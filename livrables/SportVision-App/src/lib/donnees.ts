// Ce que l'application va chercher en base (22/09/2026).
//
// Une regle : les memes tables et les memes fonctions que le site. Quand le site passe par une
// RPC (media_album_list), on passe par elle aussi — c'est elle qui porte les droits, et une
// requete directe « equivalente » finirait par diverger d'un cote ou de l'autre.
import { supabase } from "./supabase";
import { SUPABASE_URL } from "./config";
import { dateDuJourParis } from "./dates";
import { EVENEMENTS_DEMO, GALERIES_DEMO, MODE_DEMO, PHOTOS_DEMO } from "./demonstration";

/**
 * Le chargement a échoué : réseau coupé, session expirée, base qui refuse.
 *
 * Pourquoi cette distinction existe : jusqu'ici, une erreur était avalée et l'écran affichait son
 * état vide, c'est-à-dire « votre club n'a rien publié ». Mesuré le 23/09 : sans session valide,
 * la base répond 401, et l'application racontait au joueur que son club ne publiait rien. Un
 * mensonge poli reste un mensonge, et celui-là envoie la personne appeler son club.
 */
export class ErreurChargement extends Error {
  constructor(public readonly origine?: unknown) {
    super("chargement impossible");
    this.name = "ErreurChargement";
  }
}

/**
 * La session n'est plus valable, et aucun rafraîchissement ne la sauvera.
 *
 * À ne pas confondre avec un jeton périmé, que supabase-js renouvelle tout seul. Ici, le jeton de
 * rafraîchissement lui-même est refusé : mot de passe changé sur un autre appareil, compte
 * supprimé, session révoquée par un administrateur.
 *
 * POURQUOI ÇA COMPTE. Sans ce traitement, toutes les requêtes répondent 401, chaque écran affiche
 * « chargement impossible », et la personne est enfermée : l'application la croit connectée, donc
 * elle ne propose jamais de se reconnecter. Le seul moyen d'en sortir était de désinstaller.
 * Trouvé le 25/09 en auditant les cas d'erreur, pas par un utilisateur — ce qui vaut mieux.
 */
function estSessionPerdue(erreur: unknown): boolean {
  const e = erreur as { code?: string; status?: number; message?: string } | null;
  if (!e) return false;
  if (e.status === 401) return true;
  // PGRST301 : « JWT expired » côté PostgREST. Les deux formulations circulent selon la version.
  if (e.code === "PGRST301" || e.code === "401") return true;
  const m = (e.message ?? "").toLowerCase();
  return m.includes("jwt expired") || m.includes("invalid refresh token")
    || m.includes("refresh token not found");
}

/**
 * Referme la session quand elle est définitivement perdue.
 *
 * On ne prévient pas par une alerte : la déconnexion suffit. Le garde de l'espace personnel voit
 * la session disparaître et renvoie vers l'écran de connexion, ce qui est exactement ce qu'il
 * faut faire — et c'est la seule chose qui débloque la personne.
 */
export async function refermerSiPerdue(erreur: unknown): Promise<void> {
  if (!estSessionPerdue(erreur)) return;
  try { await supabase.auth.signOut(); } catch { /* déjà fermée, tant mieux */ }
}

export type GenreEvenement = "match" | "entrainement" | "evenement" | "rendez_vous";

export interface Evenement {
  id: string;
  genre: GenreEvenement;
  titre: string;
  date: string;
  heure: string | null;
  lieu: string | null;
  equipe: string | null;
  adversaire?: string | null;
  domicile?: boolean;
  competition?: string | null;
  /** Jamais invente : un match a venir n'a pas de score, et n'en affiche donc aucun. */
  score?: string | null;
  /** Reporte ou annule : la base le sait, et une famille qui se deplace pour rien ne le pardonne pas. */
  statut?: "reporte" | "annule";
  /** L'ecusson du club adverse, quand la federation le connait. Voir ecussonsDesAdversaires. */
  ecussonAdversaire?: string | null;
}

