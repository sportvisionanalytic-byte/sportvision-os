// LES LIVRABLES, COTE OPERATEUR (01/10/2026).
//
// LE GESTE QUI MANQUAIT. Un photographe qui a fini une prestation dépose le lien de ses photos ou
// de sa vidéo. C'est ce dépôt qui déclenche la vérification par la production, puis la clôture de
// la mission, puis son paiement. Jusqu'ici l'application ne savait pas le faire : il fallait
// ouvrir un ordinateur. Tout ce fichier sert ce geste et les trois qui le suivent — voir l'état
// du lien, répondre à une correction, confirmer la sauvegarde.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUI A ETE MESURE AVANT D'ECRIRE UNE LIGNE (jeton d'Antoine Blin, role photo, pole Football)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
//  · `media_liens` porte 35 lignes en tout, sur 6 prestations : 26 `valide`, 8 `a_verifier`,
//    1 `correction_demandee`. Un seul lien n'a AUCUNE prestation (voir plus bas).
//  · Antoine lit 28 de ces 35 lignes, sur 4 prestations. Il en a déposé 27 ; LA VINGT-HUITIEME a
//    été déposée par Fouka. C'est pour cela qu'on ne filtre pas sur `ajouteur_id` (voir
//    `lireLiensDeMesMissions`).
//  · Il est affecté à 5 prestations, les cinq `acceptée`. L'une des cinq — SV-2026-3957, du 27/09,
//    `médias_complets` — ne porte AUCUN lien : c'est exactement la mission pour laquelle cet écran
//    existe, et elle n'apparaîtrait dans aucune liste bâtie sur les liens.
//  · Onze opérateurs sur treize n'ont jamais déposé un lien, et dix n'ont aucune affectation.
//    L'écran vide est donc le cas NORMAL, pas l'exception : il doit dire pourquoi il est vide.
//  · `fournisseur` vaut `autre` sur les 35 lignes : aucun écran ne le demande, celui-ci non plus.
//  · Répartition des catégories : `final` 15, `livraison` 14, `rushs` 5, `depot` 1.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUE LA RLS PERMET ET REFUSE EXACTEMENT, MESURE PAR LE CHEMIN REEL (transactions annulées)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Quatre policies pèsent sur `media_liens`. Deux permissives — `ml_read` (SELECT) et `ml_write`
// (ALL), toutes deux `is_staff() AND (prestation_id IS NULL OR prestation_pole_scope_ok(...))` —
// et deux restrictives : `compte_os_desactive_bloque` et `operateur_perim_media_liens`
// (`NOT est_operateur_terrain() OR prestation_id IS NULL OR operateur_affecte_prestation(...)`).
// `ml_write` n'a pas de `WITH CHECK` propre : c'est donc son `USING` qui sert aussi de contrôle à
// l'insertion.
//
//   PERMIS  · déposer un lien sur une prestation où il est affecté.
//   REFUSE  · déposer sur une prestation où il ne l'est pas → 42501, `operateur_perim_media_liens`.
//   PERMIS  · modifier l'adresse d'un lien de ses missions, et le remettre à `a_verifier`.
//   PERMIS  · cocher `transfert_confirme` après coup.
//   PERMIS  · supprimer un lien de ses missions.
//   MUET    · modifier un lien hors de ses missions : zéro ligne ET zéro erreur. C'est le faux
//             succès de la règle 4 du contrat, et c'est pourquoi chaque écriture d'ici finit par
//             `.select("id")` et lève si le tableau revient vide.
//
// TROIS CHOSES QUE LA BASE LAISSE PASSER ET QUE CET ECRAN N'OFFRE PAS. Mesurées, pas supposées :
//
//   1. `update media_liens set statut = 'valide'` PASSE avec le jeton d'Antoine. Un opérateur peut
//      donc valider sa propre livraison, ce qui lève la dernière condition de
//      `mission_cloture_manquant` et débloque la clôture — donc sa rémunération. Le verdict
//      appartient à la production (`notifier_decision_livraison` prévient d'ailleurs l'opérateur,
//      sauf quand c'est lui-même qui a changé le statut). L'application ne propose nulle part de
//      valider. Une migration est proposée, non appliquée.
//   2. `update media_liens set commentaire = '…'` PASSE : l'opérateur peut effacer le motif écrit
//      par la production. On ne touche donc jamais `commentaire` d'un lien existant — répondre à
//      une correction passe par un NOUVEAU lien, comme dans l'OS.
//   3. `insert` avec un `ajouteur_id` qui n'est pas le sien PASSE : rien ne contraint la colonne.
//      On y met toujours `auth.uid()`.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QU'ON NE REECRIT PAS (regle 3 du contrat)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
//  · LE PERIMETRE DE LECTURE : `operateur_perim_media_liens` borne déjà un opérateur aux liens des
//    prestations où il est affecté. L'écran n'ajoute aucun filtre de sécurité par-dessus.
//  · CE QUI BLOQUE LA CLOTURE : `mission_cloture_manquant` rend des phrases entières, écrites en
//    base. Quand on les montre, on les montre mot pour mot.
//  · LA PREUVE QU'UNE CARTE PEUT ETRE FORMATEE : `proteger_liberation_cartes` refuse la libération
//    tant que `fichiers_securises_at` est nul OU qu'aucun lien de la mission n'a
//    `transfert_confirme`. L'écran dit la règle, la base l'impose.
import { supabase } from "./supabase";

