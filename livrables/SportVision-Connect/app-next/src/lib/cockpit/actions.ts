// Les « Actions à traiter » du CM, à partir des compteurs de la base.
//
// Une fonction pure, testée seule (__tests__/actions.test.ts) : la base compte, cet écran
// décide seulement du niveau, du texte et de l'endroit où l'on résout. Aucun chiffre n'est
// recalculé ici — sinon deux écrans finiraient par compter différemment la même chose.
//
// Les trois niveaux (demande de Fouka, 10/09/2026) :
//   URGENT       ce qui a une échéance dans les jours qui viennent ;
//   À FAIRE      ce qui attend le CM, sans échéance immédiate ;
//   INFORMATION  ce qui attend quelqu'un d'autre, ou une donnée à compléter sans urgence.
// Une ligne n'apparaît que si son compteur est positif : « 0 invitation » n'est pas une action.

export type NiveauAction = "urgent" | "a_faire" | "information";

export interface ActionCm {
  cle: string;
  niveau: NiveauAction;
  texte: string;
  vers: string;
  nombre: number;
}

export interface CompteursAFaire {
  demandes_du_club: number;
  demandes_urgentes?: number;
  resultats_manquants: number;
  resultats_recents?: number;
  equipes_sans_coach: number;
  invitations_preparees?: number;
  invitations_en_attente?: number;
  joueurs_sans_droit_image?: number;
  contenus_a_valider?: number;
  contenus_a_valider_proches?: number;
  souhaits_couverture?: number;
}

export interface ProblemeSante {
  code: string;
  niveau: "a_faire" | "information";
  nombre: number;
  texte: string;
  lien: string;
}

export interface StatutLancement {
  statut: "en_preparation" | "pret" | "actif";
  sections_manquantes: string[];
  invitations_preparees: number;
}

const ORDRE: Record<NiveauAction, number> = { urgent: 0, a_faire: 1, information: 2 };

/** « 3 demandes », « 1 demande ». Les pluriels irréguliers passent leur forme explicitement. */
export function pluriel(n: number, singulier: string, plurielForme = `${singulier}s`): string {
  return `${n} ${n > 1 ? plurielForme : singulier}`;
}

/** Les problèmes de santé qui ont déjà leur ligne dans les compteurs : on ne les répète pas. */
const DEJA_COMPTES = new Set(["equipes_sans_coach", "joueurs_sans_droit_image", "identite"]);

export function construireActions(
  a: CompteursAFaire,
  lancement: StatutLancement | null,
  problemes: ProblemeSante[] = [],
): ActionCm[] {
  const actions: ActionCm[] = [];
  const ajouter = (x: ActionCm) => {
    if (x.nombre > 0) actions.push(x);
  };

  const urgentes = a.demandes_urgentes ?? 0;
  const recents = a.resultats_recents ?? 0;
  const validationsProches = a.contenus_a_valider_proches ?? 0;

  // ── Urgent ──
  ajouter({ cle: "demandes_urgentes", niveau: "urgent", nombre: urgentes, vers: "/requests",
    texte: `${pluriel(urgentes, "demande urgente", "demandes urgentes")} du club` });
  ajouter({ cle: "validations_proches", niveau: "urgent", nombre: validationsProches, vers: "/content",
    texte: `${pluriel(validationsProches, "contenu")} à valider avant sa publication` });
  ajouter({ cle: "resultats_recents", niveau: "urgent", nombre: recents, vers: "/matchcenter",
    texte: `${pluriel(recents, "résultat")} des derniers jours à renseigner` });

  // ── À faire ──
  if (lancement?.statut === "pret") {
    actions.push({ cle: "lancer", niveau: "a_faire", nombre: 1, vers: "/onboarding?section=lancement",
      texte: "Le club est prêt : vous pouvez le lancer" });
  } else if (lancement?.statut === "en_preparation" && lancement.sections_manquantes.length > 0) {
    actions.push({ cle: "onboarding", niveau: "a_faire", nombre: lancement.sections_manquantes.length,
      vers: "/onboarding",
      texte: `Onboarding incomplet : ${lancement.sections_manquantes.join(", ")}` });
  }
  ajouter({ cle: "coachs", niveau: "a_faire", nombre: a.equipes_sans_coach, vers: "/teams?filtre=sans_coach",
    texte: `${pluriel(a.equipes_sans_coach, "équipe")} sans coach` });
  // Avant le lancement, une invitation préparée n'attend rien : elle partira avec le lancement.
  // Après, elle attend que le CM l'envoie.
  if (lancement?.statut === "actif") {
    const prep = a.invitations_preparees ?? 0;
    ajouter({ cle: "invitations_preparees", niveau: "a_faire", nombre: prep, vers: "/invitations",
      texte: `${pluriel(prep, "invitation préparée", "invitations préparées")}, pas encore ${prep > 1 ? "envoyées" : "envoyée"}` });
  }
  const anciens = Math.max(0, a.resultats_manquants - recents);
  ajouter({ cle: "resultats", niveau: "a_faire", nombre: anciens, vers: "/matchcenter",
    texte: `${pluriel(anciens, "résultat")} à renseigner` });
  const image = a.joueurs_sans_droit_image ?? 0;
  ajouter({ cle: "droit_image", niveau: "a_faire", nombre: image, vers: "/teams?filtre=image",
    texte: `${pluriel(image, "joueur")} sans droit à l'image validé` });
  const demandes = Math.max(0, a.demandes_du_club - urgentes);
  ajouter({ cle: "demandes", niveau: "a_faire", nombre: demandes, vers: "/requests",
    texte: `${pluriel(demandes, "demande")} du club à traiter` });
  const aValider = Math.max(0, (a.contenus_a_valider ?? 0) - validationsProches);
  ajouter({ cle: "contenus", niveau: "a_faire", nombre: aValider, vers: "/content",
    texte: `${pluriel(aValider, "contenu")} en attente de validation` });
  const couverture = a.souhaits_couverture ?? 0;
  ajouter({ cle: "presences", niveau: "a_faire", nombre: couverture, vers: "/presences",
    texte: `${pluriel(couverture, "présence SportVision", "présences SportVision")} à préparer` });

  // ── Information ──
  const attente = a.invitations_en_attente ?? 0;
  ajouter({ cle: "invitations_attente", niveau: "information", nombre: attente, vers: "/invitations",
    texte: `${pluriel(attente, "invitation envoyée", "invitations envoyées")}, sans réponse pour l'instant` });
  if (lancement && lancement.statut !== "actif") {
    ajouter({ cle: "invitations_au_lancement", niveau: "information", nombre: lancement.invitations_preparees,
      vers: "/invitations",
      texte: `${pluriel(lancement.invitations_preparees, "invitation préparée", "invitations préparées")} : ${lancement.invitations_preparees > 1 ? "elles partiront" : "elle partira"} au lancement` });
  }

  for (const p of problemes) {
    if (DEJA_COMPTES.has(p.code)) continue;
    ajouter({ cle: `sante_${p.code}`, niveau: p.niveau, nombre: Math.max(1, p.nombre), vers: p.lien, texte: p.texte });
  }

  return actions.sort((x, y) => ORDRE[x.niveau] - ORDRE[y.niveau]);
}
