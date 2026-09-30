// LE MODE JOUR J, ET LE RAPPORT QUI VIENT APRÈS (01/10/2026).
//
// C'est le seul endroit de l'application où l'opérateur ÉCRIT. Jusqu'ici il ne pouvait que lire,
// plus accepter ou refuser une invitation : tout le geste métier se faisait sur ordinateur, alors
// qu'il se passe au bord d'un terrain, debout, en 4G.
//
// ── CE QUI A ÉTÉ MESURÉ AVANT D'ÉCRIRE UNE LIGNE ───────────────────────────────────────────────
//
// Base de production, 01/10/2026. 10 prestations portent une équipe, 10 affectations, 9 lignes
// d'avancement personnel (`mission_suivi_operateur`).
//
//   `prestations.adresse_complete`     0 / 10   ← aucun itinéraire ne s'ouvrira jamais sur l'adresse
//   `prestations.contact_sur_place`    0 / 10   ← le bloc « Contact » de l'OS ne s'affiche jamais
//   `prestations.telephone_sur_place`  0 / 10   ← le bouton d'appel non plus
//   `prestations.lieu`                10 / 10   ← le seul repère réel : « STADE PHILIPPE MAHUT 2 - FONTAINEBLEAU »
//   `prestations.description_besoin`  10 / 10   ← le brief, en pratique, c'est celui-là
//   `prestations.brief_cm`             0 / 10   ← jamais rempli
//   `prestations.livrables_demandes`   0 / 10   ← rien à afficher
//   `prestations_equipe.heure_rdv`     5 / 10   ← on retombe sur `heure_debut`, et on CHANGE LE MOT
//   `heures_declarees`                 2 / 10   `km_declares` 2 / 10
//   `frais_declares`                   0 / 10   `notes_declaration` 0 / 10
//   `mission_suivi_operateur.notes`    0 /  9   ← jamais utilisé par personne
//
// Ce qui manque ne prend pas la place d'un « non renseigné » : l'adresse absente est dite UNE
// fois, parce qu'elle change ce que fait l'opérateur (il doit appeler), et le reste disparaît.
//
// ── LES DROITS, VÉRIFIÉS PAR LE CHEMIN RÉEL ────────────────────────────────────────────────────
//
// `set local role authenticated` + les claims d'Antoine Blin (photo, 5 missions), transaction
// annulée. L'API Management répond « oui » à tout : elle n'a servi qu'à MESURER.
//
//   prestations.statut, les 14 transitions du parcours opérateur   PASSENT  (détail plus bas)
//   prestations.statut vers une étape hors parcours                REFUSÉ   par le déclencheur
//   prestations.lieu / horaire / adresse                           REFUSÉ   « réservés au secrétariat »
//   mission_suivi_operateur : INSERT, horodatages, etapes, notes    PASSENT
//   prestations_equipe : heures / km / frais / notes déclarées      PASSENT
//   prestations_equipe.remuneration                                REFUSÉ   « se fixe par la Production »
//   prestations_equipe.est_responsable                             REFUSÉ   « réservée à la Production »
//   prestations.briefing_vu_at                                     PASSE
//   incidents : INSERT avec declare_par = soi                       PASSE
//
// ── CE QUE LA BASE NE LAISSE PAS FAIRE, ET QU'ON NE CONTOURNE PAS ──────────────────────────────
//
// L'opérateur ne voit PAS ses coéquipiers. Mesuré : sur SV-2026-3843, où Antoine et Quentin sont
// tous deux acceptés, Antoine lit UNE ligne de `prestations_equipe` — la sienne. La vue
// `prestations_equipe_display` ne change rien : son `where` est
// `peut_voir_couts_mission(prestation_id) OR collaborateur_id = auth.uid()`. Le bloc « Équipe »
// du Mode Jour J de l'OS web affiche donc toujours une équipe d'une personne : lui. On ne le
// reproduit pas ici — un bloc qui ne peut que se répéter soi-même n'est pas une information.
import { supabase } from "./supabase";

