// Exports the annotated image + Q&A transcript as a PDF (innovation bonus).

import { jsPDF } from "jspdf";
import { AnalysisResult, CLASS_COLORS, Detection } from "./types";

export interface ChatEntry {
  role: "user" | "assistant";
  text: string;
}

// jsPDF's core fonts only support the WinAnsi (Latin-1) range; emoji and other
// non-Latin glyphs render as mojibake ("Ø=Ü÷"). Strip anything outside the
// printable Latin range before writing text.
function sanitize(text: string): string {
  return text
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Draws the image with bounding boxes onto an offscreen canvas and returns a PNG.
function renderAnnotated(
  source: HTMLCanvasElement,
  detections: Detection[],
): string {
  const w = source.width;
  const h = source.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0, w, h);
  ctx.lineWidth = Math.max(2, w / 400);
  ctx.font = `${Math.max(12, w / 60)}px sans-serif`;
  for (const d of detections) {
    ctx.strokeStyle = CLASS_COLORS[d.label];
    ctx.fillStyle = CLASS_COLORS[d.label];
    const x = d.box.x * w;
    const y = d.box.y * h;
    const bw = d.box.w * w;
    const bh = d.box.h * h;
    ctx.strokeRect(x, y, bw, bh);
    ctx.fillText(`${d.label} ${Math.round(d.confidence * 100)}%`, x, Math.max(12, y - 4));
  }
  return canvas.toDataURL("image/png");
}

export function exportPdf(
  source: HTMLCanvasElement,
  result: AnalysisResult,
  transcript: ChatEntry[],
) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  doc.setFontSize(18);
  doc.setTextColor(3, 2, 19);
  doc.text("GeoQuery — Analysis Report", margin, y);
  y += 20;
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(new Date().toLocaleString(), margin, y);
  y += 20;

  // Annotated image
  const imgData = renderAnnotated(source, result.detections);
  const maxImgW = pageW - margin * 2;
  const ratio = source.height / source.width;
  const imgW = maxImgW;
  const imgH = imgW * ratio;
  doc.addImage(imgData, "PNG", margin, y, imgW, Math.min(imgH, 300));
  y += Math.min(imgH, 300) + 20;

  doc.setFontSize(12);
  doc.setTextColor(3, 2, 19);
  doc.text("Caption", margin, y);
  y += 16;
  doc.setFontSize(10);
  doc.setTextColor(40);
  const capLines = doc.splitTextToSize(sanitize(result.caption), pageW - margin * 2);
  doc.text(capLines, margin, y);
  y += capLines.length * 13 + 12;

  doc.setFontSize(12);
  doc.setTextColor(3, 2, 19);
  doc.text("Detection summary", margin, y);
  y += 16;
  doc.setFontSize(10);
  doc.setTextColor(40);
  for (const c of Object.keys(result.counts) as (keyof typeof result.counts)[]) {
    const [r, g, b] = hexToRgb(CLASS_COLORS[c]);
    doc.setFillColor(r, g, b);
    doc.rect(margin, y - 7, 8, 8, "F");
    doc.text(
      `${c}: ${result.counts[c]} object(s), ${Math.round(result.coverage[c] * 100)}% coverage`,
      margin + 14,
      y,
    );
    y += 14;
  }
  y += 10;

  // Transcript (new page if needed)
  const ensure = (need: number) => {
    if (y + need > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
    }
  };
  doc.setFontSize(12);
  doc.setTextColor(3, 2, 19);
  ensure(30);
  doc.text("Q&A transcript", margin, y);
  y += 16;
  doc.setFontSize(10);
  for (const e of transcript) {
    const prefix = e.role === "user" ? "You: " : "GeoQuery: ";
    doc.setTextColor(e.role === "user" ? 3 : 249, e.role === "user" ? 2 : 115, e.role === "user" ? 19 : 22);
    const lines = doc.splitTextToSize(prefix + sanitize(e.text), pageW - margin * 2);
    ensure(lines.length * 13 + 6);
    doc.text(lines, margin, y);
    y += lines.length * 13 + 6;
  }

  doc.save("geoquery-report.pdf");
}
