import { useRef, useState } from "react";
import { Upload, ImageIcon } from "lucide-react";
import { CLASS_LABELS, CLASS_COLORS } from "../lib/types";

interface Props {
  onFile: (file: File) => void;
}

// Drag-and-drop + click upload zone shown before an image is loaded.
export function UploadZone({ onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (files && files[0]) onFile(files[0]);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center p-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
          dragging
            ? "border-primary bg-accent"
            : "border-border bg-card hover:bg-accent/50"
        }`}
      >
        <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-accent">
          <Upload className="size-7 text-primary" />
        </div>
        <p className="mb-1">Drop an RGB image here or click to upload</p>
        <p className="text-sm text-muted-foreground">
          JPG or PNG · max 1024×1024 px (larger images are auto-resized)
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      <div className="mt-8 w-full">
        <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <ImageIcon className="size-4" /> GeoQuery understands six land-cover
          classes:
        </p>
        <div className="flex flex-wrap gap-2">
          {CLASS_LABELS.map((c) => (
            <span
              key={c}
              className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs"
            >
              <span
                className="size-2.5 rounded-full"
                style={{ background: CLASS_COLORS[c] }}
              />
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
