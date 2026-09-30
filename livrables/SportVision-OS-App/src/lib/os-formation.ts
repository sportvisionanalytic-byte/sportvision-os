// LE CENTRE DE FORMATION, VU DE L'APPLICATION (30/09/2026).
//
// CE QUI EST EN BASE, ET CE QUI N'Y EST PAS. Mesuré avant d'écrire une ligne, parce que la
// réponse change tout :
//
//   · EN BASE, et réel : `formation_inscriptions` (65 lignes, 9 personnes),
//     `formation_progression` (1 319 leçons validées), `formation_rewards` (108 formations avec
//     leur nombre de leçons, leur XP et leur certification), `collaborateur_certifications`
//     (30 certifications nommées, numérotées, datées), `profiles.xp` / `profiles.grade`.
//   · PAS EN BASE : le CONTENU du catalogue. Les titres, les catégories, les durées, les modules
//     et les leçons des 108 formations vivent dans `SportVision-OS-Full.html`, dans une constante
//     JavaScript (`FORMATIONS_CATALOG`). Une seule formation est en base, dans
//     `formations_custom`.
//
// CONSÉQUENCE ASSUMÉE : CETTE APPLICATION NE SERT PAS DE LEÇON. Pas de catalogue, pas de module,
// pas de quiz. Ce n'est pas un choix de confort, c'est ce que la base permet : les questions de
// quiz sont dans `formation_quiz_questions`, dont la policy `fqq_admin_select` réserve la lecture
// au seul rôle 'admin' — mesuré avec le jeton d'Antoine (opérateur) : 0 ligne sur 1 133. Et
// `rpc_get_custom_quiz` lit `formations_quiz_custom`, qui est vide (0 ligne). Un écran de quiz
// n'aurait donc aucune question à poser.
//
// CE QUE L'ÉCRAN FAIT, ALORS : il répond à « où j'en suis ». Mon grade, mon XP, mes formations
// commencées et terminées avec leur avancement réel, et mes certifications avec leur date
// d'expiration. C'est exactement ce qu'on vient vérifier depuis un téléphone ; on ne suit pas un
// module de 96 leçons debout.
//
// L'XP, LES CERTIFICATIONS ET LES QUIZ SONT CALCULÉS PAR LE SERVEUR, ET ON NE LES RECALCULE PAS.
// Lu dans le corps des fonctions, pas dans leur en-tête :
//   · `rpc_complete_formation` vérifie que toutes les leçons sont faites, crédite `xp_events` et
//     `profiles.xp`, puis crée la certification avec son numéro. Elle n'accorde l'XP QUE si
//     `profiles.role = 'photo'`.
//   · `rpc_submit_quiz` corrige, pose le seuil à 70 %, et verse un bonus de 30 % de l'XP.
//   · un trigger, `protect_sensitive_formation_inscription_fields`, refuse qu'un collaborateur
//     modifie ses propres `xp_gagnes`.
// L'écran lit donc des résultats. Il n'en produit aucun : aucune écriture dans ce fichier.
import { supabase } from "./supabase";

