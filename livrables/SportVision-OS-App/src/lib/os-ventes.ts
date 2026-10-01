// LES VENTES ET LES STATISTIQUES DES GALERIES (01/10/2026).
//
// Fouka, ce matin : « Je peux pas voir les statistiques, les galeries vendues sur l'app. »
//
// == QUI A LE DROIT DE VOIR L'ARGENT, ET ON LE DEMANDE À LA BASE ================================
//
// On ne recopie AUCUNE liste de rôles ici (règle 3). La base porte la règle, elle a un nom, et
// c'est Fouka qui l'a tranchée le 29/09 : `media_revenus_visibles()` — « la direction, la
// production, la comptabilité, et un responsable de pôle sur son périmètre. PAS le Secrétariat,
// qui fixe les prix sans voir les recettes ».
//
// Mesuré par le chemin réel, en transaction annulée, puis confirmé en HTTP :
//   · Antoine Blin (photo)  → `media_revenus_visibles()` = false, `media_stats_access()` = false
//   · Mikael (prod)         → true / true
//   · Fouka (admin)         → true / true
//
// Et ce que les tables rendent vraiment, avec le jeton de chacun :
//   · `media_orders`   : 15 lignes pour Mikael (policy `mord_prod_select` : rôle prod ET
//     `album_id is not null`), 17 pour Fouka (`mord_staff_all` → `media_commerce_staff()`),
//     0 pour Antoine — aucune policy ne le vise, la base refuse tout simplement ;
//   · `media_products` : 2 lignes pour TOUT LE MONDE, Antoine compris (`mprod_read` = `is_staff()`).
//     Les tarifs ne sont donc pas un secret ; les recettes, si.
//
// D'OÙ LA RÈGLE DE CET ÉCRAN : à qui la base refuse les ventes, on ne montre PAS un cadre vide à
// zéro euro — on ne montre rien du tout. Un « 0 € » est une affirmation fausse, pas une absence
// (le faux succès de la règle 4, retourné : un faux échec).
//
// == POURQUOI LES RPC DE L'OS, ET PAS `media_orders` DIRECTEMENT =================================
//
// Les chiffres du téléphone doivent être les MÊMES que ceux de l'ordinateur, au centime. L'écran
// « Statistiques » de l'OS appelle `media_stats_resume`, `media_stats_galeries` et
// `media_stats_ventes` : on appelle exactement les mêmes, avec les mêmes bornes. Réagréger
// `media_orders` à la main donnerait un deuxième chiffre pour la même question, et c'est
// précisément ce qui fait perdre confiance en un tableau de bord.
//
// Ces trois fonctions sont aussi les seules à savoir des choses que le téléphone ne peut pas
// deviner : le périmètre de pôle (`_media_stats_albums`), les galeries d'essai écartées
// (`analytics_excluded`), les bornes comparées en heure de Paris, et l'intitulé de la formule que
// l'acheteur a réellement vu au moment de payer.
//
// == UN ÉCART MESURÉ, ET QU'ON AFFICHE TEL QUEL =================================================
//
// `media_stats_resume` annonce 10 commandes et 144,90 € là où `media_stats_ventes` liste 12 ventes.
// Ce n'est pas un défaut : 2 des 17 commandes n'ont AUCUNE galerie (`album_id` NULL — deux Pass
// Photo achetés dans l'application, source `apple`). Le résumé passe par le périmètre des galeries
// et les écarte ; la liste, elle, les montre. L'OS affiche déjà les deux côte à côte de la même
// façon : on ne « corrige » pas un chiffre pour qu'il colle à l'autre, on montre ce que la base dit.
//
// == UNE FUITE TROUVÉE EN MESURANT, ET QUI N'EST PAS EXPLOITÉE ICI ==============================
//
// `media_stats_ventes` et `media_performance_galeries` sont gardées par `is_staff()`, qui est VRAI
// pour un opérateur terrain. Mesuré avec le jeton d'Antoine : 12 lignes de ventes (nom de
// l'acheteur, montant, galerie) et les 57 galeries avec leur chiffre d'affaires. Les autres
// fonctions de la même famille sont, elles, correctement bornées : leur périmètre passe par
// `_media_stats_albums`, qui n'ouvre qu'à admin/prod/sec/compta et au responsable de pôle — Antoine
// y reçoit 0 galerie, 0 € et 0 commande.
//
// CET ÉCRAN N'APPELLE DONC RIEN SANS AVOIR DEMANDÉ `media_revenus_visibles()` D'ABORD. La fuite
// reste à fermer en base ; elle est signalée à Fouka avec la migration qui la ferme. On ne
// s'appuie jamais sur un contrôle d'écran pour tenir un droit — mais on ne fabrique pas non plus
// l'appel qui exploiterait le trou.
import { supabase } from "./supabase";
import { dateDuJourParis } from "./dates";

