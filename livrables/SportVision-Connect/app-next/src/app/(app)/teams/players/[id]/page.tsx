"use client";

import Link from "next/link";
import { Bell, Images, Sparkles } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LockedModule } from "@/components/ui/LockedModule";
import { ImageRightBanner } from "@/components/teams/ImageRightBanner";
import { imageRightForPlayer, mockPlayers, mockTeams } from "@/lib/mock/teams";
import type { ImageRightScopes, LicenseStatus } from "@/lib/types/teams";

// Fiche joueur — ACTIONS.md § 16. « Demander un visuel » est l'action principale tant que le
// droit à l'image est signé ; si l'autorisation manque, la seule action principale devient
// « Relancer l'autorisation » (règle bloquante DATA_MODEL.md § ImageRight : aucun média n'est
// publiable sans signature) — décision prise faute de précision explicite dans ACTIONS.md sur
// la cohabitation des deux actions.

const LICENSE_LABEL: Record<LicenseStatus, string> = {
  valid: "Licence à jour",
  pending: "Licence en attente",
  expired: "Licence expirée",
  missing: "Licence manquante",
};
const LICENSE_TONE: Record<LicenseStatus, "success" | "warning" | "danger"> = {
  valid: "success",
  pending: "warning",
  expired: "danger",
  missing: "danger",
};

const SCOPE_LABEL: Record<keyof ImageRightScopes, string> = {
  teamAndMatchPhotos: "Photos d'équipe et de match",
  videosAndHighlights: "Vidéos et highlights",
  individualPortraits: "Portraits individuels",
  commercialUse: "Usage commercial",
  offClubDistribution: "Diffusion hors club",
};

export default function PlayerDetailPage({ params }: { params: { id: string } }) {
  const { ctx } = useSession();

  if (!canAccess(ctx, "teams")) return <LockedModule />;

  const player = mockPlayers.find((p) => p.id === params.id && p.organizationId === ctx.organization.id);

  if (!player) {
    return (
      <Card className="flex flex-col items-center gap-3 px-8 py-16 text-center">
        <div className="text-[15px] font-extrabold">Joueur introuvable.</div>
        <Link href="/teams">
          <Button variant="secondary">Retour aux équipes</Button>
        </Link>
      </Card>
    );
  }

  const team = mockTeams.find((t) => t.id === player.teamId);
  const imageRight = imageRightForPlayer(player.id);
  const signed = imageRight?.status === "signed";
  const previewCount = Math.min(player.contentCount, 6);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {team && (
            <Link href={`/teams/${team.id}`} className="text-[12px] font-bold text-text-soft hover:text-brand-blue-electric">
              ← {team.name}
            </Link>
          )}
          <h1 className="mt-1.5 text-[29px] font-extrabold leading-tight tracking-tight">
            {player.firstName} {player.lastName}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-text-soft">
            {player.shirtNumber !== undefined && <span>N°{player.shirtNumber}</span>}
            {player.position && (
              <>
                <span aria-hidden>·</span>
                <span>{player.position}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <Badge tone={LICENSE_TONE[player.licenseStatus]}>{LICENSE_LABEL[player.licenseStatus]}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {signed ? (
            <Button variant="primary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Demander un visuel
            </Button>
          ) : (
            <>
              <Button variant="secondary" disabled title="Autorisation manquante — les contenus de ce joueur ne sont pas publiables.">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Demander un visuel
              </Button>
              <Button variant="primary">
                <Bell className="h-3.5 w-3.5" aria-hidden />
                Relancer
              </Button>
            </>
          )}
        </div>
      </div>

      <ImageRightBanner imageRight={imageRight} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4.5 lg:col-span-2">
          <div className="text-[14px] font-extrabold tracking-tight">Contenus</div>
          {previewCount === 0 ? (
            <div className="mt-3 flex flex-col items-center gap-2 py-8 text-center">
              <Images className="h-5 w-5 text-text-faint" aria-hidden />
              <p className="text-[12.5px] text-text-soft">Aucun contenu pour ce joueur pour le moment.</p>
            </div>
          ) : (
            <div className="mt-3.5 grid grid-cols-3 gap-2.5 sm:grid-cols-4">
              {Array.from({ length: previewCount }).map((_, i) => (
                <div
                  key={i}
                  className="flex aspect-square items-center justify-center rounded-xl text-[10px] font-bold uppercase tracking-[.05em] text-white/80"
                  style={{
                    background:
                      "repeating-linear-gradient(125deg, #1B2A6B 0px, #1B2A6B 12px, #24337a 12px, #24337a 24px)",
                  }}
                >
                  Média
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 text-[12px] text-text-soft">{player.contentCount} contenu(s) au total.</div>
        </Card>

        <Card className="p-4.5">
          <div className="text-[14px] font-extrabold tracking-tight">Périmètre du droit à l&apos;image</div>
          <ul className="mt-3.5 flex flex-col gap-2.5">
            {(Object.keys(SCOPE_LABEL) as (keyof ImageRightScopes)[]).map((key) => {
              const allowed = imageRight?.scopes[key] ?? false;
              return (
                <li key={key} className="flex items-center justify-between gap-3">
                  <span className="text-[12.5px] font-semibold text-text-soft">{SCOPE_LABEL[key]}</span>
                  <Badge tone={allowed ? "success" : "neutral"}>{allowed ? "Autorisé" : "Non autorisé"}</Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
