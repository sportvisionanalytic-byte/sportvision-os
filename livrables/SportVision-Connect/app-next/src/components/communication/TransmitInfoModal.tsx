"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { sendClientMessage } from "@/lib/data/shared/messages";
import { Modal } from "./Modal";

// Dashboard Full Communication — ACTIONS.md § 5 : « Transmettre une information » (principal)
// ouvre une modale de transmission. Aucun champ détaillé n'est spécifié par la maquette : on
// reste volontairement simple (catégorie + message), cohérent avec le ton éditorial du produit.
//
// 11/08/2026 — jusqu'ici, ce formulaire n'écrivait nulle part : `handleSubmit` appelait
// directement `onSubmitted()` sans jamais envoyer `message`/`category`, qui disparaissaient. Le
// dashboard affichait pourtant un toast de succès ("Information transmise à votre Community
// Manager") — un mensonge fonctionnel, pas seulement une donnée d'affichage fabriquée. Il n'existe
// aucune table dédiée "information transmise" : la vraie destination, déjà utilisée par /messages
// pour parler à SportVision, est `messages_client` (data/shared/messages.ts:sendClientMessage) —
// mêmes RLS, même fil que celui lu par /mycm et /messages. Le message posté est préfixé par la
// catégorie choisie pour rester exploitable côté CM sans nouvelle colonne.
const CATEGORIES = ["Résultat", "Actualité du club", "Événement à venir", "Autre"];

export function TransmitInfoModal({
  open,
  onClose,
  clientId,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  /** `client_id` résolu (useClientId) — la transmission écrit dans `messages_client` pour ce
   * client. Le bouton qui ouvre cette modale doit rester désactivé tant qu'il n'est pas prêt. */
  clientId: string;
  onSubmitted: () => void;
}) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(false);
    try {
      const supabase = createClient();
      await sendClientMessage(supabase, clientId, `[${category}] ${text}`);
      setMessage("");
      setCategory(CATEGORIES[0]);
      onSubmitted();
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Transmettre une information">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-[13px] leading-relaxed text-text-soft">
          Un résultat, une actualité ou un événement à venir ? Transmettez l&apos;information à votre
          Community Manager, elle en fera un contenu.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Type d&apos;information</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-11 rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.12)]"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Message</span>
          <textarea
            required
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Décrivez l'information à transmettre…"
            className="resize-none rounded-xl border border-border-strong bg-surface px-3.5 py-3 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.12)]"
          />
        </label>

        {sendError && (
          <p className="text-[12.5px] font-semibold text-danger-fg">Envoi impossible, réessayez.</p>
        )}

        <div className="mt-1 flex justify-end gap-2.5">
          <Button type="button" variant="secondary" onClick={onClose} disabled={sending}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={!message.trim() || sending} loading={sending}>
            Envoyer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