// ── Le vocabulaire de l'OS, mot pour mot ──────────────────────────────────────────────────────
//
// Ces trois tables sont celles de `SportVision-OS-Full.html` (`ML_STATUT`, `ML_CAT`, `ML_TYPE`).
// Elles vivent ICI et nulle part ailleurs : `prod/livraisons.tsx` en portait une copie partielle
// de quatre entrées sur sept, et une copie partielle d'un vocabulaire est un second vocabulaire
// qui dit moins. Une personne qui passe de l'ordinateur au téléphone doit retrouver les mêmes
// mots (règle 9).

/** `media_liens.statut`. Les onze valeurs de la contrainte `media_liens_statut_check`. */
export const LIBELLE_STATUT: Record<string, string> = {
  a_verifier: "À vérifier",
  valide: "Valide",
  acces_limite: "Accès limité",
  autorisation_requise: "Auth. requise",
  mdp_requis: "Mot de passe",
  expirant: "Expirant",
  expire: "Expiré",
  inaccessible: "Inaccessible",
  remplace: "Remplacé",
  archive: "Archivé",
  correction_demandee: "Correction demandée",
};

/** Le ton d'une pastille d'état. Les couleurs viennent de `Pastille`, jamais d'ici. */
export function tonStatut(statut: string): "neutre" | "succes" | "alerte" | "danger" {
  if (statut === "valide") return "succes";
  if (statut === "correction_demandee" || statut === "expire" || statut === "expirant"
    || statut === "inaccessible") return "danger";
  if (statut === "acces_limite" || statut === "autorisation_requise" || statut === "mdp_requis"
    || statut === "a_verifier") return "alerte";
  return "neutre";
}

/** `media_liens.categorie` (contrainte `media_liens_categorie_check`). */
export const LIBELLE_CATEGORIE: Record<string, string> = {
  depot: "Dépôt",
  rushs: "Rushs",
  travail: "Travail",
  previsualisation: "Prévisualisation",
  final: "Final",
  livraison: "Livraison",
  bibliotheque: "Bibliothèque",
};

/** `media_liens.type_media` (contrainte `media_liens_type_media_check`). */
export const LIBELLE_TYPE_MEDIA: Record<string, string> = {
  photo: "Photo",
  video: "Vidéo",
  audio: "Audio",
  drone: "Drone",
  veo: "Veo",
  graphisme: "Graphisme",
  canva: "Canva",
  document: "Document",
  mixte: "Mixte",
  autre: "Autre",
};