/**
 * Le calendrier du joueur : les evenements du club et les matchs de son equipe.
 * Les deux sources sont distinctes en base (club_calendar_events et club_matches) et le joueur
 * ne les distingue pas — il veut son mois, dans l'ordre.
 */
export async function lireEvenements(clubId: string): Promise<Evenement[]> {
  if (MODE_DEMO) return EVENEMENTS_DEMO;
  const [cal, matchs] = await Promise.all([
    supabase
      .from("club_calendar_events")
      .select("id, event_date, type, title, team, event_time, location")
      .eq("club_id", clubId)
      .order("event_date", { ascending: true }),
    supabase
      .from("club_matches")
      .select("id, team, opponent, match_date, kickoff_time, lieu, score, is_home, competition, sport_status, opponent_club_slug")
      .eq("club_id", clubId)
      .order("match_date", { ascending: true }),
  ]);

  // Les deux sources doivent répondre. Si l'une refuse, on ne compose pas un calendrier à moitié
  // vrai : on le dit.
  if (cal.error || matchs.error) {
    const e = cal.error ?? matchs.error;
    await refermerSiPerdue(e);
    throw new ErreurChargement(e);
  }

  const liste: Evenement[] = [];

  for (const r of cal.data ?? []) {
    if (!r.event_date) continue;
    const type = String(r.type ?? "");
    liste.push({
      id: `cal-${r.id}`,
      genre: type === "entrainement" ? "entrainement" : type === "match" ? "match" : "evenement",
      titre: r.title ?? "Événement du club",
      date: r.event_date,
      heure: r.event_time ?? null,
      lieu: r.location ?? null,
      equipe: r.team ?? null,
    });
  }

  for (const r of matchs.data ?? []) {
    if (!r.match_date) continue;
    const domicile = r.is_home !== false;
    liste.push({
      id: `match-${r.id}`,
      genre: "match",
      titre: `${r.team ?? "Notre équipe"} ${domicile ? "vs" : "@"} ${r.opponent ?? "adversaire"}`,
      date: r.match_date,
      heure: r.kickoff_time ?? null,
      lieu: r.lieu ?? null,
      equipe: r.team ?? null,
      adversaire: r.opponent ?? null,
      domicile,
      competition: r.competition ?? null,
      score: r.score ?? null,
      statut: r.sport_status === "postponed" ? "reporte"
        : r.sport_status === "cancelled" ? "annule" : undefined,
    });
  }

  await ajouterEcussonsAdversaires(liste, (matchs.data ?? []) as { id: string; opponent_club_slug?: string | null }[]);

  return liste.sort((a, b) =>
    a.date === b.date ? (a.heure ?? "").localeCompare(b.heure ?? "") : a.date.localeCompare(b.date));
}

/**
 * L'ecusson du club adverse, pour chaque match qui en identifie un.
 *
 * POURQUOI UNE SEULE REQUETE POUR TOUTE LA LISTE. Un calendrier de saison compte plusieurs
 * centaines de matchs mais une centaine d'adversaires distincts au plus, et beaucoup reviennent.
 * Une requete par match ferait des centaines d'allers-retours pour afficher un ecran, au bord
 * d'un terrain, en 4G.
 *
 * `federation_clubs` est lisible par tout compte connecte (policy federation_clubs_lecture) :
 * c'est un annuaire public de 34 586 clubs, il ne contient rien de personnel.
 *
 * UN ECHEC NE FAIT RIEN ECHOUER. Sans ecusson, la carte affiche un blason neutre, ce qu'elle
 * faisait tres bien avant. Perdre un calendrier entier parce qu'une image manque serait absurde.
 */
