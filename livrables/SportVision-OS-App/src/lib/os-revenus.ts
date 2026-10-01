// CE QU'UN OPÉRATEUR A GAGNÉ, ET CE QU'ON LUI DOIT (30/09/2026).
//
// == LE VOCABULAIRE EST UNE DÉCISION, PAS UN DÉTAIL ============================================
//
// Les dix-huit collaborateurs sont des FREELANCES. Ni « salaire », ni « fiche de paie », ni
// « pénalité » n'apparaissent ici ni à l'écran. Envoyer un bulletin de paie à un indépendant, c'est
// fabriquer soi-même la preuve écrite d'un lien de subordination, la première pièce qu'un contrôle
// URSSAF demande (décision de Fouka du 29/09, en tête de la migration v358). On dit « montant
// versé », « récapitulatif de prestations », « ajustement ».
//
// La table s'appelle `mission_penalites`, et on ne la renomme pas : c'est le nom en base. Mais l'OS
// l'appelle déjà « retenue » partout dans son interface, et cette application dit « ajustement ».
// Le nom technique reste en base, jamais devant les yeux de la personne.
//
// == ON LIT LA VUE, PAS LA TABLE, ET C'EST ELLE QUI CALCULE ====================================
//
// `prestations_equipe_display` n'est pas un confort, elle porte deux choses que la table brute ne
// porte pas :
//
//   · `net_a_payer` = `mission_net_a_payer(id)` = rémunération + primes − retenues, plancher à 0.
//     Et `penalites_total` = la somme des retenues appliquées. Refaire cette addition côté
//     téléphone, c'est se préparer à afficher un montant différent de celui du récapitulatif qui
//     part chez la personne. Un chiffre qui diverge sur de l'argent, c'est un appel téléphonique.
//   · un MASQUAGE. `montant_recommande` et `motif_ajustement` ne sortent que pour qui a
//     `peut_voir_couts_mission`. Vérifié avec le jeton d'Antoine : il reçoit `null` sur les deux,
//     alors que la table brute lui rendrait 55 € en face d'une mission payée 35 €. La vue tient
//     donc une frontière que la table ne tient pas : on ne la contourne pas en lisant la table.
//
// Mesuré avec le jeton d'Antoine Blin (`profiles` role='photo') : 5 affectations, 240 € au total,
// `net_a_payer` égal à `remuneration` sur les 5 (aucune prime, aucune retenue nulle part dans la
// base), 95 € en attente et 145 € validés, 0 € versé. `date_paiement` est NULL sur 10 lignes
// sur 10 — l'écran ne promet donc jamais une date de virement qu'il n'a pas.
//
// == DEUX ÉTAPES, PLUS TROIS ===================================================================
//
// Fouka, le 25/09, mot pour mot : « je comprends pas pourquoi il y a un truc compta pour l'argent
// des photographes vidéastes, faut juste écrire prestation validée, et à la fin du mois le
// photographe reçoit son virement. Il n'y a pas de transmission compta. » Le chemin est donc
// En attente → Validé → Versé. `transmis_compta` n'est plus sur le chemin mais reste LISIBLE :
// une ligne l'a encore en base, et un statut sans libellé serait une impasse.
import { supabase } from "./supabase";

/** Les quatre valeurs admises par la contrainte de `prestations_equipe.statut_paiement`. */
export type StatutVersement = "en_attente" | "validé" | "transmis_compta" | "payé";

/** Ce qu'on montre pour chaque étape. `transmis_compta` garde le libellé de l'OS. */
export const LIBELLE_VERSEMENT: Record<StatutVersement, string> = {
  en_attente: "En attente",
  // « À verser » et non « Validé » : c'est ce que la ligne attend, pas ce qu'elle a obtenu. L'OS
  // écrit « À payer » au même endroit ; ici on garde le verbe du récapitulatif, « verser ».
  "validé": "À verser",
  transmis_compta: "Transmis compta",
  "payé": "Versé",
};