/**
 * LES TROIS CATEGORIES QU'UN OPERATEUR CHOISIT, ET PAS LES SEPT.
 *
 * `travail`, `previsualisation` et `bibliotheque` sont des rangements de la production et du
 * montage : zéro ligne en base sur les 35, et aucun écran opérateur de l'OS ne les propose.
 * Les proposer ici reviendrait à offrir trois mauvaises réponses pour une bonne.
 *
 * L'ordre et les explications sont ceux de l'OS, mot pour mot (`modalAjouterLien`).
 */
export const CATEGORIES_OPERATEUR: { cle: string; libelle: string; aide: string }[] = [
  { cle: "final", libelle: "Final", aide: "Le montage ou les photos livrés. Le seul qui remonte au club et aux familles." },
  { cle: "rushs", libelle: "Rushs", aide: "Les fichiers bruts que la Production récupère." },
  { cle: "livraison", libelle: "Livraison", aide: "Ce que vous remettez en plus : drone, Veo, photos d'un collègue, document." },
  { cle: "depot", libelle: "Dépôt", aide: "Un simple rangement. Ne va nulle part." },
];

/** Les types de média qu'un opérateur produit réellement, dans l'ordre de `modalAutreLien`. */
export const TYPES_OPERATEUR = ["photo", "video", "drone", "veo", "audio", "graphisme", "document", "autre"] as const;

// ── Mes missions, celles où je peux déposer ───────────────────────────────────────────────────

export interface MissionLivrable {
  /** L'identifiant de l'AFFECTATION. */
  affectationId: string;
  prestationId: string;
  reference: string;
  /** Le statut de la MISSION, pas de l'affectation. */
  statut: string;
  date: string | null;
  client: string | null;
  couverture: string | null;
  /** Ce que la personne a répondu à l'invitation. */
  reponse: string;
}

/**
 * Les missions sur lesquelles cette personne peut déposer un livrable.
 *
 * LE `collaborateur_id` EST INDISPENSABLE, ET CE N'EST PAS UNE COPIE DE LA RLS. Mesuré : avec le
 * jeton d'Antoine (`photo`), `prestations_equipe` rend 5 lignes, ses 5 — la RLS borne. Avec celui
 * de Mikael (`prod`, et affecté sur le terrain lui aussi), elle rend DIX lignes dont quatre
 * seulement sont les siennes : la restriction des opérateurs ne s'applique pas à un `prod`, et
 * `equipe_select` l'ouvre à tout son pôle. Sans ce filtre, « Mes livrables » lui présenterait les
 * missions de six autres personnes comme les siennes. Le filtre ne borne pas un droit, il pose une
 * AUTRE question : « lesquelles sont les miennes ». Même raisonnement que `os-planning.ts`.
 *
 * ON ECARTE LES AFFECTATIONS REFUSEES, ET C'EST LE SEUL FILTRE MÉTIER DE CET ECRAN. La base ne le
 * fait pas : `operateur_affecte_prestation` ne regarde que l'existence de la ligne, pas son
 * statut. Un opérateur qui a REFUSÉ une mission peut donc y déposer un lien — mesuré, l'insertion
 * passe. Ce n'est pas à nous de le corriger en base ici, mais l'écran ne doit pas y inviter.
 */
