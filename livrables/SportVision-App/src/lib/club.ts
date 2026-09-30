// Ce que l'application lit pour l'ESPACE CLUB (30/09/2026).
//
// POURQUOI CE FICHIER EXISTE. Jusqu'ici, Club+ arrivait dans l'application sous la forme d'une page
// web dans un cadre. Fouka, trois fois : « on dirait trop encore le site web collé sur l'app, alors
// que par rapport à Connect, je veux la même fluidité, la même DA ». Il avait raison, et la cause
// était structurelle : tous les écrans de Connect sont NATIFS et lisent la base directement, là où
// Club+ était un site affiché dans une fenêtre. Aucune retouche de la coque ne rattrape ça.
//
// On lit donc la base pour le club, comme `donnees.ts` le fait pour la famille. Les deux fichiers
// partagent la même règle : les mêmes tables et les mêmes fonctions que le site, parce que ce sont
// elles qui portent les droits.
//
// CE QU'ON NE REFAIT PAS : le calendrier. `lireEvenements(clubId)` de `donnees.ts` lit déjà TOUT le
// calendrier d'un club, matchs et événements confondus, sans filtre d'équipe — exactement ce qu'un
// coach veut voir. Réécrire une lecture « équivalente » ici, c'est se condamner à ce que les deux
// divergent le jour où l'une sera corrigée.
import { supabase } from "./supabase";
import { ErreurChargement, refermerSiPerdue } from "./donnees";

/**
 * « actif », EN FRANÇAIS, ET PAS « active ».
 *
 * J'ai écrit `.eq("status", "active")` au premier jet. La contrainte de `club_members` n'admet que
 * 'actif', 'invitation' et 'suspendu' : le filtre ne rendait donc AUCUNE ligne, et l'écran aurait
 * annoncé « aucun membre » à un club qui en a sept. C'est la faute du 29/09, à l'identique — un
 * filtre sur une valeur qui n'existe pas ne protège de rien et ne ramène rien, tout en ayant l'air
 * juste. Vérifié en base : 7 lignes, toutes à 'actif'.
 */
const STATUT_ACTIF = "actif";

/** Le club d'une personne, et ce qu'elle y est. */
export interface MonClub {
  id: string;
  nom: string;
  ville: string | null;
  logoUrl: string | null;
  /** president, admin, coach, communication, secretaire… tel que la base le nomme. */
  role: string | null;
  /** Le libellé lisible de la fonction, quand le club en a saisi un. */
  fonction: string | null;
  /** Les équipes sur lesquelles cette personne a un périmètre. Vide = tout le club. */
  equipes: string[];
  /**
   * Le prénom que LE CLUB a enregistré pour cette personne.
   *
   * Il vient d'ici et pas de `session.profil` : `chargerProfil` ne connaît que les joueurs et les
   * parents, et rend `prenom: ""` pour un coach ou un président. L'accueil du club aurait donc
   * affiché « Bonjour » suivi de rien.
   */
  monPrenom: string;
}

/**
 * Le ou les clubs de la personne connectée.
 *
 * Une personne peut appartenir à plusieurs clubs — un coach qui aide un club voisin, un CM affilié.
 * On rend donc une liste, et c'est l'écran qui décide d'en choisir un. Rendre le premier venu
 * ferait disparaître les autres sans que personne ne comprenne pourquoi.
 */