/** Les périodes de l'écran « Statistiques » de l'OS, avec ses mots. */
export type Periode = "7j" | "30j" | "mois" | "mois-1";

export const PERIODES: { cle: Periode; libelle: string }[] = [
  { cle: "7j", libelle: "7 jours" },
  { cle: "30j", libelle: "30 jours" },
  { cle: "mois", libelle: "Mois en cours" },
  { cle: "mois-1", libelle: "Mois précédent" },
];

/**
 * Les bornes d'une période, comptées à PARIS.
 *
 * Même calcul que `_statsPlage()` dans l'OS, et la même raison de ne pas passer par UTC : les
 * bornes construites en UTC reculaient d'un jour tant qu'il était moins de 2 h à Paris, et toutes
 * les périodes étaient décalées d'une journée pour qui consulte ses chiffres la nuit.
 */
export function bornes(p: Periode): { debut: string; fin: string } {
  const aujourdhui = dateDuJourParis();
  const [a, m, j] = aujourdhui.split("-").map((x) => Number(x));
  // Midi, jamais minuit : à minuit, un décalage d'une heure change le jour.
  const fin = new Date(a, m - 1, j, 12, 0, 0);
  const debut = new Date(a, m - 1, j, 12, 0, 0);

  if (p === "7j") debut.setDate(fin.getDate() - 6);
  else if (p === "30j") debut.setDate(fin.getDate() - 29);
  else if (p === "mois") debut.setDate(1);
  else {
    debut.setMonth(debut.getMonth() - 1, 1);
    // Le dernier jour du mois précédent : le jour 0 du mois en cours.
    fin.setDate(0);
  }
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { debut: ymd(debut), fin: ymd(fin) };
}

/**
 * La base me montre-t-elle les recettes ?
 *
 * ON POSE LA QUESTION À LA BASE, ON NE DÉDUIT PAS DU RÔLE. Un responsable de pôle n'est ni `admin`
 * ni `prod` et a pourtant le droit : `media_revenus_visibles()` le sait, une liste de rôles
 * recopiée dans l'application ne le saurait pas. C'est aussi ce qui décide de l'existence de
 * l'onglet, donc de l'absence de tout bouton qui mènerait à un refus (règle 5).
 */
export async function puisVoirLesVentes(): Promise<boolean> {
  const { data, error } = await supabase.rpc("media_revenus_visibles");
  if (error) return false;
  return data === true;
}

export interface ResumeVentes {
  /** En centimes, comme la base. La conversion en euros se fait à l'affichage, une seule fois. */
  caCents: number;
  rembourseCents: number;
  commandes: number;
  commandesGratuites: number;
  /** Sur les commandes PAYANTES seulement : une campagne offerte ferait chuter la moyenne. */
  panierMoyenCents: number | null;
  galeriesVendeuses: number;
  visites: number;
  /** Commandes pour 100 visites. `null` sans visite : un taux calculé sur rien n'existe pas. */
  conversion: number | null;
}

/** Une galerie, et ce qu'elle a fait sur la période. */
export interface GalerieChiffree {
  albumId: string;
  titre: string;
  club: string | null;
  date: string | null;
  visites: number;
  commandes: number;
  caCents: number;
  conversion: number | null;
}

/** Une vente, telle que la base la raconte : qui a payé quoi, et quand. */
export interface Vente {
  id: string;
  payeLe: string | null;
  albumId: string | null;
  galerie: string;
  club: string | null;
  formule: string | null;
  montantCents: number;
  acheteur: string | null;
  rembourse: boolean;
}

export interface Ventes {
  resume: ResumeVentes | null;
  galeries: GalerieChiffree[];
  ventes: Vente[];
}