// ── LES NOMS DES FORMATIONS ───────────────────────────────────────────────────────────────────
//
// UN DICTIONNAIRE DE NOMS, ET RIEN D'AUTRE. Ces 108 lignes sont recopiées de
// `FORMATIONS_CATALOG` dans `SportVision-OS-Full.html`, parce que la base ne sait pas nommer une
// formation : `formation_rewards` en connaît l'identifiant, le nombre de leçons et l'XP, mais pas
// le titre. Sans ce dictionnaire, l'écran afficherait « cert-photo-video-complet » à un opérateur.
//
// CE QU'IL NE CONTIENT SURTOUT PAS : aucun XP, aucun nombre de leçons, aucun « obligatoire ». Ces
// trois-là sont des RÈGLES, elles vivent en base, et les recopier ici en ferait une seconde
// version qui finirait par mentir. Le nombre d'XP du catalogue HTML et celui de
// `formation_rewards` divergent déjà aujourd'hui (« Culture & standards SportVision » : 25 dans le
// HTML, 10 en base, et c'est 10 qui est crédité) : preuve que deux sources d'un même nombre
// donnent deux vérités. On n'en ajoute pas une troisième.
//
// LE RISQUE, DIT : une formation créée après le 30/09/2026 ne sera pas dans ce dictionnaire. Elle
// s'affichera alors sous son identifiant, avec une mention claire — pas sous un nom inventé. Une
// formation publiée depuis l'OS arrive, elle, avec son titre depuis `formations_custom`, qui passe
// devant ce dictionnaire.
const TITRES: Record<string, string> = {
  "sv-culture": "Culture & standards SportVision",
  "sv-securite": "Sécurité et gestion du matériel",
  "sv-comportement": "Comportement en prestation",
  "photo-bases": "Bases de la photographie sportive",
  "cert-photo-video-complet": "Photographe-Vidéaste Sportif Complet",
  "cert-responsable-production-complet": "Responsable Production Complet",
  "cert-commercial-complet": "Commercial SportVision Complet",
  "cert-secretaire-complet": "Secrétaire SportVision Complet",
  "photo-sony-a7": "Maîtrise du Sony A7 IV",
  "sec-crm-05": "Secrétariat 05 — Gestion des fiches clients et portefeuille administratif",
  "cm-sport-01": "Community management sportif",
  "content-sport-01": "Création de contenus sportifs pour les réseaux sociaux",
  "design-sport-01": "Création de visuels sportifs",
  "mont-capcut-01": "Montage vidéo sportif rapide sur CapCut",
  "fusion-motion-sport-01": "Fusion et motion design sportif sur DaVinci Resolve",
  "photo-ret-01": "Retouche photo sportive professionnelle",
  "photo-ret-adv-01": "Retouche photo sportive avancée",
  "lead-terrain-01": "Responsable de prestation terrain",
  "prod-tournoi-01": "Production de tournoi et événement sportif complexe",
  "stab-gimbal-01": "Maîtrise du stabilisateur",
  "light-acc-01": "Gestion de la lumière et des accessoires",
  "pv-avance-01": "Workflow professionnel : ranger, nommer, sauvegarder et livrer sans perdre de temps",
  "pv-avance-02": "Tri photo ultra-rapide : sélectionner les images fortes sans surcharger la livraison",
  "pv-avance-03": "Sélection des rushs : dérusher vite et construire une banque de plans utile",
  "pv-avance-04": "CapCut Desktop : maîtriser l'interface et monter deux fois plus vite",
  "pv-avance-05": "Storytelling sportif : raconter une histoire au lieu d'empiler des actions",
  "pv-avance-06": "Rythme, musique, beat cuts et speed ramp pour les contenus sportifs",
  "pv-avance-07": "Sound design et mixage : donner de la puissance sans saturer",
  "pv-avance-08": "Keyframes, masques, tracking et effets avancés dans CapCut",
  "pv-avance-09": "Colorimétrie vidéo : corriger, harmoniser et créer un look SportVision",
  "pv-avance-10": "Sous-titres, typographie, habillage et exports sociaux",
  "pv-avance-11": "Filmer l'action sportive : anticipation, réglages et placements",
  "pv-avance-12": "Construire une shot list complète pour match, entraînement, tournoi et stage",
  "pv-avance-13": "Interview, témoignage et face caméra : image, lumière et son",
  "pv-avance-14": "Photographie sportive avancée : action, émotion, netteté et composition",
  "pv-avance-15": "Media Day d'équipe : organiser un shooting complet avant saison",
  "pv-avance-16": "Shooting individuel joueur : portrait, personnalité et contenus de pré-saison",
  "pv-avance-17": "Créer une banque de contenus club pour toute la saison",
  "pv-avance-18": "Créer une affiche avant-match et un flyer communicatif dans Canva",
  "pv-avance-19": "Animer une affiche et créer un teaser de match dans CapCut",
  "pv-avance-20": "Qualité, livraison, droit à l'image et contrôle final",
  "pv-avance-21": "Projet final : produire une campagne complète SportVision de A à Z",
  "sec-avance-01": "Comprendre le nouvel écosystème SportVision",
  "sec-avance-02": "Utilisateurs, organisations, rôles et onboarding",
  "sec-avance-03": "CRM, qualification et suivi commercial",
  "sec-avance-04": "Parcours d'une prestation ponctuelle",
  "sec-avance-05": "Gérer Club+ Start et Club+ Performance",
  "sec-avance-06": "Full Communication et accompagnements spécialisés",
  "sec-avance-07": "Contract Center et Yousign",
  "sec-avance-08": "Stripe, paiements, factures et impayés",
  "sec-avance-09": "Communication Hub : e-mails, WhatsApp et notifications",
  "sec-avance-10": "Google Agenda et coordination opérationnelle",
  "sec-avance-11": "Documents, fichiers et livraisons",
  "sec-avance-12": "Sécurité, RGPD et gestion d'incident",
  "sec-avance-13": "Spécialisation : gestion avancée d'agenda",
  "sec-avance-14": "Spécialisation : recrutement et intégration administrative",
  "sec-avance-15": "Projet final de certification",
  "cm-avance-01": "Maîtriser le nouvel écosystème SportVision",
  "cm-avance-02": "Onboarding client, accès sociaux et sécurité",
  "cm-avance-03": "Audit social media et stratégie par profil",
  "cm-avance-04": "Identité visuelle, Canva et bibliothèque de modèles",
  "cm-avance-05": "Piliers de contenu et calendrier éditorial",
  "cm-avance-06": "Brief de production et collaboration photo-vidéo",
  "cm-avance-07": "Copywriting sportif, hooks et appels à l'action",
  "cm-avance-08": "Montage social media avancé avec CapCut",
  "cm-avance-09": "Maîtrise des plateformes : Instagram, TikTok, Facebook et Shorts",
  "cm-avance-10": "Programmation, Meta Business Suite et Metricool",
  "cm-avance-11": "Animation de communauté, commentaires, DM et WhatsApp",
  "cm-avance-12": "KPI, reporting et amélioration continue",
  "cm-avance-13": "Événements, sponsors, contenus en direct et gestion de crise",
  "cm-avance-14": "Qualité, capacité, automatisation et rôle de Lead CM",
  "cm-avance-15": "Projet final de certification",
  "prod-avance-01": "Maîtriser le rôle de Responsable Production",
  "prod-avance-02": "Planification, capacité et attribution des missions",
  "prod-avance-03": "Préproduction, brief et conducteur de mission",
  "prod-avance-04": "Management des opérateurs et freelances",
  "prod-avance-05": "Gestion des kits, du matériel et de la maintenance",
  "prod-avance-06": "Pilotage terrain des matchs, shootings et événements",
  "prod-avance-07": "Ingest, sauvegarde et organisation des fichiers",
  "prod-avance-08": "Contrôle qualité photo, vidéo, son et exports",
  "prod-avance-09": "Orchestration de la postproduction",
  "prod-avance-10": "Livraison dans Connect et validation client",
  "prod-avance-11": "Gestion des incidents et continuité de production",
  "prod-avance-12": "KPI, qualité, marge et pilotage de performance",
  "prod-avance-13": "Sécurité, RGPD, droits à l'image et données sensibles",
  "prod-avance-14": "Leadership, formation et amélioration continue",
  "prod-avance-15": "Projet final de certification",
  "cm-complet-01": "Rôle du Community Manager SportVision et écosystème OS / Connect",
  "cm-complet-02": "Onboarding d'un club et relation client professionnelle",
  "cm-complet-03": "Audit complet des réseaux sociaux d'un club",
  "cm-complet-04": "Stratégie social media d'un club : objectifs, cibles et piliers",
  "cm-complet-05": "Identité visuelle et design system pour les réseaux du club",
  "cm-complet-06": "Calendrier éditorial d'une saison sportive",
  "cm-complet-07": "Production de contenu terrain et coordination avec l'équipe",
  "cm-complet-08": "Copywriting, storytelling, hooks et appels à l'action",
  "cm-complet-09": "Canva avancé : production rapide et cohérente",
  "cm-complet-10": "CapCut avancé : montage vidéo court, dynamique et professionnel",
  "cm-complet-11": "Instagram : Reels, carrousels, stories et recommandations",
  "cm-complet-12": "TikTok : fil Pour toi, formats, tendances et SEO",
  "cm-complet-13": "Facebook, Meta Business Suite et gestion des accès",
  "cm-complet-14": "YouTube Shorts et adaptation multi-plateforme",
  "cm-complet-15": "Metricool complet : planification, analyses, inbox, concurrence et rapports",
  "cm-complet-16": "Community management : commentaires, messages, modération et proximité",
  "cm-complet-17": "Sponsors, Matchday, tournois et contenus en direct",
  "cm-complet-18": "Algorithmes, KPI, reporting et amélioration continue",
  "cm-complet-19": "Sécurité, droits à l'image, mineurs et gestion de crise",
  "cm-complet-20": "Organisation multi-clients, outils, automatisation et niveau Lead CM",
  "cm-complet-21": "Projet final de certification - Gestion complète des réseaux d'un club",
};

