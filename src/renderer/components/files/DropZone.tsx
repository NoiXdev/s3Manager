import { useState, type ReactNode } from 'react';

export function DropZone({
  onDropFiles,
  children,
}: {
  onDropFiles: (files: File[]) => void;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      data-testid="dropzone"
      className="relative h-full"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length) onDropFiles(files);
      }}
    >
      {children}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-slate-400 bg-slate-100/80 text-slate-600">
          Drop files to upload
        </div>
      )}
    </div>
  );
}