/** Un montant retiré d'une prestation. `mission_penalites` en base, « ajustement » à l'écran. */
export interface Ajustement {
  id: string;
  montant: number;
  motif: string;
  detail: string | null;
  statut: "appliquee" | "contestee" | "annulee";
  /**
   * Vrai seulement si `mission_penalite_contester` ACCEPTERA l'appel. Les trois conditions sont
   * recopiées de la fonction elle-même, pas devinées : la retenue est la sienne (la RLS de
   * `mission_penalites` ne lui en montre pas d'autres), elle n'est pas déjà annulée, et le
   * versement n'est pas parti (`transmis_compta` / `payé` — « le récapitulatif est parti, rouvrir
   * le montant après coup ne rendrait pas l'argent, ça rendrait le document faux »).
   *
   * Un bouton qui mène à un refus est une promesse cassée : sans ce calcul, on afficherait
   * « Contester » sur une retenue déjà prélevée, pour un message d'erreur.
   */
  contestable: boolean;
}

/** Un montant ajouté à une prestation. `mission_primes` en base. */
export interface Prime {
  id: string;
  montant: number;
  motif: string;
  detail: string | null;
}

export interface Prestation {
  /** L'identifiant de l'AFFECTATION : c'est lui qui porte l'argent. */
  affectationId: string;
  prestationId: string;
  reference: string;
  date: string | null;
  client: string | null;
  couverture: string | null;
  fonction: string | null;
  responsable: boolean;
  /** Le montant convenu pour la prestation. */
  montant: number;
  /** Ce qui reste dû sur cette ligne, calculé par la base : montant + primes − ajustements. */
  net: number;
  /** La somme des ajustements appliqués. Positive = retirée du net. */
  ajustementsTotal: number;
  statutVersement: StatutVersement;
  /** La date du virement, quand elle existe. Jamais remplie aujourd'hui : 0 ligne sur 10. */
  dateVersement: string | null;
  heures: number | null;
  km: number | null;
  frais: number | null;
  primes: Prime[];
  ajustements: Ajustement[];
  /**
   * LA RÉPONSE À « POURQUOI MA PRESTATION EST-ELLE ENCORE EN ATTENTE ? » (01/10/2026).
   *
   * La foire aux questions de l'OS le dit déjà, mot pour mot : « Soit vos heures et frais ne sont
   * pas encore déclarés, soit la validation Production ou Comptable est en cours. » Mais l'écran
   * ne montrait nulle part si cette validation avait eu lieu. Mesuré sur les 10 affectations :
   * `travail_valide` vaut vrai sur 2, NULL sur 8, et la vue ne le masque à personne. C'est la
   * seule information disponible qui explique l'attente au lieu de la subir.
   *
   * `null` n'est PAS `false` : personne n'a encore regardé. Un « refusé » affiché là où il n'y a
   * eu aucune décision serait une accusation inventée.
   */
  travailValide: boolean | null;
  travailDecideLe: string | null;
  /** Le motif, quand la production en a posé un. NULL sur les 10 lignes mesurées. */
  travailMotif: string | null;
}

/**
 * UN MOIS, ET CE QU'IL PÈSE. Le « récapitulatif mensuel » que Fouka demande, construit à partir
 * des prestations elles-mêmes, parce que `recapitulatifs_remuneration` est VIDE dans toute la base
 * (0 ligne, mesuré) : aucun document n'est encore parti. Attendre qu'il en existe un pour montrer
 * un mois reviendrait à ne rien montrer du tout.
 *
 * TOUS CES CHIFFRES SONT DES SOMMES DE `net`, ET RIEN D'AUTRE. Pas une soustraction, pas un
 * pourcentage, pas un prorata : `net_a_payer` vient de la base, l'écran l'additionne. Refaire un
 * calcul d'argent ici, c'est se préparer à afficher un total différent du récapitulatif qui part
 * chez la personne.
 */
export interface MoisDeRevenus {
  /** Le premier jour du mois, en ISO. Sert de clé et d'entrée pour la mise en forme. */
  cle: string;
  nbPrestations: number;
  total: number;
  /** Somme des nets encore dus : ni versés, ni partis en comptabilité. */
  restant: number;
  verse: number;
}

