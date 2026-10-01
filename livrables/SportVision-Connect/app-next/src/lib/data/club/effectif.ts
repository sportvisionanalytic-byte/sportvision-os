import type { SupabaseClient } from "@supabase/supabase-js";

// Constituer l'effectif d'une équipe avant que les familles arrivent (migrations v384 et v385).
//
// Demande de Fouka, 01/10/2026 : « J'ai tous les noms, prénoms, et les photos de tous les joueurs.
// Du coup je peux créer moi-même les profils des joueurs. Et comme ça quand les parents vont créer
// le compte, il y aura déjà le nom, prénom de l'enfant, ils vont dire c'est bien mon enfant, et
// boum, il y a déjà les photos. »
//
// ── CE QUE CE FICHIER NE DÉCIDE PAS ──
// Qui a le droit. La base le dit, et elle seule : `effectif_peut_constituer` pour le bouton,
// `effectif_constituer` qui refuse de toute façon. L'administration et la Production SportVision
// partout, le CM affecté et le bureau sur leur club, le COACH SUR SES ÉQUIPES SEULEMENT. Mesuré par
// le chemin réel : un coach reçoit 42501 sur une équipe qui n'est pas la sienne.
//
// ── LA PHOTO N'EST PAS UNE EMPREINTE ──
// Déposer une photo de référence ne calcule AUCUNE empreinte. La photo attend dans
// `photos_reference_attente`, que la chaîne de reconnaissance ne lit nulle part. Elle ne devient une
// référence que lorsque la famille a donné son accord, et l'empreinte se calcule après. Cet écran ne
// peut pas court-circuiter cet ordre, même par erreur : il n'a aucun chemin pour le faire.

export const BUCKET_EFFECTIF = "sportvision-media-prive";

/** Une ligne saisie, et ce que la base en a fait. */
export interface VerdictEffectif {
  rang: number;
  ficheId: string | null;
  prenom: string;
  nom: string;
  verdict: "creee" | "rattachee" | "deja_presente" | "refusee";
  detail: string | null;
}

export const VERDICT_LABEL: Record<VerdictEffectif["verdict"], string> = {
  creee: "Fiche créée",
  rattachee: "Rattachée à l'équipe",
  deja_presente: "Déjà dans l'équipe",
  refusee: "Refusée",
};

export const VERDICT_TONE: Record<VerdictEffectif["verdict"], "success" | "warning" | "danger" | "neutral"> = {
  creee: "success",
  rattachee: "success",
  deja_presente: "neutral",
  refusee: "danger",
};

export interface LigneSaisie {
  prenom: string;
  nom: string;
  dateNaissance: string;
  numeroMaillot?: string;
  sexe?: "M" | "F";
}

export async function peutConstituerEffectif(supabase: SupabaseClient, teamId: string): Promise<boolean> {
  const { data } = await supabase.rpc("effectif_peut_constituer", { p_team_id: teamId });
  return data === true;
}

/** Cent par envoi : la base refuse au-delà, et un refus en milieu de liste devient illisible. */
export const LIGNES_MAX = 100;

export async function constituerEffectif(
  supabase: SupabaseClient,
  teamId: string,
  lignes: LigneSaisie[],
): Promise<VerdictEffectif[]> {
  const { data, error } = await supabase.rpc("effectif_constituer", {
    p_team_id: teamId,
    p_lignes: lignes.map((l) => ({
      prenom: l.prenom,
      nom: l.nom,
      date_naissance: l.dateNaissance,
      numero_maillot: l.numeroMaillot ?? null,
      sexe: l.sexe ?? null,
    })),
  });
  if (error) throw error;
  type Ligne = { rang: number; fiche_id: string | null; prenom: string; nom: string; verdict: string; detail: string | null };
  // PAS DE FAUX SUCCÈS : une réponse vide n'est pas une réussite. La base rend une ligne par ligne
  // envoyée ; s'il en manque, on le dit plutôt que d'afficher « c'est fait ».
  const rows = (Array.isArray(data) ? data : []) as Ligne[];
  if (rows.length !== lignes.length) {
    throw new Error(
      `La base a répondu sur ${rows.length} ligne(s) sur ${lignes.length}. Rien n'est garanti : vérifiez l'effectif avant de recommencer.`,
    );
  }
  return rows.map((r) => ({
    rang: r.rang,
    ficheId: r.fiche_id,
    prenom: r.prenom,
    nom: r.nom,
    verdict: (["creee", "rattachee", "deja_presente", "refusee"].includes(r.verdict)
      ? r.verdict
      : "refusee") as VerdictEffectif["verdict"],
    detail: r.detail,
  }));
}

// ── La photo de référence déposée par le club ──────────────────────────────

