// LE RESPONSABLE DE PRODUCTION, VU DE L'APPLICATION (30/09/2026).
//
// DEUX COMPTES, ET UN SEUL GESTE MANQUANT. Ils sont deux en production, Mikael et christian. Ce
// qu'ils ne pouvaient pas faire depuis un telephone, c'est le geste qui ouvre tous les autres :
// mettre quelqu'un sur une prestation vendue. Tout le reste de ce fichier n'est que de la lecture.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUI A ETE MESURE AVANT D'ECRIRE UNE LIGNE (jeton de Mikael, role prod, pole Football)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
//  · `v_production_missions` rend 10 lignes : a_planifier 1, a_venir 2, terrain 1,
//    post_production 1, a_verifier 1, corrections 1, terminees 3. Zero en attente_acceptation.
//  · 10 affectations en base, LES DIX au statut `acceptée`. Aucune en `invitation_envoyée`,
//    `en_attente`, `a_envoyer` ni `refusée` : l'ecran de relance est donc vide aujourd'hui, et il
//    doit le dire au lieu d'afficher une liste blanche.
//  · DEUX missions sans aucun operateur : SV-2026-5455 (groupe a_planifier) et SV-2026-5456
//    (groupe a_venir). La lecon est la : « sans operateur » N'EST PAS le groupe `a_planifier`.
//    Une mission deja planifiee peut n'avoir personne dessus. On lit donc la colonne `operateurs`
//    de la vue, et on n'invente aucun classement : le groupe reste celui que la vue a calcule.
//  · 12 candidats (10 photo + 2 cm), tous du pole Football, tous a 0 mission a venir. Deux
//    seulement ont un `niveau_operateur` : la grille de remuneration ne rend donc un montant que
//    pour 2 sur 12. Aucun n'a de `zone` : le filtre par zone de l'OS serait vide ici, il n'existe
//    pas sur le telephone. Un seul a declare du materiel personnel.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUE LA BASE TIENT DEJA, ET QU'ON NE REECRIT PAS (regle 3 du contrat)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
//  · LE CLASSEMENT DES MISSIONS : `v_production_missions.groupe`. La vue et elle seule.
//  · LE PERIMETRE : la vue se filtre sur `is_staff() AND pole_scope_ok(pole_id)`. Une mission
//    qu'on lit est donc deja dans son pole. L'ecran ne refiltre rien.
//  · LE DROIT D'AFFECTER : `rpc_ajouter_membre_equipe` verifie elle-meme le role (admin/prod/sec)
//    et `prestation_pole_scope_ok`. On lui demande la permission avant d'afficher le bouton, on ne
//    recopie pas sa condition.
//  · L'ENVOI DE LA PROPOSITION ET SON TEXTE : `envoyer_propositions_mission` fait passer les
//    lignes `a_envoyer` en `invitation_envoyée` et ecrit la notification, remuneration comprise.
//  · LA RELANCE AUTOMATIQUE : `send_prestation_reminders()`, cron toutes les heures a :05. Elle
//    relance une invitation sans reponse a J-3 ou moins, une seule fois par jour et par personne,
//    et escalade vers la production a J-2. Le bouton de relance de cet ecran ne double donc pas
//    cette regle : il porte la meme cle d'idempotence, et se fait refuser si la relance du jour
//    est deja partie.
import { supabase } from "./supabase";
import { dateDuJourParis } from "./dates";
import type { GroupeMission } from "./os-missions";

// ── Les missions du cockpit, avec tout ce dont les quatre ecrans ont besoin ────────────────────

export interface MissionProd {
  id: string;
  reference: string;
  statut: string;
  /** Calcule par la vue. Jamais recalcule ici. */
  groupe: GroupeMission;
  date: string | null;
  heureDebut: string | null;
  heureRdv: string | null;
  lieu: string | null;
  client: string | null;
  couverture: string | null;
  poleId: string | null;
  /** Les noms des operateurs ACCEPTES, assembles par la vue. Null : personne n'a accepte. */
  operateurs: string | null;
  /** Depuis quand une invitation de cette mission attend une reponse. */
  invitationDepuis: string | null;
  prete: boolean;
  enRetard: boolean;
  echeanceManquante: boolean;
  incidentOuvert: boolean;
  /** Ce qui empeche de clore, phrase par phrase, ecrit par `mission_cloture_manquant`. */
  clotureManquant: string[];
  nbPhotos: number;
  nbMontages: number;
  nbRushs: number;
  transfertConfirme: boolean;
  kitNom: string | null;
  kitRetourPrevu: string | null;
  arriveA: string | null;
  livreA: string | null;
}

