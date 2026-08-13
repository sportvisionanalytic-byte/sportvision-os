import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";

// Accueil — voir design-connect-personnel-12-08/README.md § Espace joueur → Accueil. Cartes
// affichées UNIQUEMENT si pertinentes (principe du design) : pour l'instant, seule la carte
// club existe réellement (memberships/organizations en base) — les autres cartes du design
// (contenus, prestations, cotisations, messages) n'ont encore aucune donnée réelle derrière,
// donc pas construites ici plutôt que montrées vides/décoratives.
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  return (
    <AppShell firstName={firstName}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-sora text-[33px] font-bold tracking-tight">Bonjour {firstName} 👋</h1>
          <p className="text-[15px] text-text-tertiary">Retrouvez votre univers SportVision en un coup d&apos;œil.</p>
        </div>

        {player?.club && player.club.status === "affilie" && (
          <ClubCard variant="affilie">
            <ClubHeader nom={player.club.nom} ville={player.club.ville} />
            <span className="mt-1 self-start rounded-sv-pill bg-affiliations-bg px-2.5 py-1 text-[12px] font-medium text-affiliations">
              ✓ Affilié
            </span>
          </ClubCard>
        )}

        {player?.club && player.club.status === "attente" && (
          <ClubCard variant="attente">
            <ClubHeader nom={player.club.nom} ville={player.club.ville} />
            <span className="mt-1 self-start rounded-sv-pill bg-attente-bg px-2.5 py-1 text-[12px] font-medium text-attente">
              En attente
            </span>
            <p className="mt-2 text-[13px] leading-relaxed text-text-tertiary">
              Votre demande d&apos;affiliation doit encore être confirmée par le club. Vous pouvez
              utiliser Connect normalement pendant ce temps.
            </p>
          </ClubCard>
        )}

        {player?.club && player.club.status === "refuse" && (
          <ClubCard variant="refuse">
            <ClubHeader nom={player.club.nom} ville={player.club.ville} />
            <span className="mt-1 self-start rounded-sv-pill bg-danger-bg px-2.5 py-1 text-[12px] font-medium text-danger">
              Demande refusée
            </span>
          </ClubCard>
        )}

        {!player?.club && (
          <div className="flex flex-col gap-3.5 rounded-sv-card border border-border bg-surface p-5">
            <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-affiliations-bg">
              <span className="material-symbols-rounded !text-[24px] text-affiliations">shield</span>
            </span>
            <div className="flex flex-col gap-2">
              <span className="font-sora text-[18px] font-semibold">Rejoignez votre club</span>
              <p className="text-[14px] leading-relaxed text-text-tertiary">
                Associez votre profil à votre club ou académie pour retrouver les contenus et
                événements liés à votre équipe.
              </p>
            </div>
            <Link
              href="/affiliations/ajouter"
              className="self-start rounded-sv bg-sv-gradient px-4 py-2.5 font-sora text-[14px] font-semibold text-white"
            >
              Ajouter mon club
            </Link>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ClubHeader({ nom, ville }: { nom: string; ville: string | null }) {
  return (
    <div className="flex items-center gap-3.5">
      <span className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-sv bg-white/5 font-mono text-[8px] text-text-faint">
        logo
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-[.1em] text-affiliations">Mon club</span>
        <span className="font-sora text-[20px] font-semibold tracking-tight">{nom}</span>
        {ville && <span className="text-[13px] text-text-tertiary">{ville}</span>}
      </div>
    </div>
  );
}

function ClubCard({
  variant,
  children,
}: {
  variant: "affilie" | "attente" | "refuse";
  children: React.ReactNode;
}) {
  const glow =
    variant === "affilie"
      ? "rgba(34,211,238,.55)"
      : variant === "attente"
        ? "rgba(251,191,36,.5)"
        : "rgba(244,114,182,.5)";
  return (
    <div className="rounded-sv-card p-px" style={{ background: `linear-gradient(130deg, ${glow}, rgba(79,125,255,.18) 60%, transparent)` }}>
      <div className="flex flex-col gap-3 rounded-[calc(theme(borderRadius.sv-card)-1px)] bg-bg-elevated p-5">
        {children}
      </div>
    </div>
  );
}