// ── LE PARCOURS TERRAIN ────────────────────────────────────────────────────────────────────────
//
// LES LIBELLÉS SONT CEUX DE L'OS, MOT POUR MOT (`OPERATEUR_ACTIONS`, module « Procédure terrain »
// du 09/09/2026). Une personne qui passe de l'ordinateur au téléphone doit retrouver la même
// phrase sur le même bouton.
//
// CE TABLEAU EST UNE RECOPIE, ET C'EST LE POINT FAIBLE DE CET ÉCRAN. La règle 3 du contrat dit
// d'appeler la fonction de la base plutôt que de recopier sa condition. Ici la condition vit dans
// le CORPS d'un déclencheur (`protect_prestation_operational_fields`), que rien n'expose : il
// n'existe aucune fonction à appeler. L'OS web recopie déjà ce tableau, et il a payé la dérive —
// son commentaire v151 dit « ✓ Kit prêt, je peux partir, proposé à l'opérateur mais refusé
// jusqu'ici », c'est-à-dire exactement le bouton-qui-mène-à-un-refus de la règle 5.
//
// Faute de fonction, la recopie a donc été MESURÉE, pas relue : les 14 transitions ci-dessous ont
// été tentées une par une avec le jeton d'Antoine, statut de départ forcé dans une transaction
// annulée, le 01/10/2026. Les 14 passent. Trois témoins hors parcours (prêt_validation →
// à_valider_client, prête_à_livrer → livrée, livrée → clôturée) sont refusés par le déclencheur,
// avec sa phrase. Aucun bouton de cet écran ne mène à un refus AUJOURD'HUI.
//
// La migration `migration-v377-la-liste-des-gestes-de-l-operateur-n-est-nulle-part.sql`
// (écrite, NON APPLIQUÉE) supprime la recopie :
// elle sort la liste du corps du déclencheur vers une table, fait lire cette table au
// déclencheur, et expose `operateur_action_suivante(prestation_id)`. Tant qu'elle n'est pas
// appliquée, c'est la mesure ci-dessus qui tient, et la règle 4 fait le reste : toute dérive
// ressort par la phrase de la base, jamais par un faux succès.

/** Les colonnes d'horodatage personnel de `mission_suivi_operateur` que l'opérateur remplit. */
export type ChampSuivi =
  | "kit_prepare_at" | "parti_at" | "arrive_at" | "prestation_terminee_at";

export interface EtapeTerrain {
  /** Le statut de la mission DEPUIS lequel ce geste est possible. */
  depuis: string;
  /** Le statut que la base acceptera. */
  vers: string;
  /** Le mot de l'OS. */
  libelle: string;
  /** L'icône Ionicons. L'OS met un émoji ; l'application dessine, comme partout ailleurs. */
  icone: string;
  /** L'heure qu'on note au passage, quand il y en a une à noter. */
  suivi: ChampSuivi | null;
  /** La fin de la couverture terrain : le moment où l'écran doit dire que la mission continue. */
  bascule?: boolean;
}

const PARCOURS: EtapeTerrain[] = [
  { depuis: "équipe_affectée", vers: "prête", libelle: "Kit prêt, je peux partir", icone: "checkmark-circle", suivi: "kit_prepare_at" },
  // Les deux départs courts : une mission qui n'est jamais passée par « Équipe affectée ». La base
  // les accepte (mesuré), et l'OS les propose dans son `JJ_STATUT_ACTION` sous « Je prends la
  // route ». On garde le mot d'`OPERATEUR_ACTIONS`, qui est le module de référence depuis le 09/09.
  { depuis: "planifiée", vers: "équipe_en_route", libelle: "Je suis en route", icone: "car", suivi: "parti_at" },
  { depuis: "confirmée", vers: "équipe_en_route", libelle: "Je suis en route", icone: "car", suivi: "parti_at" },
  { depuis: "prête", vers: "équipe_en_route", libelle: "Je suis en route", icone: "car", suivi: "parti_at" },
  { depuis: "équipe_en_route", vers: "arrivée_sur_place", libelle: "Je suis arrivé", icone: "location", suivi: "arrive_at" },
  { depuis: "arrivée_sur_place", vers: "production_démarrée", libelle: "Démarrer la production", icone: "play", suivi: null },
  { depuis: "production_démarrée", vers: "production_terminée", libelle: "Prestation terminée", icone: "stop", suivi: "prestation_terminee_at", bascule: true },
];