const COLONNES_MISSION =
  "prestation_id, reference, statut, groupe, date_prestation, heure_debut, heure_rdv, lieu, " +
  "client_nom, couverture, pole_id, operateurs, invitation_depuis, mission_prete, " +
  "livraison_en_retard, echeance_manquante, incident_ouvert, cloture_manquant, nb_photos, " +
  "nb_montages, nb_rushs, transfert_confirme, kit_nom, kit_retour_prevu, arrive_at, livre_at";

function versMission(r: Record<string, unknown>): MissionProd {
  return {
    id: String(r.prestation_id),
    reference: (r.reference as string) ?? "",
    statut: String(r.statut ?? ""),
    groupe: ((r.groupe as string) ?? "autres") as GroupeMission,
    date: (r.date_prestation as string) ?? null,
    heureDebut: (r.heure_debut as string) ?? null,
    heureRdv: (r.heure_rdv as string) ?? null,
    lieu: (r.lieu as string) ?? null,
    client: (r.client_nom as string) ?? null,
    couverture: (r.couverture as string) ?? null,
    poleId: (r.pole_id as string) ?? null,
    operateurs: (r.operateurs as string) ?? null,
    invitationDepuis: (r.invitation_depuis as string) ?? null,
    prete: r.mission_prete === true,
    enRetard: r.livraison_en_retard === true,
    echeanceManquante: r.echeance_manquante === true,
    incidentOuvert: r.incident_ouvert === true,
    clotureManquant: Array.isArray(r.cloture_manquant) ? (r.cloture_manquant as string[]) : [],
    nbPhotos: Number(r.nb_photos ?? 0),
    nbMontages: Number(r.nb_montages ?? 0),
    nbRushs: Number(r.nb_rushs ?? 0),
    transfertConfirme: r.transfert_confirme === true,
    kitNom: (r.kit_nom as string) ?? null,
    kitRetourPrevu: (r.kit_retour_prevu as string) ?? null,
    arriveA: (r.arrive_at as string) ?? null,
    livreA: (r.livre_at as string) ?? null,
  };
}

/**
 * Les missions vivantes. On ecarte `annulees`, comme le cockpit de l'OS, et rien d'autre : c'est
 * la vue qui decide de tout le reste.
 */
