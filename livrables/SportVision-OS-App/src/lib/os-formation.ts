// LE CENTRE DE FORMATION, VU DE L'APPLICATION (01/10/2026).
//
// CE FICHIER A ÉTÉ RÉÉCRIT LE 01/10. Sa version du 30/09 disait, en toutes lettres : « CETTE
// APPLICATION NE SERT PAS DE LEÇON. Pas de catalogue, pas de module, pas de quiz. Ce n'est pas un
// choix de confort, c'est ce que la base permet. » C'était vrai, et Fouka l'a constaté à sa
// façon : « je ne peux pas cliquer sur les trucs, on dirait des captures d'écran posées, figées ».
//
// LA BASE PERMET MAINTENANT. Quatre migrations ont été écrites et appliquées le 01/10 :
//
//   · v379 / v380 — `formations` (108), `formation_modules` (761), `formation_lecons` (1 956). Le
//     catalogue qui vivait dans une constante JavaScript du HTML de l'OS est en base.
//   · v381 — `centre_reglement_chapitres` / `_sections` : le règlement, versionné.
//   · v382 — `rpc_lire_quiz` : les 1 133 questions, lisibles par le personnel, SANS les bonnes
//     réponses. Avant, un opérateur en voyait 0 sur 1 133 (`fqq_admin_select` réserve la table au
//     rôle 'admin'), mesuré avec le jeton d'Antoine Blin.
//
// CE FICHIER NE PORTE DONC PLUS AUCUN CONTENU. Le dictionnaire `TITRES` de 108 lignes recopiées du
// HTML a disparu : une deuxième copie d'un catalogue finit toujours par dériver de la première.
//
// CE QUI RESTE EN BASE AILLEURS, ET QU'ON NE RECOPIE PAS. `formation_rewards` détient l'XP, le
// nombre de leçons attendu et la certification des 108 formations. Ce ne sont pas des libellés,
// ce sont des RÈGLES, et elles divergent volontairement du HTML : l'XP y a été divisé par quatre le
// 09/09 à la demande de Fouka. C'est cette table qui est créditée, c'est donc elle qu'on lit.
//
// L'XP, LES CERTIFICATIONS ET LA CORRECTION DU QUIZ SONT CALCULÉS PAR LE SERVEUR, ET ON NE LES
// RECALCULE PAS. Lu dans le CORPS des fonctions, pas dans leur en-tête :
//   · `rpc_complete_formation` refuse tant que les leçons ne sont pas toutes faites, crédite
//     `xp_events` et `profiles.xp`, puis crée la certification avec son numéro. Elle n'accorde
//     l'XP QUE si `profiles.role = 'photo'`.
//   · `rpc_submit_quiz` corrige, pose le seuil à 70 %, verse un bonus de 30 % de l'XP, et rend les
//     bonnes réponses APRÈS coup, dans son champ `results`. C'est pour ça qu'on peut poser les
//     questions sans les réponses : c'est le serveur qui sait.
//   · un trigger, `protect_sensitive_formation_inscription_fields`, refuse qu'un collaborateur
//     modifie ses propres `xp_gagnes`.
//
// LE FILTRE DE VISIBILITÉ N'EST PAS ICI, ET C'EST VOULU (règle 3 du contrat). L'OS décide qui voit
// quelles formations dans `_visibleFormations()`. La policy `formations_lire` de la v379 porte
// cette règle, et elle rend exactement les mêmes nombres, vérifié rôle par rôle avec le jeton de
// sept personnes réelles : photo 36, prod 24, sec 20, cm 45, com 4, compta 3, admin 108. Aucun
// filtre par rôle dans ce fichier : il en existerait deux, et un jour elles ne diraient plus la
// même chose.
import { supabase } from "./supabase";

