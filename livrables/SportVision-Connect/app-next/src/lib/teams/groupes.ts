// Regrouper les équipes d'un club pour les rendre choisissables.
//
// ── Le problème ──
// SF Villemomble a 38 équipes. Un <select> les aligne à plat, par ordre alphabétique, et trouver
// « U12 Espoir 2 » demande de parcourir quarante lignes où « Seniors D1 » côtoie « U10 Avenir ».
// Ce n'est pas un défaut de ce club : tout club structuré dépasse la vingtaine d'équipes.
//
// ── Pourquoi ce fichier est séparé du composant ──
// Le regroupement est une règle métier, pas de l'affichage. Elle doit servir au calendrier, aux
// résultats, aux galeries, aux invitations — partout où l'on choisit une équipe. La mettre dans
// un composant, c'est la réécrire au cinquième écran, différemment.
//
// ── Ce qu'on ne fait PAS ──
// Aucun groupe codé en dur pour Villemomble. Les groupes se déduisent des équipes réellement
// présentes : un club de basket avec des U11 et des Seniors obtient ses deux groupes, un club de
// cinq équipes n'en obtient pas quinze vides. Et les noms en base ne sont jamais modifiés : le
// regroupement est une couche de lecture.

export interface EquipeChoisissable {
  name: string;
  /** Catégorie structurée telle qu'elle est en base (`club_teams.categorie`). C'est l'autorité
   *  quand elle existe : le nom n'est qu'un repli. */
  categorie?: string | null;
  /** `Masculin`, `Féminin` ou `Mixte` (`club_teams.section`). Sert à poser un discret repère, pas
   *  à créer un groupe séparé : une U15 F reste une U15. */
  section?: string | null;
}

export interface GroupeEquipes {
  /** Identifiant stable du groupe, indépendant de son libellé. */
  id: string;
  label: string;
  equipes: EquipeChoisissable[];
}

/** Groupes qui ne sont pas des tranches d'âge, et l'ordre dans lequel on les cherche.
 *
 *  Un vétéran n'est pas un senior et ne doit pas se perdre au milieu de ses équipes : le club le
 *  gère à part, le sélecteur aussi. Les motifs portent sur la catégorie ou, à défaut, sur le nom. */
const GROUPES_SPECIAUX: { id: string; label: string; motif: RegExp }[] = [
  { id: "veterans", label: "Vétérans", motif: /v[ée]t[ée]ran|anciens/i },
  { id: "gardiens", label: "Gardiens", motif: /gardien/i },
  { id: "loisirs", label: "Loisirs", motif: /loisir/i },
];

/** La tranche d'âge d'une équipe : « U12 », « Seniors », ou rien.
 *
 *  On lit d'abord la catégorie structurée. Le nom n'est consulté que si elle manque — construire
 *  toute l'autorité sur `name.startsWith("U12")` casserait le jour où une équipe s'appelle
 *  « Les Lionceaux » tout en portant la catégorie U12. */
function trancheDe(e: EquipeChoisissable): string | null {
  const source = (e.categorie ?? "").trim() || e.name;
  const jeunes = /\bU\s?(\d{1,2})\b/i.exec(source);
  if (jeunes) return `U${jeunes[1]}`;
  if (/s[ée]nior/i.test(source)) return "Seniors";
  return null;
}

function groupeSpecialDe(e: EquipeChoisissable): { id: string; label: string } | null {
  const source = `${e.categorie ?? ""} ${e.name}`;
  return GROUPES_SPECIAUX.find((g) => g.motif.test(source)) ?? null;
}

/** Rang d'un groupe dans l'ordre sportif : Seniors d'abord, puis les jeunes du plus âgé au plus
 *  jeune, et les catégories particulières à la fin. Jamais l'ordre alphabétique, qui mettrait
 *  « U10 » avant « U9 » et « Seniors » au milieu des U. */