export async function lireMesClubs(): Promise<MonClub[]> {
  // ON FILTRE SUR SOI, ET CE N'EST PAS ALLE DE SOI. Un membre a le droit de lire TOUS les membres
  // de son club : sans cette ligne, la fonction rendait cinq « clubs » — le meme, cinq fois, avec
  // le role des autres personnes. L'ecran aurait demande de choisir entre cinq fois RCP
  // Fontainebleau, et aurait affiche « Communication » a un coach.
  const { data: moi } = await supabase.auth.getUser();
  const uid = moi?.user?.id;
  if (!uid) return [];

  const { data, error } = await supabase
    .from("club_members")
    .select("role, fonction, teams, prenom, club_id, clubs(id, nom, ville, logo_url)")
    .eq("user_id", uid)
    .eq("status", STATUT_ACTIF);

  if (error) {
    await refermerSiPerdue(error);
    throw new ErreurChargement(error);
  }

  const liste: MonClub[] = [];
  for (const r of (data ?? []) as unknown as {
    role: string | null; fonction: string | null; teams: string[] | null; prenom: string | null;
    club_id: string;
    clubs: { id: string; nom: string | null; ville: string | null; logo_url: string | null } | null;
  }[]) {
    const c = r.clubs;
    if (!c?.id) continue;
    liste.push({
      id: c.id,
      nom: c.nom ?? "Mon club",
      ville: c.ville ?? null,
      logoUrl: c.logo_url ?? null,
      role: r.role ?? null,
      fonction: r.fonction ?? null,
      equipes: Array.isArray(r.teams) ? r.teams : [],
      monPrenom: (r.prenom ?? "").trim(),
    });
  }
  return liste;
}

/** Une équipe du club, telle qu'on la montre dans la liste. */
export interface EquipeDuClub {
  id: string;
  nom: string;
  categorie: string | null;
  /** Le nombre de joueurs inscrits, quand le club l'a renseigné. */
  effectif: number | null;
  coach: string | null;
  /** La couleur choisie par le club pour cette équipe, s'il en a choisi une. */
  couleur: string | null;
}

/**
 * Les équipes d'un club, les archivées exclues.
 *
 * L'ORDRE EST CELUI D'UN HUMAIN, PAS CELUI DE LA BASE. Un club range ses équipes par âge : U6, U7,
 * U8… puis les séniors. Un tri alphabétique donnerait U10, U11, U12, U6, U7 — ce qui a l'air d'un
 * bug alors que c'est juste l'ordre des lettres. On extrait donc le nombre et on trie dessus.
 */
export async function lireEquipes(clubId: string): Promise<EquipeDuClub[]> {
  const { data, error } = await supabase
    .from("club_teams")
    .select("id, name, categorie, members, coach, couleur, archivee")
    .eq("club_id", clubId);

  if (error) {
    await refermerSiPerdue(error);
    throw new ErreurChargement(error);
  }

  const liste = (data ?? [])
    .filter((r) => !r.archivee)
    .map((r) => ({
      id: String(r.id),
      nom: r.name ?? "Équipe",
      categorie: r.categorie ?? null,
      effectif: typeof r.members === "number" ? r.members : null,
      coach: r.coach ?? null,
      couleur: r.couleur ?? null,
    }));

  return liste.sort((a, b) => rangCategorie(a) - rangCategorie(b) || a.nom.localeCompare(b.nom, "fr"));
}

/**
 * Le rang d'une équipe dans l'ordre d'un club : les jeunes par âge croissant, les séniors après.
 *
 * « U11 B » et « U11 » doivent rester voisins, d'où le tri secondaire sur le nom complet.
 */
function rangCategorie(e: EquipeDuClub): number {
  const source = `${e.categorie ?? ""} ${e.nom}`;
  const age = source.match(/\bU\s?(\d{1,2})\b/i);
  if (age) return Number(age[1]);
  // Tout ce qui n'a pas d'âge passe après les jeunes : séniors, vétérans, loisirs.
  return 100;
}

/** Un membre du staff, pour l'écran d'accueil du club. */
export interface MembreDuClub {
  id: string;
  nom: string;
  role: string | null;
  fonction: string | null;
}

/** Les personnes actives du club, staff et dirigeants. */
export async function lireMembres(clubId: string): Promise<MembreDuClub[]> {
  const { data, error } = await supabase
    .from("club_members")
    .select("id, prenom, nom, role, fonction")
    .eq("club_id", clubId)
    .eq("status", STATUT_ACTIF);

  if (error) {
    await refermerSiPerdue(error);
    throw new ErreurChargement(error);
  }

  return (data ?? []).map((r) => ({
    id: String(r.id),
    nom: nomComplet(r.prenom, r.nom),
    role: r.role ?? null,
    fonction: r.fonction ?? null,
  }));
}

