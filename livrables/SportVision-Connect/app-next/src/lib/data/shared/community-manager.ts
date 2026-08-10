import type { SupabaseClient } from "@supabase/supabase-js";

// `client_cm` (migration-connect-v21-client-cm-view.sql) — expose clients.cm_id + les colonnes
// profiles nécessaires à l'affichage du CM assigné (module MyCM), aux membres autorisés du
// club/client lié. Même patron que data/shared/messages.ts / contenus.ts : club_member_has_
// client_access() pour un club, client_users pour l'Espace Projet générique. clients/profiles
// restent fail-closed pour un client/membre de club — la vue est le seul chemin d'accès.

export interface CommunityManager {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  /** Libellé lisible dérivé de profiles.niveau_cm. null si non classé côté staff (cas théorique,
   *  protect_client_cm_assignment n'empêche pas un cm_id pointant vers un profil non classé). */
  levelLabel: string | null;
}

interface ClientCmRow {
  cm_id: string;
  prenom: string | null;
  nom: string | null;
  avatar_url: string | null;
  niveau_cm: string | null;
}

const NIVEAU_CM_LABELS: Record<string, string> = {
  cm_junior: "Community Manager junior",
  cm_confirme: "Community Manager confirmée",
  cm_full_communication: "Community Manager Full Communication",
  cm_club_plus_studio: "Community Manager Club+ Studio",
  cm_evenement: "Community Manager événementiel",
  cm_interne: "Community Manager SportVision",
  cm_lead: "Lead Community Manager",
};

export async function fetchCommunityManager(supabase: SupabaseClient, clientId: string): Promise<CommunityManager | null> {
  const { data, error } = await supabase
    .from("client_cm")
    .select("cm_id, prenom, nom, avatar_url, niveau_cm")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as ClientCmRow;
  return {
    id: row.cm_id,
    firstName: row.prenom ?? "",
    lastName: row.nom ?? "",
    avatarUrl: row.avatar_url,
    levelLabel: row.niveau_cm ? (NIVEAU_CM_LABELS[row.niveau_cm] ?? "Community Manager") : null,
  };
}

/** Un contrat Full Communication actif conditionne l'affichage du module MyCM (même logique que
 * session.ts:buildClubActiveContext → isFullCommunication, mais interrogée ici via la vue
 * `client_contrats` déjà exposée aux mêmes membres — `contrats`, la table brute, reste
 * fail-closed pour un client/membre de club, cf. migration-clubplus-v33). Fonctionne à
 * l'identique pour un club (client_id résolu via clubs.portail_client_id) et pour l'Espace
 * Projet générique (client_id = organization.id) : les deux passent par useClientId(). */
export async function fetchIsFullCommunication(supabase: SupabaseClient, clientId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("client_contrats")
    .select("id")
    .eq("client_id", clientId)
    .eq("type_contrat", "full_communication")
    .eq("statut", "actif")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** Contenus publiés ce mois-ci par ce CM pour ce client (`contenus`, migration-contenus.sql,
 * accès client via contenus_client_select — client_users d'origine, club étendu par
 * migration-clubplus-v34, NON EXÉCUTÉE à ce jour : un club verra 0 tant qu'elle n'est pas
 * passée, même limite honnête déjà documentée pour /publications et /communication).
 *
 * Seul indicateur des 3 du design d'origine (contentsProducedThisMonth / responseTime /
 * nextMeetingAt) avec une vraie source de donnée. Les deux autres n'ont AUCUNE table réelle
 * derrière :
 * - "délai de réponse moyen" : rien ne trace un cycle demande→réponse entre client et CM
 *   (messages_client est un fil plat, sans lien question/réponse) — aucun calcul honnête possible.
 * - "prochain point programmé" : `rendez_vous` (migration-portail-v1.sql, module /appointments)
 *   existe mais est un système staff-géré distinct pour l'Espace Projet, pas une prise de RDV
 *   CM↔client — le réutiliser ici laisserait croire à une fonctionnalité qui n'existe pas
 *   (même raisonnement que la suppression de ScheduleSlotModal, voir mycm/page.tsx).
 * mycm/page.tsx affiche ces deux indicateurs comme "Non disponible" plutôt que d'inventer une
 * valeur — voir le rapport de la Phase 2 (plan MyCM, 10/08/2026). */
export async function fetchContentsProducedThisMonth(
  supabase: SupabaseClient,
  clientId: string,
  cmId: string,
): Promise<number> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
  const { count, error } = await supabase
    .from("contenus")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("cm_id", cmId)
    .eq("statut", "publie")
    .gte("date_publication", monthStart);
  if (error) throw error;
  return count ?? 0;
}
