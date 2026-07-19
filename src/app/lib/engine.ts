// GeoQuery in-browser vision engine.
//
// This module performs REAL analysis on the uploaded image's pixels. Because
// commercial vision APIs are disallowed by the problem statement and this is a
// pure-frontend deployment, we implement a deterministic, explainable pipeline:
//
//   1. Decode + resize the image (enforcing the 1024x1024 constraint).
//   2. Per-cell HSV classification into the six target classes on a grid.
//   3. Connected-component grouping of same-class cells into bounding boxes.
//   4. Blob-based vehicle detection over road / open-ground regions.
//   5. Coverage statistics + a natural-language caption.
//
// The output feeds both the bounding-box overlay and the VQA answer engine so
// that every answer is grounded in measurable image evidence.

import { rgbToHsv, colorName } from "./color";
import {
  AnalysisResult,
  ClassLabel,
  CLASS_LABELS,
  Detection,
} from "./types";

export const MAX_DIM = 1024;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png"];

export class ImageTooLargeError extends Error {}
export class UnsupportedTypeError extends Error {}

// ---- Image loading -------------------------------------------------------

export interface LoadedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  resized: boolean;
  originalWidth: number;
  originalHeight: number;
  dataUrl: string;
}

export function loadAndPrepareImage(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      reject(
        new UnsupportedTypeError(
          `Unsupported file type "${file.type || "unknown"}". GeoQuery only accepts .jpg and .png RGB images.`,
        ),
      );
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const originalWidth = img.naturalWidth;
      const originalHeight = img.naturalHeight;
      let { width, height } = { width: originalWidth, height: originalHeight };
      let resized = false;
      const maxSide = Math.max(width, height);
      if (maxSide > MAX_DIM) {
        const scale = MAX_DIM / maxSide;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        resized = true;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve({
        canvas,
        width,
        height,
        resized,
        originalWidth,
        originalHeight,
        dataUrl: canvas.toDataURL("image/png"),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new UnsupportedTypeError("The file could not be read as an image."));
    };
    img.src = url;
  });
}

// ---- Per-cell classification --------------------------------------------

type CellClass = ClassLabel | "sky" | "unknown";

interface Cell {
  r: number;
  g: number;
  b: number;
  cls: CellClass;
  score: number; // match strength 0..1
  variance: number; // local texture proxy
}

function classifyCell(r: number, g: number, b: number, variance: number): {
  cls: CellClass;
  score: number;
} {
  const { h, s, v } = rgbToHsv(r, g, b);

  // Vegetation: green hue with reasonable saturation.
  if (h >= 65 && h <= 165 && s >= 0.18 && v >= 0.12) {
    return { cls: "vegetation", score: Math.min(1, s * 1.2 + 0.2) };
  }

  // Water: blue/teal, or dark bluish. Rendered/synthetic ponds are often very
  // saturated with hard edges, so the variance ceiling is relaxed and the hue
  // window widened toward cyan.
  if (h >= 170 && h <= 265 && s >= 0.12 && variance < 2000) {
    return { cls: "water body", score: Math.min(1, s + 0.25) };
  }

  // Open ground: tan / brown / sandy / yellow (warm hue through yellow).
  // Widened to include highly saturated synthetic yellows.
  if (h >= 20 && h <= 70 && s >= 0.1 && s <= 0.9 && v >= 0.28) {
    return { cls: "open ground", score: 0.55 + Math.min(s, 0.6) * 0.3 };
  }

  // Bright rooftops / structures: high brightness, or warm saturated roof, with texture.
  if (v > 0.6 && variance > 500) {
    return { cls: "building", score: Math.min(1, 0.4 + variance / 4000) };
  }
  if ((h < 20 || h >= 345) && s > 0.35 && v > 0.35) {
    // reddish rooftops
    return { cls: "building", score: 0.55 + s * 0.25 };
  }

  // Sky: very bright, low saturation, blue-ish, smooth — excluded from targets.
  if (v > 0.75 && s < 0.18 && variance < 300) {
    return { cls: "sky", score: 0.5 };
  }

  // Road: low-saturation grey, mid brightness, some texture.
  if (s < 0.2 && v >= 0.2 && v <= 0.7) {
    return { cls: "road", score: 0.5 + (0.2 - s) };
  }

  return { cls: "unknown", score: 0.2 };
}

