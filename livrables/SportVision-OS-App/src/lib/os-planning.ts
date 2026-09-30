// LES TROIS LECTURES QUE `os-missions.ts` NE FAIT PAS (30/09/2026).
//
// Rien d'autre n'est ici : le cockpit, mes missions et la réponse à une invitation restent là-bas,
// et personne ne les redéfinit.
//
// ── 1. « MES » MISSIONS N'A PAS LE MÊME SENS SELON LE RÔLE ────────────────────────────────────
//
// Mesuré le 30/09 avec le jeton de chacun des douze comptes terrain, `set local role
// authenticated` dans une transaction annulée :
//
//     Antoine Blin        (photo) : 5 lignes de prestations_equipe  ← les siennes
//     Quentin Caffiaux    (photo) : 1 ligne                          ← la sienne
//     les 8 autres photo          : 0 ligne
//     Mikael A. Ruffine   (prod)  : 10 lignes                        ← TOUTES
//     christian fouka     (prod)  : 10 lignes                        ← TOUTES
//
// `lireMesMissions()` ne filtre rien, et elle a raison pour un opérateur : la RLS le borne déjà à
// lui-même, et un filtre de plus donnerait l'illusion que c'est l'écran qui tient la frontière
// (la leçon des galeries, le 30/09 au matin). Mais la RLS borne un `prod` à son PÔLE, pas à sa
// personne : sans le `collaborateur_id` ci-dessous, « Mon planning » d'un responsable de
// production afficherait les dix missions du pôle, dont six où il n'est pas affecté.
//
// Ce n'est donc pas un filtre de sécurité redondant : c'est la DÉFINITION de « mon » planning, et
// la base ne la tient pas. L'OS fait exactement ça pour les deux écrans « Sur le terrain » qu'il
// prête à un prod : `collaborateur_id=eq.<uid>`.
//
// ── 2. CE QUI MANQUE POUR CLORE UNE MISSION EST ÉCRIT PAR LA BASE ──────────────────────────────
//
// `mission_cloture_manquant(prestation_id)` rend un tableau de phrases françaises complètes, par
// exemple « Sauvegarde non confirmée par l'opérateur (il doit cocher « fichiers copiés et
// vérifiés ») ». On les AFFICHE, on ne les recompose pas : recopier ses six conditions côté
// téléphone, c'est se préparer à dire l'inverse d'elle le jour où elle change. Elle est exposée
// par `v_production_missions.cloture_manquant`.
//
// ATTENTION, CETTE VUE N'EST PAS BORNÉE À SES PROPRES MISSIONS. Mesuré : les douze comptes y
// voient les MÊMES dix lignes — son `where` est `is_staff() AND pole_scope_ok(pole_id)`, il ne
// regarde pas `collaborateur_id`. Le croisement fait plus bas côté écran, entre ces dix lignes et
// mes affectations, est donc un filtre de PERTINENCE, pas de sécurité : il ne protège rien et ne
// prétend rien protéger.
//
// ── 3. LES CORRECTIONS DEMANDÉES SUR MES LIENS ─────────────────────────────────────────────────
//
// `cloture_manquant` dit qu'« un lien attend une correction » mais pas LEQUEL ni POURQUOI. Le
// pourquoi est dans `media_liens.commentaire`, écrit par la Production, et c'est la seule chose
// qui permette d'agir : mesuré, la correction en cours dit « pas assez de photod ».
import { supabase } from "./supabase";
import { versDate } from "./dates";
import type { MaMission } from "./os-missions";

// `libelleCouverture` VIVAIT ICI, ET C'ETAIT SA PLACE LA PLUS FAIBLE (30/09/2026, apres relecture
// a l'ecran). Trois ecrans — Mes missions, Mes revenus, Affectation — posaient « photo_video » tel
// quel dans leur pastille, souligne compris, parce que rien n'indiquait qu'une traduction existait
// dans le fichier du planning. Elle est desormais dans `os-missions.ts`, aupres du type qui porte
// le champ. On la re-expose ici pour ne pas casser ce qui l'importait deja.
export { libelleCouverture } from "./os-missions";