export interface PhotoEffectif {
  id: string;
  storageBucket: string;
  storagePath: string;
  createdAt: string;
  /** Passée dans les photos de référence : la famille a donné son accord. */
  promue: boolean;
  refusee: boolean;
}

export const TAILLE_MAX_PHOTO = 25 * 1024 * 1024;
export const FORMATS_PHOTO = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const PHOTOS_MAX = 5;

export function refuserPhoto(fichier: File): string | null {
  if (!FORMATS_PHOTO.includes(fichier.type)) {
    return "Format non accepté. Déposez une photo au format JPEG, PNG ou HEIC.";
  }
  if (fichier.size > TAILLE_MAX_PHOTO) {
    return "Photo trop lourde (25 Mo maximum).";
  }
  return null;
}

function extensionDe(fichier: File): string {
  const parNom = fichier.name.includes(".") ? fichier.name.split(".").pop()!.toLowerCase() : "";
  if (parNom && /^[a-z0-9]{2,5}$/.test(parNom)) return parNom;
  if (fichier.type === "image/png") return "png";
  if (fichier.type === "image/webp") return "webp";
  return "jpg";
}

export async function listerPhotosEffectif(
  supabase: SupabaseClient,
  playerId: string,
): Promise<PhotoEffectif[]> {
  const { data } = await supabase.rpc("photos_effectif_du_sportif", { p_player_id: playerId });
  type Ligne = { id: string; storage_bucket: string; storage_path: string; created_at: string; promue: boolean; refusee: boolean };
  return ((data ?? []) as Ligne[])
    .filter((r) => !r.refusee)
    .map((r) => ({
      id: r.id,
      storageBucket: r.storage_bucket,
      storagePath: r.storage_path,
      createdAt: r.created_at,
      promue: r.promue,
      refusee: r.refusee,
    }));
}

/** Déposer la photo : d'abord le fichier, ensuite la ligne.
 *
 *  L'ordre compte. Si la ligne partait d'abord et que l'envoi du fichier échouait, la base
 *  annoncerait une photo qui n'existe pas — et la promouvrait au prochain accord, vers un chemin
 *  vide. La policy de stockage pose exactement la même question que la fonction : un refus arrive
 *  donc dès l'envoi, avant toute écriture en base. */
export async function deposerPhotoEffectif(
  supabase: SupabaseClient,
  playerId: string,
  fichier: File,
): Promise<PhotoEffectif[]> {
  const refus = refuserPhoto(fichier);
  if (refus) throw new Error(refus);

  const chemin = `effectif/${playerId}/${Date.now()}.${extensionDe(fichier)}`;
  const { error: erreurEnvoi } = await supabase.storage
    .from(BUCKET_EFFECTIF)
    .upload(chemin, fichier, { contentType: fichier.type, upsert: false });
  if (erreurEnvoi) {
    throw new Error(
      "Envoi de la photo impossible. Si c'est un refus, c'est que vous n'encadrez pas ce sportif.",
    );
  }

  const { data, error } = await supabase.rpc("effectif_deposer_photo", {
    p_player_id: playerId,
    p_storage_path: chemin,
  });
  if (error) throw error;
  if (!data) throw new Error("La photo n'a pas été enregistrée : rien n'a changé.");
  return listerPhotosEffectif(supabase, playerId);
}

export async function retirerPhotoEffectif(supabase: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await supabase.rpc("effectif_refuser_photo", { p_id: id });
  if (error) throw error;
  if (data !== true) throw new Error("Rien n'a changé : cette photo n'existe plus.");
}

/** Les adresses signées, pour afficher les vignettes. Le seau est privé : une balise image n'y a
 *  pas accès sans signature, et la signature passe par la policy de lecture — un compte sans droit
 *  n'obtient rien, même en connaissant le chemin. */
export async function signerPhotos(
  supabase: SupabaseClient,
  chemins: string[],
): Promise<Map<string, string>> {
  const signees = new Map<string, string>();
  if (chemins.length === 0) return signees;
  const { data } = await supabase.storage.from(BUCKET_EFFECTIF).createSignedUrls(chemins, 60 * 60);
  for (const u of data ?? []) {
    if (u?.path && u?.signedUrl) signees.set(u.path, u.signedUrl);
  }
  return signees;
}

// ── Coller une liste ──────────────────────────────────────────────────────

/** Une catégorie entière se saisit en collant, pas en tapant trente formulaires.
 *
 *  On accepte le point-virgule, la tabulation et la virgule, parce qu'un copier-coller d'Excel sort
 *  des tabulations et qu'un export en sort des points-virgules. La date est acceptée en AAAA-MM-JJ
 *  et en JJ/MM/AAAA : la seconde est celle que tout le monde écrit, et la refuser ferait recopier
 *  trente lignes à la main.
 *
 *  Ce qui n'est PAS deviné : rien. Une ligne incomplète est rendue telle quelle avec sa raison, et
 *  la date de naissance n'est jamais déduite de la catégorie — c'est elle qui décide qui donnera
 *  l'accord de reconnaissance (avant 15 ans un parent, de 15 à 17 ans le sportif). */