// ---- Grid extraction -----------------------------------------------------

interface Grid {
  cols: number;
  rows: number;
  cells: Cell[][]; // [row][col]
  cellW: number;
  cellH: number;
}

function buildGrid(canvas: HTMLCanvasElement): Grid {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height).data;

  const cols = Math.max(12, Math.min(48, Math.round(width / 22)));
  const rows = Math.max(12, Math.min(48, Math.round(height / 22)));
  const cellW = width / cols;
  const cellH = height / rows;

  const cells: Cell[][] = [];
  for (let ry = 0; ry < rows; ry++) {
    const row: Cell[] = [];
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor(cx * cellW);
      const y0 = Math.floor(ry * cellH);
      const x1 = Math.min(width, Math.floor((cx + 1) * cellW));
      const y1 = Math.min(height, Math.floor((ry + 1) * cellH));
      let sr = 0, sg = 0, sb = 0, n = 0;
      let sr2 = 0;
      // Sample every 2px for speed.
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * width + x) * 4;
          const r = img[i], g = img[i + 1], b = img[i + 2];
          sr += r; sg += g; sb += b;
          sr2 += (r * r + g * g + b * b) / 3;
          n++;
        }
      }
      n = n || 1;
      const r = sr / n, g = sg / n, b = sb / n;
      const mean = (r + g + b) / 3;
      const variance = Math.max(0, sr2 / n - mean * mean);
      const { cls, score } = classifyCell(r, g, b, variance);
      row.push({ r, g, b, cls, score, variance });
    }
    cells.push(row);
  }
  return { cols, rows, cells, cellW, cellH };
}

// ---- Connected components -> bounding boxes ------------------------------

function connectedBoxes(
  grid: Grid,
  target: ClassLabel,
  match: (c: Cell) => boolean,
  minCells: number,
): { box: { x: number; y: number; w: number; h: number }; cells: Cell[] }[] {
  const { cols, rows, cells } = grid;
  const seen = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const out: { box: { x: number; y: number; w: number; h: number }; cells: Cell[] }[] = [];

  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      if (seen[ry][cx] || !match(cells[ry][cx])) continue;
      // BFS
      const queue = [[ry, cx]];
      seen[ry][cx] = true;
      let minR = ry, maxR = ry, minC = cx, maxC = cx;
      const comp: Cell[] = [];
      while (queue.length) {
        const [r, c] = queue.pop()!;
        comp.push(cells[r][c]);
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
        const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
        for (const [nr, nc] of nb) {
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          if (seen[nr][nc] || !match(cells[nr][nc])) continue;
          seen[nr][nc] = true;
          queue.push([nr, nc]);
        }
      }
      if (comp.length < minCells) continue;
      out.push({
        box: {
          x: minC / cols,
          y: minR / rows,
          w: (maxC - minC + 1) / cols,
          h: (maxR - minR + 1) / rows,
        },
        cells: comp,
      });
    }
  }
  return out;
}

function avgColor(cells: Cell[]): { r: number; g: number; b: number } {
  const s = cells.reduce(
    (a, c) => ({ r: a.r + c.r, g: a.g + c.g, b: a.b + c.b }),
    { r: 0, g: 0, b: 0 },
  );
  const n = cells.length || 1;
  return { r: s.r / n, g: s.g / n, b: s.b / n };
}

function sizeWord(frac: number): string {
  if (frac > 0.25) return "very large";
  if (frac > 0.1) return "large";
  if (frac > 0.03) return "medium";
  return "small";
}