/**
 * Regrouper mes prestations par mois, du plus récent au plus ancien.
 *
 * Une prestation sans date ne peut être rangée dans aucun mois : elle reste dans la liste
 * détaillée et ne fausse aucun total mensuel. Mesuré : les 10 affectations en ont une.
 */
export function parMois(prestations: Prestation[]): MoisDeRevenus[] {
  const table = new Map<string, MoisDeRevenus>();
  for (const p of prestations) {
    if (!p.date) continue;
    const cle = `${p.date.slice(0, 7)}-01`;
    const m = table.get(cle) ?? { cle, nbPrestations: 0, total: 0, restant: 0, verse: 0 };
    m.nbPrestations += 1;
    m.total += p.net;
    if (p.statutVersement === "payé") m.verse += p.net;
    else m.restant += p.net;
    table.set(cle, m);
  }
  return [...table.values()].sort((a, b) => b.cle.localeCompare(a.cle));
}

/** Le document de fin de mois. « Récapitulatif de prestations », jamais « fiche de paie ». */
export interface Recapitulatif {
  id: string;
  /** Le premier jour du mois concerné. */
  mois: string;
  nbPrestations: number;
  montantVerse: number;
  /** La date annoncée pour le virement, telle qu'elle figure sur le document envoyé. */
  virementAnnonceLe: string | null;
  /** La date du virement réellement fait, quand elle est renseignée. */
  vireLe: string | null;
  note: string | null;
}

export interface MesRevenus {
  prestations: Prestation[];
  recapitulatifs: Recapitulatif[];
}

/**
 * Un numérique de Postgres arrive tantôt en nombre, tantôt en chaîne selon la couche traversée.
 * `typeof x === "number"` seul laisserait passer `"35.00"` en `null`, et l'écran afficherait 0 €
 * devant quelqu'un à qui on doit 35 €.
 */
function nombre(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}
/** Comme `nombre`, mais garde la différence entre « rien de déclaré » et « zéro déclaré ». Sur les
 *  heures et les kilomètres, mesuré à 2 lignes remplies sur 10, la distinction est tout le sujet :
 *  « 0 km » est une déclaration, l'absence n'en est pas une. */
