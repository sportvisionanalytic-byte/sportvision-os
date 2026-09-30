// LE MATERIEL, VU DE L'APPLICATION (30/09/2026).
//
// LA QUESTION DU RESPONSABLE DE PRODUCTION EST TOUJOURS LA MEME : quel kit est dehors, chez qui, et
// quand rentre-t-il. L'ecran ne repond bien qu'a deux tiers de cette question, et la raison est
// dans les donnees, pas dans le code.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// MESURE DU 30/09 (jeton de Mikael, role prod)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
//  · 2 kits : « Kit photo bad G » (localisation « Fouka ») et « KIT alpha 1 » (« Chez fouka »).
//    Les deux sans pole : donc communs aux deux poles, Football et Basket.
//  · 2 reservations, toutes deux au statut `réservé`, chacune sur une mission de septembre deja
//    cloturee. Aucune au statut `retourné`.
//  · `date_retour_prevue` EST NULLE SUR LES DEUX. La question « quel retour est echu » n'a donc
//    aucune donnee pour se poser : ce n'est pas un ecran vide, c'est une echeance que personne ne
//    saisit. L'ecran le dit, et dit ou la saisir.
//  · `mission_suivi_operateur.kit_restitue_at` est nul sur les 9 suivis existants : la restitution
//    n'est jamais declaree cote operateur non plus. Deuxieme source, meme silence.
//  · `kits.statut` vaut `disponible` sur les deux, alors qu'une reservation active existe pour
//    chacun. Les deux verites ne s'accordent pas. On affiche la RESERVATION, qui nomme la personne
//    et la mission, et on signale le desaccord plutot que de choisir en silence.
//  · 6 materiels, 5 dans un kit, 1 hors kit (« Micro Rode »). `kits.contenu` (jsonb) vaut `[]` sur
//    les deux kits : la composition se lit dans `materiels.kit_id`, pas dans ce champ-la.
//  · 0 controle de kit, 0 incident materiel, 0 maintenance. Ces trois modules de l'OS n'ont jamais
//    servi ; l'application ne les dessine pas.
import { supabase } from "./supabase";

export interface Kit {
  id: string;
  nom: string;
  typeKit: string | null;
  /** `disponible` | `réservé` | `sorti` | `en_prestation` | `à_retourner` | `retourné` | ... */
  statut: string;
  localisation: string | null;
  numInterne: string | null;
  poleId: string | null;
  poleExclusif: boolean;
}

export interface Reservation {
  id: string;
  kitId: string;
  kitNom: string | null;
  prestationId: string | null;
  missionReference: string | null;
  missionDate: string | null;
  missionStatut: string | null;
  collaborateurId: string | null;
  collaborateurNom: string | null;
  statut: string;
  sortieLe: string | null;
  retourPrevuLe: string | null;
  retourEffectifLe: string | null;
  lieuRecuperation: string | null;
  lieuRetour: string | null;
  consignes: string | null;
}

export interface Materiel {
  id: string;
  nom: string;
  categorie: string | null;
  marque: string | null;
  modele: string | null;
  statut: string;
  kitId: string | null;
}

export interface EtatMateriel {
  kits: Kit[];
  reservations: Reservation[];
  materiels: Materiel[];
}

/** Ce qui n'est plus dehors. La vue `v_production_missions` ecarte exactement ces deux statuts. */
const STATUTS_RENTRES = ["retourné", "en_contrôle"];

/**
 * Tout l'etat du materiel en une lecture par table.
 *
 * ON NE FILTRE PAS PAR POLE : `kits_select` et `kit_resa_select` appellent deja
 * `kit_pole_scope_ok` / `kit_reservation_pole_scope_ok`, qui laissent passer les kits communs et
 * bornent les kits dedies. Mesure : Mikael lit 2 kits sur 2 et 2 reservations sur 2, et les deux
 * kits sont communs.
 *
 * L'embed vers `profiles` est NOMME : `kit_reservations` designe trois personnes
 * (`collaborateur_id`, `created_by`, `responsable_id`). Un embed implicite y repond PGRST201, ce
 * que l'OS a decouvert en testant sous RLS reelle avant de considerer son code fini.
 */