// ---- Vehicle detection ---------------------------------------------------
// The hard part of pixel-heuristic detection is separating a real vehicle from
// a high-contrast *edge* (building corner, shoreline, tree/grass boundary). Both
// produce local contrast. The distinguishing property: a real vehicle is a SMALL
// ISLAND fully surrounded by UNIFORM driveable surface (road OR open ground),
// whereas an edge always has a non-surface class (vegetation / water / building)
// on at least one side.
//
// Pipeline: (1) mark candidate cells that (a) sit over a surface, (b) are
// enclosed on almost all 8 sides by ONE dominant, low-variance surface class,
// and (c) contrast with that surface; (2) group candidates into compact blobs;
// (3) apply a size gate. This eliminates the edge false-positives.
function detectVehicles(grid: Grid): Detection[] {
  const { cols, rows, cells } = grid;
  // NOTE: buildings are deliberately NOT surface — cars don't sit on rooftops,
  // and building edges were the biggest source of false positives.
  const surfaceLike = (c: Cell) =>
    c.cls === "road" || c.cls === "open ground";

  // 1. Candidate mask + per-cell contrast score.
  const cand: boolean[][] = Array.from({ length: rows }, () =>
    new Array(cols).fill(false),
  );
  const contrastScore: number[][] = Array.from({ length: rows }, () =>
    new Array(cols).fill(0),
  );

  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      const cell = cells[ry][cx];
      if (
        cell.cls === "vegetation" ||
        cell.cls === "water body" ||
        cell.cls === "sky"
      ) {
        continue;
      }

      // (a) Enclosure test — of the 8 immediate neighbours, almost all must be
      // driveable surface. Any vegetation/water/building neighbour means we are
      // on a region boundary, not on an isolated object.
      let surf8 = 0;
      let nonSurf8 = 0;
      for (const [dr, dc] of [
        [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
      ]) {
        const nr = ry + dr;
        const nc = cx + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const nb = cells[nr][nc];
        if (surfaceLike(nb)) surf8++;
        else if (nb.cls !== "sky") nonSurf8++;
      }
      // Require the cell to be embedded in surface, tolerating at most one
      // non-surface neighbour (e.g. the adjacent vehicle cell).
      if (surf8 < 6 || nonSurf8 > 1) continue;

      // (b) Surrounding surface uniformity over a 5x5 ring.
      let sumB = 0;
      let sumB2 = 0;
      let sumSat = 0;
      let n = 0;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = ry + dr;
          const nc = cx + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const nb = cells[nr][nc];
          if (!surfaceLike(nb)) continue;
          const nbB = (nb.r + nb.g + nb.b) / 3;
          sumB += nbB;
          sumB2 += nbB * nbB;
          sumSat += rgbToHsv(nb.r, nb.g, nb.b).s;
          n++;
        }
      }
      if (n < 12) continue; // not enough surrounding surface → likely a boundary

      const localB = sumB / n;
      const localStd = Math.sqrt(Math.max(0, sumB2 / n - localB * localB));
      const localSat = sumSat / n;
      // Textured / patchy surroundings (e.g. dappled tree shadows) are rejected;
      // real roads / lots are fairly uniform.
      if (localStd > 42) continue;

      const b = (cell.r + cell.g + cell.b) / 3;
      const { s, v } = rgbToHsv(cell.r, cell.g, cell.b);
      const brightnessContrast = Math.abs(b - localB);

      // (c) The cell must actually stand out from that uniform surface.
      const contrasty = brightnessContrast > 45;
      const coloured = s > 0.4 && s - localSat > 0.25 && v > 0.28;
      const metallic = v > 0.88 && localB < 190;
      if (!(contrasty || coloured || metallic)) continue;

      cand[ry][cx] = true;
      contrastScore[ry][cx] =
        brightnessContrast / 255 + (coloured ? s * 0.5 : 0);
    }
  }

  // 2. Connected components over the candidate mask.
  const seen: boolean[][] = Array.from({ length: rows }, () =>
    new Array(cols).fill(false),
  );
  const out: Detection[] = [];
  let idx = 0;

  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      if (seen[ry][cx] || !cand[ry][cx]) continue;
      const queue = [[ry, cx]];
      seen[ry][cx] = true;
      let minR = ry, maxR = ry, minC = cx, maxC = cx;
      let sr = 0, sg = 0, sb = 0, sScore = 0, count = 0;
      while (queue.length) {
        const [r, c] = queue.pop()!;
        const cell = cells[r][c];
        sr += cell.r; sg += cell.g; sb += cell.b;
        sScore += contrastScore[r][c];
        count++;
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
        for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          if (seen[nr][nc] || !cand[nr][nc]) continue;
          seen[nr][nc] = true;
          queue.push([nr, nc]);
        }
      }

      // 3. Size gate — vehicles are small and compact.
      const bw = maxC - minC + 1;
      const bh = maxR - minR + 1;
      const bbCells = bw * bh;
      const fill = count / bbCells; // compactness
      if (count > 6 || bw > 4 || bh > 4) continue; // too large to be one vehicle
      if (fill < 0.5) continue; // scattered noise, not a solid object

      const r = sr / count, g = sg / count, b = sb / count;
      const avgScore = sScore / count;
      out.push({
        id: `veh-${idx++}`,
        label: "vehicle",
        confidence: Math.min(0.94, 0.5 + avgScore * 0.9),
        box: {
          x: minC / cols,
          y: minR / rows,
          w: bw / cols,
          h: bh / rows,
        },
        attribute: `${colorName(r, g, b)} vehicle`,
        areaFraction: (bw / cols) * (bh / rows),
        dominantColor: colorName(r, g, b),
      });
    }
  }

  // Keep the most confident detections; cap to avoid runaway noise counts.
  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, 15);
}