/**
 * Le geste que l'opérateur peut faire maintenant, ou rien.
 *
 * Rien n'est proposé au-delà de `production_terminée` : la suite (sécuriser les fichiers, déposer
 * les liens, la post-production) est l'écran « Sauvegarde » de l'OS, avec ses propres garde-fous
 * en base — `proteger_liberation_cartes` refuse de libérer une carte tant qu'aucune livraison n'a
 * de transfert confirmé. Un bouton « Fichiers sauvegardés » ici, sans l'écran qui dépose le lien,
 * ne servirait qu'à faire échouer la clôture plus tard.
 */
export function actionSuivante(statut: string): EtapeTerrain | null {
  return PARCOURS.find((e) => e.depuis === statut) ?? null;
}

/** Les statuts par lesquels la couverture terrain est derrière nous. */
const TERRAIN_FAIT = [
  "production_terminée", "médias_à_transférer", "médias_complets", "à_monter", "montage_en_cours",
  "prêt_validation", "à_valider_client", "prête_à_livrer", "livrée", "facturée",
  "partiellement_payée", "payée", "clôturée",
];
export const prestationRealisee = (statut: string) => TERRAIN_FAIT.includes(statut);

/**
 * Les libellés d'état de l'OS (`SL`), SURCHARGÉS PAR CEUX DE L'OPÉRATEUR (`OPERATEUR_LB`, 13/09).
 *
 * « Prêt validation » est du vocabulaire d'atelier : de son point de vue, son travail est terminé
 * et quelqu'un vérifie. C'est la raison d'être de cette seconde table dans l'OS, et on la reprend
 * telle quelle plutôt que de réafficher le mot technique.
 */
const ETAT: Record<string, string> = {
  confirmée: "Confirmée", planifiée: "Planifiée", "équipe_affectée": "Équipe affectée",
  prête: "Prête", "équipe_en_route": "Équipe en route", "arrivée_sur_place": "Arrivée sur place",
  "production_démarrée": "Production démarrée", "production_terminée": "Production terminée",
  "médias_à_transférer": "Médias à transférer", "médias_complets": "Médias complets",
  "à_monter": "À monter", "montage_en_cours": "Montage en cours",
  "prêt_validation": "En cours de vérification", "à_valider_client": "En cours de vérification",
  "prête_à_livrer": "Vérifiée, livraison en cours", livrée: "Livrée au client",
  facturée: "Facturée", "partiellement_payée": "Partiellement payée", payée: "Payée",
  "clôturée": "Prestation validée", annulée: "Annulée", refusée: "Refusée",
};
/** Une valeur inconnue ressort telle quelle : un libellé qu'on n'a pas prévu doit se voir. */
export const libelleEtat = (statut: string) => ETAT[statut] ?? statut;

// ── LA CHECK-LIST D'AVANT-MATCH ────────────────────────────────────────────────────────────────
//
// LES MÊMES CASES, LES MÊMES CLÉS, LE MÊME FORMAT QUE L'OS (`checklistAvant`, §50 : « une case
// doit représenter une action vérifiable »). Mesuré dans `mission_suivi_operateur.etapes` : les
// clés réellement présentes en base sont exactement boitier / batteries / cartes / test / tenue /
// materiel_video, chacune valant `{"fait": true, "at": "<ISO>"}`. On écrit dans le même champ, avec
// les mêmes clés : ce que l'application coche se lit dans l'OS, et l'inverse.
//
// LE MODE JOUR J DE L'OS WEB, LUI, NE LES ÉCRIT PAS EN BASE. Ses six cases vivent dans le
// `localStorage` du navigateur (`sv_jj_ck_<prestation>_<i>`) : elles ne quittent jamais le
// téléphone, la Production ne les voit pas, et elles disparaissent avec le cache. Trois d'entre
// elles sont même DÉDUITES du statut et non cochables. Ici, tout va dans `etapes`.
export interface CaseChecklist { cle: string; libelle: string }