export function lireLignesCollees(texte: string): { lignes: LigneSaisie[]; erreurs: { ligne: number; texte: string; raison: string }[] } {
  const lignes: LigneSaisie[] = [];
  const erreurs: { ligne: number; texte: string; raison: string }[] = [];
  const brutes = texte.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  brutes.forEach((brute, i) => {
    const champs = brute.split(/[\t;,]/).map((c) => c.trim());
    const [prenom, nom, date, maillot, sexe] = champs;
    if (!prenom || !nom) {
      erreurs.push({ ligne: i + 1, texte: brute, raison: "Prénom et nom attendus en premier." });
      return;
    }
    const iso = normaliserDate(date ?? "");
    if (!iso) {
      erreurs.push({
        ligne: i + 1,
        texte: brute,
        raison: "Date de naissance attendue (AAAA-MM-JJ ou JJ/MM/AAAA).",
      });
      return;
    }
    const s = (sexe ?? "").toUpperCase();
    lignes.push({
      prenom,
      nom,
      dateNaissance: iso,
      numeroMaillot: maillot || undefined,
      sexe: s === "M" || s === "F" ? (s as "M" | "F") : undefined,
    });
  });

  return { lignes, erreurs };
}

function normaliserDate(valeur: string): string | null {
  const v = valeur.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const fr = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (fr) {
    const j = fr[1] ?? "";
    const m = fr[2] ?? "";
    const a = fr[3] ?? "";
    return `${a}-${m.padStart(2, "0")}-${j.padStart(2, "0")}`;
  }
  return null;
}

// ── La photo de profil PROPOSÉE à un encadrant (migration v386) ────────────
//
// Fouka : « Pour le coach, on lui PROPOSE sa photo de profil, il gère. »
//
// « Il gère » est la règle entière, et elle est tenue par la base : `repondre_photo_profil` est le
// seul chemin qui écrit `club_members.photo_path`, le garde-fou de la table refuse toute autre
// écriture, et le droit d'écrire ces trois colonnes a été retiré à `authenticated`. Mesuré : poser
// la photo directement est refusé au président, au CM et à l'administration SportVision.

export interface PhotoProfilProposee {
  id: string;
  clubId: string;
  club: string;
  storageBucket: string;
  storagePath: string;
  commentaire: string | null;
  createdAt: string;
}

export async function mesPhotosProfilProposees(
  supabase: SupabaseClient,
): Promise<PhotoProfilProposee[]> {
  const { data } = await supabase.rpc("mes_photos_profil_proposees");
  type Ligne = { id: string; club_id: string; club: string; storage_bucket: string; storage_path: string; commentaire: string | null; created_at: string };
  return ((data ?? []) as Ligne[]).map((r) => ({
    id: r.id,
    clubId: r.club_id,
    club: r.club,
    storageBucket: r.storage_bucket,
    storagePath: r.storage_path,
    commentaire: r.commentaire,
    createdAt: r.created_at,
  }));
}

export async function repondrePhotoProfil(
  supabase: SupabaseClient,
  id: string,
  accepte: boolean,
): Promise<void> {
  const { data, error } = await supabase.rpc("repondre_photo_profil", { p_id: id, p_accepte: accepte });
  if (error) throw error;
  // Pas de faux succès : la base rend `false` quand la proposition n'existe plus.
  if (data !== true) throw new Error("Cette proposition n'existe plus.");
}

/** Proposer une photo à un encadrant. Réservé à SportVision et au bureau du club : la base le
 *  vérifie (`peut_proposer_photo_profil`), et la policy de stockage pose la même question. */
export async function proposerPhotoProfil(
  supabase: SupabaseClient,
  clubMemberId: string,
  userId: string,
  fichier: File,
  commentaire?: string,
): Promise<void> {
  const refus = refuserPhoto(fichier);
  if (refus) throw new Error(refus);
  const chemin = `profils/${userId}/${Date.now()}.${extensionDe(fichier)}`;
  const { error: erreurEnvoi } = await supabase.storage
    .from(BUCKET_EFFECTIF)
    .upload(chemin, fichier, { contentType: fichier.type, upsert: false });
  if (erreurEnvoi) throw new Error("Envoi de la photo impossible.");
  const { data, error } = await supabase.rpc("proposer_photo_profil", {
    p_club_member_id: clubMemberId,
    p_storage_path: chemin,
    p_commentaire: commentaire ?? null,
  });
  if (error) throw error;
  if (!data) throw new Error("La proposition n'a pas été enregistrée : rien n'a changé.");
}