// ---- Caption -------------------------------------------------------------

function buildCaption(
  coverage: Record<ClassLabel, number>,
  counts: Record<ClassLabel, number>,
): string {
  const parts: string[] = [];
  const ordered = [...CLASS_LABELS].sort((a, b) => coverage[b] - coverage[a]);
  const present = ordered.filter((c) => coverage[c] > 0.03 || counts[c] > 0);

  if (present.length === 0) {
    return "An RGB image with no clearly identifiable target land-cover classes.";
  }

  const dominant = present[0];
  const dominantPct = Math.round(coverage[dominant] * 100);

  const descriptors: Record<ClassLabel, (pct: number, n: number) => string> = {
    vegetation: (p) => `vegetation covering roughly ${p}% of the scene`,
    "water body": (p) => `a water body spanning about ${p}% of the frame`,
    road: (p) => `road surfaces (~${p}%)`,
    building: (_p, n) => `${n} building${n === 1 ? "" : "s"}`,
    "open ground": (p) => `open ground (~${p}%)`,
    vehicle: (_p, n) => `${n} vehicle${n === 1 ? "" : "s"}`,
  };

  for (const cls of present.slice(0, 4)) {
    parts.push(descriptors[cls](Math.round(coverage[cls] * 100), counts[cls]));
  }

  const spatial =
    coverage["water body"] > 0.15
      ? " Water dominates part of the scene."
      : counts.building > 3
      ? " The layout suggests a built-up urban area."
      : coverage.vegetation > 0.4
      ? " The scene is largely natural / green."
      : "";

  const lead =
    dominantPct > 40
      ? `An overhead RGB image dominated by ${descriptors[dominant](dominantPct, counts[dominant])}.`
      : `An overhead RGB image showing ${parts.slice(0, 3).join(", ")}.`;

  const tail =
    parts.length > 1 && dominantPct > 40
      ? ` It also contains ${parts.slice(1).join(", ")}.`
      : "";

  return (lead + tail + spatial).trim();
}

// ---- Box post-processing (IoU / NMS / merge) -----------------------------

type Box = { x: number; y: number; w: number; h: number };

function iou(a: Box, b: Box): number {
  const ax2 = a.x + a.w, ay2 = a.y + a.h;
  const bx2 = b.x + b.w, by2 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni <= 0 ? 0 : inter / uni;
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: x2 - x, h: y2 - y };
}