// ── LES GRADES ────────────────────────────────────────────────────────────────────────────────
//
// Recopiés de `GRADES_DEF` dans l'OS, pour la même raison que les titres : le grade d'une personne
// est en base (`profiles.grade`, un entier), son NOM n'y est pas.
//
// ET C'EST LE GRADE ACCORDÉ QUI S'AFFICHE, PAS CELUI QUE L'XP PERMETTRAIT. L'OS le dit dans son
// propre code : le grade est validé par l'administration (`grade_valide_at`, `grade_valide_par`),
// il ne se déclenche pas tout seul au franchissement d'un seuil. Afficher un grade calculé
// contredirait le verrouillage des formations, qui lit `profiles.grade`.
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

export interface MaFormation {
  formationId: string;
  titre: string;
  /** Vrai quand le titre vient de la base (`formations_custom`) et non du dictionnaire. */
  titreDeLaBase: boolean;
  /** Vrai quand on n'a aucun nom : l'écran affiche alors l'identifiant et le dit. */
  sansNom: boolean;
  terminee: boolean;
  leconsFaites: number;
  /** Le nombre de leçons attendu par le serveur (`formation_rewards.total_lecons`). */
  leconsTotal: number | null;
  avancement: number;
  /** L'XP réellement crédité, tel que la base l'a enregistré. Jamais un calcul d'écran. */
  xpCredite: number;
  scoreQuiz: number | null;
  quizReussi: boolean;
  termineeLe: string | null;
  certifiante: boolean;
}