/**
 * Mes affectations à moi, et seulement les miennes.
 *
 * Le `eq("collaborateur_id")` est expliqué en tête de fichier : mesuré, un `prod` voit les dix
 * lignes de la table, un `photo` seulement les siennes.
 *
 * UNE MISSION REFUSÉE OU REMPLACÉE N'EST PLUS LA MIENNE, et une prestation annulée n'est plus une
 * mission : les deux sortent d'ici. C'est la règle de l'OS (`loadPhotoDash` teste les DEUX statuts,
 * celui de l'invitation et celui de la prestation, « sinon le photographe continue de voir une
 * mission annulée comme active »). Mesuré ce jour : aucune ligne refusée, aucune prestation
 * annulée, donc rien ne change à l'écran aujourd'hui — mais un refus ne doit pas revenir demain.
 */
export async function lireMonPlanning(moiId: string): Promise<MaMission[]> {
  const { data, error } = await supabase
    .from("prestations_equipe")
    .select(`id, prestation_id, statut, fonction, est_responsable, heure_rdv, remuneration,
             prestations ( reference, statut, date_prestation, heure_debut, lieu, adresse_complete,
                           couverture, brief_cm, description_besoin, clients ( nom ) )`)
    .eq("collaborateur_id", moiId);
  if (error) throw error;

  type Ligne = {
    id: string; prestation_id: string; statut: string | null; fonction: string | null;
    est_responsable: boolean | null; heure_rdv: string | null; remuneration: number | null;
    prestations: {
      reference: string | null; statut: string | null; date_prestation: string | null;
      heure_debut: string | null; lieu: string | null; adresse_complete: string | null;
      couverture: string | null; brief_cm: string | null; description_besoin: string | null;
      clients: { nom: string | null } | null;
    } | null;
  };

  return ((data ?? []) as unknown as Ligne[])
    .filter((r) => r.prestations)
    .filter((r) => !["refusée", "remplacée", "annulée"].includes(String(r.statut ?? "")))
    .filter((r) => String(r.prestations!.statut ?? "") !== "annulée")
    .map((r) => ({
      affectationId: String(r.id),
      prestationId: String(r.prestation_id),
      reference: r.prestations!.reference ?? "",
      statut: String(r.prestations!.statut ?? ""),
      date: r.prestations!.date_prestation ?? null,
      heureRdv: r.heure_rdv ?? null,
      heureDebut: r.prestations!.heure_debut ?? null,
      lieu: r.prestations!.lieu ?? null,
      adresse: r.prestations!.adresse_complete ?? null,
      client: r.prestations!.clients?.nom ?? null,
      couverture: r.prestations!.couverture ?? null,
      fonction: r.fonction ?? null,
      responsable: r.est_responsable === true,
      reponse: String(r.statut ?? ""),
      remuneration: typeof r.remuneration === "number" ? r.remuneration : null,
      brief: r.prestations!.brief_cm ?? null,
      besoin: r.prestations!.description_besoin ?? null,
    }))
    // Tri en JavaScript et pas côté serveur : `order` sur une colonne de la table jointe ne
    // s'applique pas sur toutes les versions de PostgREST, et l'OS a payé la même leçon (« le tri
    // serveur sur embedded ne marche pas sur toutes les versions »). Une date absente part au bout.
    .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
}

export interface EtatCloture {
  prestationId: string;
  /** Les phrases de la base, telles quelles. Vide quand il ne manque rien. */
  manque: string[];
  incidentOuvert: boolean;
}

/**
 * Ce qui manque pour clore chaque mission, d'après la base.
 *
 * `annulees` sort : `mission_cloture_manquant` ne regarde pas si la prestation est annulée et rend
 * donc ses quatre phrases habituelles sur une mission qui n'aura jamais lieu. Même exclusion que
 * `lireCockpit()`, pour la même raison.
 */
export async function lireEtatCloture(): Promise<EtatCloture[]> {
  const { data, error } = await supabase
    .from("v_production_missions")
    .select("prestation_id, cloture_manquant, incident_ouvert")
    .neq("groupe", "annulees");
  if (error) throw error;

  return (data ?? []).map((r) => ({
    prestationId: String(r.prestation_id),
    manque: Array.isArray(r.cloture_manquant) ? (r.cloture_manquant as string[]) : [],
    incidentOuvert: r.incident_ouvert === true,
  }));
}