export async function lireMissions(): Promise<MissionProd[]> {
  const { data, error } = await supabase
    .from("v_production_missions")
    .select(COLONNES_MISSION)
    .neq("groupe", "annulees")
    .order("date_prestation", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(versMission);
}

// ── Qui est sur quoi, ligne par ligne ─────────────────────────────────────────────────────────

export interface Affectation {
  /** L'identifiant de l'affectation, celui qu'on retire ou qu'on relance. */
  id: string;
  prestationId: string;
  collaborateurId: string;
  nom: string;
  roleCollaborateur: string | null;
  /** `invitation_envoyée` | `en_attente` | `a_envoyer` | `acceptée` | `refusée` | ... */
  statut: string;
  fonction: string | null;
  heureRdv: string | null;
  responsable: boolean;
  creeLe: string | null;
  missionReference: string;
  missionDate: string | null;
  missionStatut: string;
  missionClient: string | null;
}

/**
 * Toutes les affectations lisibles.
 *
 * ON NE FILTRE PAS PAR POLE NI PAR MISSION : `equipe_select` borne deja un responsable de
 * production aux prestations de son pole (`prestation_pole_scope_ok`). Mesure : Mikael lit 10
 * lignes sur 10, et aucune d'un autre pole n'existe pour qu'il la voie.
 *
 * L'embed vers `profiles` est nomme explicitement. `prestations_equipe` n'a qu'une seule cle
 * etrangere vers `profiles` aujourd'hui, mais deux autres colonnes (`exception_decidee_par`,
 * `travail_decide_par`) designent aussi des personnes : le jour ou l'une recoit sa contrainte,
 * un embed implicite deviendrait ambigu et PostgREST repondrait PGRST201. Le nommer coute un mot.
 */
export async function lireAffectations(): Promise<Affectation[]> {
  const { data, error } = await supabase
    .from("prestations_equipe")
    .select(
      `id, prestation_id, collaborateur_id, statut, fonction, heure_rdv, est_responsable, created_at,
       profiles!prestations_equipe_collaborateur_id_fkey ( prenom, nom, role ),
       prestations ( reference, statut, date_prestation, clients ( nom ) )`,
    )
    .order("created_at", { ascending: false });
  if (error) throw error;

  type Ligne = {
    id: string; prestation_id: string; collaborateur_id: string; statut: string | null;
    fonction: string | null; heure_rdv: string | null; est_responsable: boolean | null;
    created_at: string | null;
    profiles: { prenom: string | null; nom: string | null; role: string | null } | null;
    prestations: {
      reference: string | null; statut: string | null; date_prestation: string | null;
      clients: { nom: string | null } | null;
    } | null;
  };

  return ((data ?? []) as unknown as Ligne[]).map((r) => ({
    id: String(r.id),
    prestationId: String(r.prestation_id),
    collaborateurId: String(r.collaborateur_id),
    nom: [r.profiles?.prenom, r.profiles?.nom].filter(Boolean).join(" ").trim(),
    roleCollaborateur: r.profiles?.role ?? null,
    statut: String(r.statut ?? ""),
    fonction: r.fonction ?? null,
    heureRdv: r.heure_rdv ?? null,
    responsable: r.est_responsable === true,
    creeLe: r.created_at ?? null,
    missionReference: r.prestations?.reference ?? "",
    missionDate: r.prestations?.date_prestation ?? null,
    missionStatut: String(r.prestations?.statut ?? ""),
    missionClient: r.prestations?.clients?.nom ?? null,
  }));
}

/** Les statuts d'affectation qui occupent une place : la base en fait un index unique partiel. */
export const STATUTS_ACTIFS = ["invitation_envoyée", "en_attente", "acceptée"] as const;
/** Ce qui attend une reponse de la personne. */
export const STATUTS_SANS_REPONSE = ["invitation_envoyée", "en_attente"] as const;

// ── Les candidats ─────────────────────────────────────────────────────────────────────────────

export interface Candidat {
  id: string;
  nom: string;
  role: string;
  actif: boolean;
  /** 1 a 4. Null sur 10 des 12 personnes mesurees : la grille ne donnera alors aucun montant. */
  niveau: number | null;
  materielPersonnel: string | null;
  telephone: string | null;
  poleIds: string[];
  /** Vrai si la personne accepte les notifications d'invitation. Mesure : les 18 l'acceptent. */
  accepteInvitations: boolean;
}

/**
 * Les personnes qu'on peut mettre sur une mission.
 *
 * Le pole vient de `pole_affectations`, la cle etrangere est nommee comme dans l'OS
 * (`pole_affectations_user_id_fkey`) : la table designe deux personnes, celle affectee et celle
 * qui a affecte.
 *
 * `role in (photo, cm)` reprend le choix de l'OS pour ce picker : ce sont les metiers de terrain.
 * Ce n'est pas un filtre de securite, c'est la liste de travail.
 */
export async function lireCandidats(): Promise<Candidat[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      `id, prenom, nom, role, actif, niveau_operateur, materiel_personnel, telephone,
       notification_prefs,
       pole_affectations!pole_affectations_user_id_fkey ( pole_id, actif )`,
    )
    .in("role", ["photo", "cm"])
    .order("nom", { ascending: true });
  if (error) throw error;

  type Ligne = {
    id: string; prenom: string | null; nom: string | null; role: string | null;
    actif: boolean | null; niveau_operateur: number | null; materiel_personnel: string | null;
    telephone: string | null; notification_prefs: Record<string, unknown> | null;
    pole_affectations: { pole_id: string | null; actif: boolean | null }[] | null;
  };

  return ((data ?? []) as unknown as Ligne[]).map((r) => ({
    id: String(r.id),
    nom: [r.prenom, r.nom].filter(Boolean).join(" ").trim(),
    role: r.role ?? "",
    actif: r.actif !== false,
    niveau: typeof r.niveau_operateur === "number" ? r.niveau_operateur : null,
    materielPersonnel: r.materiel_personnel?.trim() ? r.materiel_personnel.trim() : null,
    telephone: r.telephone ?? null,
    poleIds: (r.pole_affectations ?? [])
      .filter((p) => p.actif !== false && p.pole_id)
      .map((p) => String(p.pole_id)),
    // Meme lecture que la fonction `notifier` de la base : une categorie absente vaut « oui ».
    accepteInvitations: String(r.notification_prefs?.["invitations"] ?? "true") !== "false",
  }));
}

