import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, requireJoueurAccount } from "@/lib/supabase/session";
import { AppShell } from "@/components/layout/AppShell";
import { fetchPlayerOfferById, MONTAGE_COMPILATION_SLUG } from "@/lib/prestations/catalogue";
import { fetchAthleteProfile } from "@/lib/prestations/athleteProfile";
import { ReservationWizard } from "./ReservationWizard";

export default async function ReserverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { user } = await requireJoueurAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);
  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  const offer = await fetchPlayerOfferById(supabase, id);
  if (!offer) notFound();

  // Réserver une prestation nécessite une identité joueur réelle (player_profiles) : c'est elle
  // qui est résolue en client_id côté edge function (resolve_player_client_id). Un compte qui a
  // choisi "Plus tard"/"Non" à l'étape Club de l'inscription (aucune ligne player_profiles,
  // voir lib/supabase/session.ts) n'a rien à résoudre — état honnête à afficher plutôt qu'une
  // erreur technique en pleine réservation.
  if (!player) {
    return (
      <AppShell firstName={firstName}>
        <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 rounded-sv-card border border-dashed border-border-strong bg-surface p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-affiliations-bg">
            <span className="material-symbols-rounded !text-[24px] text-affiliations">person</span>
          </span>
          <span className="font-sora text-[18px] font-semibold">Complétez votre profil</span>
          <p className="text-[14px] leading-relaxed text-text-tertiary">
            Pour réserver une prestation, votre profil joueur doit d&apos;abord être créé. Ajoutez votre club ou déclarez votre
            structure pour continuer.
          </p>
          <Link href="/affiliations/ajouter" className="rounded-sv bg-sv-gradient px-4 py-2.5 font-sora text-[14px] font-semibold text-white">
            Compléter mon profil
          </Link>
        </div>
      </AppShell>
    );
  }

  // Pré-remplissage "Informations pour le montage" (migration-connect-v68) — Montage Compilation
  // UNIQUEMENT. Espace joueur = toujours "self" (aucun beneficiary ici), matché par user_id sur
  // player_profiles — voir le commentaire équivalent dans particulier/reserver/[offerId]/page.tsx.
  const athleteProfile = offer.slug === MONTAGE_COMPILATION_SLUG ? await fetchAthleteProfile(supabase, { kind: "self", userId: user.id, managedId: null }) : null;

  return (
    <AppShell firstName={firstName}>
      <ReservationWizard offer={offer} defaultTeamLabel={player.club?.nom || ""} athleteProfile={athleteProfile} />
    </AppShell>
  );
}
