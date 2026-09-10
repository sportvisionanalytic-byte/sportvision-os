// Le planning éditorial du CM : ce que l'écran sait des contenus, sans React (testé à part).
//
// Demande de Fouka, 11/09/2026 : le Centre communication est l'outil de travail principal du CM.
// Une seule source : la table `contenus` (v141 y ajoute heure, équipe, séance). Le workflow des
// statuts est celui de la base (contenus_valider_transition_statut) : il est RECOPIÉ ici pour
// proposer seulement les étapes que la base acceptera, jamais redéfini.

export type StatutContenu =
  | "brouillon" | "a_valider_interne" | "a_valider_tuteur" | "corrections" | "pret"
  | "a_valider_client" | "valide" | "programme" | "publie" | "archive";

export const STATUT_LIBELLE: Record<StatutContenu, string> = {
  brouillon: "Brouillon",
  a_valider_interne: "À relire (SportVision)",
  a_valider_tuteur: "À relire (tuteur)",
  corrections: "Corrections",
  pret: "Prêt",
  a_valider_client: "À valider par le club",
  valide: "Validé par le club",
  programme: "Programmé",
  publie: "Publié",
  archive: "Archivé",
};

/** Les transitions acceptées par la base (contenus_valider_transition_statut), telles quelles. */
const TRANSITIONS: Record<StatutContenu, StatutContenu[]> = {
  brouillon: ["pret", "a_valider_interne", "a_valider_tuteur"],
  a_valider_interne: ["a_valider_client", "corrections"],
  a_valider_tuteur: ["pret", "corrections"],
  corrections: ["brouillon", "a_valider_tuteur"],
  pret: ["programme"],
  a_valider_client: ["valide", "corrections"],
  valide: ["programme"],
  programme: ["publie"],
  publie: ["archive"],
  archive: [],
};

export function statutsSuivants(statut: StatutContenu): StatutContenu[] {
  return TRANSITIONS[statut] ?? [];
}

/** Ce qui reste à faire avant la mise en ligne. */
export const STATUTS_A_PREPARER: StatutContenu[] = ["brouillon", "corrections", "a_valider_interne", "a_valider_tuteur"];
export const STATUTS_MODIFIABLES = (s: StatutContenu) => s !== "publie" && s !== "archive";

export const TYPES_CONTENU: { id: string; libelle: string; emoji: string }[] = [
  { id: "publication", libelle: "Publication", emoji: "📝" },
  { id: "reel", libelle: "Reel / vidéo", emoji: "🎬" },
  { id: "story", libelle: "Story", emoji: "⏱️" },
  { id: "carrousel", libelle: "Carrousel", emoji: "📸" },
  { id: "actualite", libelle: "Actualité", emoji: "📰" },
  { id: "visuel", libelle: "Visuel", emoji: "🖼️" },
  { id: "autre", libelle: "Autre", emoji: "✳️" },
];

export const CANAUX: { id: string; libelle: string }[] = [
  { id: "instagram", libelle: "Instagram" },
  { id: "tiktok", libelle: "TikTok" },
  { id: "facebook", libelle: "Facebook" },
  { id: "linkedin", libelle: "LinkedIn" },
];

export function typeContenu(id: string | null | undefined): { libelle: string; emoji: string } {
  const t = TYPES_CONTENU.find((x) => x.id === (id ?? "").toLowerCase());
  return t ? { libelle: t.libelle, emoji: t.emoji } : { libelle: id ? id.charAt(0).toUpperCase() + id.slice(1) : "Contenu", emoji: "✳️" };
}