// Non-Maximum Suppression: drop lower-confidence boxes that overlap a stronger
// one beyond `thr` IoU. Removes the duplicate boxes drawn over a single object.
function nms(dets: Detection[], thr: number): Detection[] {
  const sorted = [...dets].sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];
  for (const d of sorted) {
    if (kept.some((k) => iou(k.box, d.box) > thr)) continue;
    kept.push(d);
  }
  return kept;
}

// Iteratively fuse boxes that overlap or nearly touch into a single detection.
// Used for buildings, where one house is split into several class components.
function mergeOverlapping(dets: Detection[], thr: number): Detection[] {
  const items = [...dets];
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (iou(items[i].box, items[j].box) > thr) {
          const a = items[i], b = items[j];
          const box = union(a.box, b.box);
          const strong = a.confidence >= b.confidence ? a : b;
          items.splice(j, 1);
          items.splice(i, 1, {
            ...strong,
            box,
            confidence: Math.max(a.confidence, b.confidence),
            areaFraction: box.w * box.h,
          });
          merged = true;
          break outer;
        }
      }
    }
  }
  return items;
}

// ---- Main entry ----------------------------------------------------------

export function analyze(loaded: LoadedImage): AnalysisResult {
  const grid = buildGrid(loaded.canvas);
  const { cols, rows, cells } = grid;
  const totalCells = cols * rows;

  // Coverage per class from per-cell segmentation.
  const coverage = Object.fromEntries(
    CLASS_LABELS.map((c) => [c, 0]),
  ) as Record<ClassLabel, number>;
  for (const row of cells) {
    for (const c of row) {
      if (c.cls !== "sky" && c.cls !== "unknown") {
        coverage[c.cls as ClassLabel] += 1 / totalCells;
      }
    }
  }

  const detections: Detection[] = [];

  // Region-like classes -> connected component boxes.
  // Lower minima so small (but real) synthetic ponds / ground patches are not
  // dropped entirely — this is why water & open ground were never detected.
  const regionConfig: { cls: ClassLabel; minCells: number }[] = [
    { cls: "water body", minCells: 2 },
    { cls: "vegetation", minCells: 5 },
    { cls: "building", minCells: 3 },
    { cls: "road", minCells: 4 },
    { cls: "open ground", minCells: 3 },
  ];

  let idCounter = 0;
  for (const { cls, minCells } of regionConfig) {
    const comps = connectedBoxes(grid, cls, (c) => c.cls === cls, minCells);
    comps.sort((a, b) => b.cells.length - a.cells.length);
    const keep = cls === "building" ? comps.slice(0, 8) : comps.slice(0, 4);
    let group: Detection[] = [];
    for (const comp of keep) {
      const areaFraction = comp.box.w * comp.box.h;
      const { r, g, b } = avgColor(comp.cells);
      const avgScore =
        comp.cells.reduce((a, c) => a + c.score, 0) / comp.cells.length;
      group.push({
        id: `${cls.replace(/\s/g, "")}-${idCounter++}`,
        label: cls,
        confidence: Math.min(0.98, 0.5 + avgScore * 0.45),
        box: comp.box,
        attribute: `${sizeWord(areaFraction)}, ${colorName(r, g, b)}`,
        areaFraction,
        dominantColor: colorName(r, g, b),
      });
    }
    // Fuse split components of the same structure (e.g. one house detected as
    // several building blobs) before adding to the result set.
    if (cls === "building" || cls === "road") {
      group = mergeOverlapping(group, 0.02);
    }
    detections.push(...group);
  }

  // Vehicles — de-duplicate overlapping/split boxes with IoU-based NMS so one
  // car is not counted several times.
  detections.push(...nms(detectVehicles(grid), 0.3));

  // Counts per class.
  const counts = Object.fromEntries(
    CLASS_LABELS.map((c) => [c, 0]),
  ) as Record<ClassLabel, number>;
  for (const d of detections) counts[d.label] += 1;

  const caption = buildCaption(coverage, counts);

  return {
    width: loaded.width,
    height: loaded.height,
    caption,
    detections,
    coverage,
    counts,
  };
}