// ── LES GRADES ────────────────────────────────────────────────────────────────────────────────
//
// Recopiés de `GRADES_DEF` dans l'OS : le grade d'une personne est en base (`profiles.grade`, un
// entier), son NOM n'y est pas. C'est la dernière chose que ce fichier recopie, et elle tient en
// six lignes.
//
// ET C'EST LE GRADE ACCORDÉ QUI S'AFFICHE, PAS CELUI QUE L'XP PERMETTRAIT. L'OS le dit dans son
// propre code : le grade est validé par l'administration (`grade_valide_at`, `grade_valide_par`),
// il ne se déclenche pas tout seul au franchissement d'un seuil.
const GRADES = [
  { nom: "Débutant", xp: 0 },
  { nom: "Confirmé", xp: 600 },
  { nom: "Senior", xp: 2000 },
  { nom: "Expert", xp: 4000 },
  { nom: "Elite", xp: 6500 },
  { nom: "Maître", xp: 9000 },
] as const;

export interface Grade {
  nom: string;
  /** Le nom du grade suivant, ou null au sommet. */
  suivant: string | null;
  /** Ce qu'il reste d'XP à gagner avant le grade suivant. Null au sommet. */
  restant: number | null;
  /** L'avancement vers le grade suivant, de 0 à 100. */
  avancement: number;
}

export function grade(indice: number, xp: number): Grade {
  const i = Math.max(0, Math.min(GRADES.length - 1, Math.trunc(indice)));
  const actuel = GRADES[i];
  const suivant = GRADES[i + 1] ?? null;
  if (!suivant) return { nom: actuel.nom, suivant: null, restant: null, avancement: 100 };
  const largeur = suivant.xp - actuel.xp;
  const fait = xp - actuel.xp;
  return {
    nom: actuel.nom,
    suivant: suivant.nom,
    restant: Math.max(0, suivant.xp - xp),
    avancement: largeur > 0 ? Math.max(0, Math.min(100, Math.round((fait / largeur) * 100))) : 0,
  };
}

/** Le nom d'un grade par son indice. Sert à écrire « Débloqué au grade Senior » sans inventer. */
export function nomDuGrade(indice: number): string {
  const i = Math.max(0, Math.min(GRADES.length - 1, Math.trunc(indice)));
  return GRADES[i].nom;
}

// ── LE CATALOGUE ──────────────────────────────────────────────────────────────────────────────

export interface Formation {
  id: string;
  titre: string;
  categorie: string | null;
  icone: string | null;
  niveau: string | null;
  /** « en_ligne » ou « hybride », le mot de l'OS. */
  type: string | null;
  duree: string | null;
  formateur: string | null;
  obligatoire: boolean;
  description: string | null;
  /** L'XP de `formation_rewards`, celui qui sera réellement crédité. */
  xp: number | null;
  /** Le nombre de leçons attendu par le serveur pour délivrer la certification. */
  leconsTotal: number | null;
  certifiante: boolean;
  certificationNom: string | null;
  /**
   * LE VERROU D'ÉTOILES, TEL QUE L'OS LE CALCULE (`_formLockLabel`). Non nul = on montre la
   * formation verrouillée, avec ce libellé. On ne la cache pas : l'OS ne la cache pas non plus, et
   * savoir ce qui reste à débloquer fait partie du parcours.
   */
  verrou: string | null;
}

export interface MaFormation extends Formation {
  /** L'identifiant de mon inscription, ou null si je ne suis pas inscrit. */
  inscriptionId: string | null;
  terminee: boolean;
  leconsFaites: number;
  avancement: number;
  /** L'XP réellement crédité, tel que la base l'a enregistré. Jamais un calcul d'écran. */
  xpCredite: number;
  scoreQuiz: number | null;
  quizReussi: boolean;
  termineeLe: string | null;
}

