// Visual Question Answering engine.
//
// Parses free-form natural-language queries, infers intent (detection request,
// binary, numeric, attribute, caption, out-of-scope) and produces an answer
// grounded in the AnalysisResult. Supports lightweight multi-turn context via a
// "last referenced class" carried between turns ("how many of those are ...").

import { AnalysisResult, ClassLabel, CLASS_LABELS } from "./types";

export interface VqaContext {
  lastClass: ClassLabel | null;
}

export interface VqaResponse {
  answer: string;
  // If set, the overlay should highlight only these classes.
  highlightClasses?: ClassLabel[];
  intent: string;
  context: VqaContext;
}

const CLASS_SYNONYMS: Record<string, ClassLabel> = {
  building: "building",
  buildings: "building",
  house: "building",
  houses: "building",
  rooftop: "building",
  rooftops: "building",
  structure: "building",
  structures: "building",
  road: "road",
  roads: "road",
  street: "road",
  streets: "road",
  highway: "road",
  path: "road",
  vehicle: "vehicle",
  vehicles: "vehicle",
  car: "vehicle",
  cars: "vehicle",
  truck: "vehicle",
  trucks: "vehicle",
  bus: "vehicle",
  buses: "vehicle",
  vegetation: "vegetation",
  tree: "vegetation",
  trees: "vegetation",
  grass: "vegetation",
  forest: "vegetation",
  greenery: "vegetation",
  crop: "vegetation",
  crops: "vegetation",
  field: "vegetation",
  fields: "vegetation",
  water: "water body",
  "water body": "water body",
  "water bodies": "water body",
  lake: "water body",
  river: "water body",
  pond: "water body",
  sea: "water body",
  ocean: "water body",
  "open ground": "open ground",
  ground: "open ground",
  land: "open ground",
  soil: "open ground",
  sand: "open ground",
  "bare land": "open ground",
};

const OUT_OF_SCOPE = [
  "person",
  "people",
  "human",
  "animal",
  "dog",
  "cat",
  "airplane",
  "plane",
  "boat",
  "ship",
  "bicycle",
  "sign",
  "traffic light",
  "cloud",
  "sky",
];

function findClasses(q: string): ClassLabel[] {
  const found = new Set<ClassLabel>();
  // multi-word first
  for (const key of Object.keys(CLASS_SYNONYMS).sort((a, b) => b.length - a.length)) {
    if (q.includes(key)) found.add(CLASS_SYNONYMS[key]);
  }
  return [...found];
}

function pct(n: number): number {
  return Math.round(n * 100);
}

