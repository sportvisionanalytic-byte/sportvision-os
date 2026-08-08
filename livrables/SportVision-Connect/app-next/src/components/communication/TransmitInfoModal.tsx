"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "./Modal";

// Dashboard Full Communication — ACTIONS.md § 5 : « Transmettre une information » (principal)
// ouvre une modale de transmission. Aucun champ détaillé n'est spécifié par la maquette : on
// reste volontairement simple (catégorie + message), cohérent avec le ton éditorial du produit.
const CATEGORIES = ["Résultat", "Actualité du club", "Événement à venir", "Autre"];

export function TransmitInfoModal({
  open,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [message, setMessage] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmitted();
    setMessage("");
    setCategory(CATEGORIES[0]);
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

        <div className="mt-1 flex justify-end gap-2.5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={!message.trim()}>
            Envoyer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