export interface MaCertification {
  id: string;
  code: string;
  nom: string;
  badge: string | null;
  /** Le titre de la formation qui l'a délivrée, quand la base sait le nommer. */
  parFormation: string | null;
  obtenueLe: string | null;
  expireLe: string | null;
  numero: string | null;
  /** « active », « expiree »… tel que la base le dit, corrigé si la date est passée. */
  statut: string;
  /** Jours restants avant expiration. Négatif quand c'est déjà passé. */
  joursRestants: number | null;
}

export interface Parcours {
  /** Vrai pour les opérateurs terrain : eux seuls ont un parcours XP/grade dans l'OS. */
  parcoursXp: boolean;
  xp: number;
  grade: Grade;
  /** Tout le catalogue que la base m'ouvre, avec mon état sur chacune. */
  catalogue: MaFormation[];
  /** Les seules où je suis inscrit. Sous-ensemble de `catalogue`. */
  mesFormations: MaFormation[];
  certifications: MaCertification[];
  terminees: number;
  enCours: number;
  certificationsActives: number;
  /** Les obligatoires que je n'ai pas terminées. Ce sont elles qui bloquent une mission. */
  obligatoiresRestantes: number;
}

type LigneFormation = {
  id: string; titre: string; categorie: string | null; icone: string | null;
  niveau: string | null; type: string | null; duree: string | null; formateur: string | null;
  obligatoire: boolean | null; description: string | null; grade_minimum: number | null; ordre: number | null;
};
type LigneRecompense = {
  formation_id: string; total_lecons: number | null; xp: number | null;
  certification_id: string | null; certification_nom: string | null;
};
type LigneInscription = {
  id: string; formation_id: string; statut: string | null; xp_gagnes: number | null;
  score_quiz: number | null; quiz_passe: boolean | null; completed_at: string | null;
  formation_progression: { lecon_key: string }[] | null;
};

/**
 * LE VERROU, RECOPIÉ DE `_formLockLabel` DE L'OS, MOT POUR MOT SAUF LES ÉTOILES.
 *
 * L'OS écrit « 🔒 Débloqué à partir de ⭐⭐ (2 étoiles) ». On garde son sens et son chiffre, et on
 * ajoute le NOM du grade : sur un téléphone, « à partir du grade Confirmé » se lit du premier coup,
 * là où deux étoiles demandent de savoir compter les paliers.
 *
 * `onlyRole` n'est PAS repris ici : il devient `formations.roles`, et la policy `formations_lire`
 * l'applique. Une formation réservée à un autre rôle n'arrive donc jamais jusqu'à cette fonction.
 */
function verrou(f: LigneFormation, role: string | null, monGrade: number): string | null {
  if (role === "admin") return null;
  if (!f.grade_minimum || role !== "photo") return null;
  if (monGrade >= f.grade_minimum) return null;
  return `Débloqué à partir du grade ${nomDuGrade(f.grade_minimum)}`;
}

/**
 * Tout ce que l'écran Formation affiche, en une lecture.
 *
 * ON FILTRE LES INSCRIPTIONS SUR SON PROPRE IDENTIFIANT, ET C'EST INDISPENSABLE ICI. Ce n'est pas
 * la même situation que le catalogue, où la RLS borne déjà : `fi_own_read` dit
 * « (collaborateur_id = auth.uid()) OR role IN ('admin','prod') », et `cc_own_read` la même chose.
 * Mesuré : sans ce filtre, Mikael (responsable production) verrait les 65 inscriptions de l'équipe
 * sur son écran « Mes formations », et les 30 certifications de tout le monde. La base a raison de
 * les lui ouvrir, c'est son travail de les voir, mais pas sur CET écran-là.
 */