async function ajouterEcussonsAdversaires(
  liste: Evenement[], lignes: { id: string; opponent_club_slug?: string | null }[],
): Promise<void> {
  const slugs = [...new Set(lignes.map((r) => r.opponent_club_slug).filter(Boolean))] as string[];
  if (!slugs.length) return;
  try {
    const { data } = await supabase
      .from("federation_clubs").select("slug, logo_url").in("slug", slugs);
    const parSlug = new Map(
      (data ?? []).filter((f) => f.logo_url).map((f) => [f.slug as string, f.logo_url as string]));
    if (!parSlug.size) return;
    const parMatch = new Map(lignes.map((r) => [`match-${r.id}`, r.opponent_club_slug]));
    for (const e of liste) {
      const slug = parMatch.get(e.id);
      if (slug) e.ecussonAdversaire = parSlug.get(slug) ?? null;
    }
  } catch { /* le calendrier vaut mieux sans ecusson que pas de calendrier */ }
}

export type Issue = "gagne" | "nul" | "perdu";

/**
 * Gagné, nul ou perdu, lu depuis le score.
 *
 * Le score de `club_matches` est écrit « pour - contre », du point de vue du club : c'est la
 * convention posée par la synchronisation fédérale, qui recopie le score officiel dans cet ordre.
 * On peut donc annoncer l'issue sans risque de se tromper de camp. En cas de format inattendu, on
 * ne devine pas : on ne renvoie rien, et l'écran se contente d'afficher le score.
 */
export function issueDuMatch(score?: string | null): Issue | null {
  if (!score) return null;
  const m = score.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (!m) return null;
  const pour = Number(m[1]);
  const contre = Number(m[2]);
  if (Number.isNaN(pour) || Number.isNaN(contre)) return null;
  return pour > contre ? "gagne" : pour < contre ? "perdu" : "nul";
}

export const MOT_ISSUE: Record<Issue, string> = { gagne: "Victoire", nul: "Nul", perdu: "Défaite" };

/**
 * Sépare ce qui arrive de ce qui est passé. À venir dans l'ordre croissant, terminés dans l'ordre
 * décroissant : on regarde vers l'avant, et on revient sur le dernier match d'abord.
 */
export function separer(evenements: Evenement[]): { aVenir: Evenement[]; termines: Evenement[] } {
  const jour = dateDuJourParis();
  const aVenir = evenements.filter((e) => e.date >= jour);
  const termines = evenements.filter((e) => e.date < jour).reverse();
  return { aVenir, termines };
}

/** Le prochain rendez-vous, aujourd'hui compris : un match du jour interesse plus qu'un match de mars. */
export function prochain(evenements: Evenement[]): Evenement | null {
  const jour = dateDuJourParis();
  return evenements.find((e) => e.date >= jour) ?? null;
}

/** Les derniers resultats connus, du plus recent au plus ancien. */
export function derniersResultats(evenements: Evenement[], combien = 3): Evenement[] {
  return evenements
    .filter((e) => e.genre === "match" && e.score)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, combien);
}

/**
 * L'identifiant réel du match, extrait de celui que porte l'écran.
 *
 * DEUX FORMES CIRCULENT, et c'est ce qui a cassé la fiche de match pour les parents (25/09/2026).
 *
 *   joueur   « match-<uuid du match> »                       posé par lireEvenements
 *   parent   « match-<uuid du match>-<uuid de l'enfant> »     posé par lireCalendrierFamille
 *
 * Le second porte l'enfant parce que deux enfants peuvent jouer le même match : sans lui, les
 * deux lignes du calendrier auraient la même clé et React n'en afficherait qu'une. C'est une
 * bonne raison, mais la fiche ne retirait que le préfixe et envoyait le reste à la base, qui
 * répondait « invalid input syntax for type uuid ». L'écran affichait alors « chargement
 * impossible » — signalé par Fouka, reproduit, mesuré : HTTP 400 avec l'identifiant composite,
 * HTTP 200 avec le seul identifiant du match.
 *
 * On prend donc le PREMIER UUID rencontré, quelle que soit la forme. Une expression stricte, et
 * non un découpage sur les tirets : un UUID en contient déjà quatre.
 */
