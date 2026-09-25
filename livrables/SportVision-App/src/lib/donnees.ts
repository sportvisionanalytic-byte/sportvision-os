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
}

/**
 * Les photos ou ce joueur a ete reconnu, dans une galerie donnee. La base ne rend que les
 * rattachements valides par une personne, et seulement au joueur lui-meme ou a son parent
 * confirme : l'application ne refait pas ce controle, elle s'y fie.
 */
export async function lirePhotosDuJoueur(albumId: string, playerId: string): Promise<PhotoDuJoueur[]> {
  if (MODE_DEMO) return PHOTOS_DEMO;
  const { data, error } = await supabase.rpc("media_photos_du_joueur", {
    p_album_id: albumId, p_player_id: playerId,
  });
  if (error) { await refermerSiPerdue(error); throw new ErreurChargement(error); }
  if (!Array.isArray(data)) return [];
  return (data as { asset_id: string; preview_path: string | null; thumb_path: string | null }[])
    .map((r) => ({ id: r.asset_id, url: urlApercu((r.preview_path ?? r.thumb_path) ?? "") }))
    .filter((p) => !!p.url);
}