export async function lireParcours(moiId: string, role: string | null): Promise<Parcours> {
  const [profil, formations, recompenses, inscriptions, certifs] = await Promise.all([
    supabase.from("profiles").select("xp, grade").eq("id", moiId).maybeSingle(),
    supabase
      .from("formations")
      .select("id, titre, categorie, icone, niveau, type, duree, formateur, obligatoire, description, grade_minimum, ordre")
      .order("ordre", { ascending: true }),
    supabase.from("formation_rewards").select("formation_id, total_lecons, xp, certification_id, certification_nom"),
    supabase
      .from("formation_inscriptions")
      .select("id, formation_id, statut, xp_gagnes, score_quiz, quiz_passe, completed_at, formation_progression(lecon_key)")
      .eq("collaborateur_id", moiId),
    supabase
      .from("collaborateur_certifications")
      .select("id, code_certification, nom, badge, formation_id, date_obtention, date_expiration, statut, numero_certificat")
      .eq("collaborateur_id", moiId)
      .order("date_obtention", { ascending: false }),
  ]);

  for (const r of [profil, formations, recompenses, inscriptions, certifs]) {
    if (r.error) throw r.error;
  }

  const xp = ((profil.data as { xp?: number | null } | null)?.xp) ?? 0;
  const monGrade = ((profil.data as { grade?: number | null } | null)?.grade) ?? 0;

  const parId = new Map<string, LigneRecompense>();
  for (const r of (recompenses.data ?? []) as unknown as LigneRecompense[]) {
    parId.set(String(r.formation_id), r);
  }
  const mesInscriptions = new Map<string, LigneInscription>();
  for (const i of (inscriptions.data ?? []) as unknown as LigneInscription[]) {
    mesInscriptions.set(String(i.formation_id), i);
  }

  const titres = new Map<string, string>();
  const catalogue: MaFormation[] = ((formations.data ?? []) as unknown as LigneFormation[]).map((f) => {
    titres.set(String(f.id), f.titre);
    const rec = parId.get(String(f.id));
    const ins = mesInscriptions.get(String(f.id)) ?? null;
    const faites = (ins?.formation_progression ?? []).length;
    const total = rec?.total_lecons ?? null;
    // L'AVANCEMENT SE COMPTE, IL NE SE LIT PAS. `formation_inscriptions.progression_pct` existe,
    // mais il est faux sur au moins une ligne mesurée le 30/09 : Bhajneet sur « Maîtrise du
    // stabilisateur », 8 leçons sur 8 faites et pourtant 88 %. L'OS fait la même division, leçons
    // validées sur `total_lecons` du serveur, et c'est elle qui fait foi.
    const avancement = total && total > 0
      ? Math.max(0, Math.min(100, Math.round((faites / total) * 100)))
      : 0;
    return {
      id: String(f.id),
      titre: f.titre,
      categorie: (f.categorie ?? "").trim() || null,
      icone: (f.icone ?? "").trim() || null,
      niveau: (f.niveau ?? "").trim() || null,
      type: (f.type ?? "").trim() || null,
      duree: (f.duree ?? "").trim() || null,
      formateur: (f.formateur ?? "").trim() || null,
      obligatoire: f.obligatoire === true,
      description: (f.description ?? "").trim() || null,
      xp: rec?.xp ?? null,
      leconsTotal: total,
      certifiante: !!rec?.certification_id,
      certificationNom: (rec?.certification_nom ?? "").trim() || null,
      verrou: verrou(f, role, monGrade),
      inscriptionId: ins ? String(ins.id) : null,
      terminee: ins?.statut === "terminee",
      leconsFaites: faites,
      avancement,
      xpCredite: ins?.xp_gagnes ?? 0,
      scoreQuiz: ins?.score_quiz ?? null,
      quizReussi: ins?.quiz_passe === true,
      termineeLe: ins?.completed_at ?? null,
    };
  });

  const mesFormations = catalogue
    .filter((f) => f.inscriptionId !== null)
    // Les plus avancées d'abord chez les non terminées, et les terminées à la fin : ce qu'il reste
    // à faire se lit avant ce qui est fait.
    .sort((a, b) => {
      if (a.terminee !== b.terminee) return a.terminee ? 1 : -1;
      if (a.terminee) return (b.termineeLe ?? "").localeCompare(a.termineeLe ?? "");
      return b.avancement - a.avancement;
    });

  type LigneCertif = {
    id: string; code_certification: string; nom: string; badge: string | null;
    formation_id: string | null; date_obtention: string | null; date_expiration: string | null;
    statut: string | null; numero_certificat: string | null;
  };
  const maintenant = Date.now();
  const certifications: MaCertification[] = ((certifs.data ?? []) as unknown as LigneCertif[]).map((c) => {
    const exp = c.date_expiration ? new Date(c.date_expiration) : null;
    const perimee = !!exp && exp.getTime() < maintenant;
    return {
      id: String(c.id),
      code: String(c.code_certification),
      nom: c.nom,
      badge: c.badge ?? null,
      parFormation: c.formation_id ? (titres.get(c.formation_id) ?? null) : null,
      obtenueLe: c.date_obtention ?? null,
      expireLe: c.date_expiration ?? null,
      numero: (c.numero_certificat ?? "").trim() || null,
      // `sync_certifications_statut()` existe côté serveur pour basculer les statuts, mais rien ne
      // garantit qu'elle a tourné aujourd'hui : une certification « active » dont la date est
      // passée se lit comme expirée, exactement comme le fait l'OS.
      statut: c.statut === "active" && perimee ? "expiree" : (c.statut ?? "active"),
      joursRestants: exp ? Math.ceil((exp.getTime() - maintenant) / 86400000) : null,
    };
  });

  return {
    // Décision de l'OS, reprise telle quelle : seuls les photographes-vidéastes ont un parcours
    // XP/grade, parce qu'eux seuls ont des missions terrain notées. Pour les autres, afficher un
    // grade « Débutant » à 0 XP serait un jugement, pas une information.
    parcoursXp: role === "photo",
    xp,
    grade: grade(monGrade, xp),
    catalogue,
    mesFormations,
    certifications,
    terminees: mesFormations.filter((f) => f.terminee).length,
    enCours: mesFormations.filter((f) => !f.terminee).length,
    certificationsActives: certifications.filter((c) => c.statut !== "expiree").length,
    obligatoiresRestantes: catalogue.filter((f) => f.obligatoire && !f.terminee).length,
  };
}