export interface MaCertification {
  id: string;
  code: string;
  nom: string;
  badge: string | null;
  /** Le titre de la formation qui l'a délivrée, quand on sait le nommer. */
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
  formations: MaFormation[];
  certifications: MaCertification[];
  /** Combien de formations terminées, sur combien de commencées. */
  terminees: number;
  enCours: number;
  /** Combien de certifications encore valides. */
  certificationsActives: number;
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

/**
 * Tout ce que l'écran Formation affiche, en une lecture.
 *
 * ON FILTRE SUR SON PROPRE IDENTIFIANT, ET C'EST INDISPENSABLE ICI. Ce n'est pas la même situation
 * que les missions, où la RLS bornait déjà chacun à ses lignes : `fi_own_read` dit
 * « (collaborateur_id = auth.uid()) OR role IN ('admin','prod') », et `cc_own_read` dit la même
 * chose. Mesuré : sans ce filtre, Mikael (responsable production) verrait les 65 inscriptions de
 * l'équipe sur son écran « Mes formations », et les 30 certifications de tout le monde. La base a
 * raison de les lui ouvrir — c'est son travail de les voir — mais pas sur CET écran-là.
 */
export async function lireParcours(moiId: string, role: string | null): Promise<Parcours> {
  const [profil, inscriptions, recompenses, personnalisees, certifs] = await Promise.all([
    supabase.from("profiles").select("xp, grade").eq("id", moiId).maybeSingle(),
    supabase
      .from("formation_inscriptions")
      .select("id, formation_id, statut, xp_gagnes, score_quiz, quiz_passe, completed_at, formation_progression(lecon_key)")
      .eq("collaborateur_id", moiId),
    supabase.from("formation_rewards").select("formation_id, total_lecons, certification_id"),
    supabase.from("formations_custom").select("id, titre"),
    supabase
      .from("collaborateur_certifications")
      .select("id, code_certification, nom, badge, formation_id, date_obtention, date_expiration, statut, numero_certificat")
      .eq("collaborateur_id", moiId)
      .order("date_obtention", { ascending: false }),
  ]);

  for (const r of [profil, inscriptions, recompenses, personnalisees, certifs]) {
    if (r.error) throw r.error;
  }

  type LigneRecompense = { formation_id: string; total_lecons: number | null; certification_id: string | null };
  const parFormation = new Map<string, LigneRecompense>();
  for (const r of (recompenses.data ?? []) as unknown as LigneRecompense[]) {
    parFormation.set(String(r.formation_id), r);
  }

  type LignePerso = { id: string; titre: string | null };
  const titresBase = new Map<string, string>();
  for (const f of (personnalisees.data ?? []) as unknown as LignePerso[]) {
    const t = (f.titre ?? "").trim();
    if (t) titresBase.set(String(f.id), t);
  }

  function nommer(id: string): { titre: string; titreDeLaBase: boolean; sansNom: boolean } {
    const base = titresBase.get(id);
    if (base) return { titre: base, titreDeLaBase: true, sansNom: false };
    const connu = TITRES[id];
    if (connu) return { titre: connu, titreDeLaBase: false, sansNom: false };
    return { titre: id, titreDeLaBase: false, sansNom: true };
  }

  type LigneInscription = {
    id: string; formation_id: string; statut: string | null; xp_gagnes: number | null;
    score_quiz: number | null; quiz_passe: boolean | null; completed_at: string | null;
    formation_progression: { lecon_key: string }[] | null;
  };

  const formations: MaFormation[] = ((inscriptions.data ?? []) as unknown as LigneInscription[])
    .map((i) => {
      const rec = parFormation.get(String(i.formation_id));
      const faites = (i.formation_progression ?? []).length;
      const total = rec?.total_lecons ?? null;
      // L'AVANCEMENT SE COMPTE, IL NE SE LIT PAS. `formation_inscriptions.progression_pct` existe,
      // mais il est faux sur au moins une ligne mesurée le 30/09 : Bhajneet sur « Maîtrise du
      // stabilisateur », 8 leçons sur 8 faites et pourtant 88 %. L'OS fait la même division —
      // leçons validées sur `total_lecons` du serveur — et c'est elle qui fait foi.
      const avancement = total && total > 0
        ? Math.max(0, Math.min(100, Math.round((faites / total) * 100)))
        : 0;
      return {
        formationId: String(i.formation_id),
        ...nommer(String(i.formation_id)),
        terminee: i.statut === "terminee",
        leconsFaites: faites,
        leconsTotal: total,
        avancement,
        xpCredite: i.xp_gagnes ?? 0,
        scoreQuiz: i.score_quiz ?? null,
        quizReussi: i.quiz_passe === true,
        termineeLe: i.completed_at ?? null,
        certifiante: !!rec?.certification_id,
      };
    })
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
      parFormation: c.formation_id ? (titresBase.get(c.formation_id) ?? TITRES[c.formation_id] ?? null) : null,
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

  const xp = ((profil.data as { xp?: number | null } | null)?.xp) ?? 0;
  const indice = ((profil.data as { grade?: number | null } | null)?.grade) ?? 0;

  return {
    // Décision de l'OS, reprise telle quelle : seuls les photographes-vidéastes ont un parcours
    // XP/grade, parce qu'eux seuls ont des missions terrain notées. Pour les autres, afficher un
    // grade « Débutant » à 0 XP serait un jugement, pas une information.
    parcoursXp: role === "photo",
    xp,
    grade: grade(indice, xp),
    formations,
    certifications,
    terminees: formations.filter((f) => f.terminee).length,
    enCours: formations.filter((f) => !f.terminee).length,
    certificationsActives: certifications.filter((c) => c.statut !== "expiree").length,
  };
}

/** « 7 août 2026 ». Les dates de certification sont des dates, pas des instants. */
export function dateCourte(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris",
  }).format(d);
}
