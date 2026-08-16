"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface MessageData {
  id: string;
  auteur: "client" | "staff";
  contenu: string;
  pieceJointeUrl: string | null;
  lu: boolean;
  createdAt: string;
}

const ATTACHMENT_BUCKET = "portail-media";
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, today)) return "Aujourd'hui";
  if (isSameDay(d, yesterday)) return "Hier";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Extrait un nom de fichier lisible d'une URL de pièce jointe (le stockage préfixe le nom par un
// identifiant unique, voir handleAttach ci-dessous).
function attachmentLabel(url: string): string {
  try {
    const name = decodeURIComponent(url.split("/").pop() || "Pièce jointe");
    return name.replace(/^[a-f0-9-]{20,}-/i, "");
  } catch {
    return "Pièce jointe";
  }
}

export function MessagesThread({
  clientId,
  initialMessages,
  unavailable,
  hideHeader,
}: {
  clientId: string | null;
  initialMessages: MessageData[];
  unavailable: boolean;
  // Le conteneur appelant affiche déjà son propre titre "Messages" (cas de l'espace particulier,
  // qui ajoute un sélecteur "Ce message concerne :" entre le titre et le fil) — évite un doublon
  // visuel du même h1+sous-titre à l'écran.
  hideHeader?: boolean;
}) {
  const [messages, setMessages] = useState<MessageData[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const unreadStaffIds = useMemo(
    () => messages.filter((m) => m.auteur === "staff" && !m.lu).map((m) => m.id),
    [messages],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  useEffect(() => {
    if (unreadStaffIds.length === 0) return;
    const supabase = createClient();
    // Best-effort : client_mark_message_read reconnaît un compte Joueur depuis l'exécution de
    // migration-connect-v46-client-mark-message-read-player.sql (confirmée en base le 14/08,
    // audit). Reste en best-effort par prudence (aucune conséquence visible en cas d'échec
    // ponctuel : le badge non-lu resterait simplement affiché).
    (async () => {
      for (const id of unreadStaffIds) {
        try {
          await supabase.rpc("client_mark_message_read", { p_message_id: id });
        } catch {
          // Best-effort — voir le commentaire ci-dessus.
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || !clientId || sending) return;
    setSending(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSending(false);
      setError("Session invalide.");
      return;
    }

    // Même stratégie que l'ancien app-next (lib/data/shared/messages.ts) : auteur_client_id a une
    // FK stricte vers client_users(id), qu'un compte Joueur n'a pas — on retombe sur null si
    // Postgres rejette la contrainte plutôt que de vérifier au préalable.
    let attempt = await supabase
      .from("messages_client")
      .insert({ client_id: clientId, auteur_type: "client", auteur_client_id: user.id, contenu: text })
      .select("id, auteur_type, contenu, piece_jointe_url, lu, created_at")
      .single();

    if (attempt.error?.code === "23503") {
      attempt = await supabase
        .from("messages_client")
        .insert({ client_id: clientId, auteur_type: "client", auteur_client_id: null, contenu: text })
        .select("id, auteur_type, contenu, piece_jointe_url, lu, created_at")
        .single();
    }

    setSending(false);
    if (attempt.error || !attempt.data) {
      setError("Impossible d'envoyer le message pour le moment.");
      return;
    }
    const row = attempt.data;
    setMessages((prev) => [
      ...prev,
      {
        id: row.id as string,
        auteur: "client",
        contenu: row.contenu as string,
        pieceJointeUrl: (row.piece_jointe_url as string | null) ?? null,
        lu: row.lu as boolean,
        createdAt: row.created_at as string,
      },
    ]);
    setDraft("");
  }

  async function handleAttach(file: File) {
    if (!clientId) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError("Ce fichier dépasse la taille maximale autorisée (15 Mo).");
      return;
    }
    setAttaching(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setAttaching(false);
      return;
    }

    const safeName = file.name.replace(/[^a-z0-9.\-_]+/gi, "-");
    const path = `messages/${clientId}/${crypto.randomUUID()}-${safeName}`;
    const upload = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, file, { upsert: false });

    if (upload.error) {
      setAttaching(false);
      setError("Impossible d'envoyer la pièce jointe pour le moment.");
      return;
    }

    const { data: publicUrl } = supabase.storage.from(ATTACHMENT_BUCKET).getPublicUrl(path);

    let attempt = await supabase
      .from("messages_client")
      .insert({
        client_id: clientId,
        auteur_type: "client",
        auteur_client_id: user.id,
        contenu: `Pièce jointe : ${file.name}`,
        piece_jointe_url: publicUrl.publicUrl,
      })
      .select("id, auteur_type, contenu, piece_jointe_url, lu, created_at")
      .single();

    if (attempt.error?.code === "23503") {
      attempt = await supabase
        .from("messages_client")
        .insert({
          client_id: clientId,
          auteur_type: "client",
          auteur_client_id: null,
          contenu: `Pièce jointe : ${file.name}`,
          piece_jointe_url: publicUrl.publicUrl,
        })
        .select("id, auteur_type, contenu, piece_jointe_url, lu, created_at")
        .single();
    }

    setAttaching(false);
    if (attempt.error || !attempt.data) {
      setError("Pièce jointe envoyée mais impossible de créer le message.");
      return;
    }
    const row = attempt.data;
    setMessages((prev) => [
      ...prev,
      {
        id: row.id as string,
        auteur: "client",
        contenu: row.contenu as string,
        pieceJointeUrl: (row.piece_jointe_url as string | null) ?? null,
        lu: row.lu as boolean,
        createdAt: row.created_at as string,
      },
    ]);
  }

  if (unavailable) {
    return (
      <div className="flex flex-col gap-6">
        {!hideHeader && (
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Messages</h1>
            <p className="text-[15px] text-text-tertiary">Votre lien direct avec SportVision.</p>
          </div>
        )}
        <div className="flex max-w-[560px] flex-col gap-3.5 rounded-sv-card border border-dashed border-border-strong bg-surface p-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-white/[.06]">
            <span className="material-symbols-rounded !text-[24px] text-text-tertiary" aria-hidden="true">forum</span>
          </span>
          <span className="font-sora text-[18px] font-semibold">Messages indisponible pour le moment</span>
          <p className="text-[14px] leading-relaxed text-text-tertiary">
            Complétez votre profil joueur pour pouvoir échanger avec l&apos;équipe SportVision.
          </p>
        </div>
      </div>
    );
  }

  let lastDay = "";

  // Hauteur mobile calculée depuis les chrome réels du shell (jamais un h-screen simple) :
  // AppShell = pt-[68px]+pb-16 sur <main> + py-7 sur le conteneur = 188px de chrome hors de ce
  // composant (hideHeader=false, /messages joueur direct). ParticularShell = pt-[112px]+pb-16+
  // py-7 = 232px, PLUS le bloc titre + sélecteur "Ce message concerne :" rendu par
  // MessagesParticulierView au-dessus de ce composant (hideHeader=true) — ~160px au pire (voir
  // MessagesParticulierView.tsx, ligne des pills bornée à une seule ligne mobile pour rester
  // prévisible). Avant ce correctif, un unique -140px pour les deux cas poussait la zone de
  // saisie sous la bottom nav fixe sur mobile (jamais visible sans un scroll de page cassant le
  // pattern "liste défile, saisie fixe") — bug trouvé lors de l'audit responsive du 15/08.
  const mobileHeight = hideHeader ? "h-[calc(100vh-400px)]" : "h-[calc(100vh-195px)]";

  return (
    <div className={`flex ${mobileHeight} flex-col gap-5 animate-sv-in lg:h-[calc(100vh-120px)]`}>
      {!hideHeader && (
        <div className="flex flex-col gap-2">
          <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">Messages</h1>
          <p className="text-[15px] text-text-tertiary">Votre lien direct avec SportVision.</p>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-sv-card border border-border bg-surface lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="hidden flex-none flex-col border-r border-border p-3 lg:flex">
          <div className="flex items-center gap-3 rounded-sv bg-white/[.06] p-3">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-sv bg-sv-gradient">
              <span className="material-symbols-rounded !text-[21px] text-white" aria-hidden="true">support_agent</span>
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-sora text-[15px] font-semibold">Équipe SportVision</span>
              <span className="truncate text-[13px] text-text-tertiary">
                {messages.length > 0 ? messages[messages.length - 1]?.contenu : "Aucun message"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 lg:p-5">
            {messages.length === 0 && (
              <div className="m-auto flex max-w-[380px] flex-col items-center gap-2 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-affiliations-bg">
                  <span className="material-symbols-rounded !text-[24px] text-affiliations" aria-hidden="true">forum</span>
                </span>
                <span className="font-sora text-[16px] font-semibold">Aucun message pour le moment</span>
                <p className="text-[13px] text-text-tertiary">
                  Vous pourrez échanger avec SportVision depuis cet espace.
                </p>
              </div>
            )}
            {messages.map((m) => {
              const day = dayLabel(m.createdAt);
              const showDay = day !== lastDay;
              lastDay = day;
              const isClient = m.auteur === "client";
              return (
                <div key={m.id} className={`flex flex-col gap-1 ${isClient ? "items-end" : "items-start"}`}>
                  {showDay && <span className="my-1.5 self-center text-[11px] text-text-label">{day}</span>}
                  <div
                    className="max-w-[76%] rounded-[18px] px-4 py-3"
                    style={{
                      background: isClient ? "linear-gradient(120deg,#A855F7,#4F7DFF 55%,#22D3EE)" : "rgba(255,255,255,.06)",
                      border: isClient ? "none" : "1px solid rgba(255,255,255,.09)",
                      borderBottomRightRadius: isClient ? 6 : 18,
                      borderBottomLeftRadius: isClient ? 18 : 6,
                    }}
                  >
                    <span className="text-[14px] leading-relaxed" style={{ color: isClient ? "#fff" : "#F7F7FB" }}>
                      {m.contenu}
                    </span>
                    {m.pieceJointeUrl && (
                      <a
                        href={m.pieceJointeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 flex items-center gap-2 rounded-sv border border-white/20 bg-black/15 px-3 py-2 text-[12px] font-medium"
                        style={{ color: isClient ? "#fff" : "#8CA9FF" }}
                      >
                        <span className="material-symbols-rounded !text-[16px]" aria-hidden="true">attach_file</span>
                        {attachmentLabel(m.pieceJointeUrl)}
                      </a>
                    )}
                  </div>
                  <span className="text-[11px] text-text-label">{timeLabel(m.createdAt)}</span>
                </div>
              );
            })}
          </div>

          {error && <div className="mx-4 mb-1 rounded-sv border border-danger-border bg-danger-bg px-3 py-2 text-[12px] text-danger lg:mx-5">{error}</div>}

          <div className="flex flex-none items-center gap-2.5 border-t border-border bg-white/[.03] p-3.5">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleAttach(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={attaching || !clientId}
              className="flex h-11 w-11 flex-none items-center justify-center rounded-sv bg-white/[.06] text-text-secondary hover:bg-white/[.12] disabled:opacity-45"
              aria-label="Ajouter une pièce jointe"
            >
              <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">{attaching ? "hourglass_top" : "attach_file"}</span>
            </button>
            <input
              aria-label="Écrivez votre message"
              placeholder="Écrivez votre message…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              className="h-11 min-w-0 flex-1 rounded-sv border border-border-strong bg-surface px-3.5 font-sans text-[14px] text-text outline-none focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.22)]"
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!draft.trim() || sending}
              className="flex h-11 w-11 flex-none items-center justify-center rounded-sv bg-sv-gradient text-white disabled:cursor-wait disabled:opacity-75"
              aria-label="Envoyer"
            >
              {sending ? (
                <span className="h-[18px] w-[18px] animate-sv-spin rounded-full border-2 border-white/35 border-t-white" aria-hidden="true" />
              ) : (
                <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">send</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
