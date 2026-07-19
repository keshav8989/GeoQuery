import { AnalysisResult, CLASS_LABELS, CLASS_COLORS, Detection } from "../lib/types";
import { ScrollArea } from "./ui/scroll-area";

interface Props {
  result: AnalysisResult;
  onSelectDetection: (d: Detection) => void;
  selectedId?: string | null;
}

// Side panel: per-class coverage bars + a scrollable list of detected objects.
export function DetectionPanel({ result, onSelectDetection, selectedId }: Props) {
  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <h3 className="mb-2 text-sm">Land-cover coverage</h3>
        <div className="space-y-2">
          {CLASS_LABELS.map((c) => {
            const pct = Math.round(result.coverage[c] * 100);
            return (
              <div key={c} className="text-xs">
                <div className="mb-0.5 flex justify-between">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: CLASS_COLORS[c] }}
                    />
                    {c}
                  </span>
                  <span className="text-muted-foreground">
                    {pct}% · {result.counts[c]} obj
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, pct)}%`,
                      background: CLASS_COLORS[c],
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <h3 className="mb-2 text-sm">
          Detected objects ({result.detections.length})
        </h3>
        <ScrollArea className="flex-1 rounded-lg border border-border">
          <div className="divide-y divide-border">
            {result.detections.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">
                No target objects detected.
              </p>
            )}
            {result.detections.map((d) => (
              <button
                key={d.id}
                onClick={() => onSelectDetection(d)}
                className={`flex w-full items-center gap-2 p-2 text-left text-xs transition-colors hover:bg-accent ${
                  selectedId === d.id ? "bg-accent" : ""
                }`}
              >
                <span
                  className="mt-0.5 size-3 shrink-0 rounded-sm"
                  style={{ background: CLASS_COLORS[d.label] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block">{d.label}</span>
                  <span className="block truncate text-muted-foreground">
                    {d.attribute}
                  </span>
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {Math.round(d.confidence * 100)}%
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
