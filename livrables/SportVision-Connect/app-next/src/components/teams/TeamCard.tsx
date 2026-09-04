"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Copy, MapPin, QrCode as QrCodeIcon, RotateCw, Users, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { QrCode } from "@/components/ui/QrCode";
import { cn } from "@/lib/cn";
import { isRealId } from "@/lib/mock/teams";
import { createInviteLink, fetchClubTeamInviteLink, rotateInviteLink, deactivateInviteLink, buildJoinUrl, type InviteLink } from "@/lib/data/club/invite-links";
import { createClient } from "@/lib/supabase/client";
import type { Team } from "@/lib/types/teams";

// Carte d'équipe — ACTIONS.md § 16, écran /teams. Un id réel (uuid Supabase) n'a pas de fiche
// équipe consultable : club_players n'existe pas, teams/[id]/page.tsx verrouille l'écran ou
// affiche "Équipe introuvable". On évite donc de router vers une page dont l'issue est déjà
// connue.
export function TeamCard({ team }: { team: Team }) {
  const clickable = !isRealId(team.id);
  const body = (
    <Card
      className={cn(
        "group h-full p-4.5",
        clickable && "hover:-translate-y-0.5 hover:border-brand-blue-pale hover:shadow-sv-card-hover",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold tracking-tight">{team.name}</div>
          <div className="mt-0.5 text-[12px] font-semibold text-text-soft">
            {team.category} · Saison {team.season}
          </div>
        </div>
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-info-bg text-[12px] font-extrabold text-info-fg">
          {team.playerCount}
        </span>
      </div>

      <div className="mt-3.5 flex flex-col gap-1.5 text-[12.5px] text-text-soft">
        <span className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 flex-none" aria-hidden />
          {team.headCoachName} · Entraîneur principal
        </span>
        {team.venue && (
          <span className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 flex-none" aria-hidden />
            {team.venue}
          </span>
        )}
      </div>

      {/* Pour un id réel, aucune fiche équipe consultable n'existe (voir le commentaire en tête
          de fichier) : pas de ligne "bientôt disponible" qui promettrait une page à venir, la
          carte s'arrête simplement à ce qui est réellement affichable aujourd'hui (11/08/2026,
          règle V1 : masquer plutôt que promettre). 19/08/2026 : remplacé par un vrai bouton
          d'invitation (create_team_invite_code) pour un id réel — retour utilisateur, aucun moyen
          de faire rejoindre un joueur autrement qu'en le créant à la main. */}
      {!isRealId(team.id) ? (
        <div className="mt-4 border-t border-divider pt-3 text-[12.5px] font-bold text-brand-blue-electric group-hover:text-brand-violet">
          Ouvrir la fiche équipe →
        </div>
      ) : (
        <div className="mt-4 border-t border-divider pt-3" onClick={(e) => e.preventDefault()}>
          <InviteAction clubId={team.organizationId} teamId={team.id} />
        </div>
      )}
    </Card>
  );

  if (isRealId(team.id)) return body;
  return <Link href={`/teams/${team.id}`}>{body}</Link>;
}

function InviteAction({ clubId, teamId }: { clubId: string; teamId: string }) {
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
      .catch(() => setError("Impossible de générer le lien. Réessayez."))
      .finally(() => setBusy(false));
  }

  function handleRotate() {
    if (!link) return;
    setBusy(true);
    setError(null);
    rotateInviteLink(createClient(), link.id)
      .then(setLink)
      .catch(() => setError("Impossible de régénérer le lien. Réessayez."))
      .finally(() => setBusy(false));
  }

  function handleDeactivate() {
    if (!link) return;
    setBusy(true);
    setError(null);
    deactivateInviteLink(createClient(), link.id)
      .then(() => setLink(null))
      .catch(() => setError("Impossible de désactiver le lien. Réessayez."))
      .finally(() => setBusy(false));
  }

  function handleCopy() {
    if (!link) return;
    navigator.clipboard.writeText(buildJoinUrl(link.code)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (error) {
    return <span className="text-[12px] font-bold text-danger-fg">{error}</span>;
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
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleInvite}
      className="text-[12.5px] font-bold text-brand-blue-electric hover:text-brand-violet disabled:opacity-60"
    >
      {busy ? "Génération…" : "Générer un lien pour inviter des joueurs →"}
    </button>
  );
}
