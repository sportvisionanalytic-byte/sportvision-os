// MON PROFIL, ET CE QUE LA BASE ACCEPTE VRAIMENT QU'ON Y CHANGE (01/10/2026).
//
// Fouka, ce matin : « quand je vais dans mon profil, je peux même pas modifier mon profil, je peux
// même pas modifier mes informations. Ajouter une photo de profil. » L'écran `profil.tsx` portait
// en en-tête « AUCUN FORMULAIRE, ET C'EST INCHANGÉ ». Ce n'était pas la base qui refusait.
//
// == CE QUI A ÉTÉ MESURÉ, COLONNE PAR COLONNE ==================================================
//
// Avec le jeton d'Antoine Blin (`photo`), `set local role authenticated`, un `update` par colonne,
// transaction annulée à chaque fois. Le déclencheur `protect_sensitive_profile_fields` répond par
// une exception nommée quand il refuse, donc il n'y a aucun doute sur le verdict :
//
//   ACCEPTÉ, et la valeur reste : prenom, nom, telephone, bio, avatar_url, zone,
//                                 materiel_personnel, portfolio_url, email, notification_prefs
//   REFUSÉ (exception)           : role, grade, actif, type_contrat, niveau_cm,
//                                 cm_niveau_autonomie, cm_pool_clubplus_general, niveau_operateur
//
// Attention au faux positif que j'ai failli garder : `niveau_operateur = 3` est passé, tout
// simplement parce qu'Antoine valait déjà 3 et que le déclencheur teste `is distinct from`. Avec
// la valeur 1, il refuse — « le niveau d'opérateur fixe la rémunération recommandée ». Une mesure
// qui ne CHANGE rien ne mesure rien.
//
// == LE PIÈGE : CINQ COLONNES QUI RÉPONDENT « 1 LIGNE MODIFIÉE » ET NE GARDENT RIEN =============
//
// `adresse`, `code_postal`, `ville`, `vehicule` et `permis` existent toujours dans `profiles`, et
// un `update` dessus rend bien 1 ligne, sans erreur. Puis la valeur relue vaut NULL. Deux
// déclencheurs, `rediriger_adresse_hors_profiles` et `rediriger_logistique_hors_profiles`, les
// recopient dans `collaborateur_coordonnees` et `collaborateur_logistique` puis posent `new.x` à
// NULL. Mesuré sur les 19 profils : `adresse` et `ville` valent NULL partout dans `profiles`, et
// les deux tables à côté portent 5 et 6 lignes.
//
// C'est exactement le faux succès de la règle 4 du contrat, en pire : le `.select("id")` rendrait
// une ligne, l'écran afficherait « Enregistré », et le champ reviendrait vide au rechargement.
// On écrit donc DIRECTEMENT dans les deux tables dédiées, comme le fait l'OS
// (`enregistrerCoordonnees` / `enregistrerLogistique` dans `sauvegarderProfil`).
//
// Droits mesurés sur ces deux tables avec le même jeton : `insert … on conflict do update` rend
// 1 ligne et la valeur est relue telle quelle. En lecture, la RLS ne rend QUE sa propre ligne
// (1 sur 5, et 1 sur 6). L'écran ne filtre donc pas par identifiant : la base borne déjà.
//
// == LA PHOTO : LE FORMAT DE L'OS, PAS UN SECOND MÉCANISME =====================================
//
// L'OS écrit dans `avatar_url` une image EMBARQUÉE : `handleAvatarUpload` découpe un carré, le
// redessine en 120 × 120 sur un canvas, et enregistre `canvas.toDataURL('image/jpeg', 0.75)`.
// Mesuré sur les 5 avatars renseignés en base : entre 4 503 et 10 363 caractères.
//
// L'autre chemin existe et il a été mesuré aussi, avec le jeton du compte de recette, par le
// vrai chemin HTTP : le seau `portail-media` porte deux policies faites pour ça,
// `portail_media_avatar_insert` et `portail_media_avatar_update`, qui autorisent n'importe quel
// compte connecté à écrire sous `avatars/<son uuid>/`. Envoi 200, lecture publique 200,
// remplacement 200, écriture sous le dossier d'un autre refusée (« violates row-level security »).
// MAIS la suppression rend 403 : aucune policy `delete` ne couvre ce dossier. Et ce seau ne
// contient aujourd'hui AUCUN objet `avatars/` : ces deux policies n'ont jamais servi.
//
// On garde donc le format de l'OS. Trois raisons, dans cet ordre : une seule façon de porter un
// avatar dans tout l'écosystème (règle 1) ; aucun fichier orphelin dans un seau que la personne
// n'a pas le droit de nettoyer ; et rien à inventer pour contourner le cache d'un chemin fixe.
// Le coût est connu et mesuré : une dizaine de kilo-octets dans une colonne `text`.
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { supabase } from "./supabase";