export async function lireMesMissionsLivrables(moiId: string): Promise<MissionLivrable[]> {
  const { data, error } = await supabase
    .from("prestations_equipe")
    .select(`id, prestation_id, statut,
             prestations ( reference, statut, date_prestation, couverture, clients ( nom ) )`)
    .eq("collaborateur_id", moiId)
    .neq("statut", "refusée")
    .order("created_at", { ascending: false });
  if (error) throw error;

  type Ligne = {
    id: string; prestation_id: string; statut: string | null;
    prestations: {
      reference: string | null; statut: string | null; date_prestation: string | null;
      couverture: string | null; clients: { nom: string | null } | null;
    } | null;
  };

  return ((data ?? []) as unknown as Ligne[])
    .filter((r) => r.prestations)
    .map((r) => ({
      affectationId: String(r.id),
      prestationId: String(r.prestation_id),
      reference: r.prestations!.reference ?? "",
      statut: String(r.prestations!.statut ?? ""),
      date: r.prestations!.date_prestation ?? null,
      client: r.prestations!.clients?.nom ?? null,
      couverture: r.prestations!.couverture ?? null,
      reponse: String(r.statut ?? ""),
    }))
    // La plus récente d'abord : c'est celle qu'on vient livrer. Les dates nulles en dernier.
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

// ── Les liens de mes missions ─────────────────────────────────────────────────────────────────

export interface MonLien {
  id: string;
  prestationId: string;
  nom: string;
  url: string;
  categorie: string | null;
  typeMedia: string | null;
  /** Un `null` se lit `a_verifier` : c'est la lecture de `mission_cloture_manquant` elle-même. */
  statut: string;
  /** Le motif écrit par la production quand elle demande une correction. Jamais réécrit par ici. */
  commentaire: string | null;
  transfertConfirme: boolean;
  nombreFichiers: number | null;
  depuis: string | null;
  /** Qui a déposé. Peut être quelqu'un d'autre que soi : mesuré, 1 lien sur 28 chez Antoine. */
  deposePar: string | null;
  /** Vrai quand c'est moi qui ai déposé : seul ce lien porte « par vous » à l'écran. */
  parMoi: boolean;
  /** Renseigné quand ce lien a été remplacé par un autre. */
  remplaceParId: string | null;
}

/**
 * Tous les liens des prestations passées en argument.
 *
 * ON NE FILTRE PAS SUR `ajouteur_id`, ET C'EST UNE CORRECTION VOLONTAIRE DE L'OS. L'écran « Mes
 * livrables » de l'OS lit `media_liens?ajouteur_id=eq.<moi>`. Mesuré : sur les 28 liens des
 * missions d'Antoine, 27 sont de lui et un de Fouka — qui dépose lui-même les liens que ses
 * opérateurs lui envoient en privé (c'est écrit dans l'OS, `enregistrerAutreLien`). Avec le filtre
 * de l'OS, une correction demandée sur CE lien-là resterait invisible pour Antoine, et sa mission
 * resterait bloquée sans qu'il sache pourquoi. Ce qui compte n'est pas qui a collé l'adresse, c'est
 * de quelle mission le lien parle.
 *
 * ON EXCLUT LES LIENS SANS PRESTATION, par l'`in` lui-même. `ml_read` et
 * `operateur_perim_media_liens` autorisent explicitement `prestation_id IS NULL` : mesuré, le lien
 * « Test 34 » de Fouka est lisible — et modifiable, et supprimable — par n'importe quel opérateur.
 * Ce n'est le livrable d'aucune mission ; il n'a rien à faire ici.
 */
export async function lireLiensDeMesMissions(prestationIds: string[], moiId: string): Promise<MonLien[]> {
  if (!prestationIds.length) return [];

  const { data, error } = await supabase
    .from("media_liens")
    .select(
      `id, prestation_id, nom, url, categorie, type_media, statut, commentaire,
       transfert_confirme, nombre_fichiers, remplace_par_id, ajouteur_id, created_at,
       profiles!media_liens_ajouteur_id_fkey ( prenom, nom )`,
    )
    .in("prestation_id", prestationIds)
    .order("created_at", { ascending: false });
  if (error) throw error;

  type Ligne = {
    id: string; prestation_id: string; nom: string | null; url: string | null;
    categorie: string | null; type_media: string | null; statut: string | null;
    commentaire: string | null; transfert_confirme: boolean | null;
    nombre_fichiers: number | null; remplace_par_id: string | null;
    ajouteur_id: string | null; created_at: string | null;
    profiles: { prenom: string | null; nom: string | null } | null;
  };

  return ((data ?? []) as unknown as Ligne[]).map((r) => ({
    id: String(r.id),
    prestationId: String(r.prestation_id),
    nom: r.nom?.trim() || "Lien sans nom",
    url: r.url ?? "",
    categorie: r.categorie ?? null,
    typeMedia: r.type_media ?? null,
    statut: r.statut ?? "a_verifier",
    commentaire: r.commentaire?.trim() || null,
    transfertConfirme: r.transfert_confirme === true,
    nombreFichiers: typeof r.nombre_fichiers === "number" ? r.nombre_fichiers : null,
    depuis: r.created_at ?? null,
    deposePar: [r.profiles?.prenom, r.profiles?.nom].filter(Boolean).join(" ").trim() || null,
    parMoi: r.ajouteur_id === moiId,
    remplaceParId: r.remplace_par_id ?? null,
  }));
}

// ── Les écritures ─────────────────────────────────────────────────────────────────────────────
//
// TOUTES FINISSENT PAR `.select("id")` ET LEVENT SI VIDE. Mesuré : un `update` hors périmètre rend
// zéro ligne et zéro erreur. Sans cette vérification, l'écran annoncerait « enregistré » alors que
// rien n'a bougé — le « ça n'enregistre pas » de Villemomble, règle 4 du contrat.

/** Le message d'un refus silencieux. Un seul texte, pour ne pas en avoir trois légèrement
 *  différents. Il dit ce qui s'est passé ET quoi faire, pas « erreur ». */
const REFUS = "Refusé par la base : cette mission n'est pas la vôtre, ou votre affectation a changé. "
  + "Tirez pour rafraîchir, puis prévenez la production si le lien reste absent.";

/**
 * Tracer ce qui a été fait, dans `media_historique`.
 *
 * MESURE ET NON SUPPOSEE : l'insertion PASSE avec le jeton d'Antoine, et la colonne s'appelle
 * `auteur_id` (pas `acteur_id`). L'OS écrit la même ligne pour chaque geste de l'opérateur.
 *
 * AU MIEUX, JAMAIS BLOQUANT. Le lien est déjà déposé quand on arrive ici : faire échouer le dépôt
 * parce que sa trace n'est pas partie serait faire disparaître un travail réel pour un journal.
 */
async function tracer(
  prestationId: string, moiId: string, action: string,
  lienId: string, avant: string | null, apres: string | null,
): Promise<void> {
  try {
    await supabase.from("media_historique").insert({
      prestation_id: prestationId, auteur_id: moiId, action,
      cible_type: "lien", cible_id: lienId,
      ancienne_valeur: avant, nouvelle_valeur: apres,
    });
  } catch { /* volontairement muet : voir l'en-tête */ }
}

export interface Depot {
  prestationId: string;
  nom: string;
  url: string;
  categorie: string;
  typeMedia: string;
  /** La case « mes fichiers sont copiés et vérifiés ». */
  transfertConfirme: boolean;
}

/**
 * Déposer un lien de livrable.
 *
 * `statut: 'a_verifier'` est posé explicitement, alors que c'est déjà le défaut de la colonne :
 * ce n'est pas un défaut technique qu'on répète, c'est la seule valeur que l'opérateur a le droit
 * de poser, et la voir écrite ici évite qu'on y mette un jour autre chose.
 *
 * `ajouteur_id` vaut toujours `moiId`. Mesuré : la base accepte l'identifiant de quelqu'un
 * d'autre, rien ne l'en empêche. On ne s'appuie pas là-dessus.
 */
export async function deposerLien(d: Depot, moiId: string): Promise<string> {
  const maintenant = new Date().toISOString();
  const { data, error } = await supabase
    .from("media_liens")
    .insert({
      prestation_id: d.prestationId,
      nom: d.nom.trim(),
      url: d.url.trim(),
      categorie: d.categorie,
      type_media: d.typeMedia,
      statut: "a_verifier",
      ajouteur_id: moiId,
      transfert_confirme: d.transfertConfirme,
      transfert_confirme_at: d.transfertConfirme ? maintenant : null,
    })
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || !data.length) throw new Error(REFUS);
  const id = String(data[0].id);
  await tracer(d.prestationId, moiId, "Lien ajouté depuis l'application", id, null, d.url.trim());
  return id;
}

