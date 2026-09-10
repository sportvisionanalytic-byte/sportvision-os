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
import { CalendarClock, Check, Copy, QrCode as QrCodeIcon, RotateCw, Share2, X } from "lucide-react";
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
import { definirExpirationLien } from "@/lib/data/club/cockpit";

export function TeamPlayerInvite({ clubId, teamId }: { clubId: string; teamId: string }) {
  const [link, setLink] = useState<InviteLink | null | undefined>(undefined); // undefined = chargement
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [editionExpiration, setEditionExpiration] = useState(false);
  const [dateExpiration, setDateExpiration] = useState("");

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

  // Partager (10/09/2026) : le menu de partage du téléphone quand il existe — WhatsApp, SMS,
  // groupe de l'équipe —, sinon la copie. Le lien partagé est le même que le lien copié.
  function handleShare() {
    if (!link) return;
    const url = buildJoinUrl(link.code);
    const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }) : null;
    if (nav?.share) {
      nav.share({ title: "Rejoindre l'équipe sur SportVision", text: "Voici le lien pour rejoindre l'équipe sur SportVision Connect :", url }).catch(() => {});
    } else {
      handleCopy();
    }
  }

  function handleExpiration(valeur: string | null) {
    if (!link) return;
    setBusy(true);
    setError(null);
    // Fin de journée : un lien « valable jusqu'au 30 septembre » doit marcher tout le 30.
    const iso = valeur ? new Date(`${valeur}T23:59:59`).toISOString() : null;
    definirExpirationLien(createClient(), link.id, iso)
      .then(() => {
        setLink({ ...link, expireAt: iso });
        setEditionExpiration(false);
      })
      .catch((e) => setError(messageErreurLien(e, "Impossible de modifier l'expiration.")))
      .finally(() => setBusy(false));
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
          <button type="button" disabled={busy} onClick={handleShare} className="flex items-center gap-1 hover:text-brand-blue-electric disabled:opacity-60">
            <Share2 className="h-3.5 w-3.5" aria-hidden /> Partager
          </button>
          <button type="button" disabled={busy} onClick={handleDeactivate} className="flex items-center gap-1 hover:text-danger-fg disabled:opacity-60">
            <X className="h-3.5 w-3.5" aria-hidden /> Révoquer
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-text-soft">
          <CalendarClock className="h-3.5 w-3.5 flex-none" aria-hidden />
          {link.expireAt
            ? `Valable jusqu'au ${new Date(link.expireAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`
            : "Sans date d'expiration"}
          {!editionExpiration ? (
            <button type="button" disabled={busy} onClick={() => setEditionExpiration(true)} className="font-bold hover:text-brand-blue-electric">
              {link.expireAt ? "Modifier" : "Définir une date"}
            </button>
          ) : (
            <span className="flex items-center gap-1.5">
              <input
                type="date"
                value={dateExpiration}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDateExpiration(e.target.value)}
                className="h-7 rounded-md border border-border-strong bg-input-bg px-1.5 text-[12px]"
              />
              <button type="button" disabled={busy || !dateExpiration} onClick={() => handleExpiration(dateExpiration)} className="font-bold text-brand-blue-electric disabled:opacity-50">
                OK
              </button>
              {link.expireAt && (
                <button type="button" disabled={busy} onClick={() => handleExpiration(null)} className="font-bold hover:text-danger-fg">
                  Retirer
                </button>
              )}
              <button type="button" onClick={() => setEditionExpiration(false)} className="font-bold">
                Annuler
              </button>
            </span>
          )}
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