// ── UNE FORMATION, OUVERTE ────────────────────────────────────────────────────────────────────

export interface Lecon {
  id: string;
  titre: string;
  /** La clé que `formation_progression` enregistre : celle de l'OS, jamais recalculée à l'écran. */
  leconKey: string;
  faite: boolean;
}

export interface Module {
  id: string;
  ordre: number;
  titre: string;
  lecons: Lecon[];
  faites: number;
}

export interface FormationOuverte {
  formation: MaFormation;
  modules: Module[];
  /** Le nombre de leçons réellement en base. Peut différer de `leconsTotal`, et on le dit alors. */
  leconsEnBase: number;
  /** Vrai quand toutes les leçons attendues par le serveur sont validées. */
  toutesFaites: boolean;
}

/**
 * Une formation avec ses modules, ses leçons et mon avancement.
 *
 * DEUX SOURCES POUR LE MÊME NOMBRE, ET ON LES GARDE TOUTES LES DEUX. `leconsTotal` vient de
 * `formation_rewards` : c'est le nombre que `rpc_complete_formation` EXIGE. `leconsEnBase` est le
 * nombre de lignes de `formation_lecons`. La migration v380 refuse de s'appliquer s'ils diffèrent,
 * mais l'écran ne parie pas sur ça : si les deux divergent un jour, cocher toutes les leçons
 * affichées ne terminerait pas la formation, et il faut que l'écran puisse le dire au lieu de
 * laisser quelqu'un chercher la leçon manquante.
 */