/**
 * Redéposer : une nouvelle adresse sur le lien existant, qui repart à vérifier.
 *
 * C'est le chemin de l'OS (`enregistrerLivrable`), et son commentaire dit pourquoi le statut
 * repart : « la Production a validé un contenu qui n'est plus celui-là ».
 *
 * ON NE TOUCHE PAS `commentaire`. Le motif de la correction est le texte de la production, et il
 * doit rester lisible à côté de la nouvelle adresse — c'est ce qui permet de vérifier que la
 * demande a bien été traitée. Mesuré : l'opérateur POURRAIT l'écraser, la base l'accepte.
 */
export async function redeposerLien(
  lien: MonLien, nouvelleUrl: string, moiId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("media_liens")
    .update({
      url: nouvelleUrl.trim(),
      statut: "a_verifier",
      updated_at: new Date().toISOString(),
    })
    .eq("id", lien.id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || !data.length) throw new Error(REFUS);
  await tracer(lien.prestationId, moiId, "Lien modifié par l'opérateur", lien.id, lien.url, nouvelleUrl.trim());
}

/**
 * Répondre à une correction en expliquant, sans écraser le motif de la production.
 *
 * DEUX ECRITURES, ET C'EST LE MECANISME DE L'OS (`executerRemplacement`) : un NOUVEAU lien qui
 * porte le mot de l'opérateur dans son `commentaire`, et l'ancien qui passe à `remplace` en
 * désignant le nouveau par `remplace_par_id`. Mesuré : la chaîne complète passe avec le jeton
 * d'Antoine.
 *
 * POURQUOI PAS SIMPLEMENT ECRIRE DANS LE COMMENTAIRE DU LIEN EXISTANT. Parce que ce champ porte
 * le motif de la production, et qu'il n'y en a qu'un. Y répondre par-dessus effacerait la question
 * en même temps que la réponse, et la production relirait un lien sans savoir ce qu'elle avait
 * demandé.
 *
 * ET POURQUOI L'ANCIEN NE RESTE PAS EN L'ETAT. `mission_cloture_manquant` compte un lien en
 * `correction_demandee` comme un blocage de clôture. Laisser l'ancien tel quel laisserait la
 * mission bloquée par une demande déjà traitée. `remplace` n'est compté ni par `correction_demandee`
 * ni par `a_verifier` : la vérification porte sur le nouveau lien, et sur lui seul.
 *
 * ORDRE VOULU : on crée d'abord. Si la seconde écriture échoue, il reste un lien de trop à
 * vérifier — visible, corrigeable. Dans l'autre ordre, on aurait un lien marqué remplacé par rien.
 */
