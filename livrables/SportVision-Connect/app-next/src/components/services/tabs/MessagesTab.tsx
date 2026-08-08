"use client";

import { useState } from "react";
import type { ServiceMessage } from "@/lib/types/services";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

export function MessagesTab({
  messages,
  onSend,
}: {
  messages: ServiceMessage[];
  onSend: (body: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function submit() {
    if (!draft.trim()) return;
    onSend(draft.trim());
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex flex-col gap-1", m.authorSide === "client" ? "items-end" : "items-start")}>
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                m.authorSide === "client"
                  ? "rounded-br-sm bg-gradient-to-br from-brand-blue to-brand-violet text-white"
                  : "rounded-bl-sm border border-border bg-surface-alt text-text",
              )}
            >
              {m.body}
            </div>
            <span className="px-1 text-[11px] text-text-faint">
              {m.authorName} · {formatDateTime(m.createdAt)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2.5 border-t border-divider pt-4">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Écrire un message…"
          className="h-11 flex-1 rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
        />
        <Button variant="primary" onClick={submit} disabled={!draft.trim()}>
          Envoyer
        </Button>
      </div>
    </div>
  );
}