export async function lireFormation(formationId: string, moiId: string, role: string | null): Promise<FormationOuverte> {
  const parcours = await lireParcours(moiId, role);
  const formation = parcours.catalogue.find((f) => f.id === formationId);
  if (!formation) {
    throw new Error(
      "Cette formation ne vous est pas ouverte, ou n'existe plus au catalogue. " +
      "Demandez à l'administration si elle devrait l'être.",
    );
  }

  const [modules, lecons, progression] = await Promise.all([
    supabase.from("formation_modules").select("id, ordre, titre").eq("formation_id", formationId).order("ordre"),
    supabase.from("formation_lecons").select("id, module_id, ordre, titre, lecon_key").eq("formation_id", formationId).order("ordre"),
    formation.inscriptionId
      ? supabase.from("formation_progression").select("lecon_key").eq("inscription_id", formation.inscriptionId)
      : Promise.resolve({ data: [] as { lecon_key: string }[], error: null }),
  ]);
  for (const r of [modules, lecons, progression]) if (r.error) throw r.error;

  const faites = new Set(
    ((progression.data ?? []) as unknown as { lecon_key: string }[]).map((p) => p.lecon_key),
  );

  type LigneLecon = { id: string; module_id: string; ordre: number; titre: string; lecon_key: string };
  const parModule = new Map<string, LigneLecon[]>();
  for (const l of (lecons.data ?? []) as unknown as LigneLecon[]) {
    const liste = parModule.get(String(l.module_id)) ?? [];
    liste.push(l);
    parModule.set(String(l.module_id), liste);
  }

  type LigneModule = { id: string; ordre: number; titre: string };
  const blocs: Module[] = ((modules.data ?? []) as unknown as LigneModule[]).map((m) => {
    const liste = (parModule.get(String(m.id)) ?? []).slice().sort((a, b) => a.ordre - b.ordre);
    const contenu: Lecon[] = liste.map((l) => ({
      id: String(l.id),
      titre: l.titre,
      leconKey: String(l.lecon_key),
      faite: faites.has(String(l.lecon_key)),
    }));
    return {
      id: String(m.id),
      ordre: m.ordre,
      titre: m.titre,
      lecons: contenu,
      faites: contenu.filter((l) => l.faite).length,
    };
  });

  const leconsEnBase = blocs.reduce((n, m) => n + m.lecons.length, 0);
  return {
    formation,
    modules: blocs,
    leconsEnBase,
    toutesFaites:
      formation.leconsTotal !== null &&
      formation.leconsTotal > 0 &&
      formation.leconsFaites >= formation.leconsTotal,
  };
}

// ── LES GESTES ────────────────────────────────────────────────────────────────────────────────
//
// TOUTE ÉCRITURE FINIT PAR `.select(...)` ET LÈVE SI LE TABLEAU EST VIDE (règle 4 du contrat).
// PostgREST rend zéro ligne ET zéro erreur quand la RLS refuse : sans ce contrôle, l'écran
// afficherait « c'est fait » sur une ligne qui n'a pas bougé. Vérifié le 01/10 : un opérateur qui
// tente `update formations set titre = …` obtient 0 ligne et aucune erreur.

/**
 * S'inscrire à une formation.
 *
 * `fi_own_write` n'autorise que `collaborateur_id = auth.uid()`, et un index unique
 * `(formation_id, collaborateur_id)` interdit le doublon. Une seconde inscription simultanée rend
 * donc une erreur 23505 : on relit l'inscription existante au lieu de faire échouer le geste. Sur
 * un téléphone, un double appui n'est pas une faute de l'utilisateur.
 */
export async function sInscrire(formationId: string, moiId: string): Promise<string> {
  const { data, error } = await supabase
    .from("formation_inscriptions")
    .insert({ formation_id: formationId, collaborateur_id: moiId, statut: "en_cours" })
    .select("id");

  if (error) {
    if (error.code === "23505") {
      const { data: deja, error: e2 } = await supabase
        .from("formation_inscriptions")
        .select("id")
        .eq("formation_id", formationId)
        .eq("collaborateur_id", moiId)
        .maybeSingle();
      if (e2) throw new Error(e2.message);
      if (deja?.id) return String(deja.id);
    }
    throw new Error(error.message);
  }
  if (!data || !data.length) {
    throw new Error("Inscription refusée par la base. Votre compte n'a peut-être plus accès à l'OS.");
  }
  return String(data[0].id);
}

