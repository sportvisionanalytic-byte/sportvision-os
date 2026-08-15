import type { SupabaseClient } from "@supabase/supabase-js";
import type { AthleteNavItem } from "@/components/layout/ParticularShell";

// Espace particulier — voir migration-connect-v51-espace-particulier.sql §5 et
// design-connect-personnel-12-08/README.md § Espace particulier. `connect_list_my_athletes()`
// fusionne sportifs liés (connect_access_relationships, status='acceptee') et profils gérés en
// une seule liste déjà enrichie côté serveur — jamais de lecture directe de player_profiles/
// auth.users d'un tiers depuis le client (RLS ne le permettrait de toute façon pas).
export interface AthleteRow {
  kind: "linked" | "managed";
  refId: string;
  relationshipId: string;
  firstName: string;
  lastName: string;
  sport: string | null;
  categorie: string | null;
  clubNom: string | null;
  clubStatus: "affilie" | null;
  relationLabel: string;
  status: "actif" | "limite" | "gere";
  rights: {
    voir: boolean;
    download: boolean;
    reserver: boolean;
    commandes: boolean;
    factures: boolean;
    payer: boolean;
    cotisation: boolean;
    calendrier: boolean;
    modifier: boolean;
  };
}

interface AthleteRpcRow {
  kind: "linked" | "managed";
  ref_id: string;
  relationship_id: string;
  first_name: string;
  last_name: string;
  sport: string | null;
  categorie: string | null;
  club_nom: string | null;
  club_status: "affilie" | null;
  relation_label: string;
  status: "actif" | "limite" | "gere";
  right_voir: boolean;
  right_download: boolean;
  right_reserver: boolean;
  right_commandes: boolean;
  right_factures: boolean;
  right_payer: boolean;
  right_cotisation: boolean;
  right_calendrier: boolean;
  right_modifier: boolean;
}

// "Accès actif" vs "Accès limité" (README § Mes sportifs) : dérivé côté client à partir des
// droits réels plutôt qu'un statut figé côté RPC — un profil géré est toujours "gere" (droits
// pleins par construction), un sportif lié est "actif" si les 3 droits les plus consultés
// (voir/commandes/calendrier) sont accordés, "limité" sinon. Seuil arbitraire documenté ici :
// aucune règle produit tranchée par le brief au-delà des 3 statuts eux-mêmes.
function deriveStatus(kind: "linked" | "managed", rights: AthleteRpcRow): "actif" | "limite" | "gere" {
  if (kind === "managed") return "gere";
  return rights.right_voir && rights.right_commandes && rights.right_calendrier ? "actif" : "limite";
}

export async function fetchMyAthletes(supabase: SupabaseClient): Promise<AthleteRow[]> {
  const { data, error } = await supabase.rpc("connect_list_my_athletes");
  if (error) throw error;
  return ((data || []) as AthleteRpcRow[]).map((r) => ({
    kind: r.kind,
    refId: r.ref_id,
    relationshipId: r.relationship_id,
    firstName: r.first_name || "",
    lastName: r.last_name || "",
    sport: r.sport,
    categorie: r.categorie,
    clubNom: r.club_nom,
    clubStatus: r.club_status,
    relationLabel: r.relation_label,
    status: deriveStatus(r.kind, r),
    rights: {
      voir: r.right_voir,
      download: r.right_download,
      reserver: r.right_reserver,
      commandes: r.right_commandes,
      factures: r.right_factures,
      payer: r.right_payer,
      cotisation: r.right_cotisation,
      calendrier: r.right_calendrier,
      modifier: r.right_modifier,
    },
  }));
}

export function toNavItems(athletes: AthleteRow[]): AthleteNavItem[] {
  return athletes.map((a) => ({ kind: a.kind, refId: a.refId, firstName: a.firstName, lastName: a.lastName }));
}

export const ATHLETE_STATUS_LABEL: Record<AthleteRow["status"], string> = {
  actif: "Accès actif",
  limite: "Accès limité",
  gere: "Profil géré",
};

export const ATHLETE_STATUS_COLOR: Record<AthleteRow["status"], { fg: string; bg: string }> = {
  actif: { fg: "#22D3EE", bg: "rgba(34,211,238,.14)" },
  limite: { fg: "#FBBF24", bg: "rgba(251,191,36,.14)" },
  gere: { fg: "#C084FC", bg: "rgba(168,85,247,.16)" },
};

// Vocabulaire adapté selon connect_profile_settings.profil_particulier (migration-connect-v67-
// distinction-parent-agent.sql §1) — "Mes enfants" pour un parent/tuteur, "Mes sportifs suivis"
// pour un agent (vocabulaire pro déjà utilisé ailleurs, ex. AbonnementView.tsx), "Mes sportifs"
// pour le reste (choix générique "autre", ou NULL pour un compte antérieur à la migration qui
// n'a jamais fait ce choix). Partagé entre composants serveur (AthletesListView via
// sportifs/page.tsx, Accueil particulier) et client (ParticularShell.tsx) — module TS neutre,
// pas de dépendance "use client"/"use server".
export function particulierSportifsLabel(profilParticulier: string | null | undefined): string {
  if (profilParticulier === "parent" || profilParticulier === "tuteur") return "Mes enfants";
  if (profilParticulier === "agent") return "Mes sportifs suivis";
  return "Mes sportifs";
}

// Libellé du rôle affiché à l'utilisateur lui-même (sidebar, profil) — demande de Fouka le 15/08 :
// "il faut qu'il voie son rôle joueur/parent/agent/particulier". `null`/`undefined` couvre les
// comptes créés avant migration-connect-v67 (jamais redemandé rétroactivement) ET le choix
// générique "particulier" du tunnel d'inscription (aucune valeur du CHECK ne lui correspond, voir
// resolveProfilParticulier dans signup/club/page.tsx) — les deux cas affichent "Particulier",
// jamais une valeur inventée.
export function particulierRoleLabel(profilParticulier: string | null | undefined): string {
  if (profilParticulier === "agent") return "Agent";
  if (profilParticulier === "parent") return "Parent";
  if (profilParticulier === "tuteur") return "Tuteur légal";
  return "Particulier";
}

// Variante courte pour les espaces contraints (bottom nav mobile à 5 onglets) — même logique,
// vocabulaire raccourci.
export function particulierSportifsShortLabel(profilParticulier: string | null | undefined): string {
  if (profilParticulier === "parent" || profilParticulier === "tuteur") return "Enfants";
  return "Sportifs";
}

// Variante "vos/votre" pour l'Accueil particulier (formulation à la 2e personne, différente du
// "Mes ..." de la sidebar/liste) — même bascule parent/tuteur vs agent vs défaut, accordée au
// singulier/pluriel selon le nombre de sportifs affichés.
export function particulierSportifsSectionLabel(profilParticulier: string | null | undefined, count: number): string {
  const single = count === 1;
  if (profilParticulier === "parent" || profilParticulier === "tuteur") return single ? "Votre enfant" : "Vos enfants";
  if (profilParticulier === "agent") return single ? "Votre sportif suivi" : "Vos sportifs suivis";
  return single ? "Votre sportif" : "Vos sportifs";
}
