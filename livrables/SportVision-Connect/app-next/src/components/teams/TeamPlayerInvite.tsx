"use client";

// Le lien d'inscription collectif d'une équipe : celui qu'on colle dans le groupe WhatsApp ou
// qu'on affiche au vestiaire.
//
// ── Pourquoi il n'est plus sur la carte d'équipe ──
// Il y était répété 43 fois chez SF Villemomble, sur un écran dont le rôle est d'aider à TROUVER
// une équipe. L'action la plus rare du club y était donc l'élément le plus visible, et le nom des
// équipes le moins. Il vit désormais dans la fiche de l'équipe concernée, là où l'on est déjà
// quand on veut inviter SES joueurs.
//
// ── Collectif, et réservé aux joueurs ──
// Multi-usage par nature : un lien dans un groupe, un QR au vestiaire (§41). C'est exactement ce
// qu'il ne faut PAS pour un coach, qui reçoit des droits d'administration sur l'équipe — lui passe
// par une invitation nominative (§42, voir InviterEncadrantModal).
//
// Il mène vers CONNECT, pas vers Club+ : un joueur rejoint son espace personnel, il n'a rien à
// faire dans l'outil de gestion du club (§38).

import { useEffect, useState } from "react";
import { Check, Copy, QrCode as QrCodeIcon, RotateCw, X } from "lucide-react";
import { QrCode } from "@/components/ui/QrCode";
import {
  createInviteLink,
  fetchClubTeamInviteLink,
  rotateInviteLink,
  deactivateInviteLink,
  buildJoinUrl,
  messageErreurLien,
  type InviteLink,
} from "@/lib/data/club/invite-links";
import { createClient } from "@/lib/supabase/client";

export function TeamPlayerInvite({ clubId, teamId }: { clubId: string; teamId: string }) {
  const [link, setLink] = useState<InviteLink | null | undefined>(undefined); // undefined = chargement
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    fetchClubTeamInviteLink(createClient(), teamId)
      .then(setLink)
      .catch(() => setLink(null));
  }, [teamId]);

  function handleInvite() {
    setBusy(true);
    setError(null);
    createInviteLink(createClient(), clubId, teamId)
      .then(setLink)
      .catch((e) => setError(messageErreurLien(e, "Impossible de générer le lien. Réessayez.")))
      .finally(() => setBusy(false));
  }

  function handleRotate() {
    if (!link) return;
    // Régénérer casse le lien déjà distribué : le QR affiché au vestiaire et le message envoyé
    // dans le groupe de l'équipe cessent de fonctionner à la seconde. Ça se demande.
    if (!window.confirm(`Le code ${link.code} cessera de fonctionner immédiatement, y compris les QR déjà imprimés et les liens déjà envoyés. Continuer ?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    rotateInviteLink(createClient(), link.id)
      .then(setLink)
      .catch((e) => setError(messageErreurLien(e, "Impossible de régénérer le lien. Réessayez.")))
      .finally(() => setBusy(false));
  }

  function handleDeactivate() {
    if (!link) return;
    setBusy(true);
    setError(null);
    deactivateInviteLink(createClient(), link.id)
      .then(() => setLink(null))
      .catch((e) => setError(messageErreurLien(e, "Impossible de désactiver le lien. Réessayez.")))
      .finally(() => setBusy(false));
  }

  function handleCopy() {
    if (!link) return;
    navigator.clipboard.writeText(buildJoinUrl(link.code)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (link === undefined) {
    return <span className="text-[12px] text-text-faint">Chargement…</span>;
  }

  if (link) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="flex w-full items-center justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-[12.5px] font-bold text-text"
        >
          <span>
            Code : <span className="font-mono tracking-[.08em]">{link.code}</span>
          </span>
          {copied ? <Check className="h-3.5 w-3.5 flex-none text-success-fg" aria-hidden /> : <Copy className="h-3.5 w-3.5 flex-none text-text-faint" aria-hidden />}
        </button>
        {showQr && (
          <div className="flex justify-center py-1">
            <QrCode value={buildJoinUrl(link.code)} />
          </div>
        )}
        <div className="flex items-center gap-3 text-[11.5px] font-bold text-text-soft">
          <button type="button" disabled={busy} onClick={() => setShowQr((v) => !v)} className="flex items-center gap-1 hover:text-brand-blue-electric disabled:opacity-60">
            <QrCodeIcon className="h-3.5 w-3.5" aria-hidden /> {showQr ? "Masquer le QR" : "Afficher le QR"}
          </button>
          <button type="button" disabled={busy} onClick={handleRotate} className="flex items-center gap-1 hover:text-brand-blue-electric disabled:opacity-60">
            <RotateCw className="h-3.5 w-3.5" aria-hidden /> Régénérer
          </button>
          <button type="button" disabled={busy} onClick={handleDeactivate} className="flex items-center gap-1 hover:text-danger-fg disabled:opacity-60">
            <X className="h-3.5 w-3.5" aria-hidden /> Désactiver
          </button>
        </div>
        {error && <span className="text-[12px] font-bold text-danger-fg">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={handleInvite}
        className="text-left text-[12.5px] font-bold text-brand-blue-electric hover:text-brand-violet disabled:opacity-60"
      >
        {busy ? "Génération…" : "Générer un lien pour inviter des joueurs →"}
      </button>
      {/* Le message reste SOUS l'action, jamais à sa place : une erreur qui remplace le bouton
          enlève au passage le moyen de réessayer. */}
      {error && <span className="text-[12px] font-bold text-danger-fg">{error}</span>}
    </div>
  );
}
