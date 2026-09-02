"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MessagesThread } from "@/app/(joueur)/messages/MessagesThread";
import { resolveMessageAttachments, type MessageData } from "@/app/(joueur)/messages/messageAttachments";
import type { AthleteRow } from "@/lib/supabase/particulier";

type Subject = { kind: "self" | "linked" | "managed"; id: string | null; label: string };

export function MessagesParticulierView({ firstName, athletes }: { firstName: string; athletes: AthleteRow[] }) {
  // 'club' (migration-connect-v79) exclu des sujets de message : connect_resolve_beneficiary_client_id
  // ne connaît que 'self'/'linked'/'managed' (concept client_id, sans équivalent pour un enfant
  // affilié à un vrai club) — pas de sujet plutôt qu'un canal de messagerie cassé.
  const subjects: Subject[] = [
    { kind: "self", id: null, label: "Mon compte" },
    ...athletes.filter((a): a is AthleteRow & { kind: "linked" | "managed" } => a.kind !== "club").map((a) => ({ kind: a.kind, id: a.refId, label: `${a.firstName} ${a.lastName}`.trim() })),
  ];

  const [subjectIndex, setSubjectIndex] = useState(0);
  const [clientId, setClientId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const subject = subjects[subjectIndex] ?? subjects[0]!;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    (async () => {
      const { data: resolvedId, error: rpcError } = await supabase.rpc("connect_resolve_beneficiary_client_id", {
        p_kind: subject.kind,
        p_ref_id: subject.id,
      });
      if (cancelled) return;
      if (rpcError || !resolvedId) {
        setError("Messages indisponible pour ce contexte pour le moment.");
        setLoading(false);
        return;
      }
      setClientId(resolvedId as string);
      const { data } = await supabase
        .from("messages_client")
        .select("id, auteur_type, contenu, piece_jointe_path, lu, created_at")
        .eq("client_id", resolvedId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      setMessages(
        await resolveMessageAttachments(
          supabase,
          (data || []) as Array<{ id: string; auteur_type: string; contenu: string; piece_jointe_path: string | null; lu: boolean; created_at: string }>,
        ),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject.kind, subject.id]);

  return (
    <div className="flex flex-col gap-5 animate-sv-in">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Messages</h1>
        <p className="text-[15px] text-text-tertiary">Votre lien direct avec SportVision.</p>
      </div>

      {subjects.length > 1 && (
        <div className="flex flex-col gap-2">
          <span className="text-[14px] font-medium text-text-secondary lg:text-[13px]">Ce message concerne :</span>
          {/* Une seule ligne défilante horizontalement sur mobile (jamais de wrap multi-lignes,
              qui rendrait la hauteur de ce bloc imprévisible pour le calcul de hauteur du fil
              juste en dessous — voir MessagesThread.tsx). Retour au wrap normal dès sm: où la
              hauteur n'est plus contrainte. */}
          <div className="flex gap-2 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible">
            {subjects.map((s, i) => (
              <button
                key={`${s.kind}:${s.id}`}
                type="button"
                onClick={() => setSubjectIndex(i)}
                className={`flex-none rounded-sv-pill border px-3.5 py-2 text-[14px] font-medium transition-colors duration-150 lg:text-[13px] ${
                  subjectIndex === i ? "border-[rgba(34,211,238,.5)] bg-[rgba(34,211,238,.18)] text-text" : "border-border text-text-tertiary hover:text-text"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-[420px] animate-pulse rounded-sv-card border border-border bg-surface" />
      ) : (
        <MessagesThread
          key={`${subject.kind}:${subject.id}`}
          clientId={clientId}
          initialMessages={messages}
          unavailable={!!error}
          hideHeader
        />
      )}
      {!loading && !error && subject.kind !== "self" && (
        <p className="text-[13px] text-text-faint lg:text-[12.5px]">
          {firstName}, ce fil concerne {subject.label} — l&apos;équipe SportVision voit qui écrit.
        </p>
      )}
    </div>
  );
}