/** `plateforme` porte un ou plusieurs réseaux séparés par des virgules (« instagram,facebook »). */
export function lireCanaux(plateforme: string | null | undefined): string[] {
  return (plateforme ?? "")
    .split(/[,+/]/)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

export function ecrireCanaux(canaux: string[]): string | null {
  const uniques = [...new Set(canaux.map((c) => c.trim().toLowerCase()).filter(Boolean))];
  return uniques.length ? uniques.join(",") : null;
}

export function libelleCanaux(plateforme: string | null | undefined): string {
  return lireCanaux(plateforme)
    .map((c) => CANAUX.find((x) => x.id === c)?.libelle ?? c.charAt(0).toUpperCase() + c.slice(1))
    .join(" + ");
}

// ── Dates (heure locale, jamais UTC : un contenu de 23 h reste sur sa journée) ──
export function isoJour(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function depuisIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
export function plusJours(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
/** Les sept jours (lundi → dimanche) de la semaine qui contient `d`. */
export function semaineDe(d: Date): Date[] {
  const lundi = plusJours(d, -((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => plusJours(lundi, i));
}
/** Les jours affichés pour le mois de `d` : semaines complètes, du lundi au dimanche. */
export function grilleMois(d: Date): Date[] {
  const premier = new Date(d.getFullYear(), d.getMonth(), 1);
  const dernier = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const debut = semaineDe(premier)[0]!;
  const fin = semaineDe(dernier)[6]!;
  const jours: Date[] = [];
  for (let x = debut; x <= fin; x = plusJours(x, 1)) jours.push(x);
  return jours;
}

export interface ContenuPlanning {
  id: string;
  titre: string;
  statut: StatutContenu;
  typeContenu: string | null;
  plateforme: string | null;
  datePrevue: string | null;
  heurePrevue: string | null;
  equipe: string | null;
}

/** « 18:00 · 📸 Carrousel · Seniors R2 ». */
export function ligneContenu(c: Pick<ContenuPlanning, "heurePrevue" | "typeContenu" | "equipe">): string {
  const t = typeContenu(c.typeContenu);
  return [c.heurePrevue?.slice(0, 5), `${t.emoji} ${t.libelle}`, c.equipe].filter(Boolean).join(" · ");
}

export function trierContenus<C extends ContenuPlanning>(liste: C[]): C[] {
  return [...liste].sort((a, b) => {
    const da = `${a.datePrevue ?? "9999"}T${a.heurePrevue ?? "99"}`;
    const db = `${b.datePrevue ?? "9999"}T${b.heurePrevue ?? "99"}`;
    return da < db ? -1 : da > db ? 1 : a.titre.localeCompare(b.titre);
  });
}

export interface Resume<C> {
  aujourdhui: C[];
  semaine: number;
  aPreparer: C[];
}

/** Aujourd'hui | Cette semaine | À préparer (sept prochains jours, pas encore prêts). */
export function resumePlanning<C extends ContenuPlanning>(liste: C[], maintenant: Date): Resume<C> {
  const auj = isoJour(maintenant);
  const jours = semaineDe(maintenant).map(isoJour);
  const horizon = isoJour(plusJours(maintenant, 7));
  const actifs = trierContenus(liste.filter((c) => c.statut !== "archive"));
  return {
    aujourdhui: actifs.filter((c) => c.datePrevue === auj),
    semaine: actifs.filter((c) => c.datePrevue && jours.includes(c.datePrevue)).length,
    aPreparer: actifs.filter((c) => c.datePrevue && c.datePrevue >= auj && c.datePrevue <= horizon && STATUTS_A_PREPARER.includes(c.statut)),
  };
}

export interface Suggestion {
  cle: string;
  titre: string;
  typeContenu: string;
  datePrevue: string;
  heurePrevue: string;
}

/** Autour d'un match : ce qu'un CM prépare d'habitude. Proposé, jamais créé tout seul. */
export function suggestionsMatch(m: { date: string; heure?: string | null; equipe?: string | null; adversaire?: string | null }): Suggestion[] {
  const j = depuisIso(m.date);
  const h = m.heure ? Number(m.heure.slice(0, 2)) : 15;
  const mn = m.heure ? m.heure.slice(3, 5) : "00";
  const hh = (x: number) => `${String(Math.min(23, Math.max(0, x))).padStart(2, "0")}:${mn}`;
  const quoi = [m.equipe, m.adversaire ? `contre ${m.adversaire}` : null].filter(Boolean).join(" ");
  return [
    { cle: "veille", titre: `Veille de match · ${quoi}`, typeContenu: "visuel", datePrevue: isoJour(plusJours(j, -1)), heurePrevue: "18:00" },
    { cle: "matchday", titre: `Matchday · ${quoi}`, typeContenu: "story", datePrevue: isoJour(j), heurePrevue: "09:00" },
    { cle: "compo", titre: `Composition · ${quoi}`, typeContenu: "visuel", datePrevue: isoJour(j), heurePrevue: hh(h - 1) },
    { cle: "score", titre: `Score final · ${quoi}`, typeContenu: "visuel", datePrevue: isoJour(j), heurePrevue: hh(h + 2) },
    { cle: "images", titre: `Retour en images · ${quoi}`, typeContenu: "carrousel", datePrevue: isoJour(plusJours(j, 1)), heurePrevue: "12:00" },
  ];
}
