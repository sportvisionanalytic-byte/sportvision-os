"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy, MapPin, Users } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { isRealId } from "@/lib/mock/teams";
import { createTeamInviteCode } from "@/lib/data/club/teams";
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
          <InviteAction teamId={team.id} />
        </div>
      )}
    </Card>
  );

  if (isRealId(team.id)) return body;
  return <Link href={`/teams/${team.id}`}>{body}</Link>;
}

function InviteAction({ teamId }: { teamId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleInvite() {
    setBusy(true);
    setError(null);
    createTeamInviteCode(createClient(), teamId)
      .then((c) => setCode(c))
      .catch(() => setError("Impossible de générer le code. Réessayez."))
      .finally(() => setBusy(false));
  }

  function handleCopy() {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (error) {
    return <span className="text-[12px] font-bold text-danger-fg">{error}</span>;
  }

  if (code) {
    return (
      <button
        type="button"
        onClick={handleCopy}
        className="flex w-full items-center justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-[12.5px] font-bold text-text"
      >
        <span>
          Code : <span className="font-mono tracking-[.08em]">{code}</span>
        </span>
        {copied ? <Check className="h-3.5 w-3.5 flex-none text-success-fg" aria-hidden /> : <Copy className="h-3.5 w-3.5 flex-none text-text-faint" aria-hidden />}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={handleInvite}
      className="text-[12.5px] font-bold text-brand-blue-electric hover:text-brand-violet disabled:opacity-60"
    >
      {busy ? "Génération…" : "Générer un code pour inviter des joueurs →"}
    </button>
  );
}