const nombre = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const nombreOuNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Les ventes de la période, en trois appels menés ensemble.
 *
 * `p_inclure_exclus` reste à faux : les galeries d'essai (`analytics_excluded`) sortent des
 * chiffres, comme dans l'OS par défaut. Les réintégrer est une case à cocher sur l'ordinateur, pas
 * une question qu'on pose sur un téléphone au bord d'un terrain.
 *
 * TROIS APPELS, PAS TRENTE. Un par bloc de l'écran, menés en parallèle : le résumé, les galeries
 * qui ont bougé, et la liste des ventes. Un appel par galerie aurait été cinquante-sept
 * allers-retours pour un écran.
 */
export async function lireVentes(p: Periode): Promise<Ventes> {
  const { debut, fin } = bornes(p);
  const args = { p_debut: debut, p_fin: fin, p_inclure_exclus: false };

  const [r, g, v] = await Promise.all([
    supabase.rpc("media_stats_resume", args),
    // 30 galeries au plus : au-delà, on ne lit plus un classement, on fait défiler. L'OS en montre
    // 15 sur un écran large ; sur un téléphone la liste est verticale, 30 reste tenable.
    supabase.rpc("media_stats_galeries", { ...args, p_limit: 30 }),
    supabase.rpc("media_stats_ventes", { ...args, p_limit: 60 }),
  ]);

  // UNE PANNE DE RÉSUMÉ N'EST PAS UN ÉCRAN VIDE, et une panne des trois n'est pas « aucune vente ».
  // On lève : l'écran affichera `Probleme` et proposera de réessayer, jamais « 0 € ».
  if (r.error) throw new Error(r.error.message);

  type LigneResume = {
    ca_cents: unknown; rembourse_cents: unknown; commandes: unknown;
    commandes_payantes: unknown; commandes_gratuites: unknown; galeries_vendeuses: unknown;
    visites: unknown; panier_moyen_cents: unknown; taux_conversion: unknown;
  };
  // La fonction rend UNE ligne. PostgREST la livre dans un tableau : la prendre pour un objet
  // afficherait « undefined € ».
  const brut = (Array.isArray(r.data) ? r.data[0] : r.data) as LigneResume | null | undefined;

  const resume: ResumeVentes | null = brut
    ? {
      caCents: nombre(brut.ca_cents),
      rembourseCents: nombre(brut.rembourse_cents),
      commandes: nombre(brut.commandes),
      commandesGratuites: nombre(brut.commandes_gratuites),
      panierMoyenCents: nombreOuNull(brut.panier_moyen_cents),
      galeriesVendeuses: nombre(brut.galeries_vendeuses),
      visites: nombre(brut.visites),
      conversion: nombreOuNull(brut.taux_conversion),
    }
    : null;

  type LigneGalerie = {
    album_id: string; titre: string | null; club_nom: string | null; event_date: string | null;
    visites: unknown; commandes: unknown; ca_cents: unknown; taux_conversion: unknown;
  };
  // Les deux listes tombent sans faire tomber l'écran : le résumé suffit à dire la vérité, et un
  // classement manquant vaut mieux qu'une page de panne.
  const galeries: GalerieChiffree[] = g.error
    ? []
    : ((g.data ?? []) as LigneGalerie[]).map((x) => ({
      albumId: String(x.album_id),
      titre: (x.titre ?? "").trim() || "Galerie",
      club: (x.club_nom ?? "").trim() || null,
      date: x.event_date ?? null,
      visites: nombre(x.visites),
      commandes: nombre(x.commandes),
      caCents: nombre(x.ca_cents),
      conversion: nombreOuNull(x.taux_conversion),
    }));

  type LigneVente = {
    commande_id: string; paye_le: string | null; album_id: string | null;
    galerie: string | null; club: string | null; formule: string | null;
    montant_cents: unknown; acheteur: string | null; rembourse: boolean | null;
  };
  const ventes: Vente[] = v.error
    ? []
    : ((v.data ?? []) as LigneVente[]).map((x) => ({
      id: String(x.commande_id),
      payeLe: x.paye_le ?? null,
      albumId: x.album_id ?? null,
      galerie: (x.galerie ?? "").trim() || "Galerie supprimée",
      club: (x.club ?? "").trim() || null,
      formule: (x.formule ?? "").trim() || null,
      montantCents: nombre(x.montant_cents),
      // LE TIRET LONG DE LA BASE NE S'AFFICHE PAS (règle 7 et règle 9). `media_stats_ventes` écrit
      // « — » quand elle ne peut nommer personne : sur l'ordinateur ça remplit une cellule de
      // tableau, sur un téléphone c'est une ligne de plus qui ne dit rien. Pas de nom, pas de ligne.
      acheteur: ((x.acheteur ?? "").trim().replace(/^—$/, "")) || null,
      rembourse: x.rembourse === true,
    }));

  return { resume, galeries, ventes };
}

