import { useCallback, useEffect, useRef, useState } from "react";
import { Satellite, Send, RotateCcw, FileDown, Sparkles } from "lucide-react";
import { Toaster } from "./components/ui/sonner";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { ScrollArea } from "./components/ui/scroll-area";
import { UploadZone } from "./components/UploadZone";
import { ImageViewer } from "./components/ImageViewer";
import { DetectionPanel } from "./components/DetectionPanel";
import {
  analyze,
  loadAndPrepareImage,
  LoadedImage,
  UnsupportedTypeError,
} from "./lib/engine";
import { answerQuery, VqaContext } from "./lib/vqa";
import { AnalysisResult, ClassLabel, Detection } from "./lib/types";
import { exportPdf } from "./lib/exportReport";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}

const SUGGESTIONS = [
  "Describe the image",
  "Mark all vehicles",
  "How many buildings are visible?",
  "Is there a water body?",
  "What fraction is vegetation?",
];

let msgId = 0;
const nextId = () => `m${msgId++}`;

export default function App() {
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [highlight, setHighlight] = useState<ClassLabel[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const ctxRef = useRef<VqaContext>({ lastClass: null });
  const scrollRef = useRef<HTMLDivElement>(null);

  const addMessage = (role: Message["role"], text: string) =>
    setMessages((m) => [...m, { id: nextId(), role, text }]);

  useEffect(() => {
    const el = scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleFile = useCallback(async (file: File) => {
    setAnalyzing(true);
    try {
      const img = await loadAndPrepareImage(file);
      const res = analyze(img);
      setLoaded(img);
      setResult(res);
      setHighlight(null);
      setSelectedId(null);
      ctxRef.current = { lastClass: null };
      const notes: string[] = [];
      if (img.resized) {
        notes.push(
          `Image resized from ${img.originalWidth}×${img.originalHeight} to ${img.width}×${img.height} to satisfy the 1024 px limit.`,
        );
      }
      const activeClasses = (Object.keys(res.counts) as ClassLabel[]).filter(
        (c) => res.counts[c] > 0,
      ).length;
      setMessages([
        {
          id: nextId(),
          role: "assistant",
          text:
            `📷 **Caption:** ${res.caption}\n\n` +
            `I detected ${res.detections.length} object(s) across ${activeClasses} class(es). ${notes.join(" ")}\n\n` +
            `Ask me anything — count objects, mark a class, check colours, or ask yes/no questions.`,
        },
      ]);
      if (img.resized) toast.info("Large image auto-resized to 1024 px.");
    } catch (e) {
      if (e instanceof UnsupportedTypeError) {
        toast.error(e.message);
      } else {
        toast.error("Something went wrong while analysing the image.");
      }
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const submitQuery = (raw: string) => {
    const q = raw.trim();
    if (!q || !result) return;
    addMessage("user", q);
    setInput("");
    const resp = answerQuery(q, result, ctxRef.current);
    ctxRef.current = resp.context;
    setHighlight(resp.highlightClasses ?? null);
    setSelectedId(null);
    setTimeout(() => addMessage("assistant", resp.answer), 150);
  };

  const handleSelectDetection = (d: Detection) => {
    setSelectedId(d.id);
    setHighlight([d.label]);
    addMessage(
      "assistant",
      `🔍 Selected object: a **${d.label}** at ${Math.round(
        d.confidence * 100,
      )}% confidence. Attributes: ${d.attribute} (dominant colour: ${
        d.dominantColor
      }), covering ~${Math.round(d.areaFraction * 100)}% of the image.`,
    );
  };

  const reset = () => {
    setLoaded(null);
    setResult(null);
    setMessages([]);
    setHighlight(null);
    setSelectedId(null);
    ctxRef.current = { lastClass: null };
  };

  const handleExport = () => {
    if (!loaded || !result) return;
    exportPdf(
      loaded.canvas,
      result,
      messages.map((m) => ({ role: m.role, text: m.text.replace(/\*\*/g, "") })),
    );
    toast.success("Report exported as PDF.");
  };

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground">
      <Toaster position="top-center" richColors />
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Satellite className="size-5" />
          </div>
          <div>
            <h1 className="leading-tight">GeoQuery</h1>
            <p className="text-xs text-muted-foreground">
              Natural-language understanding of RGB imagery
            </p>
          </div>
        </div>
        {result && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}>
              <FileDown className="size-4" /> Export PDF
            </Button>
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="size-4" /> New image
            </Button>
          </div>
        )}
      </header>

      {/* Body */}
      {!result ? (
        <div className="flex-1 overflow-auto">
          {analyzing ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Sparkles className="mr-2 size-5 animate-pulse" /> Analysing image…
            </div>
          ) : (
            <UploadZone onFile={handleFile} />
          )}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_320px_400px]">
          {/* Image + overlay */}
          <div className="flex min-h-0 flex-col items-center justify-center overflow-auto border-b border-border p-4 lg:border-b-0 lg:border-r">
            {loaded && (
              <ImageViewer
                imageUrl={loaded.dataUrl}
                detections={result.detections}
                highlight={highlight}
                onSelectDetection={handleSelectDetection}
                selectedId={selectedId}
              />
            )}
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Click any bounding box for an object-level description.
            </p>
          </div>

          {/* Detection panel */}
          <div className="min-h-0 overflow-hidden border-b border-border p-4 lg:border-b-0 lg:border-r">
            <DetectionPanel
              result={result}
              onSelectDetection={handleSelectDetection}
              selectedId={selectedId}
            />
          </div>

          {/* Chat */}
          <div className="flex min-h-0 flex-col" ref={scrollRef}>
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-3 p-4">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${
                      m.role === "user"
                        ? "self-end bg-primary text-primary-foreground"
                        : "self-start bg-muted"
                    }`}
                    dangerouslySetInnerHTML={{
                      __html: m.text.replace(
                        /\*\*(.+?)\*\*/g,
                        "<strong>$1</strong>",
                      ),
                    }}
                  />
                ))}
              </div>
            </ScrollArea>

            {/* Suggestions */}
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => submitQuery(s)}
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Input */}
            <form
              className="flex gap-2 border-t border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                submitQuery(input);
              }}
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about the image…"
              />
              <Button type="submit" size="icon" disabled={!input.trim()}>
                <Send className="size-4" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