export function checklistAvant(couverture?: string | null): CaseChecklist[] {
  const c: CaseChecklist[] = [
    { cle: "boitier", libelle: "Boîtier et objectifs présents" },
    { cle: "batteries", libelle: "Batteries présentes et chargées" },
    { cle: "cartes", libelle: "Cartes SD présentes et vérifiées" },
    { cle: "test", libelle: "Carte reconnue, quelques prises de test faites" },
    { cle: "tenue", libelle: "Tenue SportVision" },
  ];
  // Mesuré : 9 prestations sur 10 sont en `photo_video`, la dixième à NULL. Le matériel vidéo est
  // donc demandé presque toujours — mais sur une mission photo seule, la case n'a aucun sens.
  if (couverture === "video" || couverture === "photo_video") {
    c.splice(3, 0, { cle: "materiel_video", libelle: "Matériel vidéo (micro, stabilisateur) selon mission" });
  }
  return c;
}

// ── LA FICHE, TELLE QUE L'ÉCRAN EN A BESOIN ────────────────────────────────────────────────────

export interface SuiviOperateur {
  id: string;
  kitPrepare: string | null;
  parti: string | null;
  arrive: string | null;
  prestationTerminee: string | null;
  /** Les cases cochées : la clé de la case, l'heure du clic. */
  etapes: Record<string, { fait?: boolean; at?: string }>;
  notes: string | null;
}

export interface FicheTerrain {
  prestationId: string;
  /** L'identifiant de l'AFFECTATION : c'est lui que porte le rapport. */
  affectationId: string;
  reference: string;
  statut: string;
  client: string | null;
  format: string | null;
  date: string | null;
  /** L'heure attendue sur place. */
  heure: string | null;
  /** Vrai quand cette heure est un DÉBUT et non un rendez-vous : le mot change à l'écran. */
  heureEstUnDebut: boolean;
  lieu: string | null;
  adresse: string | null;
  contact: string | null;
  telephone: string | null;
  besoin: string | null;
  livrables: string | null;
  couverture: string | null;
  fonction: string | null;
  responsable: boolean;
  remuneration: number | null;
  /** Ma réponse à l'invitation. Une mission pas encore acceptée n'a pas de Jour J. */
  reponse: string;
  heuresDeclarees: number | null;
  kmDeclares: number | null;
  fraisDeclares: number | null;
  notesDeclaration: string | null;
  suivi: SuiviOperateur | null;
  /** Les incidents que J'AI déclarés et qui ne sont pas clos. */
  incidentsOuverts: number;
}

/**
 * Ma fiche de mission.
 *
 * LE `collaborateur_id` N'EST PAS UN FILTRE DE SÉCURITÉ, c'est la DÉFINITION de « ma »
 * affectation — même raison que `lireMonPlanning` : la RLS borne un `photo` à lui-même, mais elle
 * borne un `prod` à son PÔLE. Sans lui, un responsable de production ouvrant cet écran verrait
 * l'affectation de quelqu'un d'autre et déclarerait ses heures.
 */
