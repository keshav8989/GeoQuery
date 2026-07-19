import { Detection, ClassLabel, CLASS_COLORS } from "../lib/types";

interface Props {
  imageUrl: string;
  detections: Detection[];
  highlight: ClassLabel[] | null; // null = show all
  onSelectDetection: (d: Detection) => void;
  selectedId?: string | null;
}

// Renders the uploaded image with axis-aligned bounding boxes overlaid.
// Boxes are positioned in normalised [0..1] coordinates so the overlay scales
// with the responsive image.
export function ImageViewer({
  imageUrl,
  detections,
  highlight,
  onSelectDetection,
  selectedId,
}: Props) {
  const visible = highlight
    ? detections.filter((d) => highlight.includes(d.label))
    : detections;

  return (
    <div className="relative inline-block max-w-full overflow-hidden rounded-xl border border-border bg-muted/30 shadow-sm">
      <img
        src={imageUrl}
        alt="Uploaded scene under analysis"
        className="block max-h-[60vh] w-auto max-w-full select-none"
        draggable={false}
      />
      <div className="pointer-events-none absolute inset-0">
        {visible.map((d) => {
          const color = CLASS_COLORS[d.label];
          const selected = d.id === selectedId;
          return (
            <button
              key={d.id}
              onClick={() => onSelectDetection(d)}
              className="pointer-events-auto absolute cursor-pointer transition-all hover:z-10"
              style={{
                left: `${d.box.x * 100}%`,
                top: `${d.box.y * 100}%`,
                width: `${d.box.w * 100}%`,
                height: `${d.box.h * 100}%`,
                border: `2px solid ${color}`,
                boxShadow: selected ? `0 0 0 2px ${color}` : "none",
                background: selected ? `${color}22` : "transparent",
                borderRadius: 3,
              }}
              title={`${d.label} · ${Math.round(d.confidence * 100)}%`}
            >
              <span
                className="absolute -top-[18px] left-0 whitespace-nowrap rounded px-1 text-[10px] leading-[16px] text-white"
                style={{ background: color }}
              >
                {d.label} {Math.round(d.confidence * 100)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