/** La charge d'une personne : ses missions acceptees a venir. Le « Libre » du picker de l'OS. */
export function chargeAVenir(affectations: Affectation[]): Map<string, number> {
  const aujourdhui = dateDuJourParis();
  const m = new Map<string, number>();
  for (const a of affectations) {
    if (a.statut !== "acceptée") continue;
    if (!a.missionDate || a.missionDate < aujourdhui) continue;
    if (a.missionStatut === "annulée" || a.missionStatut === "refusée") continue;
    m.set(a.collaborateurId, (m.get(a.collaborateurId) ?? 0) + 1);
  }
  return m;
}

// ── Le droit, demande a la base avant d'afficher le bouton (regle 5) ───────────────────────────

/**
 * « Cette mission est-elle dans mon perimetre ? », posee a la base.
 *
 * C'est la moitie exacte de la condition de `rpc_ajouter_membre_equipe` qui depend de la mission ;
 * l'autre moitie est le role, que la session porte deja (`profiles.role`, lu en base a l'ouverture).
 * On appelle la fonction de la base, on ne recopie pas sa logique : `pole_scope_ok` fait intervenir
 * `is_admin_or_rh()` et `get_my_pole_ids()`, deux regles qui n'ont rien a faire dans un ecran.
 *
 * Un `null` (mission introuvable) est traite comme un refus : mieux vaut cacher un bouton qui
 * aurait marche que promettre un geste qui echoue.
 */