export async function repondreParRemplacement(
  lien: MonLien, nouvelleUrl: string, mot: string, moiId: string,
): Promise<void> {
  const maintenant = new Date().toISOString();

  const { data: cree, error: e1 } = await supabase
    .from("media_liens")
    .insert({
      prestation_id: lien.prestationId,
      nom: lien.nom,
      url: nouvelleUrl.trim(),
      categorie: lien.categorie,
      type_media: lien.typeMedia,
      statut: "a_verifier",
      ajouteur_id: moiId,
      // Le préfixe est celui de l'OS, mot pour mot : la production lit la même phrase qu'elle
      // lise l'ordinateur ou le téléphone.
      commentaire: `Remplacement: ${mot.trim()}`,
      transfert_confirme: lien.transfertConfirme,
      transfert_confirme_at: lien.transfertConfirme ? maintenant : null,
    })
    .select("id");
  if (e1) throw new Error(e1.message);
  if (!cree || !cree.length) throw new Error(REFUS);
  const nouveauId = String(cree[0].id);

  const { data: ancien, error: e2 } = await supabase
    .from("media_liens")
    .update({ statut: "remplace", remplace_par_id: nouveauId, updated_at: maintenant })
    .eq("id", lien.id)
    .select("id");
  if (e2) throw new Error(e2.message);
  if (!ancien || !ancien.length) {
    throw new Error(
      "Le nouveau lien est bien parti, mais l'ancien n'a pas pu être marqué remplacé. "
      + "La production verra les deux : dites-lui lequel compte.",
    );
  }

  await tracer(lien.prestationId, moiId, "Lien remplacé", lien.id, lien.url, nouvelleUrl.trim());
}