/**
 * Le nom affichable d'un membre, SANS RÉPÉTER LE PRÉNOM (30/09/2026).
 *
 * `club_members.nom` devrait porter le nom de famille, et le porte presque toujours. Mesuré sur les
 * cinq membres réels de RCP Fontainebleau : une ligne contient « David SEMBO » en face d'un prénom
 * « David ». Le simple `prenom + " " + nom` donnait donc « David David SEMBO ».
 *
 * On ne corrige pas la donnée depuis ici — ce serait écrire dans le dos du club. On l'affiche
 * proprement, et c'est tout.
 */
function nomComplet(prenom: string | null, nom: string | null): string {
  const p = (prenom ?? "").trim();
  const n = (nom ?? "").trim();
  if (!n) return p || "Membre";
  if (!p) return n;
  // Le nom porte déjà le prénom : on garde le nom seul.
  if (n.toLowerCase().startsWith(p.toLowerCase())) return n;
  return `${p} ${n}`;
}

/**
 * LE LIBELLÉ D'UN RÔLE, AVEC LES MOTS DE CLUB+ ET PAS D'AUTRES (corrigé le 30/09/2026).
 *
 * DEUX DÉFAUTS DANS MA PREMIÈRE VERSION, tous deux trouvés en lisant la contrainte de la table
 * plutôt que mon propre code :
 *
 *   1. `fonction` N'EST PAS UN INTITULÉ LIBRE. La contrainte ne laisse passer que 'principal' ou
 *      'adjoint' : c'est un qualificatif de coach (v124, décision de Fouka du 10/09 : « un libellé,
 *      pas un rôle »). Je le rendais tel quel en priorité sur le rôle, donc un coach adjoint se
 *      serait vu annoncer, en gros, sous le titre « adjoint ».
 *
 *   2. LA MOITIÉ DES RÔLES RÉELS MANQUAIT. J'avais écrit « communication », « tresorier »,
 *      « owner » — des valeurs qui n'existent pas dans la contrainte — et j'avais oublié `comm`,
 *      `membre_bureau`, `cm_externe`, `resp_equipe`, `directeur_sportif`, `administratif`,
 *      `sponsor_mgr`, `lecture_seule`, qui, eux, existent. Deux des sept membres réels en base
 *      (`comm` et `membre_bureau`) seraient donc tombés sur « Membre du club ».
 *
 * LES MOTS SONT CEUX DE CLUB+, repris de `ROLE_LABELS` et `CLUB_ROLE_MAP`. Une personne qui passe
 * de l'ordinateur au téléphone doit lire le même titre au même endroit ; deux vocabulaires pour
 * les mêmes rôles, c'est deux vérités.
 */
const LIBELLES: Record<string, string> = {
  admin: "Administrateur du club",
  president: "Président",
  secretaire: "Secrétaire",
  comm: "Community manager du club",
  cm_externe: "Community manager externe",
  coach: "Coach",
  resp_equipe: "Responsable d'équipe",
  directeur_sportif: "Directeur sportif",
  administratif: "Administratif",
  sponsor_mgr: "Responsable sponsors",
  tresorier: "Trésorier",
  membre_bureau: "Membre du bureau",
  lecture_seule: "Lecture seule",
};

export function libelleRole(role: string | null, fonction: string | null): string {
  const cle = (role ?? "").toLowerCase();
  // La règle exacte de Club+ (`TeamStaffCard`) : seul un coach adjoint change de libellé. Un coach
  // principal reste « Coach » — ajouter « principal » laisserait croire à un grade supérieur là où
  // il n'y en a pas.
  if (cle === "coach" && fonction === "adjoint") return "Coach adjoint";
  // Un rôle inconnu ne se traduit pas en droit : on dit ce qu'on sait, c'est-à-dire rien de plus
  // que « cette personne est du club ».
  return LIBELLES[cle] ?? "Membre du club";
}