/**
 * Cocher ou décocher une leçon.
 *
 * ON FAIT CE QUE FAIT L'OS, ET RIEN DE PLUS : un `insert` pour cocher, un `delete` pour décocher,
 * sur `(inscription_id, lecon_key)`. Aucun `progression_pct` n'est écrit : cette colonne est fausse
 * sur au moins une ligne en base, et l'avancement se compte.
 *
 * Le `delete` mérite son propre commentaire : `.select("lecon_key")` après un `delete` rend les
 * lignes supprimées. Zéro ligne signifie « la RLS a refusé » OU « elle n'était pas cochée » — les
 * deux se terminent par l'état demandé, donc on ne lève pas. Pour l'`insert`, en revanche, zéro
 * ligne ne peut vouloir dire qu'un refus.
 */
export async function basculerLecon(inscriptionId: string, leconKey: string, cocher: boolean): Promise<void> {
  if (cocher) {
    const { data, error } = await supabase
      .from("formation_progression")
      .insert({ inscription_id: inscriptionId, lecon_key: leconKey })
      .select("id");
    // Déjà cochée : l'index unique refuse, et l'état voulu est déjà celui-là.
    if (error && error.code === "23505") return;
    if (error) throw new Error(error.message);
    if (!data || !data.length) {
      throw new Error("Leçon non enregistrée : la base a refusé l'écriture. Rechargez l'écran.");
    }
    return;
  }
  const { error } = await supabase
    .from("formation_progression")
    .delete()
    .eq("inscription_id", inscriptionId)
    .eq("lecon_key", leconKey)
    .select("id");
  if (error) throw new Error(error.message);
}

// ── LE QUIZ ───────────────────────────────────────────────────────────────────────────────────

export interface Question {
  /** Le rang du correcteur : la réponse à cette question va à CET indice du tableau envoyé. */
  rang: number;
  question: string;
  options: string[];
}

export interface ResultatQuiz {
  score: number;
  reussi: boolean;
  justes: number;
  total: number;
  bonusXp: number;
  /** Par question : la bonne réponse, celle donnée, et si elle était juste. Rendu par le serveur. */
  corrections: { rang: number; bonne: number | null; donnee: number | null; juste: boolean }[];
}

/**
 * Les questions d'un quiz, sans les bonnes réponses.
 *
 * `rpc_lire_quiz` (v382) rend `[{rang, question, options}]` dans l'ORDRE EXACT où `rpc_submit_quiz`
 * corrige — les deux fonctions partagent la même source d'ordre, `quiz_questions_a_poser`, et la
 * migration refuse de s'appliquer si les deux ne comptent pas le même nombre de questions.
 *
 * ELLE REFUSE SANS INSCRIPTION, et c'est pour ça que l'écran n'ouvre le quiz qu'une fois inscrit.
 * Mesuré : avec le jeton d'un compte à 0 inscription, elle lève « Non autorisé : inscription
 * requise pour accéder à ce quiz ». Un bouton qui mènerait là est un bouton de trop (règle 5).
 */
export async function lireQuiz(formationId: string): Promise<Question[]> {
  const { data, error } = await supabase.rpc("rpc_lire_quiz", { p_formation_id: formationId });
  if (error) throw new Error(error.message);
  const brut = (data ?? []) as { rang: number; question: string; options: unknown }[];
  return brut
    .map((q) => ({
      rang: Number(q.rang),
      question: String(q.question),
      options: Array.isArray(q.options) ? q.options.map((o) => String(o)) : [],
    }))
    // Le serveur trie déjà, mais l'ordre est TOUTE la sécurité de la correction : on ne délègue pas
    // à un `jsonb_agg` la garantie que la réponse d'une question ne sera pas notée sur une autre.
    .sort((a, b) => a.rang - b.rang);
}