function rangGroupe(id: string): number {
  if (id === "seniors") return 0;
  const jeunes = /^u(\d{1,2})$/.exec(id);
  if (jeunes) return 100 - Number(jeunes[1]); // U20 avant U19… U6 en dernier
  const special = GROUPES_SPECIAUX.findIndex((g) => g.id === id);
  return special >= 0 ? 1000 + special : 900; // « Autres » avant les groupes particuliers
}

/** Rang d'une équipe dans son groupe. Le classement suit le niveau quand il se lit dans le nom :
 *  le régional avant le départemental, l'élite avant l'avenir. On ne construit pas de moteur de
 *  classement : ce qui n'est pas reconnu garde l'ordre alphabétique, qui reste stable. */
function rangEquipe(nom: string): number {
  const n = nom.toLowerCase();
  if (/\br[1-3]\b/.test(n)) return 0;          // régional
  if (/\breg\b|r[ée]gional/.test(n)) return 1;
  if (/\b[ée]lite\b/.test(n)) return 2;
  if (/\bd[1-4]\b/.test(n)) return 3;          // départemental
  if (/\bespoir/.test(n)) return 5;
  if (/\bavenir/.test(n)) return 6;
  return 4;
}

/**
 * Construit les groupes à partir des équipes réellement présentes.
 *
 * Un groupe n'existe que s'il contient au moins une équipe : un coach qui n'encadre que deux
 * équipes voit deux groupes, pas quinze rubriques vides.
 */
export function grouperEquipes(equipes: EquipeChoisissable[]): GroupeEquipes[] {
  const parGroupe = new Map<string, GroupeEquipes>();

  for (const e of equipes) {
    // Le groupe particulier l'emporte : « Super Vétérans » contient « Seniors » dans son nom pour
    // certains clubs, et se retrouverait chez les seniors si on testait la tranche d'abord.
    const special = groupeSpecialDe(e);
    const tranche = special ? null : trancheDe(e);
    const id = special?.id ?? (tranche ? tranche.toLowerCase() : "autres");
    const label = special?.label ?? tranche ?? "Autres";

    const groupe = parGroupe.get(id) ?? { id, label, equipes: [] };
    groupe.equipes.push(e);
    parGroupe.set(id, groupe);
  }

  for (const g of parGroupe.values()) {
    g.equipes.sort((a, b) => {
      const d = rangEquipe(a.name) - rangEquipe(b.name);
      return d !== 0 ? d : a.name.localeCompare(b.name, "fr");
    });
  }

  return [...parGroupe.values()].sort((a, b) => {
    const d = rangGroupe(a.id) - rangGroupe(b.id);
    return d !== 0 ? d : a.label.localeCompare(b.label, "fr");
  });
}

/** Normalisation pour la recherche : sans accent, sans ponctuation, en minuscules. « U 12 » et
 *  « u12 » doivent trouver la même chose, et « Séniors » se cherche en tapant « seniors ». */
function normaliser(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Filtre les groupes sur une recherche libre.
 *
 * Une correspondance sur le NOM DU GROUPE garde tout le groupe : taper « U12 » doit montrer les
 * quatre U12, pas seulement celle qui contient « U12 » dans son propre nom. Les groupes vidés
 * disparaissent, pour ne pas laisser des rubriques sans contenu.
 */
export function filtrerGroupes(groupes: GroupeEquipes[], recherche: string): GroupeEquipes[] {
  const q = normaliser(recherche);
  if (!q) return groupes;
  return groupes
    .map((g) => {
      if (normaliser(g.label).includes(q)) return g;
      const equipes = g.equipes.filter((e) => normaliser(e.name).includes(q));
      return { ...g, equipes };
    })
    .filter((g) => g.equipes.length > 0);
}

/** Le repère féminin, quand la donnée le dit. Discret et facultatif : une U15 F reste une U15, on
 *  ne crée pas un groupe « Féminines » qui éclaterait chaque tranche en deux. */
export function estFeminine(e: EquipeChoisissable): boolean {
  if (e.section) return /f[ée]minin/i.test(e.section);
  return /\bf(?:[ée]minines?)?\b/i.test(e.name);
}