/** Ce que l'écran montre et peut renvoyer. Rien d'autre n'est modifiable ici. */
export interface MonProfil {
  prenom: string;
  nom: string;
  telephone: string;
  bio: string;
  avatarUrl: string | null;
  /** `collaborateur_coordonnees`, pas `profiles` : voir l'en-tête. */
  adresse: string;
  codePostal: string;
  /** `collaborateur_logistique`, pas `profiles`. */
  ville: string;
  vehicule: boolean;
  permis: boolean;
}

/** Le formulaire renvoie exactement ça, et l'écran ne construit rien d'autre. */
export type ModifsProfil = Omit<MonProfil, "avatarUrl"> & { avatarUrl?: string | null };

export const PROFIL_VIDE: MonProfil = {
  prenom: "", nom: "", telephone: "", bio: "", avatarUrl: null,
  adresse: "", codePostal: "", ville: "", vehicule: false, permis: false,
};

/** `null` plutôt que `""` : la base distingue « non renseigné » de « vide », et l'OS écrit `null`. */
function vide(v: string): string | null {
  const t = v.trim();
  return t ? t : null;
}

/**
 * Mon profil, recollé depuis les trois tables où il vit.
 *
 * ON NE FILTRE PAS SUR SON PROPRE IDENTIFIANT POUR LES DEUX TABLES DE CÔTÉ : leurs policies
 * (`collaborateur_coordonnees_acces`, `collaborateur_logistique_acces`) ne rendent que la ligne de
 * `auth.uid()` à qui n'est ni administration ni production. Mesuré : 1 ligne rendue sur 5, et 1
 * sur 6. Recopier le filtre ici donnerait l'illusion que c'est l'écran qui tient la frontière
 * (règle 3 du contrat). `profiles`, en revanche, est lu par identifiant : la production et
 * l'administration y voient l'annuaire, et sans `eq` elles recevraient la ligne d'un collègue.
 */
export async function lireMonProfil(monId: string): Promise<MonProfil> {
  const [p, coord, logi] = await Promise.all([
    supabase.from("profiles")
      .select("prenom, nom, telephone, bio, avatar_url")
      .eq("id", monId).maybeSingle(),
    supabase.from("collaborateur_coordonnees")
      .select("adresse, code_postal").eq("collaborateur_id", monId).maybeSingle(),
    supabase.from("collaborateur_logistique")
      .select("ville, vehicule, permis").eq("collaborateur_id", monId).maybeSingle(),
  ]);
  if (p.error) throw p.error;

  return {
    prenom: (p.data?.prenom ?? "") as string,
    nom: (p.data?.nom ?? "") as string,
    telephone: (p.data?.telephone ?? "") as string,
    bio: (p.data?.bio ?? "") as string,
    avatarUrl: (p.data?.avatar_url ?? null) as string | null,
    // Une erreur sur ces deux lectures ne doit pas faire échouer tout l'écran : le nom et le
    // téléphone sont là, et un champ vide se corrige, un écran de panne ne se corrige pas.
    adresse: (coord.data?.adresse ?? "") as string,
    codePostal: (coord.data?.code_postal ?? "") as string,
    ville: (logi.data?.ville ?? "") as string,
    vehicule: logi.data?.vehicule === true,
    permis: logi.data?.permis === true,
  };
}

/**
 * Enregistrer mon profil.
 *
 * TROIS ÉCRITURES, ET CHACUNE DOIT PROUVER QU'ELLE A CHANGÉ QUELQUE CHOSE (règle 4). PostgREST
 * rend zéro ligne et zéro erreur quand la RLS refuse : sans `.select(...)`, un refus s'afficherait
 * « Enregistré ».
 *
 * L'ORDRE COMPTE, ET LE MESSAGE D'ÉCHEC AUSSI. Si l'adresse échoue après que l'identité a été
 * écrite, dire « échec » serait faux : le nom, lui, EST enregistré. L'OS dit déjà « Profil
 * enregistré, mais l'adresse n'a pas pu être sauvegardée » ; on reprend cette phrase.
 *
 * ON N'ENVOIE JAMAIS `role`, `grade`, `actif`, `type_contrat`, `niveau_operateur`, `niveau_cm`,
 * `cm_niveau_autonomie` NI `cm_pool_clubplus_general` : mesuré, le déclencheur lève une exception
 * sur chacune. Un champ qui se fait refuser est pire qu'un champ absent (règle 5).
 */
