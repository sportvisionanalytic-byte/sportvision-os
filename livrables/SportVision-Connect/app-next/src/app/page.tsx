import { redirect } from "next/navigation";

// Racine technique : renvoie vers le tableau de bord. Une fois l'authentification réelle
// branchée, ce sera un middleware qui décidera entre /dashboard et /auth/login selon la
// session — pas cette page.
//
// `?abonnement=succes|annule` : cible de success_url/cancel_url de
// create-clubplus-subscription-checkout (édge function existante, jamais modifiée pour
// rester simple à redéployer) — voir DashboardPage pour l'affichage réel du retour.
export default function RootPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const abonnement = typeof searchParams.abonnement === "string" ? searchParams.abonnement : null;
  redirect(abonnement ? `/dashboard?abonnement=${abonnement}` : "/dashboard");
}
