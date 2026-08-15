import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveDisplayIdentity, buildPlayerContext } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { fetchPlayerOfferById } from "@/lib/prestations/catalogue";
import { fetchAgentDiscount } from "@/lib/supabase/agentSubscription";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { ReservationWizardParticulier, type Beneficiary } from "./ReservationWizardParticulier";

// Réservation pour un sportif — voir design-connect-personnel-12-08/README.md § Espace
// particulier → Réservation pour un sportif. Adapte le wizard existant (prestations/[id]/
// reserver/ReservationWizard.tsx) plutôt que de le dupliquer entièrement : mêmes étapes
// (Informations/Options/Paiement/Confirmation), mêmes garde-fous légaux (CGV, rétractation),
// même edge function connect-player-prestations — SEUL ajout réel : le bloc bénéficiaire
// (bénéficiaire/commanditaire/payeur) et le paramètre `beneficiary` envoyé à la fonction (voir
// son en-tête pour le détail de l'extension du 14/08).
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const player = await buildPlayerContext(supabase, user.id);
  const identity = resolveDisplayIdentity(user, player);
  const firstName = identity.firstName || user.email?.split("@")[0] || "";

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

  return (
    <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
      <ReservationWizardParticulier
        offer={offer}
        beneficiary={beneficiary}
        commanditaireLabel={`${identity.firstName} ${identity.lastName}`.trim() || identity.email}
        agentDiscount={agentDiscount}
      />
    </ParticularShell>
  );
}