export async function lireFicheTerrain(prestationId: string, moiId: string): Promise<FicheTerrain | null> {
  const [rAff, rSuivi, rInc] = await Promise.all([
    supabase
      .from("prestations_equipe")
      .select(`id, statut, fonction, est_responsable, heure_rdv, remuneration,
               heures_declarees, km_declares, frais_declares, notes_declaration,
               prestations ( id, reference, statut, type_prestation, date_prestation, heure_debut,
                             heure_rdv, lieu, adresse_complete, contact_sur_place,
                             telephone_sur_place, description_besoin, livrables_demandes,
                             couverture, clients ( nom ) )`)
      .eq("prestation_id", prestationId)
      .eq("collaborateur_id", moiId)
      .maybeSingle(),
    supabase
      .from("mission_suivi_operateur")
      .select("id, kit_prepare_at, parti_at, arrive_at, prestation_terminee_at, etapes, notes")
      .eq("prestation_id", prestationId)
      .eq("collaborateur_id", moiId)
      .maybeSingle(),
    // `declare_par = auth.uid()` est la moitié de la policy `incidents_acces` qui s'applique à un
    // opérateur : il ne lit QUE ses propres déclarations. Le compter ici sert à ne pas lui faire
    // signaler deux fois le même problème. Mesuré : 0 incident lisible par Antoine aujourd'hui.
    supabase
      .from("incidents")
      .select("id", { count: "exact", head: true })
      .eq("prestation_id", prestationId)
      .eq("declare_par", moiId)
      .eq("cloture", false),
  ]);

  if (rAff.error) throw rAff.error;
  const a = rAff.data as unknown as LigneAffectation | null;
  if (!a || !a.prestations) return null;
  const p = a.prestations;

  // Une heure de rendez-vous propre à l'affectation d'abord (5 sur 10), puis celle de la mission
  // (2 sur 10), et seulement en dernier l'heure de DÉBUT (10 sur 10). Le mot change alors :
  // annoncer « Rendez-vous 09h30 » quand la base ne dit que « début 09h30 » fait arriver en retard.
  const rdv = a.heure_rdv ?? p.heure_rdv ?? null;
  const heure = rdv ?? p.heure_debut ?? null;

  const suivi = rSuivi.error ? null : (rSuivi.data as unknown as LigneSuivi | null);

  return {
    prestationId: String(p.id),
    affectationId: String(a.id),
    reference: p.reference ?? "",
    statut: String(p.statut ?? ""),
    client: p.clients?.nom ?? null,
    format: p.type_prestation ?? null,
    date: p.date_prestation ?? null,
    heure,
    heureEstUnDebut: !rdv && !!p.heure_debut,
    lieu: p.lieu ?? null,
    adresse: p.adresse_complete ?? null,
    contact: p.contact_sur_place ?? null,
    telephone: p.telephone_sur_place ?? null,
    besoin: p.description_besoin ?? null,
    livrables: p.livrables_demandes ?? null,
    couverture: p.couverture ?? null,
    fonction: a.fonction ?? null,
    responsable: a.est_responsable === true,
    remuneration: typeof a.remuneration === "number" ? a.remuneration : null,
    reponse: String(a.statut ?? ""),
    heuresDeclarees: typeof a.heures_declarees === "number" ? a.heures_declarees : null,
    kmDeclares: typeof a.km_declares === "number" ? a.km_declares : null,
    fraisDeclares: typeof a.frais_declares === "number" ? a.frais_declares : null,
    notesDeclaration: a.notes_declaration ?? null,
    suivi: suivi
      ? {
        id: String(suivi.id),
        kitPrepare: suivi.kit_prepare_at ?? null,
        parti: suivi.parti_at ?? null,
        arrive: suivi.arrive_at ?? null,
        prestationTerminee: suivi.prestation_terminee_at ?? null,
        etapes: (suivi.etapes ?? {}) as SuiviOperateur["etapes"],
        notes: suivi.notes ?? null,
      }
      : null,
    incidentsOuverts: rInc.count ?? 0,
  };
}

type LigneAffectation = {
  id: string; statut: string | null; fonction: string | null; est_responsable: boolean | null;
  heure_rdv: string | null; remuneration: number | null; heures_declarees: number | null;
  km_declares: number | null; frais_declares: number | null; notes_declaration: string | null;
  prestations: {
    id: string; reference: string | null; statut: string | null; type_prestation: string | null;
    date_prestation: string | null; heure_debut: string | null; heure_rdv: string | null;
    lieu: string | null; adresse_complete: string | null; contact_sur_place: string | null;
    telephone_sur_place: string | null; description_besoin: string | null;
    livrables_demandes: string | null; couverture: string | null;
    clients: { nom: string | null } | null;
  } | null;
};
type LigneSuivi = {
  id: string; kit_prepare_at: string | null; parti_at: string | null; arrive_at: string | null;
  prestation_terminee_at: string | null; etapes: unknown; notes: string | null;
};

// ── LE DROIT, DEMANDÉ À LA BASE (RÈGLE 5) ──────────────────────────────────────────────────────

/**
 * « Suis-je affecté à cette mission ? », posée à la base et non déduite de l'écran.
 *
 * C'est `operateur_affecte_prestation`, LA fonction que la policy `mso_operateur` utilise
 * elle-même — `(collaborateur_id = auth.uid()) AND operateur_affecte_prestation(prestation_id)`.
 * On appelle la sienne plutôt que de recopier sa condition. Elle est exécutable par
 * `authenticated` (vérifié : `authenticated=X/postgres`).
 *
 * Un `null` ou une erreur compte comme un refus : mieux vaut cacher un bouton qui aurait marché
 * que promettre un geste qui échoue.
 */
export async function puisJeAgirSurLaMission(prestationId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("operateur_affecte_prestation", {
    p_prestation_id: prestationId,
  });
  if (error) return false;
  return data === true;
}