export async function enregistrerMonProfil(monId: string, m: ModifsProfil): Promise<void> {
  const identite: Record<string, unknown> = {
    prenom: vide(m.prenom),
    nom: vide(m.nom),
    telephone: vide(m.telephone),
    bio: vide(m.bio),
  };
  // `undefined` = la photo n'a pas été touchée. `null` serait « retirer la photo », ce que le
  // formulaire propose aussi : les deux cas doivent donc rester distincts.
  if (m.avatarUrl !== undefined) identite.avatar_url = m.avatarUrl;

  const r = await supabase.from("profiles").update(identite).eq("id", monId).select("id");
  if (r.error) throw new Error(r.error.message);
  if (!r.data || !r.data.length) {
    throw new Error("Enregistrement refusé : votre compte n'a pas pu être modifié. Prévenez l'administration.");
  }

  const rc = await supabase.from("collaborateur_coordonnees")
    .upsert({ collaborateur_id: monId, adresse: vide(m.adresse), code_postal: vide(m.codePostal) },
      { onConflict: "collaborateur_id" })
    .select("collaborateur_id");
  if (rc.error || !rc.data || !rc.data.length) {
    throw new Error("Profil enregistré, mais votre adresse n'a pas pu l'être. Réessayez.");
  }

  const rl = await supabase.from("collaborateur_logistique")
    .upsert({ collaborateur_id: monId, ville: vide(m.ville), vehicule: m.vehicule, permis: m.permis },
      { onConflict: "collaborateur_id" })
    .select("collaborateur_id");
  if (rl.error || !rl.data || !rl.data.length) {
    throw new Error("Profil enregistré, mais votre ville et vos infos pratiques n'ont pas pu l'être. Réessayez.");
  }
}

// ── LA PHOTO ──────────────────────────────────────────────────────────────────────────────────

/** Le côté du carré, et la compression. Les deux valeurs de l'OS, recopiées, pas rechoisies. */
const COTE = 120;
const COMPRESSION = 0.75;

export type ResultatPhoto =
  | { etat: "ok"; imageUri: string }
  | { etat: "annule" }
  | { etat: "refus"; message: string };

/**
 * Réduire ce que la personne a choisi au format de l'OS.
 *
 * POURQUOI ON NE GARDE PAS L'IMAGE TELLE QUELLE. Une photo d'iPhone fait trois à six millions
 * d'octets. Embarquée dans `avatar_url`, elle partirait dans CHAQUE lecture de `profiles` — la
 * messagerie de l'OS en lit les dix-neuf d'un coup, l'écran Équipe aussi. 120 × 120 en qualité
 * 0,75 donne les quelques kilo-octets qu'on mesure sur les cinq avatars déjà en base.
 */
async function reduire(uri: string): Promise<string> {
  const image = await ImageManipulator.manipulate(uri)
    .resize({ width: COTE, height: COTE })
    .renderAsync();
  const sortie = await image.saveAsync({ format: SaveFormat.JPEG, compress: COMPRESSION, base64: true });
  if (!sortie.base64) throw new Error("La photo n'a pas pu être préparée.");
  return `data:image/jpeg;base64,${sortie.base64}`;
}

/**
 * Choisir une photo dans la photothèque.
 *
 * `allowsEditing` avec `aspect: [1, 1]` fait faire le cadrage carré PAR LA PERSONNE, avant la
 * réduction : sans lui, `resize` en 120 × 120 écraserait une photo verticale. C'est le pendant du
 * découpage centré que l'OS fait au canvas, en mieux — un visage n'est pas toujours au centre.
 *
 * SUR IOS, CE CHOIX NE DEMANDE AUCUNE AUTORISATION : le sélecteur du système rend l'image choisie
 * sans donner accès à la photothèque. On demande quand même le droit quand il est refusable, et on
 * dit quoi faire s'il a été refusé une fois pour toutes, plutôt que d'ouvrir un sélecteur vide.
 */
export async function choisirPhoto(): Promise<ResultatPhoto> {
  const droit = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!droit.granted && !droit.canAskAgain) {
    return {
      etat: "refus",
      message: "L'accès à vos photos est refusé. Ouvrez Réglages, SV OS bêta, puis Photos pour l'autoriser.",
    };
  }
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (r.canceled || !r.assets?.length) return { etat: "annule" };
  return { etat: "ok", imageUri: await reduire(r.assets[0].uri) };
}

/**
 * Prendre une photo.
 *
 * L'appareil photo, LUI, demande une autorisation, et iOS ne la redemande jamais après un refus.
 * Un bouton qui ouvrirait un écran noir serait une promesse cassée (règle 5) : on dit où aller la
 * rendre.
 */
export async function prendrePhoto(): Promise<ResultatPhoto> {
  const droit = await ImagePicker.requestCameraPermissionsAsync();
  if (!droit.granted) {
    return {
      etat: "refus",
      message: droit.canAskAgain
        ? "L'appareil photo n'a pas été autorisé."
        : "L'appareil photo est refusé. Ouvrez Réglages, SV OS bêta, puis Appareil photo pour l'autoriser.",
    };
  }
  const r = await ImagePicker.launchCameraAsync({
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (r.canceled || !r.assets?.length) return { etat: "annule" };
  return { etat: "ok", imageUri: await reduire(r.assets[0].uri) };
}
