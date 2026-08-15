import type { SupabaseClient } from "@supabase/supabase-js";

// Pré-remplissage du bloc "Informations pour le montage" du wizard Montage Compilation
// (migration-connect-v68-fiche-joueur-montage-compilation.sql, décidé par Fouka le 15/08) —
// UNIQUEMENT pour cette offre, jamais utilisé pour les autres prestations du catalogue.
//
// Deux sources selon le type de bénéficiaire (voir ReservationWizardParticulier.tsx §Beneficiary
// et particulier.ts §AthleteRow pour le détail de kind self/linked/managed) :
//  - "self"/"linked" → player_profiles, matché par user_id (le compte joueur lui-même pour
//    "self" ; car.owner_user_id — c'est-à-dire beneficiary.id — pour "linked", voir
//    connect_list_my_athletes dans migration-connect-v51-espace-particulier.sql).
//  - "managed" → managed_athlete_profiles, matché par id (= beneficiary.id).
//
// null si aucune ligne profil n'existe encore (particulier "self" sans player_profiles, par
// exemple) — état honnête, jamais une erreur : le frontend traite null comme "tous les champs
// du bloc sont de simples champs de saisie vides".
export interface AthleteProfileInfo {
  tailleCm: number | null;
  poidsKg: number | null;
  poste: string | null;
  numeroMaillot: string | null;
}

interface AthleteProfileTarget {
  kind: "self" | "linked" | "managed";
  // player_profiles.user_id à lire pour "self"/"linked" (userId du compte joueur ciblé — celui
  // de l'appelant pour "self", celui du sportif lié pour "linked").
  userId: string | null;
  // managed_athlete_profiles.id à lire pour "managed".
  managedId: string | null;
}

export async function fetchAthleteProfile(
  supabase: SupabaseClient,
  target: AthleteProfileTarget,
): Promise<AthleteProfileInfo | null> {
  if (target.kind === "managed") {
    if (!target.managedId) return null;
    const { data } = await supabase
      .from("managed_athlete_profiles")
      .select("taille_cm, poids_kg, poste, numero_maillot")
      .eq("id", target.managedId)
      .maybeSingle();
    if (!data) return null;
    return {
      tailleCm: data.taille_cm ?? null,
      poidsKg: data.poids_kg ?? null,
      poste: data.poste ?? null,
      numeroMaillot: data.numero_maillot ?? null,
    };
  }

  if (!target.userId) return null;
  const { data } = await supabase
    .from("player_profiles")
    .select("taille_cm, poids_kg, poste, numero_maillot")
    .eq("user_id", target.userId)
    .maybeSingle();
  if (!data) return null;
  return {
    tailleCm: data.taille_cm ?? null,
    poidsKg: data.poids_kg ?? null,
    poste: data.poste ?? null,
    numeroMaillot: data.numero_maillot ?? null,
  };
}