/**
 * Envoyer ses réponses.
 *
 * `p_answers` EST UN TABLEAU, PAS UN OBJET, et l'indice compte. Lu dans le corps de
 * `rpc_submit_quiz` : elle boucle avec un compteur `v_pos` qui part de 0, et lit la réponse avec
 * `p_answers ->> v_pos`. Une question sans réponse doit donc porter `null` à sa place, pour ne pas
 * décaler les suivantes — une réponse décalée serait notée sur la mauvaise question, sans aucune
 * erreur visible.
 */
export async function envoyerQuiz(
  inscriptionId: string,
  reponses: (number | null)[],
): Promise<ResultatQuiz> {
  const { data, error } = await supabase.rpc("rpc_submit_quiz", {
    p_inscription_id: inscriptionId,
    p_answers: reponses,
  });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as {
    score?: number; pass?: boolean; correct?: number; total?: number; bonus_xp?: number;
    results?: { q_index?: number; correct_index?: number; given?: number | null; ok?: boolean }[];
  };
  return {
    score: Number(r.score ?? 0),
    reussi: r.pass === true,
    justes: Number(r.correct ?? 0),
    total: Number(r.total ?? 0),
    bonusXp: Number(r.bonus_xp ?? 0),
    corrections: (r.results ?? []).map((x) => ({
      rang: Number(x.q_index ?? 0),
      bonne: x.correct_index === undefined || x.correct_index === null ? null : Number(x.correct_index),
      donnee: x.given === undefined || x.given === null ? null : Number(x.given),
      juste: x.ok === true,
    })),
  };
}

export interface ResultatFin {
  dejaFait: boolean;
  xpGagnes: number;
  certifiee: boolean;
}

/**
 * Terminer une formation.
 *
 * ELLE REFUSE TANT QUE TOUT N'EST PAS FAIT, avec le compte exact (« Toutes les leçons ne sont pas
 * encore terminées (94 / 96) »). L'écran n'offre donc le bouton que quand `toutesFaites` est vrai,
 * et son message d'erreur reste celui du serveur : c'est lui qui compte, et il compte juste.
 */
export async function terminerFormation(inscriptionId: string): Promise<ResultatFin> {
  const { data, error } = await supabase.rpc("rpc_complete_formation", { p_inscription_id: inscriptionId });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { already_done?: boolean; xp_gagnes?: number; certified?: boolean };
  return {
    dejaFait: r.already_done === true,
    xpGagnes: Number(r.xp_gagnes ?? 0),
    certifiee: r.certified === true,
  };
}

// ── OUTILS D'AFFICHAGE ────────────────────────────────────────────────────────────────────────

/** « 7 août 2026 ». Les dates de certification sont des dates, pas des instants. */
export function dateCourte(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris",
  }).format(d);
}

/** « En ligne », « Hybride ». Les mots de l'OS, pas les valeurs brutes de la colonne. */
export function libelleType(type: string | null): string | null {
  if (type === "en_ligne") return "En ligne";
  if (type === "hybride") return "Hybride";
  return type;
}

/**
 * La recherche du catalogue, sans accents et sans casse.
 *
 * Même raison que dans le Centre : on tape « colorimetrie » d'une main, pas « colorimétrie ». Une
 * recherche qui exige l'accent ne trouve rien, et on croit que la formation n'existe pas.
 */
export function normaliser(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function formationCorrespond(f: Formation, requete: string): boolean {
  const q = normaliser(requete);
  if (!q) return true;
  return normaliser(`${f.titre} ${f.categorie ?? ""} ${f.niveau ?? ""} ${f.description ?? ""}`).includes(q);
}