/**
 * Confirmer la sauvegarde d'un lien : « mes fichiers sont copiés et vérifiés ».
 *
 * C'EST LA SEULE PREUVE QU'UNE CARTE PEUT ETRE FORMATEE, et ce n'est pas une formule. Deux règles
 * en base s'appuient sur cette colonne, et sur elle seule :
 *
 *   · `mission_cloture_manquant` : sans un lien `transfert_confirme` sur la mission, elle rend la
 *     phrase « Sauvegarde non confirmée par l'opérateur (il doit cocher « fichiers copiés et
 *     vérifiés ») », et la mission ne peut pas être close.
 *   · `proteger_liberation_cartes` : elle REFUSE `cartes_liberees_at` tant qu'aucun lien de la
 *     mission n'a `transfert_confirme`, avec ce message — « aucune livraison de cette mission n'a
 *     de transfert confirmé. Sécurisez une seconde copie avant de préparer les cartes. »
 *
 * MESURE QUI JUSTIFIE UN GESTE APRES COUP : 8 des 9 liens qui attendent la production, et 2 sur 8
 * seulement portent `transfert_confirme`. Six liens réels ont donc été déposés sans cocher la case.
 * L'OS a dû ajouter ce rattrapage le 13/09 pour la même raison : « un oubli au moment de coller le
 * lien ne doit pas bloquer la mission pour toujours ».
 *
 * UN SEUL LIEN A LA FOIS, ET PAS LA MISSION ENTIERE. L'OS coche d'un coup tous les liens de la
 * mission (`confirmerTransfertMission`). C'est une déclaration sur des fichiers : la faire à la
 * place d'un lien qu'on n'a pas regardé, c'est déclarer en sécurité une copie qu'on n'a pas
 * vérifiée. Ici on confirme le lien qu'on touche, et la base n'en demande qu'un.
 */
export async function confirmerSauvegarde(lien: MonLien, moiId: string): Promise<void> {
  const maintenant = new Date().toISOString();
  const { data, error } = await supabase
    .from("media_liens")
    .update({ transfert_confirme: true, transfert_confirme_at: maintenant, updated_at: maintenant })
    .eq("id", lien.id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || !data.length) throw new Error(REFUS);
  await tracer(lien.prestationId, moiId, "Sauvegarde confirmée par l'opérateur", lien.id, null, null);
}

// ── Ce qui se vérifie avant d'envoyer ─────────────────────────────────────────────────────────

/**
 * L'adresse d'un livrable.
 *
 * `url` est NOT NULL en base et sans contrainte de forme : une chaîne vide y passerait, et la
 * production ouvrirait un lien vide. On exige donc `http`, comme l'OS (« URL invalide (doit
 * commencer par https://) »), et on le dit avant d'envoyer plutôt qu'après.
 */
export function problemeAdresse(url: string): string | null {
  const v = url.trim();
  if (!v) return "L'adresse est obligatoire : c'est elle que la production va ouvrir.";
  if (!/^https?:\/\/\S+$/i.test(v)) return "L'adresse doit commencer par https:// et ne pas contenir d'espace.";
  return null;
}

/** `nom` est NOT NULL en base. Le texte du refus est celui de l'OS, mot pour mot. */
export function problemeNom(nom: string): string | null {
  if (!nom.trim()) return "Dites ce que contient ce lien : la Production doit savoir ce qu'elle ouvre.";
  return null;
}