export async function lireMateriel(): Promise<EtatMateriel> {
  const [rKits, rResa, rMat] = await Promise.all([
    supabase
      .from("kits")
      .select("id, nom, type_kit, statut, localisation, num_interne, pole_id, pole_exclusif")
      .order("nom", { ascending: true }),
    supabase
      .from("kit_reservations")
      .select(
        `id, kit_id, prestation_id, collaborateur_id, statut, date_sortie, date_retour_prevue,
         date_retour_effective, lieu_recuperation, lieu_retour, consignes,
         kits ( nom ),
         prestations ( reference, date_prestation, statut ),
         profiles!kit_reservations_collaborateur_id_fkey ( prenom, nom )`,
      )
      .not("statut", "in", `(${STATUTS_RENTRES.join(",")})`)
      .order("date_sortie", { ascending: true, nullsFirst: false }),
    supabase
      .from("materiels")
      .select("id, nom, categorie, marque, modele, statut, kit_id")
      .order("nom", { ascending: true }),
  ]);

  if (rKits.error) throw rKits.error;
  if (rResa.error) throw rResa.error;
  if (rMat.error) throw rMat.error;

  type LigneKit = {
    id: string; nom: string | null; type_kit: string | null; statut: string | null;
    localisation: string | null; num_interne: string | null; pole_id: string | null;
    pole_exclusif: boolean | null;
  };
  type LigneResa = {
    id: string; kit_id: string; prestation_id: string | null; collaborateur_id: string | null;
    statut: string | null; date_sortie: string | null; date_retour_prevue: string | null;
    date_retour_effective: string | null; lieu_recuperation: string | null;
    lieu_retour: string | null; consignes: string | null;
    kits: { nom: string | null } | null;
    prestations: { reference: string | null; date_prestation: string | null; statut: string | null } | null;
    profiles: { prenom: string | null; nom: string | null } | null;
  };
  type LigneMat = {
    id: string; nom: string | null; categorie: string | null; marque: string | null;
    modele: string | null; statut: string | null; kit_id: string | null;
  };

  return {
    kits: ((rKits.data ?? []) as unknown as LigneKit[]).map((k) => ({
      id: String(k.id),
      nom: k.nom?.trim() || "Kit sans nom",
      typeKit: k.type_kit ?? null,
      statut: k.statut ?? "",
      localisation: k.localisation?.trim() || null,
      numInterne: k.num_interne?.trim() || null,
      poleId: k.pole_id ?? null,
      poleExclusif: k.pole_exclusif === true,
    })),
    reservations: ((rResa.data ?? []) as unknown as LigneResa[]).map((r) => ({
      id: String(r.id),
      kitId: String(r.kit_id),
      kitNom: r.kits?.nom?.trim() || null,
      prestationId: r.prestation_id ?? null,
      missionReference: r.prestations?.reference ?? null,
      missionDate: r.prestations?.date_prestation ?? null,
      missionStatut: r.prestations?.statut ?? null,
      collaborateurId: r.collaborateur_id ?? null,
      collaborateurNom:
        [r.profiles?.prenom, r.profiles?.nom].filter(Boolean).join(" ").trim() || null,
      statut: r.statut ?? "",
      sortieLe: r.date_sortie ?? null,
      retourPrevuLe: r.date_retour_prevue ?? null,
      retourEffectifLe: r.date_retour_effective ?? null,
      lieuRecuperation: r.lieu_recuperation?.trim() || null,
      lieuRetour: r.lieu_retour?.trim() || null,
      consignes: r.consignes?.trim() || null,
    })),
    materiels: ((rMat.data ?? []) as unknown as LigneMat[]).map((m) => ({
      id: String(m.id),
      nom: m.nom?.trim() || "Matériel sans nom",
      categorie: m.categorie ?? null,
      marque: m.marque?.trim() || null,
      modele: m.modele?.trim() || null,
      statut: m.statut ?? "",
      kitId: m.kit_id ?? null,
    })),
  };
}

/**
 * Un retour est echu quand la date prevue est passee et qu'aucun retour n'a ete enregistre.
 *
 * Mesure : AUCUNE des 2 reservations n'a de `date_retour_prevue`. Cette fonction rendra donc
 * toujours faux aujourd'hui, et c'est precisement ce que l'ecran doit expliquer au lieu de montrer
 * une liste vide qui laisserait croire que tout est rentre.
 */
export function retourEchu(r: Reservation, maintenant = new Date()): boolean {
  if (!r.retourPrevuLe || r.retourEffectifLe) return false;
  return new Date(r.retourPrevuLe).getTime() < maintenant.getTime();
}

/** Combien de reservations n'ont pas d'echeance de retour. Le chiffre a dire, pas a cacher. */
export function sansEcheanceDeRetour(reservations: Reservation[]): number {
  return reservations.filter((r) => !r.retourPrevuLe && !r.retourEffectifLe).length;
}

/**
 * Le desaccord entre les deux verites : le kit se dit « disponible » alors qu'une reservation
 * active le tient. Constate sur 2 kits sur 2.
 *
 * On ne corrige rien depuis un ecran : on signale, et la production tranche dans l'OS.
 */
export function kitSeDitLibreMaisEstPris(kit: Kit, reservations: Reservation[]): boolean {
  if (kit.statut !== "disponible") return false;
  return reservations.some((r) => r.kitId === kit.id && !r.retourEffectifLe);
}

/** Les libelles de statut de kit, ceux de l'OS, mot pour mot. */
export const LIBELLE_STATUT_KIT: Record<string, string> = {
  disponible: "Disponible",
  pret: "Prêt",
  "pré_réservé": "Pré-réservé",
  "réservé": "Réservé",
  a_preparer: "À préparer",
  "à_récupérer": "À récupérer",
  sorti: "Sorti",
  en_prestation: "En prestation",
  "à_retourner": "À retourner",
  "retourné": "Retourné",
  "en_contrôle": "En contrôle",
  "endommagé": "Endommagé",
  en_maintenance: "En maintenance",
  indisponible: "Indisponible",
};

/** Les categories de materiel, dans les mots de l'OS. */
export const LIBELLE_CATEGORIE: Record<string, string> = {
  boitier_photo: "Boîtier photo",
  camera: "Caméra",
  objectif: "Objectif",
  microphone: "Microphone",
  micro: "Microphone",
  drone: "Drone",
  stabilisateur: "Stabilisateur",
  trepied: "Trépied",
  eclairage: "Éclairage",
  batterie: "Batterie",
  carte_memoire: "Carte mémoire",
  chargeur: "Chargeur",
  cable: "Câble",
  ordinateur: "Ordinateur",
  telephone: "Téléphone",
  sac: "Sac / Contenant",
  accessoire: "Accessoire",
  consommable: "Consommable",
  autre: "Autre",
};
