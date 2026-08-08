"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Paperclip, Search, Send } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { mockMessages, mockThreads } from "@/lib/mock/messaging";
import { THREAD_CONTEXT_LABELS, type Message } from "@/lib/types/messaging";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

// Messagerie contextuelle — voir ACTIONS.md § 22. « Il n'y a pas de messagerie générale : chaque
// fil est rattaché à un objet. » Deux panneaux partagés entre /messages et /messages/:thread
// (composant propre au module, pas dans components/ui — voir README.md § Conventions).
interface MessagesShellProps {
  activeThreadId?: string;
}

export function MessagesShell({ activeThreadId }: MessagesShellProps) {
  const { ctx } = useSession();
  const [query, setQuery] = useState("");
  const [threads, setThreads] = useState(() => mockThreads[ctx.organization.id] ?? []);
  const [messagesByThread, setMessagesByThread] = useState(() => mockMessages);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const visibleThreads = useMemo(
    () =>
      threads
        .filter((t) => !t.isArchived)
        .filter((t) => !query.trim() || t.subject.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()),
    [threads, query],
  );

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;
  const activeMessages: Message[] = activeThread ? messagesByThread[activeThread.id] ?? [] : [];

  function sendMessage() {
    if (!activeThread || !draft.trim()) return;
    const newMessage: Message = {
      id: `msg-${Date.now()}`,
      threadId: activeThread.id,
      authorId: ctx.user.id,
      authorName: `${ctx.user.firstName} ${ctx.user.lastName}`,
      authorInitials: `${ctx.user.firstName[0] ?? ""}${ctx.user.lastName[0] ?? ""}`.toUpperCase(),
      isSportvision: false,
      body: draft.trim(),
      attachments: [],
      visibility: "client_visible",
      seenByNames: [],
      createdAt: new Date().toISOString(),
    };
    setMessagesByThread((prev) => ({ ...prev, [activeThread.id]: [...(prev[activeThread.id] ?? []), newMessage] }));
    setThreads((prev) =>
      prev.map((t) => (t.id === activeThread.id ? { ...t, lastMessagePreview: draft.trim(), lastMessageAt: newMessage.createdAt, unreadCount: 0 } : t)),
    );
    setDraft("");
  }

  function toggleArchive() {
    if (!activeThread) return;
    setThreads((prev) => prev.map((t) => (t.id === activeThread.id ? { ...t, isArchived: !t.isArchived } : t)));
    setMenuOpen(false);
  }

  function markUnread() {
    if (!activeThread) return;
    setThreads((prev) => prev.map((t) => (t.id === activeThread.id ? { ...t, unreadCount: Math.max(1, t.unreadCount) } : t)));
    setMenuOpen(false);
  }

  return (
    <div className="grid h-[calc(100vh-140px)] grid-cols-1 overflow-hidden rounded-sv-card border border-border bg-surface md:grid-cols-[300px_1fr]">
      <div className="flex flex-col border-r border-divider">
        <div className="border-b border-divider p-3.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une conversation…"
              className="h-9 w-full rounded-lg border border-border-strong bg-input-bg pl-8 pr-3 text-[12.5px] outline-none focus-visible:border-brand-blue"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {visibleThreads.length === 0 && (
            <div className="p-5 text-center text-[12.5px] text-text-soft">Aucune conversation.</div>
          )}
          {visibleThreads.map((thread) => {
            const other = thread.participants.find((p) => p.isSportvision) ?? thread.participants[0];
            const active = thread.id === activeThreadId;
            return (
              <Link
                key={thread.id}
                href={`/messages/${thread.id}`}
                className={cn(
                  "flex items-start gap-2.5 border-b border-divider px-3.5 py-3 transition-colors duration-sv hover:bg-row-hover",
                  active && "bg-info-bg",
                )}
              >
                <span className="relative flex-none">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[11px] font-extrabold text-white">
                    {other?.avatarInitials ?? "SV"}
                  </span>
                  {other?.isOnline && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-success-fg" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-extrabold">{thread.subject}</span>
                    {thread.unreadCount > 0 && (
                      <span className="flex h-[18px] min-w-[18px] flex-none items-center justify-center rounded-full bg-brand-blue px-1 text-[10px] font-extrabold text-white">
                        {thread.unreadCount}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-text-soft">{thread.lastMessagePreview}</span>
                  <span className="mt-1 inline-block text-[10.5px] font-bold uppercase tracking-[.04em] text-text-faint">
                    {THREAD_CONTEXT_LABELS[thread.contextType]}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex min-w-0 flex-col">
        {!activeThread ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-[13.5px] text-text-soft">
            Sélectionnez une conversation pour afficher le fil.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-divider px-5 py-3.5">
              <div className="min-w-0">
                <div className="truncate text-[14.5px] font-extrabold tracking-tight">{activeThread.subject}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-text-soft">
                  {activeThread.contextHref ? (
                    <Link href={activeThread.contextHref} className="font-bold text-brand-blue-electric hover:underline">
                      {activeThread.contextLabel}
                    </Link>
                  ) : (
                    <span>{activeThread.contextLabel}</span>
                  )}
                  {activeThread.sportvisionRoleLabel && <Badge tone="info">{activeThread.sportvisionRoleLabel}</Badge>}
                </div>
              </div>
              <div className="relative flex-none">
                <button
                  aria-label="Options de la conversation"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-text-soft hover:bg-surface-sunken"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </button>
                {menuOpen && (
                  <div className="animate-svfade absolute right-0 top-9 z-10 w-44 rounded-xl border border-border bg-elevated p-1.5 shadow-sv-dropdown">
                    <button onClick={toggleArchive} className="block w-full rounded-lg px-3 py-2 text-left text-[12.5px] font-semibold hover:bg-row-hover">
                      {activeThread.isArchived ? "Désarchiver" : "Archiver"}
                    </button>
                    <button onClick={markUnread} className="block w-full rounded-lg px-3 py-2 text-left text-[12.5px] font-semibold hover:bg-row-hover">
                      Marquer non lu
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4">
              {activeMessages.map((m) => (
                <div key={m.id} className={cn("flex items-start gap-2.5", !m.isSportvision && "flex-row-reverse")}>
                  <span
                    className={cn(
                      "flex h-8 w-8 flex-none items-center justify-center rounded-full text-[10.5px] font-extrabold text-white",
                      m.isSportvision ? "bg-gradient-to-br from-brand-blue-electric to-brand-violet" : "bg-gradient-to-br from-brand-violet to-brand-blue-electric",
                    )}
                  >
                    {m.authorInitials}
                  </span>
                  <div className={cn("flex max-w-[70%] flex-col gap-1", !m.isSportvision && "items-end")}>
                    <div
                      className={cn(
                        "rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                        m.isSportvision ? "bg-surface-alt text-text" : "bg-gradient-to-br from-brand-blue to-brand-violet text-white",
                      )}
                    >
                      {m.body}
                      {m.attachments.map((a) => (
                        <div key={a.id} className="mt-2 flex items-center gap-1.5 rounded-lg bg-black/15 px-2.5 py-1.5 text-[11.5px] font-semibold">
                          <Paperclip className="h-3 w-3" aria-hidden />
                          {a.name}
                        </div>
                      ))}
                    </div>
                    <span className="text-[10.5px] font-semibold text-text-faint">
                      {m.authorName} · {new Date(m.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      {m.seenByNames.length > 0 && ` · Vu par ${m.seenByNames.join(", ")}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2.5 border-t border-divider px-4 py-3.5">
              <button aria-label="Joindre un fichier ou une image" className="flex h-10 w-10 flex-none items-center justify-center rounded-xl text-text-soft hover:bg-surface-sunken">
                <Paperclip className="h-4 w-4" aria-hidden />
              </button>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendMessage();
                }}
                placeholder="Écrire un message…"
                className="h-10 flex-1 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[13.5px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]"
              />
              <Button className="h-10 flex-none px-3.5" disabled={!draft.trim()} onClick={sendMessage}>
                <Send className="h-4 w-4" aria-hidden />
                Envoyer
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
