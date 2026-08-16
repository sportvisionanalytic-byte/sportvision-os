"use client";

import { useRef } from "react";
import { Download, FileText, Upload } from "lucide-react";
import type { ServiceFile } from "@/lib/types/services";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} Mo`;
  return `${Math.round(bytes / 1_000)} Ko`;
}

export function FilesTab({
  files,
  onAddFile,
}: {
  files: ServiceFile[];
  onAddFile: (file: { name: string; sizeBytes: number }) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onAddFile({ name: file.name, sizeBytes: file.size });
    e.target.value = "";
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-extrabold tracking-tight">{files.length} fichier{files.length > 1 ? "s" : ""}</div>
        <Button variant="secondary" onClick={() => inputRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Ajouter un fichier
        </Button>
        <input ref={inputRef} type="file" className="hidden" onChange={handleFileChange} />
      </div>

      <div className="mt-3.5 flex flex-col gap-2.5">
        {files.length === 0 ? (
          <EmptyState variant="compact" title="Aucun fichier partagé pour le moment" />
        ) : (
          files.map((file) => (
            <div key={file.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-alt p-3">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-info-bg text-info-fg">
                <FileText className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-text">{file.name}</span>
                <span className="block text-[11.5px] text-text-faint">
                  {formatFileSize(file.sizeBytes)} · ajouté par {file.uploadedByName}
                </span>
              </span>
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                aria-label={`Télécharger ${file.name}`}
                className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-text-soft hover:bg-surface-sunken"
              >
                <Download className="h-4 w-4" aria-hidden />
              </a>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