export async function missionDansMonPerimetre(prestationId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("prestation_pole_scope_ok", {
    p_prestation_id: prestationId,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

/**
 * Le montant que la grille de la base donne pour cette personne sur cette mission.
 *
 * C'est `remuneration_recommandee` : niveau de l'operateur x coefficient du format de mission,
 * les deux lus dans des tables. On ne refait pas ce calcul ici, et surtout on ne le SAISIT pas :
 * decision de Fouka du 20/08, « le responsable production affecte et ajoute des consignes, mais ne
 * doit pas fixer la remuneration ».
 *
 * Rend `null` pour 10 des 12 personnes mesurees, faute de `niveau_operateur`. L'ecran le dit.
 */
export async function remunerationGrille(
  collaborateurId: string, prestationId: string,
): Promise<number | null> {
  const { data, error } = await supabase.rpc("remuneration_recommandee", {
    p_collaborateur_id: collaborateurId,
    p_prestation_id: prestationId,
  });
  if (error) throw new Error(error.message);
  return typeof data === "number" ? data : null;
}

// ── L'affectation : la seule ecriture de ces quatre ecrans ─────────────────────────────────────

export interface ResultatAffectation {
  affectationId: string;
  /** Combien de propositions la base a reellement envoyees. Zero = personne n'a ete prevenu. */
  propositionsEnvoyees: number;
}

/**
 * Mettre quelqu'un sur une mission, et le prevenir.
 *
 * DEUX APPELS, ET DANS CET ORDRE, PARCE QUE C'EST LE CHEMIN DE LA BASE (v134-v136) :
 *
 *   1. `rpc_ajouter_membre_equipe(..., p_envoyer = false)` cree la ligne au statut `a_envoyer` :
 *      la personne est PREVUE, elle ne voit encore rien. `equipe_select` exclut expressement
 *      `a_envoyer` de ce qu'un collaborateur lit sur lui-meme.
 *   2. `envoyer_propositions_mission(prestation)` fait passer les `a_envoyer` de la mission en
 *      `invitation_envoyée` ET ecrit la notification, avec le texte et le montant de la base.
 *
 * POURQUOI PAS `p_envoyer = true` EN UN SEUL APPEL : la RPC ne notifie personne. L'OS complete
 * donc par une insertion de notification cote navigateur, avec son propre texte. Passer par
 * `envoyer_propositions_mission` laisse ce texte a la base, la ou il est deja ecrit une fois.
 *
 * POURQUOI ON VERIFIE D'ABORD QU'ELLE N'Y EST PAS DEJA : l'index unique
 * `prestations_equipe_active_uniq` ne couvre que les statuts invitation_envoyée / en_attente /
 * acceptée. `a_envoyer` n'y est pas : entre l'etape 1 et l'etape 2, deux appuis rapides sur un
 * telephone creeraient deux lignes, donc deux notifications et deux remunerations. Le bouton est
 * bloque pendant l'action, et cette lecture ferme le reste.
 *
 * PAS DE FAUX SUCCES (regle 4) : la RPC est SECURITY DEFINER et leve une exception sur un refus,
 * elle rend un `uuid` sinon. Un uuid absent est donc une anomalie, pas un succes silencieux.
 */
export async function affecter(m: {
  prestationId: string;
  collaborateurId: string;
  fonction?: string | null;
  consignes?: string | null;
  heureRdv?: string | null;
  /** Le montant de la grille, tel que la base l'a rendu. `null` : pas de niveau, pas de montant. */
  remuneration?: number | null;
}): Promise<ResultatAffectation> {
  const { data: deja, error: erreurLecture } = await supabase
    .from("prestations_equipe")
    .select("id, statut")
    .eq("prestation_id", m.prestationId)
    .eq("collaborateur_id", m.collaborateurId)
    .in("statut", [...STATUTS_ACTIFS, "a_envoyer"]);
  if (erreurLecture) throw new Error(erreurLecture.message);
  if (deja && deja.length) {
    throw new Error("Cette personne est déjà sur cette mission.");
  }

  const { data: id, error } = await supabase.rpc("rpc_ajouter_membre_equipe", {
    p_prestation_id: m.prestationId,
    p_collaborateur_id: m.collaborateurId,
    p_fonction: m.fonction?.trim() || null,
    p_notes: m.consignes?.trim() || null,
    p_heure_rdv: m.heureRdv?.trim() || null,
    p_remuneration: typeof m.remuneration === "number" ? m.remuneration : null,
    p_envoyer: false,
  });
  if (error) throw new Error(error.message);
  if (!id) throw new Error("Affectation refusée : la base n'a rien créé.");

  const propositionsEnvoyees = await envoyerPropositions(m.prestationId);
  return { affectationId: String(id), propositionsEnvoyees };
}

/**
 * Envoyer les propositions en attente d'une mission.
 *
 * Rend le NOMBRE de lignes reellement passees en `invitation_envoyée`. Zero veut dire que personne
 * n'a ete prevenu, et l'ecran doit l'afficher comme tel : c'est exactement le genre de zero qui
 * s'affichait « succes » avant la regle du 10/09.
 */
export async function envoyerPropositions(prestationId: string): Promise<number> {
  const { data, error } = await supabase.rpc("envoyer_propositions_mission", {
    p_prestation_id: prestationId,
  });
  if (error) throw new Error(error.message);
  return typeof data === "number" ? data : 0;
}

/** Retirer quelqu'un d'une mission. La RPC leve sur un refus et sur une ligne introuvable. */
export async function retirer(affectationId: string): Promise<void> {
  const { error } = await supabase.rpc("rpc_retirer_membre_equipe", { p_equipe_id: affectationId });
  if (error) throw new Error(error.message);
}

/**
 * RELANCER UNE PERSONNE QUI N'A PAS REPONDU.
 *
 * CE QUE LA BASE FAIT DEJA, ET QU'ON NE REFAIT PAS. `send_prestation_reminders()` tourne toutes
 * les heures et relance, une fois par jour et par personne, toute invitation sans reponse pour une
 * mission a J-3 ou moins, passee de 12 h. Elle previent aussi la production a J-2.
 *
 * CE QU'ELLE NE COUVRE PAS, ET QUI JUSTIFIE CE BOUTON : une mission a plus de trois jours, ou une
 * invitation envoyee il y a moins de douze heures, n'est jamais relancee. Et un responsable ne
 * peut aujourd'hui rien declencher a la main.
 *
 * LA MEME CLE D'IDEMPOTENCE QUE LA BASE. `notifications.cle_occurrence` porte un index unique
 * partiel, et la fonction de la base ecrit `mission_non_acceptee:<mission>:<personne>:<jour>`.
 * En reprenant ce format, une relance manuelle et la relance automatique du meme jour ne peuvent
 * pas se doubler : la seconde est refusee par la base avec un 23505, qu'on traduit en clair.
 *
 * PAS DE `.select()`, ET C'EST VOULU. La policy de lecture de `notifications` ne laisse voir que
 * ses propres notifications. Demander la representation de la ligne inseree ferait echouer
 * l'insertion ENTIERE avec un 42501 trompeur : c'est le piege repere le 30/08 dans l'OS, qui a
 * du poser `Prefer: return=minimal`. Sans `.select()`, supabase-js n'envoie pas
 * `return=representation`, et un refus de la regle d'ecriture revient bien en erreur : ce n'est
 * donc pas un faux succes possible, c'est le seul chemin qui dit la verite.
 *
 * CE QUE LA RELANCE ATTEINT, EXACTEMENT. Mesure du 30/09 : `notifications` n'a AUCUN trigger, et le
 * dispatcher d'e-mails (`dispatch-notifications`, cron chaque minute) travaille sur une autre table,
 * `notification_outbox`, alimentee par `enqueue_notification` — qui n'est pas ouverte a
 * `authenticated`. Une ligne de `notifications` est donc une notification DANS l'application, sans
 * e-mail ni notification systeme. C'est aussi vrai de la relance automatique de la base, qui passe
 * par la meme table : la portee est identique, ni meilleure ni pire. L'ecran ne promet donc pas
 * davantage que « dans ses notifications ».
 *
 * Le jour de la cle est compte A PARIS, comme partout dans cette application, sinon la cle
 * changerait de valeur entre minuit et 2 h et la relance passerait deux fois.
 */
export async function relancer(m: {
  prestationId: string;
  collaborateurId: string;
  client: string | null;
  date: string | null;
  heureDebut: string | null;
}): Promise<void> {
  const jour = dateDuJourParis();
  const quand = m.date ? `${m.date.slice(8, 10)}/${m.date.slice(5, 7)}` : null;
  const heure = m.heureDebut ? m.heureDebut.slice(0, 5) : null;

  // Le texte est celui de `send_prestation_reminders`, mot pour mot : une personne qui recoit la
  // relance automatique et la relance manuelle doit lire la meme phrase.
  const message =
    `${m.client ?? "Mission"}${quand ? ` — ${quand}` : ""}${heure ? ` à ${heure}` : ""}` +
    ". Merci de confirmer votre disponibilité.";

  const { error } = await supabase.from("notifications").insert({
    destinataire_id: m.collaborateurId,
    type: "mission_non_acceptee",
    titre: "Mission en attente de réponse",
    message,
    lue: false,
    priorite: "normale",
    prestation_id: m.prestationId,
    lien_prestation_id: m.prestationId,
    source_type: "prestations",
    source_id: m.prestationId,
    cle_occurrence: `mission_non_acceptee:${m.prestationId}:${m.collaborateurId}:${jour}`,
  });

  if (error) {
    // 23505 : la cle du jour existe deja. Ce n'est pas une panne, c'est la bonne reponse.
    if (error.code === "23505") {
      throw new Error("Déjà relancé aujourd'hui. La base ne renvoie qu'un rappel par jour.");
    }
    throw new Error(error.message);
  }
}

// ── Les livraisons ────────────────────────────────────────────────────────────────────────────

export interface Lien {
  id: string;
  prestationId: string;
  nom: string;
  url: string | null;
  categorie: string | null;
  typeMedia: string | null;
  /** `a_verifier` | `correction_demandee` | `valide` | ... Un null se lit `a_verifier`. */
  statut: string;
  commentaire: string | null;
  transfertConfirme: boolean;
  depuis: string | null;
  deposePar: string | null;
}

/**
 * Les liens qui attendent quelque chose de la production.
 *
 * `coalesce(statut, 'a_verifier')` est la lecture de la base elle-meme, dans
 * `mission_cloture_manquant` : un lien sans statut n'est pas un lien neutre, c'est un lien a
 * verifier. On reprend la meme convention plutot que d'en inventer une seconde.
 *
 * Mesure du 30/09 : 8 des 9 liens a traiter appartiennent a SV-2026-3121, que la vue range dans
 * le groupe `terrain`. UN ECRAN BATI SUR LE GROUPE `a_verifier` N'EN AURAIT MONTRE AUCUN. C'est
 * pour cela que cet ecran part des liens, et affiche le groupe de leur mission a cote.
 */
export async function lireLiensATraiter(): Promise<Lien[]> {
  const { data, error } = await supabase
    .from("media_liens")
    .select(
      `id, prestation_id, nom, url, categorie, type_media, statut, commentaire,
       transfert_confirme, created_at,
       profiles!media_liens_ajouteur_id_fkey ( prenom, nom )`,
    )
    .or("statut.is.null,statut.in.(a_verifier,correction_demandee)")
    .order("created_at", { ascending: true });
  if (error) throw error;

  type Ligne = {
    id: string; prestation_id: string; nom: string | null; url: string | null;
    categorie: string | null; type_media: string | null; statut: string | null;
    commentaire: string | null; transfert_confirme: boolean | null; created_at: string | null;
    profiles: { prenom: string | null; nom: string | null } | null;
  };

  return ((data ?? []) as unknown as Ligne[]).map((r) => ({
    id: String(r.id),
    prestationId: String(r.prestation_id),
    nom: r.nom?.trim() || "Lien sans nom",
    url: r.url ?? null,
    categorie: r.categorie ?? null,
    typeMedia: r.type_media ?? null,
    statut: r.statut ?? "a_verifier",
    commentaire: r.commentaire?.trim() || null,
    transfertConfirme: r.transfert_confirme === true,
    depuis: r.created_at ?? null,
    deposePar: [r.profiles?.prenom, r.profiles?.nom].filter(Boolean).join(" ").trim() || null,
  }));
}

// ── L'equipe terrain ──────────────────────────────────────────────────────────────────────────

export interface Incident {
  id: string;
  prestationId: string | null;
  type: string | null;
  niveau: string;
  description: string | null;
  quand: string | null;
  declarePar: string | null;
}

/**
 * Les incidents ouverts.
 *
 * Mesure : la table `incidents` est VIDE, zero ligne depuis toujours. L'ecran ne peut donc pas
 * presenter cela comme une liste qu'on consulte : il dit qu'aucun incident n'a jamais ete
 * declare, et ou on en declare un. « Aucune donnee » tout court fait telephoner (regle 7).
 */
export async function lireIncidentsOuverts(): Promise<Incident[]> {
  const { data, error } = await supabase
    .from("incidents")
    .select(
      `id, prestation_id, type_incident, niveau, description, date_incident,
       profiles!incidents_declare_par_fkey ( prenom, nom )`,
    )
    .eq("cloture", false)
    .order("date_incident", { ascending: false });
  if (error) throw error;

  type Ligne = {
    id: string; prestation_id: string | null; type_incident: string | null; niveau: string | null;
    description: string | null; date_incident: string | null;
    profiles: { prenom: string | null; nom: string | null } | null;
  };

  return ((data ?? []) as unknown as Ligne[]).map((r) => ({
    id: String(r.id),
    prestationId: r.prestation_id ?? null,
    type: r.type_incident ?? null,
    niveau: r.niveau ?? "mineur",
    description: r.description?.trim() || null,
    quand: r.date_incident ?? null,
    declarePar: [r.profiles?.prenom, r.profiles?.nom].filter(Boolean).join(" ").trim() || null,
  }));
}

export interface SuiviTerrain {
  prestationId: string;
  collaborateurId: string;
  nom: string;
  arriveA: string | null;
  prestationTermineeA: string | null;
  fichiersSecurisesA: string | null;
  livreA: string | null;
  kitRestitueA: string | null;
}

/**
 * Ce que chaque operateur a horodate sur ses missions.
 *
 * Mesure sur les 9 lignes existantes : `arrive_at` n'est renseigne que 3 fois, `kit_restitue_at`
 * ZERO fois. La restitution du kit n'est donc jamais declaree par l'operateur : l'ecran Materiel
 * ne peut pas s'appuyer dessus, et il le dit.
 */
export async function lireSuiviTerrain(): Promise<SuiviTerrain[]> {
  const { data, error } = await supabase
    .from("mission_suivi_operateur")
    .select(
      `prestation_id, collaborateur_id, arrive_at, prestation_terminee_at, fichiers_securises_at,
       livre_at, kit_restitue_at,
       profiles!mission_suivi_operateur_collaborateur_id_fkey ( prenom, nom )`,
    );
  if (error) throw error;

  type Ligne = {
    prestation_id: string; collaborateur_id: string; arrive_at: string | null;
    prestation_terminee_at: string | null; fichiers_securises_at: string | null;
    livre_at: string | null; kit_restitue_at: string | null;
    profiles: { prenom: string | null; nom: string | null } | null;
  };

  return ((data ?? []) as unknown as Ligne[]).map((r) => ({
    prestationId: String(r.prestation_id),
    collaborateurId: String(r.collaborateur_id),
    nom: [r.profiles?.prenom, r.profiles?.nom].filter(Boolean).join(" ").trim(),
    arriveA: r.arrive_at ?? null,
    prestationTermineeA: r.prestation_terminee_at ?? null,
    fichiersSecurisesA: r.fichiers_securises_at ?? null,
    livreA: r.livre_at ?? null,
    kitRestitueA: r.kit_restitue_at ?? null,
  }));
}

// ── L'ENCHAÎNEMENT DES STATUTS, LU EN BASE (01/10/2026) ────────────────────────────────────────

export interface Transition {
  depuis: string;
  vers: string;
  libelle: string;
  /** Vrai pour la suite NORMALE du parcours. Les autres sont des raccourcis ou des retours. */
  estLaSuite: boolean;
  ordre: number;
}

/**
 * CE QUE LA BASE AUTORISE APRÈS CHAQUE STATUT, DEMANDÉ À LA BASE.
 *
 * `prestation_transitions` (v412) remplace le grand `or` qui vivait dans
 * `validate_prestation_statut_transition()` : le trigger consulte maintenant cette table, et
 * l'écran lit la même. Un bouton ne peut donc plus proposer ce que la base refusera, et la liste ne
 * peut plus diverger — c'est exactement ce que la v377 avait fait pour la moitié opérateur de la
 * chaîne (`operateur_transitions`).
 *
 * L'OS web garde pour l'instant sa propre copie (`_NEXT_ST`). Elle est identique aujourd'hui, et la
 * migration le prouve sur les 1 089 couples de l'énumération ; elle devrait lire la table aussi.
 */
export async function lireTransitions(): Promise<Transition[]> {
  const { data, error } = await supabase
    .from("prestation_transitions")
    .select("statut_depuis, statut_vers, libelle, est_la_suite, ordre")
    .order("ordre", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    depuis: String(r.statut_depuis),
    vers: String(r.statut_vers),
    libelle: String(r.libelle ?? ""),
    estLaSuite: r.est_la_suite === true,
    ordre: Number(r.ordre ?? 0),
  }));
}

/** La suite normale d'un statut, telle que la base la range. Null : la chaîne s'arrête ici. */
export function suiteDe(statut: string, transitions: Transition[]): Transition | null {
  return transitions.find((t) => t.depuis === statut && t.estLaSuite) ?? null;
}
