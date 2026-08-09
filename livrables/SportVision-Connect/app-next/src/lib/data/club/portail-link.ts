import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Résout le `client_id` Portail lié à un club, si le rapprochement a eu lieu (best-effort à
 * l'inscription sur correspondance d'e-mail confirmé, voir clubplus-onboarding, ou fait
 * manuellement par le staff). `null` si le club n'a jamais été relié — pas une erreur, un club
 * peut légitimement n'avoir aucun historique Portail (devis/factures/contrats/documents/messages
 * n'existent alors simplement pas encore pour lui). Toujours vérifier ce retour avant d'appeler
 * fetchClientInvoices/fetchClientDevis/fetchClientContracts/fetchClientLivrables (data/projet/*)
 * avec — passer `organizationId` (id du club) à ces fonctions ne renverrait jamais rien, elles
 * filtrent par `client_id`, pas par `club_id`.
 */
export async function resolveClubPortailClientId(supabase: SupabaseClient, clubId: string): Promise<string | null> {
  const { data } = await supabase.from("clubs").select("portail_client_id").eq("id", clubId).maybeSingle();
  return (data as { portail_client_id: string | null } | null)?.portail_client_id ?? null;
}
