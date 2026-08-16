import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext, requireParticulierAccount } from "@/lib/supabase/session";
import { fetchMyAthletes } from "@/lib/supabase/particulier";
import { fetchPlayerOfferById, MONTAGE_COMPILATION_SLUG } from "@/lib/prestations/catalogue";
import { fetchAgentDiscount } from "@/lib/supabase/agentSubscription";
import { fetchAthleteProfile } from "@/lib/prestations/athleteProfile";
import { ReservationWizardParticulier, type Beneficiary } from "./ReservationWizardParticulier";

// Réservation pour un sportif — voir design-connect-personnel-12-08/README.md § Espace
// particulier → Réservation pour un sportif. Adapte le wizard existant (prestations/[id]/
// reserver/ReservationWizard.tsx) plutôt que de le dupliquer entièrement : mêmes étapes
// (Informations/Options/Paiement/Confirmation), mêmes garde-fous légaux (CGV, rétractation),
// même edge function connect-player-prestations — SEUL ajout réel : le bloc bénéficiaire
// (bénéficiaire/commanditaire/payeur) et le paramètre `beneficiary` envoyé à la fonction (voir
// son en-tête pour le détail de l'extension du 14/08).
//
// Shell (ParticularShell) rendu par le layout parent (src/app/particulier/layout.tsx) — cette
// page garde son propre fetch identity/athletes car ils servent au bloc bénéficiaire/payeur.
export default async function ReservationParticulierPage({
  params,
  searchParams,
}: {
  params: Promise<{ offerId: string }>;
  searchParams: Promise<{ benefKind?: string; benefId?: string }>;
}) {
  const { offerId } = await params;
  const { benefKind, benefId } = await searchParams;
  const supabase = await createClient();
  const { user } = await requireParticulierAccount(supabase);

  const player = await buildPlayerContext(supabase, user.id);
  const identity = resolveDisplayIdentity(user, player);

  const [athletes, offer, agentDiscount] = await Promise.all([
    fetchMyAthletes(supabase).catch(() => []),
    fetchPlayerOfferById(supabase, offerId),
    fetchAgentDiscount(supabase, user.id),
  ]);
  if (!offer) notFound();

  const kind: "self" | "linked" | "managed" = benefKind === "linked" || benefKind === "managed" ? benefKind : "self";
  const beneficiary: Beneficiary | null =
    kind === "self"
      ? { kind: "self", id: null, label: `${identity.firstName} ${identity.lastName}`.trim() || "Vous", club: null, categorie: null }
      : (() => {
          const found = athletes.find((a) => a.kind === kind && a.refId === benefId);
          if (!found || !found.rights.reserver) return null;
          const result: Beneficiary = { kind: found.kind, id: found.refId, label: `${found.firstName} ${found.lastName}`.trim(), club: found.clubNom, categorie: found.categorie };
          return result;
        })();

  // Pré-remplissage "Informations pour le montage" (migration-connect-v68) — Montage Compilation
  // UNIQUEMENT, résolu depuis player_profiles ("self"/"linked", matché par user_id — pour
  // "linked" beneficiary.id porte déjà owner_user_id, voir connect_list_my_athletes) ou
  // managed_athlete_profiles ("managed", matché par id). null si aucun bénéficiaire résolu, ou
  // si l'offre n'est pas Montage Compilation, ou si le profil n'a encore aucune donnée.
  const athleteProfile =
    beneficiary && offer.slug === MONTAGE_COMPILATION_SLUG
      ? await fetchAthleteProfile(supabase, {
          kind: beneficiary.kind,
          userId: beneficiary.kind === "managed" ? null : beneficiary.kind === "self" ? user.id : beneficiary.id,
          managedId: beneficiary.kind === "managed" ? beneficiary.id : null,
        })
      : null;

  return (
    <ReservationWizardParticulier
      offer={offer}
      beneficiary={beneficiary}
      commanditaireLabel={`${identity.firstName} ${identity.lastName}`.trim() || identity.email}
      agentDiscount={agentDiscount}
      athleteProfile={athleteProfile}
    />
  );
}