// ── LES ÉCRITURES ──────────────────────────────────────────────────────────────────────────────
//
// TOUTES FINISSENT PAR `.select("id")`, ET LÈVENT SI LE TABLEAU EST VIDE (règle 4). PostgREST rend
// zéro ligne ET zéro erreur quand la RLS refuse : sans ça, l'écran annonce « enregistré » alors
// que la base n'a rien changé. C'est le « ça n'enregistre pas » de Villemomble, le 10/09.

/** Poser ou mettre à jour mon avancement personnel. La contrainte
 *  `mission_suivi_operateur_unique (prestation_id, collaborateur_id)` rend l'`upsert` sûr : la
 *  ligne n'existe que pour 9 des 10 affectations, et il faut donc savoir la créer. */
async function ecrireSuivi(
  prestationId: string, moiId: string, champs: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await supabase
    .from("mission_suivi_operateur")
    .upsert(
      { prestation_id: prestationId, collaborateur_id: moiId, updated_at: new Date().toISOString(), ...champs },
      { onConflict: "prestation_id,collaborateur_id" },
    )
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || !data.length) {
    throw new Error("Enregistrement refusé : cette mission n'est pas dans vos affectations.");
  }
}

/**
 * Avancer d'une étape : le statut de la mission ET l'heure personnelle, dans cet ordre.
 *
 * LES DEUX VONT ENSEMBLE, et l'OS le dit mieux que moi : « un statut avancé sans trace de qui l'a
 * fait ni quand ne sert à rien le jour où il faut comprendre un couac ».
 *
 * SI L'HEURE ÉCHOUE APRÈS QUE LE STATUT A BOUGÉ, ON NE DIT NI « ENREGISTRÉ » NI « ÉCHEC ». Les
 * deux seraient faux : l'étape EST passée, et la Production la voit. On dit exactement ce qui s'est
 * produit, parce que c'est la seule phrase qui n'amène pas l'opérateur à réappuyer.
 */
export async function avancer(prestationId: string, moiId: string, etape: EtapeTerrain): Promise<void> {
  const { data, error } = await supabase
    .from("prestations")
    .update({ statut: etape.vers })
    .eq("id", prestationId)
    .select("id");
  // La phrase du déclencheur est meilleure que n'importe quel texte générique : elle dit à qui
  // s'adresser (« réservé au secrétariat/à la production »). On la laisse passer telle quelle.
  if (error) throw new Error(error.message);
  if (!data || !data.length) {
    throw new Error(
      "L'étape n'a pas été enregistrée : la mission a peut-être changé d'état de son côté. "
      + "Tirez l'écran vers le bas pour le relire.",
    );
  }

  if (!etape.suivi) return;
  try {
    await ecrireSuivi(prestationId, moiId, { [etape.suivi]: new Date().toISOString() });
  } catch {
    throw new Error(
      `« ${etape.libelle} » est bien enregistré, mais l'heure n'a pas pu être notée. `
      + "Prévenez la production si elle vous la demande.",
    );
  }
}

/** Cocher ou décocher une case de la check-list. On relit `etapes` avant d'écrire : deux cases
 *  cochées coup sur coup depuis un état périmé effaceraient la première. */
export async function cocherCase(
  prestationId: string, moiId: string, cle: string, coche: boolean,
  etapesConnues: SuiviOperateur["etapes"],
): Promise<void> {
  const etapes = { ...etapesConnues };
  if (coche) etapes[cle] = { fait: true, at: new Date().toISOString() };
  else delete etapes[cle];
  await ecrireSuivi(prestationId, moiId, { etapes });
}

export interface Rapport {
  /** Obligatoire, comme dans l'OS : c'est la seule valeur que la Production attend vraiment. */
  heures: number;
  km: number | null;
  frais: number | null;
  notes: string | null;
}