function nombreOuRien(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Les réponses qui ne donnent droit à rien : la mission n'a pas été faite par cette personne. */
const REPONSES_SANS_REVENU = new Set(["refusée", "remplacée", "annulée"]);
/** Une mission annulée ou refusée ne se compte pas, même si l'affectation était acceptée. */
const MISSIONS_SANS_REVENU = new Set(["annulée", "refusée"]);

/**
 * Mes revenus.
 *
 * ON NE FILTRE PAS SUR SON PROPRE IDENTIFIANT : la vue borne déjà chaque ligne à
 * `collaborateur_id = auth.uid()` pour qui n'a pas `peut_voir_couts_mission`. Ajouter un
 * `eq("collaborateur_id", moi)` ne protégerait de rien de plus et donnerait l'illusion que c'est
 * l'écran qui tient la frontière.
 *
 * LES DEUX SEULS FILTRES SONT MÉTIER, PAS SÉCURITAIRES, et c'est pour ça qu'ils sont ici : la base
 * n'a aucune raison de cacher une invitation refusée, mais la compter comme un revenu serait faux.
 * L'OS écarte exactement les mêmes lignes.
 */
export async function lireMesRevenus(): Promise<MesRevenus> {
  const { data, error } = await supabase
    .from("prestations_equipe_display")
    .select(`id, prestation_id, statut, fonction, est_responsable, remuneration, net_a_payer,
             penalites_total, statut_paiement, date_paiement,
             heures_declarees, km_declares, frais_declares,
             travail_valide, travail_decide_le, travail_motif,
             prestations ( reference, statut, date_prestation, couverture, clients ( nom ) )`)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  type Ligne = {
    id: string; prestation_id: string; statut: string | null; fonction: string | null;
    est_responsable: boolean | null; remuneration: unknown; net_a_payer: unknown;
    penalites_total: unknown; statut_paiement: string | null; date_paiement: string | null;
    heures_declarees: unknown; km_declares: unknown; frais_declares: unknown;
    travail_valide: boolean | null; travail_decide_le: string | null; travail_motif: string | null;
    prestations: {
      reference: string | null; statut: string | null; date_prestation: string | null;
      couverture: string | null; clients: { nom: string | null } | null;
    } | null;
  };

  const lignes = ((data ?? []) as unknown as Ligne[]).filter(
    (r) => r.prestations
      && !REPONSES_SANS_REVENU.has(String(r.statut ?? ""))
      && !MISSIONS_SANS_REVENU.has(String(r.prestations.statut ?? "")),
  );

  // LES PRIMES ET LES AJUSTEMENTS SE LISENT, ILS NE SE DEVINENT PAS. `net_a_payer` dit COMBIEN, et
  // c'est la base qui le calcule ; ces deux lectures disent POURQUOI. Un net inférieur au montant
  // convenu, sans un mot d'explication, c'est le genre d'écran qui fait téléphoner — et sur de
  // l'argent retiré à quelqu'un, c'est le pire moment pour le faire téléphoner.
  //
  // Aucune ligne n'existe dans ces deux tables aujourd'hui (0 prime, 0 retenue dans toute la
  // base). Les deux requêtes ne partent donc que s'il y a des affectations, et ne coûtent rien.
  const ids = lignes.map((r) => String(r.id));
  const primesPar = new Map<string, Prime[]>();
  const ajustementsPar = new Map<string, Ajustement[]>();
  const versementPar = new Map<string, StatutVersement>();
  for (const r of lignes) {
    versementPar.set(String(r.id), (r.statut_paiement ?? "en_attente") as StatutVersement);
  }

  if (ids.length) {
    // La RLS de ces deux tables ne rend que les lignes des affectations de la personne
    // (`mission_primes_lecture` / `mission_penalites_lecture`). Un échec de lecture ne doit pas
    // vider l'écran des montants : on préfère un détail manquant à un écran de panne.
    const [primes, retenues] = await Promise.all([
      supabase.from("mission_primes")
        .select("id, affectation_id, montant, motif, detail")
        .in("affectation_id", ids).eq("statut", "active"),
      supabase.from("mission_penalites")
        .select("id, affectation_id, montant, motif, detail, statut")
        .in("affectation_id", ids).neq("statut", "annulee"),
    ]);

    for (const p of (primes.data ?? []) as { id: string; affectation_id: string; montant: unknown; motif: string | null; detail: string | null }[]) {
      const cle = String(p.affectation_id);
      const liste = primesPar.get(cle) ?? [];
      liste.push({ id: String(p.id), montant: nombre(p.montant), motif: p.motif ?? "Prime", detail: p.detail ?? null });
      primesPar.set(cle, liste);
    }
    for (const a of (retenues.data ?? []) as { id: string; affectation_id: string; montant: unknown; motif: string | null; detail: string | null; statut: string | null }[]) {
      const cle = String(a.affectation_id);
      const versement = versementPar.get(cle) ?? "en_attente";
      const statut = (a.statut ?? "appliquee") as Ajustement["statut"];
      const liste = ajustementsPar.get(cle) ?? [];
      liste.push({
        id: String(a.id),
        montant: nombre(a.montant),
        motif: a.motif ?? "Ajustement",
        detail: a.detail ?? null,
        statut,
        contestable: statut === "appliquee" && versement !== "transmis_compta" && versement !== "payé",
      });
      ajustementsPar.set(cle, liste);
    }
  }

  const prestations: Prestation[] = lignes.map((r) => {
    const cle = String(r.id);
    return {
      affectationId: cle,
      prestationId: String(r.prestation_id),
      reference: r.prestations!.reference ?? "",
      date: r.prestations!.date_prestation ?? null,
      client: r.prestations!.clients?.nom ?? null,
      couverture: r.prestations!.couverture ?? null,
      fonction: r.fonction ?? null,
      responsable: r.est_responsable === true,
      montant: nombre(r.remuneration),
      // `net_a_payer` peut être NULL si la vue a masqué la colonne. Ce n'est pas le cas pour sa
      // propre ligne (mesuré), mais un repli sur le montant convenu vaut mieux qu'un 0 € faux.
      net: r.net_a_payer === null || r.net_a_payer === undefined ? nombre(r.remuneration) : nombre(r.net_a_payer),
      ajustementsTotal: nombre(r.penalites_total),
      statutVersement: versementPar.get(cle) ?? "en_attente",
      dateVersement: r.date_paiement ?? null,
      heures: nombreOuRien(r.heures_declarees),
      km: nombreOuRien(r.km_declares),
      frais: nombreOuRien(r.frais_declares),
      primes: primesPar.get(cle) ?? [],
      ajustements: ajustementsPar.get(cle) ?? [],
      travailValide: r.travail_valide === null || r.travail_valide === undefined ? null : r.travail_valide,
      travailDecideLe: r.travail_decide_le ?? null,
      travailMotif: (r.travail_motif ?? "").trim() || null,
    };
  })
    // Du plus récent au plus ancien : « ma dernière mission est-elle payée ? » est la question
    // qu'on se pose en ouvrant cet écran.
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  // `recap_lecture_interesse` ne rend que SES récapitulatifs, et seulement ceux dont l'e-mail est
  // réellement parti (`statut = 'envoye'`). Un brouillon resté en plan ne doit pas lui annoncer un
  // virement dont il n'a pas été prévenu. On n'ajoute donc aucun filtre : la base l'a déjà mis.
  const recap = await supabase
    .from("recapitulatifs_remuneration")
    .select("id, mois, nb_prestations, montant_verse, virement_annonce_le, vire_le, note")
    .order("mois", { ascending: false })
    .limit(24);

  const recapitulatifs: Recapitulatif[] = ((recap.data ?? []) as {
    id: string; mois: string | null; nb_prestations: number | null; montant_verse: unknown;
    virement_annonce_le: string | null; vire_le: string | null; note: string | null;
  }[]).filter((d) => d.mois).map((d) => ({
    id: String(d.id),
    mois: String(d.mois),
    nbPrestations: typeof d.nb_prestations === "number" ? d.nb_prestations : 0,
    montantVerse: nombre(d.montant_verse),
    virementAnnonceLe: d.virement_annonce_le ?? null,
    vireLe: d.vire_le ?? null,
    note: (d.note ?? "").trim() || null,
  }));

  return { prestations, recapitulatifs };
}

/**
 * Contester un ajustement.
 *
 * PAS DE FAUX SUCCÈS. `mission_penalite_contester` rend `{ok:true, suspendue:true}`. Un objet
 * d'erreur PostgREST a la même forme générale — un objet, pas un tableau — d'où la vérification de
 * `ok` après celle de `error` : sans elle, n'importe quelle réponse inattendue s'afficherait comme
 * une contestation enregistrée, et la personne attendrait une décision que personne n'a reçue.
 *
 * La fonction refuse d'elle-même une retenue qui n'est pas la sienne, un texte vide, une retenue
 * déjà annulée et un versement déjà parti. On ne recopie pas ces règles ici : `contestable` sert à
 * ne pas PROPOSER le geste, la base seule le refuse.
 */
export async function contesterAjustement(ajustementId: string, texte: string): Promise<void> {
  const propre = texte.trim();
  if (!propre) throw new Error("Dites ce que vous contestez.");

  const { data, error } = await supabase.rpc("mission_penalite_contester", {
    p_penalite_id: ajustementId,
    p_texte: propre,
  });
  if (error) throw new Error(error.message);
  if (!data || (data as { ok?: boolean }).ok !== true) {
    throw new Error("La contestation n'a pas été enregistrée. Réessayez, puis prévenez la direction.");
  }
}
