import type { SupabaseClient } from "@supabase/supabase-js";

// Revendiquer une fiche pré-créée par le club (migration v387, 01/10/2026).
//
// Fouka : « Admettons je crée un petit qui s'appelle Saiden. Il va créer son compte, moi j'aurai déjà
// mis ses photos de référence. Ça va lui dire : est-ce bien vous Saiden ? »
//
// ── POURQUOI UNE LISTE, ET PAS UN CHAMP DE RECHERCHE ──
// Parce qu'une recherche floue sur le fichier des enfants d'un club EST une énumération. Le code de
// l'équipe borne l'ensemble : une vingtaine de noms, ceux de SA catégorie, et seulement les fiches
// sans compte. On se reconnaît dedans, on ne cherche pas.
//
// Effet de bord heureux : les fautes d'orthographe deviennent sans objet. Saiden reconnaît « Sayden
// Kone » parce qu'il le LIT. Il n'y a donc aucun seuil de ressemblance à régler — et c'est heureux,
// on a mesuré qu'aucun ne sépare proprement une faute de frappe d'un homonyme.
//
// ── CE QUE CET ÉCRAN NE FAIT PAS ──
// Rattacher. Déclarer « c'est moi » dépose une demande, et c'est le CLUB qui tranche. Avant le
// 10/09/2026, un inconnu devenait parent confirmé d'un mineur avec le code d'équipe, un nom et une
// date de naissance. Un nom et une date de naissance ne prouvent pas une identité.
//
// Et revendiquer n'est pas consentir : aucune empreinte biométrique n'est calculée ici. La photo que
// le club a déposée attend toujours l'autorisation de reconnaissance, donnée plus tard, ailleurs.

export interface FicheARevendiquer {
  playerId: string;
  prenom: string;
  nom: string;
  anneeNaissance: number;
  clubNom: string | null;
  equipeNom: string | null;
  /** Une photo de référence attend déjà sur cette fiche. On ne la MONTRE pas : la photo d'un enfant
   *  n'a pas à être visible de qui détient un code. On dit seulement qu'elle existe. */
  aUnePhoto: boolean;
}

/** La liste de l'équipe du code, la plus probable en tête si un nom est donné.
 *
 *  `nomApproximatif` sert UNIQUEMENT à trier côté base. Il n'écarte personne : la liste entière
 *  reste affichée, parce qu'un tri qui se trompe se corrige d'un coup d'œil, alors qu'un filtre qui
 *  se trompe fait disparaître sa propre fiche sans rien dire. */
export async function fichesARevendiquer(
  supabase: SupabaseClient,
  code: string,
  nomApproximatif?: string,
): Promise<FicheARevendiquer[]> {
  const { data, error } = await supabase.rpc("fiches_a_revendiquer", {
    p_code: code,
    p_nom: nomApproximatif ?? null,
  });
  // Un code invalide rend une liste vide, sans explication : expliquer aiderait à en deviner un.
  if (error) return [];
  type Ligne = {
    player_id: string; prenom: string; nom: string; annee_naissance: number;
    club_nom: string | null; equipe_nom: string | null; a_une_photo: boolean;
  };
  return ((data ?? []) as Ligne[]).map((r) => ({
    playerId: r.player_id,
    prenom: r.prenom,
    nom: r.nom,
    anneeNaissance: r.annee_naissance,
    clubNom: r.club_nom,
    equipeNom: r.equipe_nom,
    aUnePhoto: r.a_une_photo,
  }));
}

export async function revendiquerFiche(
  supabase: SupabaseClient,
  playerId: string,
  code: string,
  qualite: "joueur" | "parent",
): Promise<string> {
  const { data, error } = await supabase.rpc("revendiquer_fiche", {
    p_player_id: playerId,
    p_code: code,
    p_qualite: qualite,
  });
  if (error) throw error;
  // Pas de faux succès : la base dit ce qu'elle a déposé, et le message à afficher.
  const r = data as { depose?: boolean; message?: string } | null;
  if (!r?.depose) throw new Error("La demande n'a pas été enregistrée. Réessayez.");
  return r.message ?? "Votre demande est partie au club.";
}

/** Corriger son identité, ou celle de son enfant, une fois la fiche confirmée.
 *
 *  « Peut-être que je vais me tromper dans les noms et prénoms » (Fouka) : une fiche pré-créée par
 *  SportVision puis corrigée par la famille, c'est la famille qui a raison. Chaque correction est
 *  tracée en base avec qui l'a faite et en quelle qualité. */
export async function corrigerIdentiteSportif(
  supabase: SupabaseClient,
  playerId: string,
  champs: { prenom?: string; nom?: string; dateNaissance?: string },
): Promise<void> {
  const { data, error } = await supabase.rpc("corriger_identite_sportif", {
    p_player_id: playerId,
    p_prenom: champs.prenom ?? null,
    p_nom: champs.nom ?? null,
    p_date_naissance: champs.dateNaissance ?? null,
  });
  if (error) throw error;
  const r = data as { corrige?: boolean; raison?: string } | null;
  if (!r) throw new Error("La correction n'a pas été enregistrée.");
  if (!r.corrige && r.raison !== "rien à corriger") {
    throw new Error("La correction n'a pas été enregistrée.");
  }
}