/**
 * Le rapport de mission : ce qu'on renseigne après la prestation.
 *
 * Quatre colonnes de `prestations_equipe`, celles-là mêmes que l'OS écrit dans
 * `sauvegarderHeures` — `heures_declarees`, `km_declares`, `frais_declares`, `notes_declaration`.
 * Aucune n'est protégée par `protect_sensitive_affectation_fields` : vérifié par le chemin réel,
 * l'opérateur les écrit sur SA ligne. Ce qu'il ne peut pas toucher, c'est `remuneration` — « La
 * rémunération d'une mission se fixe par la Production », et c'est la base qui le dit.
 *
 * DIFFÉRENCE ASSUMÉE AVEC L'OS : il n'écrit `km_declares` et `frais_declares` que si la valeur est
 * > 0, donc on ne peut jamais CORRIGER un km saisi par erreur à la baisse jusqu'à zéro. Ici, un
 * champ vidé écrit `null` : effacer doit être possible.
 */
export async function enregistrerRapport(affectationId: string, r: Rapport): Promise<void> {
  const { data, error } = await supabase
    .from("prestations_equipe")
    .update({
      heures_declarees: r.heures,
      km_declares: r.km,
      frais_declares: r.frais,
      notes_declaration: r.notes,
    })
    .eq("id", affectationId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || !data.length) {
    throw new Error("Rapport refusé : cette affectation n'est pas la vôtre.");
  }
}

/** Les notes libres de l'opérateur sur sa mission, dans `mission_suivi_operateur.notes`.
 *  Mesuré : 0 des 9 lignes en porte. Le champ existe depuis le 09/09 et personne ne l'a jamais
 *  rempli — parce qu'aucun écran ne le propose. */
export async function enregistrerNotes(prestationId: string, moiId: string, notes: string | null): Promise<void> {
  await ecrireSuivi(prestationId, moiId, { notes });
}

export type NiveauIncident = "mineur" | "important" | "critique";

/**
 * Signaler un incident depuis le terrain.
 *
 * `type_incident` est NOT NULL en base et ce formulaire ne le demande pas : on pose « Terrain »,
 * exactement comme le Mode Jour J de l'OS. Sans cette valeur par défaut, le POST échouait avec
 * « null value in column type_incident » affiché tel quel au photographe — le défaut que la QA
 * nocturne de l'OS a trouvé le 10/09.
 *
 * `materiel_incidents` N'EST PAS ÉCRIT ICI, ET C'EST MESURÉ : sa policy
 * `materiel_incidents_access` n'ouvre la table qu'aux rôles `admin` et `prod`. L'OS web tente
 * l'écriture en « best-effort » et affiche « le lien matériel n'a pas pu être créé » — un
 * opérateur verrait donc cet avertissement à CHAQUE incident matériel. On ne propose pas de
 * désigner un kit : ce serait une promesse que la base refuse.
 */
export async function declarerIncident(
  prestationId: string, moiId: string, description: string, niveau: NiveauIncident,
): Promise<void> {
  const { data, error } = await supabase
    .from("incidents")
    .insert({
      prestation_id: prestationId,
      type_incident: "Terrain",
      description,
      niveau,
      declare_par: moiId,
      cloture: false,
    })
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || !data.length) {
    throw new Error("Signalement refusé : la base n'a pas accepté la déclaration.");
  }
}

/**
 * Marquer le briefing comme lu, sans rien dire.
 *
 * `briefing_vu_at` alimente `v_mission_prete.brief_rempli`, donc la pastille « Prête » du cockpit
 * de la Production. Vérifié par le chemin réel : l'opérateur peut l'écrire. Mesuré : 5 prestations
 * sur 10 le portent.
 *
 * C'EST UNE TRACE, PAS UNE ACTION : personne n'a demandé à l'enregistrer, donc un échec ne se
 * signale pas. Le seul tort serait d'afficher une erreur pour un geste que l'opérateur n'a pas
 * fait. La date de première ouverture ne se réécrit pas non plus — `is null` s'en charge, et c'est
 * la base qui tranche, pas une lecture préalable côté écran.
 */
export async function marquerBriefingLu(prestationId: string): Promise<void> {
  try {
    await supabase
      .from("prestations")
      .update({ briefing_vu_at: new Date().toISOString() })
      .eq("id", prestationId)
      .is("briefing_vu_at", null);
  } catch {
    // Volontairement muet : voir ci-dessus.
  }
}

/** La clé de cache de la fiche. Une seule question, un seul endroit où la poser. */
export const cleTerrain = (prestationId: string, moiId: string) => `os:terrain:${prestationId}:${moiId}`;
