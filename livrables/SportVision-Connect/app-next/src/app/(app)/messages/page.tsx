"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { LockedModule } from "@/components/ui/LockedModule";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useClientId } from "@/lib/data/shared/use-client-id";
import { createClient } from "@/lib/supabase/client";
import { fetchClientMessages, sendClientMessage, type ClientMessage } from "@/lib/data/shared/messages";

// /messages — un seul fil par client Portail (messages_client n'a pas de notion de thread/sujet,
// voir data/shared/messages.ts), pas les conversations multiples imaginées par la maquette
// d'origine (mockThreads). Un membre staff qui répond s'affiche "SportVision" sans nom précis :
// `profiles` (identité du staff) n'est pas exposé côté client.
export default function MessagesPage() {
  const { ctx } = useSession();
  const resolution = useClientId();

  if (resolution.status === "locked") return <LockedModule title="Messages" />;
  if (resolution.status === "loading") return <div className="py-16 text-center text-[13px] text-text-soft">Chargement…</div>;

  if (resolution.status === "not_linked") {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-[29px] font-extrabold tracking-tight">Messages</h1>
        <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
          <MessageSquare className="h-6 w-6 text-text-faint" aria-hidden />
          <div className="max-w-md">
            <h2 className="text-[18px] font-extrabold tracking-tight">Messages pas encore reliés</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-text-soft">
              SportVision n&apos;a pas encore relié {ctx.organization.name} à un espace Messages. Contactez votre
              interlocuteur SportVision pour l&apos;activer.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return <MessagesThread clientId={resolution.clientId} />;
}

function MessagesThread({ clientId }: { clientId: string }) {
  const [messages, setMessages] = useState<ClientMessage[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function reload() {
    setLoadError(false);
    try {
      const supabase = createClient();
      setMessages(await fetchClientMessages(supabase, clientId));
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(false);
    const supabase = createClient();
    sendClientMessage(supabase, clientId, text)
      .then(() => {
        setDraft("");
        return reload();
      })
      .catch(() => setSendError(true))
      .finally(() => setSending(false));
  }

  return (
    <div className="flex h-[calc(100vh-140px)] flex-col gap-5">
      <h1 className="text-[29px] font-extrabold tracking-tight">Messages</h1>

      <Card className="flex flex-1 flex-col overflow-hidden p-0">
        <div className="flex-1 overflow-y-auto p-5">
          {loadError && (
            <p className="mb-3 text-[12.5px] font-semibold text-danger-fg">Impossible de charger les messages.</p>
          )}
          {messages === null ? (
            <div className="py-10 text-center text-[13px] text-text-soft">Chargement…</div>
          ) : messages.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-text-soft">
              Aucun message pour le moment. Écrivez à votre interlocuteur SportVision ci-dessous.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((m) => (
                <div key={m.id} className={m.auteur === "client" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={
                      m.auteur === "client"
                        ? "max-w-[75%] rounded-2xl rounded-br-sm bg-brand-blue-electric px-4 py-2.5 text-[13.5px] text-white"
                        : "max-w-[75%] rounded-2xl rounded-bl-sm bg-surface-alt px-4 py-2.5 text-[13.5px] text-text"
                    }
                  >
                    {m.auteur === "staff" && (
                      <div className="mb-0.5 text-[11px] font-bold uppercase tracking-[.04em] text-text-faint">
                        SportVision
                      </div>
                    )}
                    <div className="whitespace-pre-wrap">{m.contenu}</div>
                    {m.pieceJointeUrl && (
                      <a
                        href={m.pieceJointeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block text-[12px] underline"
                      >
                        Pièce jointe
                      </a>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="flex items-end gap-2.5 border-t border-divider p-3.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={2}
            placeholder="Écrivez votre message…"
            className="flex-1 resize-none rounded-sv border border-border-strong bg-input-bg px-3.5 py-2.5 text-[13.5px] outline-none focus-visible:border-brand-blue"
          />
          <Button variant="primary" disabled={!draft.trim() || sending} loading={sending} onClick={handleSend}>
            <Send className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        {sendError && <p className="px-3.5 pb-3 text-[12px] font-semibold text-danger-fg">Envoi impossible, réessayez.</p>}
      </Card>
    </div>
  );
}
