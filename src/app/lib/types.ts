// Shared types for the GeoQuery vision pipeline.

export type ClassLabel =
  | "building"
  | "road"
  | "vehicle"
  | "vegetation"
  | "water body"
  | "open ground";

export const CLASS_LABELS: ClassLabel[] = [
  "building",
  "road",
  "vehicle",
  "vegetation",
  "water body",
  "open ground",
];

// Colours used for bounding boxes / legend, one per class.
export const CLASS_COLORS: Record<ClassLabel, string> = {
  building: "#f97316", // orange
  road: "#64748b", // slate
  vehicle: "#ef4444", // red
  vegetation: "#22c55e", // green
  "water body": "#3b82f6", // blue
  "open ground": "#d4a24e", // tan
};

export interface Detection {
  id: string;
  label: ClassLabel;
  confidence: number; // 0..1
  // Bounding box in normalised [0..1] coordinates relative to the analysed image.
  box: { x: number; y: number; w: number; h: number };
  attribute: string; // one key attribute, e.g. dominant colour
  areaFraction: number; // fraction of total image area this box covers
  dominantColor: string; // human colour name
}

export interface AnalysisResult {
  width: number; // analysed (possibly resized) pixel width
  height: number;
  caption: string;
  detections: Detection[];
  // Fraction of image covered by each class (0..1), from per-pixel segmentation.
  coverage: Record<ClassLabel, number>;
  counts: Record<ClassLabel, number>;
}