export function answerQuery(
  raw: string,
  result: AnalysisResult,
  ctx: VqaContext,
): VqaResponse {
  const q = raw.toLowerCase().trim();
  const classes = findClasses(q);
  const primary = classes[0] ?? ctx.lastClass;
  const newCtx: VqaContext = { lastClass: primary ?? ctx.lastClass };

  // Out-of-scope object check (only if no supported class matched).
  if (classes.length === 0) {
    const oos = OUT_OF_SCOPE.find((w) => new RegExp(`\\b${w}\\b`).test(q));
    if (oos && /\b(is|are|how many|count|detect|find|mark|show|where)\b/.test(q)) {
      return {
        intent: "out-of-scope",
        context: newCtx,
        answer: `"${oos}" is outside GeoQuery's supported classes. I can only reason about: ${CLASS_LABELS.join(", ")}.`,
      };
    }
  }

  // Caption / describe intent.
  if (/\b(describe|caption|what.*(see|image|scene|photo)|summar)/.test(q) && !primary) {
    return {
      intent: "caption",
      context: newCtx,
      answer: result.caption,
    };
  }

  // Detection / "mark all" intent.
  if (/\b(mark|highlight|show|detect|find|identify|locate|box)\b/.test(q)) {
    if (!primary) {
      return {
        intent: "detect-all",
        context: newCtx,
        highlightClasses: CLASS_LABELS,
        answer: `Showing all detected objects: ${CLASS_LABELS.map(
          (c) => `${result.counts[c]} ${c}`,
        ).join(", ")}.`,
      };
    }
    const n = result.counts[primary];
    return {
      intent: "detect-class",
      context: newCtx,
      highlightClasses: [primary],
      answer:
        n > 0
          ? `Highlighted ${n} ${primary}${n === 1 ? "" : " region(s)"} on the image.`
          : `I could not localise any ${primary} in this image.`,
    };
  }

  // Numeric ("how many", "count", "number of", "fraction").
  if (/\b(how many|count|number of)\b/.test(q)) {
    if (!primary) {
      return {
        intent: "numeric",
        context: newCtx,
        answer: "Which class would you like me to count? (building, road, vehicle, vegetation, water body, open ground)",
      };
    }
    const n = result.counts[primary];
    return {
      intent: "numeric",
      context: newCtx,
      highlightClasses: [primary],
      answer: `I detect ${n} ${primary}${n === 1 ? "" : n === 0 ? "s" : " instances"} in the image.`,
    };
  }

  if (/\b(fraction|percentage|percent|how much|proportion|coverage|cover)\b/.test(q) && primary) {
    return {
      intent: "coverage",
      context: newCtx,
      highlightClasses: [primary],
      answer: `${primary} covers approximately ${pct(result.coverage[primary])}% of the image area.`,
    };
  }

  // Binary ("is there", "are there", "does", "can you see").
  if (/\b(is there|are there|is a|are any|do you see|can you see|does the image|any )\b/.test(q) || /^(is|are|does|do)\b/.test(q)) {
    if (primary) {
      const present = result.counts[primary] > 0 || result.coverage[primary] > 0.02;
      return {
        intent: "binary",
        context: newCtx,
        highlightClasses: present ? [primary] : undefined,
        answer: present
          ? `Yes — there ${result.counts[primary] === 1 ? "is" : "are"} ${result.counts[primary] || "some"} ${primary} visible in the image.`
          : `No, I do not detect any ${primary} in this image.`,
      };
    }
  }

  // Attribute ("what colour", "what color", "size").
  if (/\b(colour|color|attribute|shade)\b/.test(q) && primary) {
    const dets = result.detections
      .filter((d) => d.label === primary)
      .sort((a, b) => b.areaFraction - a.areaFraction);
    if (dets.length === 0) {
      return {
        intent: "attribute",
        context: newCtx,
        answer: `I could not find a ${primary} to describe its colour.`,
      };
    }
    const target = dets[0];
    return {
      intent: "attribute",
      context: newCtx,
      highlightClasses: [primary],
      answer: `The most prominent ${primary} appears ${target.dominantColor} (${target.attribute}), at ~${pct(target.confidence)}% confidence.`,
    };
  }

  if (/\b(size|large|biggest|largest|small)\b/.test(q) && primary) {
    const dets = result.detections
      .filter((d) => d.label === primary)
      .sort((a, b) => b.areaFraction - a.areaFraction);
    if (dets.length) {
      return {
        intent: "attribute",
        context: newCtx,
        highlightClasses: [primary],
        answer: `The largest ${primary} covers about ${pct(dets[0].areaFraction)}% of the image (${dets[0].attribute}).`,
      };
    }
  }

  // Fallback: describe what we know about the referenced class, else caption.
  if (primary) {
    const n = result.counts[primary];
    return {
      intent: "info",
      context: newCtx,
      highlightClasses: n > 0 ? [primary] : undefined,
      answer:
        n > 0
          ? `Regarding ${primary}: I detect ${n} instance(s) covering ~${pct(result.coverage[primary])}% of the image.`
          : `I don't detect any ${primary} in this image. It covers ~${pct(result.coverage[primary])}% by segmentation.`,
    };
  }

  return {
    intent: "caption",
    context: newCtx,
    answer:
      result.caption +
      " You can ask me to count objects, mark a class, check colours, or ask yes/no questions.",
  };
}