/** « 39,90 € », « 145 € ». Les centimes ne s'affichent que s'il y en a, comme dans l'OS (`_eur`). */
export function euros(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "Sans objet";
  return (cents / 100).toLocaleString("fr-FR", {
    style: "currency", currency: "EUR", maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
}

/** « 12,50 % ». Un taux absent n'est PAS 0 % : on le dit avec un mot, pas avec un chiffre faux. */
export function pourcent(v: number | null | undefined): string {
  if (v === null || v === undefined) return "Sans visite";
  return `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} %`;
}

/** « 29 sept. 14h05 » : la date et l'heure d'une vente, comme dans la liste de l'OS. */
export function quandVente(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const jour = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", timeZone: "Europe/Paris" });
  const heure = d.toLocaleTimeString("fr-FR", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
  }).replace(":", "h");
  return `${jour} ${heure}`;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  LES VENTES D'UNE SEULE GALERIE (01/10/2026)
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Un lien de partage d'une galerie, et ce qu'il a rapporté. */
export interface LienVendeur {
  id: string;
  /** L'intitulé du lien, tel que la production l'a nommé. */
  libelle: string | null;
  /** « Club », « Adversaire », « Public »… Le mot de l'OS. */
  audience: string | null;
  /** La formule vendue par ce lien, et son prix. */
  formule: string | null;
  prixCents: number | null;
  actif: boolean;
  visites: number;
  visiteurs: number;
  /** `null` quand la base MASQUE l'argent à ce lecteur (le Secrétariat). Pas 0 : masqué. */
  commandes: number | null;
  caCents: number | null;
}

/** Les mots de l'OS pour l'audience d'un lien (`PA_AUDIENCE_LB`). */
const AUDIENCE: Record<string, string> = {
  club_partenaire: "Club",
  equipe_adverse: "Adversaire",
  public: "Public",
  evenementiel: "Événementiel",
  personnalise: "Personnalisé",
};

/**
 * Ce que cette galerie a vendu, lien par lien.
 *
 * `media_album_links_stats` EST LA FONCTION QUI FAIT LE GARDE-FOU CORRECTEMENT, et c'est pour ça
 * qu'on l'a choisie plutôt qu'un agrégat maison sur `media_orders` : elle se termine par
 * `where media_pricing_staff()` et n'écrit les deux colonnes d'argent que
 * `case when media_revenus_visibles() then … end`. Deux droits distincts, tenus par la base :
 *
 *   · Mikael (prod)   → 1 lien, 1 commande, 40,00 € sur la galerie la plus vendeuse ;
 *   · Antoine (photo) → ZÉRO ligne. Pas une ligne à zéro euro : zéro ligne.
 *
 * Mesuré par le chemin réel, en transaction annulée. Un tableau vide ne se dessine donc pas : il
 * n'y a rien à dire, et un cadre « 0 € » serait une affirmation, pas une absence.
 */
export async function lireVentesDeLaGalerie(albumId: string): Promise<LienVendeur[]> {
  const { data, error } = await supabase.rpc("media_album_links_stats", { p_album_id: albumId });
  // UN REFUS N'EST PAS UNE PANNE. La fonction rend zéro ligne quand le lecteur n'y a pas droit :
  // l'écran n'affiche alors simplement pas ce bloc.
  if (error) return [];
  type Ligne = {
    id: string; label: string | null; audience: string | null;
    offer_name: string | null; price_cents: unknown; is_enabled: boolean | null;
    view_count: unknown; unique_visitor_count: unknown;
    orders_count: unknown; revenue_cents: unknown;
  };
  return ((data ?? []) as Ligne[]).map((r) => ({
    id: String(r.id),
    libelle: (r.label ?? "").trim() || null,
    audience: r.audience ? AUDIENCE[r.audience] ?? r.audience : null,
    formule: (r.offer_name ?? "").trim() || null,
    prixCents: nombreOuNull(r.price_cents),
    actif: r.is_enabled !== false,
    visites: nombre(r.view_count),
    visiteurs: nombre(r.unique_visitor_count),
    commandes: nombreOuNull(r.orders_count),
    caCents: nombreOuNull(r.revenue_cents),
  }));
}