function identifiantDeMatch(id: string): string {
  const m = id.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : id.replace(/^match-/, "");
}

/** Un match précis, pour sa fiche. L'identifiant porte le préfixe posé par lireEvenements. */
export async function lireMatch(id: string): Promise<Evenement | null> {
  const brut = identifiantDeMatch(id);
  if (MODE_DEMO) return EVENEMENTS_DEMO.find((e) => e.id === id || e.id === brut
    || identifiantDeMatch(e.id) === brut) ?? null;

  const { data, error } = await supabase
    .from("club_matches")
    .select("id, team, opponent, match_date, kickoff_time, lieu, score, is_home, competition, opponent_club_slug")
    .eq("id", brut)
    .maybeSingle();
  if (error) { await refermerSiPerdue(error); throw new ErreurChargement(error); }
  if (!data) return null;

  const domicile = data.is_home !== false;
  let ecussonAdversaire: string | null = null;
  const slug = (data as { opponent_club_slug?: string | null }).opponent_club_slug;
  if (slug) {
    try {
      const { data: f } = await supabase
        .from("federation_clubs").select("logo_url").eq("slug", slug).maybeSingle();
      ecussonAdversaire = (f?.logo_url as string | null) ?? null;
    } catch { /* la fiche vaut mieux sans ecusson que pas de fiche */ }
  }
  return {
    id: `match-${data.id}`,
    ecussonAdversaire,
    genre: "match",
    titre: `${data.team ?? "Notre équipe"} ${domicile ? "vs" : "@"} ${data.opponent ?? "adversaire"}`,
    date: data.match_date,
    heure: data.kickoff_time ?? null,
    lieu: data.lieu ?? null,
    equipe: data.team ?? null,
    adversaire: data.opponent ?? null,
    domicile,
    competition: data.competition ?? null,
    score: data.score ?? null,
  };
}

export interface Galerie {
  id: string;
  titre: string;
  date: string | null;
  apercuUrl: string | null;
  nbPhotos: number;
  /** Le droit d'acces est deja achete : la galerie s'ouvre en entier. */
  ouverte: boolean;
  videoUrl?: string | null;
  /** Combien de photos portent le visage de ce joueur. Zero : on n'affiche pas de compteur. */
  mesPhotos?: number;
}

export async function lireGaleries(
  clubId: string, teamId: string, saisonId: string | null, playerId?: string,
): Promise<Galerie[]> {
  if (MODE_DEMO) return GALERIES_DEMO;
  const { data, error } = await supabase.rpc("media_album_list", {
    p_club_id: clubId, p_team_id: teamId, p_saison_id: saisonId,
  });
  if (error) { await refermerSiPerdue(error); throw new ErreurChargement(error); }
  if (!Array.isArray(data)) return [];

  const galeries: Galerie[] = data.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    titre: String(r.title ?? "Galerie"),
    date: (r.event_date as string | null) ?? null,
    apercuUrl: (r.cover_preview_url as string | null) ?? null,
    nbPhotos: Number(r.photo_count ?? 0),
    ouverte: r.unlocked === true,
  }));
  if (!galeries.length) return galeries;

  const ids = galeries.map((g) => g.id);
  // DEUX REQUETES POUR TOUT L'ECRAN, et non deux plus une par galerie (corrige le 25/09/2026).
  //
  // Le comptage « mes photos » appelait la base UNE FOIS PAR GALERIE. Sur une saison qui en
  // compte trente, cela faisait trente allers-retours pour afficher un ecran — et cet ecran
  // s'ouvre au bord d'un terrain, en 4G, souvent a la mi-temps quand tout le monde est sur le
  // reseau en meme temps. La fonction groupee (v259) fait le meme travail en une fois, avec
  // exactement les memes droits : elle appelle la meme fonction interne.
  const [videos, comptes] = await Promise.all([
    supabase.rpc("media_galeries_video", { p_album_ids: ids }),
    playerId
      ? supabase.rpc("media_compte_photos_du_joueur_lot", {
          p_album_ids: ids, p_player_id: playerId,
        })
      : Promise.resolve({ data: [] as { album_id: string; nb: number }[] }),
  ]);

  const parVideo = new Map(
    (Array.isArray(videos.data) ? videos.data : [])
      .map((v: { album_id: string; url: string }) => [v.album_id, v.url]));
  const parCompte = new Map(
    (Array.isArray(comptes.data) ? comptes.data : [])
      .map((c: { album_id: string; nb: number }) => [c.album_id, Number(c.nb ?? 0)]));

  return galeries.map((g) => ({
    ...g,
    videoUrl: parVideo.get(g.id) ?? null,
    mesPhotos: parCompte.get(g.id) ?? 0,
  }));
}

