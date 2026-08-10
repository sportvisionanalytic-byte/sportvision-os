import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Résout le `client_id` Portail lié à une organisation coach/académie
 * (organizations.legacy_client_id), peuplé best-effort par connect-org-signup (bloc "Pont
 * Documents ↔ Portail", même principe que clubplus-onboarding/clubs.portail_client_id — voir
 * data/club/portail-link.ts pour l'équivalent club) ou par le staff a posteriori. `null` si le
 * rapprochement n'a jamais eu lieu — pas une erreur : une organisation coach/académie fraîchement
 * inscrite peut légitimement ne pas encore être reliée (ex. e-mail non confirmé au moment de
 * l'inscription, le pont étant best-effort).
 *
 * Dédié plutôt que fusionné dans useClientId() (data/shared/use-client-id.ts, qui ne gère
 * aujourd'hui que 'generic'/'club') : le périmètre Séances/Stages n'a besoin que d'une résolution
 * ponctuelle organization_id → legacy_client_id pour afficher un état honnête "pas encore relié"
 * (sessions/page.tsx, camps/page.tsx) — pas du hook de state React complet consommé par
 * /messages, /communication, /publications, /validations. Étendre useClientId() à coach/académie
 * déverrouillerait potentiellement ces autres modules pour ces types d'organisation : décision
 * hors périmètre de ce chantier (Séances/Stages), à prendre séparément si besoin.
 */
export async function resolveOrgLegacyClientId(supabase: SupabaseClient, organizationId: string): Promise<string | null> {
  const { data } = await supabase.from("organizations").select("legacy_client_id").eq("id", organizationId).maybeSingle();
  return (data as { legacy_client_id: string | null } | null)?.legacy_client_id ?? null;
}