export interface CorrectionDemandee {
  id: string;
  prestationId: string;
  /** Le nom du lien, tel que l'opérateur l'a saisi : « PHOTOS VAL YERRES VS RCPF (18photos) ». */
  nom: string | null;
  /** Ce que la Production reproche. C'est la seule phrase qui dit quoi refaire. */
  commentaire: string | null;
}

/**
 * Les corrections demandées sur MES liens.
 *
 * `ajouteur_id` n'est pas une barrière : mesuré, Antoine lit 28 liens dont 27 posés par lui. C'est
 * un filtre de pertinence, et c'est celui de l'OS (`media_liens?…&ajouteur_id=eq.<uid>`) : une
 * correction demandée sur le lien d'un collègue n'est pas mon travail.
 */
export async function lireMesCorrections(moiId: string): Promise<CorrectionDemandee[]> {
  const { data, error } = await supabase
    .from("media_liens")
    .select("id, prestation_id, nom, commentaire")
    .eq("ajouteur_id", moiId)
    .eq("statut", "correction_demandee");
  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: String(r.id),
    prestationId: String(r.prestation_id),
    nom: r.nom ?? null,
    commentaire: r.commentaire ?? null,
  }));
}

// ── Le rangement du planning ───────────────────────────────────────────────────────────────────

export interface JourDePlanning { date: string; missions: MaMission[] }
export interface MoisDePlanning { cle: string; libelle: string; jours: JourDePlanning[] }

/** « Septembre 2026 ». Même construction que l'OS dans `loadPhotoPlan` : le mois long en français,
 *  première lettre en capitale. */
export function libelleMois(cle: string): string {
  const brut = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", month: "long", year: "numeric",
  }).format(versDate(`${cle}-01`));
  return brut.charAt(0).toUpperCase() + brut.slice(1);
}

/** Les mois qui portent vraiment quelque chose. Un mois vide ne se propose pas : c'est la règle du
 *  calendrier de l'application des familles, et la puce qu'on touche pour rien y avait été retirée. */
export function moisDisponibles(missions: MaMission[]): string[] {
  const vus = new Set<string>();
  for (const m of missions) if (m.date) vus.add(m.date.slice(0, 7));
  return [...vus].sort();
}

/** Les missions d'un mois, rangées par jour. L'ordre des jours est celui du tableau reçu, donc
 *  croissant : c'est `lireMonPlanning` qui trie, une seule fois. */
export function jours(missions: MaMission[], mois: string): JourDePlanning[] {
  const parJour = new Map<string, MaMission[]>();
  for (const m of missions) {
    if (!m.date || !m.date.startsWith(mois)) continue;
    const liste = parJour.get(m.date);
    if (liste) liste.push(m);
    else parJour.set(m.date, [m]);
  }
  return [...parJour.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, liste]) => ({ date, missions: liste }));
}

/** Ma prochaine mission : la première dont la date n'est pas passée. Aujourd'hui compte comme à
 *  venir — on ne retire pas de l'écran la mission sur laquelle on est en train de partir. */
export function prochaine(missions: MaMission[], aujourdhui: string): MaMission | null {
  return missions.find((m) => m.date && m.date >= aujourdhui) ?? null;
}

/** Ce qui attend une réponse. Les deux mêmes valeurs que l'écran « Mes missions », pour qu'un
 *  compteur sur l'accueil et une carte dans l'onglet ne disent jamais deux choses différentes.
 *  `a_envoyer` existe aussi dans l'énumération mais désigne une invitation PAS ENCORE envoyée :
 *  elle n'est pas à moi de répondre. */
export function aRepondre(missions: MaMission[]): MaMission[] {
  return missions.filter((m) => m.reponse === "invitation_envoyée" || m.reponse === "en_attente");
}

// ── Les clés de cache ──────────────────────────────────────────────────────────────────────────
//
// L'accueil et le planning posent EXACTEMENT la même question à la base. Même clé, donc : ouvrir
// « Mon planning » après l'accueil ne coûte plus rien, et il n'y a pas deux réponses possibles à
// la même question sur le même écran (la leçon de `cleEvenements`, le 29/09).

export const clePlanning = (moiId: string) => `os:planning:${moiId}`;
export const cleCloture = "os:cloture";
export const cleCorrections = (moiId: string) => `os:corrections:${moiId}`;
export const cleCockpit = "os:cockpit";