/**
 * Le lien de la collection haute definition. Jamais charge d'avance : la base re-verifie le droit
 * a cet instant precis et journalise l'ouverture. Un lien prefetch serait un lien qui fuit.
 */
export async function ouvrirGalerie(albumId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("media_album_get_link", { p_album_id: albumId });
  if (error) return null;
  return (data as string | null) ?? null;
}

/** Le bucket public des apercus. Les originaux, eux, ne sortent jamais par la. */
const BUCKET_APERCUS = "galerie-previews";

/** L'adresse publique d'un apercu. Utilisee par lirePhotosDuJoueur, plus bas dans ce fichier. */
export function urlApercu(chemin: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_APERCUS}/${chemin}`;
}

export interface PhotoDuJoueur {
  id: string;
  url: string;
  /** L'apercu est-il net ? Faux = il porte le filigrane, et il n'y en a que quelques-uns. */
  net: boolean;
}

/** Ce que la base rend pour une galerie : les photos servies, et le VRAI total.
 *
 *  Les deux sont necessaires et distincts. Sans Pass, la base ne rend que quatre lignes (v282, la
 *  limite est en base et non ici : une limite cote ecran se contourne en rejouant la requete, et
 *  ces photos se vendent). L'ecran doit pourtant pouvoir dire « 37 autres photos de vous » — d'ou
 *  `total`, qui compte tout meme quand on n'en sert que quatre. Sans lui, il annoncerait « 0 autre »
 *  et laisserait croire qu'il n'y en a pas plus, exactement l'inverse de l'effet voulu. */
export interface PhotosDuJoueur {
  photos: PhotoDuJoueur[];
  total: number;
}

/**
 * Les photos ou ce joueur a ete reconnu, dans une galerie donnee. La base ne rend que les
 * rattachements valides par une personne, et seulement au joueur lui-meme ou a son parent
 * confirme : l'application ne refait pas ce controle, elle s'y fie.
 */
/** Le bucket des apercus NETS. Prive, et c'est tout l'interet : la politique de storage (v281)
 *  decide qui peut lire, donc une adresse qui circule ne sert a rien a qui n'y a pas droit. */
const BUCKET_NETS = "sportvision-media-prive";

/**
 * Des adresses utilisables pour les apercus nets.
 *
 * POURQUOI SIGNER, ET POURQUOI EN UN SEUL APPEL. Un bucket prive ne repond pas a une balise image :
 * le point d'acces authentifie veut un en-tete Authorization, qu'aucun <Image> n'envoie. On demande
 * donc des adresses signees — et la signature elle-meme passe par la politique de lecture, donc un
 * compte sans droit n'obtient rien, meme s'il connait le chemin.
 *
 * `createSignedUrls` au pluriel : une galerie peut contenir cent photos, et cent allers-retours au
 * bord d'un terrain en 4G, c'est l'ecran qui ne s'affiche jamais.
 *
 * Une signature qui echoue n'est PAS une erreur d'ecran : on retombe sur l'apercu public, filigrane.
 * Mieux vaut une photo barree qu'une case vide.
 */
async function signerLesNets(chemins: string[]): Promise<Map<string, string>> {
  const par = new Map<string, string>();
  if (!chemins.length) return par;
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NETS)
      .createSignedUrls(chemins, 60 * 60);
    if (error || !Array.isArray(data)) return par;
    for (const d of data) {
      if (d?.path && d?.signedUrl) par.set(d.path, d.signedUrl);
    }
  } catch { /* on retombe sur l'apercu public */ }
  return par;
}

export async function lirePhotosDuJoueur(
  albumId: string, playerId: string,
): Promise<PhotosDuJoueur> {
  if (MODE_DEMO) return { photos: PHOTOS_DEMO, total: PHOTOS_DEMO.length };
  const { data, error } = await supabase.rpc("media_photos_du_joueur", {
    p_album_id: albumId, p_player_id: playerId,
  });
  if (error) { await refermerSiPerdue(error); throw new ErreurChargement(error); }
  if (!Array.isArray(data)) return { photos: [], total: 0 };

  type Ligne = {
    asset_id: string; preview_path: string | null; thumb_path: string | null;
    preview_clair_path: string | null; total: number | null;
  };
  const lignes = data as Ligne[];
  // La base ne rend un chemin net qu'a qui y a droit : s'il y en a, on les signe tous d'un coup.
  const signees = await signerLesNets(
    lignes.map((r) => r.preview_clair_path).filter((c): c is string => !!c),
  );
  const photos = lignes
    .map((r) => {
      const net = r.preview_clair_path ? signees.get(r.preview_clair_path) : undefined;
      return {
        id: r.asset_id,
        url: net ?? urlApercu((r.preview_path ?? r.thumb_path) ?? ""),
        net: !!net,
      };
    })
    .filter((p) => !!p.url);
  // Le total vient de la base, jamais de la longueur de la liste : c'est toute la difference entre
  // « 4 photos » et « 4 photos sur 41 ».
  return { photos, total: Number(lignes[0]?.total ?? photos.length) };
}


/**
 * Où en est la reconnaissance pour ce joueur — les quatre marches, dans l'ordre.
 *
 * POURQUOI L'ÉCRAN A BESOIN DE ÇA. Tout le mécanisme existe et fonctionne, mais rien ne le disait à
 * la famille : l'écran affichait « Rien pour le moment », ce qui est vrai et inutile. Mesure du
 * 26/09 sur les six joueurs en base : deux avaient donné leur accord, AUCUN n'avait déposé de photo
 * de référence, donc aucune empreinte, donc zéro photo retrouvée.
 *
 * Une famille qui paie le Pass et tombe sur une galerie vide demande un remboursement, et elle a
 * raison. L'écran doit nommer la marche suivante.
 *
 * Rend `null` sans bruit en cas de refus ou de panne : l'écran retombe alors sur son texte neutre,
 * il ne montre pas une erreur à quelqu'un qui regardait des photos.
 */
export interface EtatReconnaissance {
  consentement: boolean;
  photoReference: boolean;
  empreinte: boolean;
  photosTrouvees: number;
}

export async function lireEtatReconnaissance(playerId: string): Promise<EtatReconnaissance | null> {
  if (MODE_DEMO) {
    return { consentement: true, photoReference: true, empreinte: true, photosTrouvees: 12 };
  }
  const { data, error } = await supabase.rpc("media_etat_reconnaissance", { p_player_id: playerId });
  if (error) return null;
  const r = (Array.isArray(data) ? data[0] : null) as {
    consentement: boolean; photo_reference: boolean; empreinte: boolean; photos_trouvees: number;
  } | null;
  if (!r) return null;
  return {
    consentement: !!r.consentement,
    photoReference: !!r.photo_reference,
    empreinte: !!r.empreinte,
    photosTrouvees: Number(r.photos_trouvees ?? 0),
  };
}
