// Ce que l'application va chercher en base (22/09/2026).
//
// Une regle : les memes tables et les memes fonctions que le site. Quand le site passe par une
// RPC (media_album_list), on passe par elle aussi — c'est elle qui porte les droits, et une
// requete directe « equivalente » finirait par diverger d'un cote ou de l'autre.
import { supabase } from "./supabase";
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
      .select("id, team, opponent, match_date, kickoff_time, lieu, score, is_home, competition, sport_status")
      .eq("club_id", clubId)
      .order("match_date", { ascending: true }),
  ]);

  // Les deux sources doivent répondre. Si l'une refuse, on ne compose pas un calendrier à moitié
  // vrai : on le dit.
  if (cal.error || matchs.error) throw new ErreurChargement(cal.error ?? matchs.error);

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

  return liste.sort((a, b) =>
    a.date === b.date ? (a.heure ?? "").localeCompare(b.heure ?? "") : a.date.localeCompare(b.date));
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

/** Un match précis, pour sa fiche. L'identifiant porte le préfixe posé par lireEvenements. */
export async function lireMatch(id: string): Promise<Evenement | null> {
  const brut = id.replace(/^match-/, "");
  if (MODE_DEMO) return EVENEMENTS_DEMO.find((e) => e.id === id || e.id === brut) ?? null;

  const { data, error } = await supabase
    .from("club_matches")
    .select("id, team, opponent, match_date, kickoff_time, lieu, score, is_home, competition")
    .eq("id", brut)
    .maybeSingle();
  if (error) throw new ErreurChargement(error);
  if (!data) return null;

  const domicile = data.is_home !== false;
  return {
    id: `match-${data.id}`,
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
  if (error) throw new ErreurChargement(error);
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
  const [videos, comptes] = await Promise.all([
    supabase.rpc("media_galeries_video", { p_album_ids: ids }),
    playerId
      ? Promise.all(ids.map(async (id) => {
          const { data: n } = await supabase.rpc("media_compte_photos_du_joueur", {
            p_album_id: id, p_player_id: playerId,
          });
          return [id, Number(n ?? 0)] as const;
        }))
      : Promise.resolve([] as (readonly [string, number])[]),
  ]);

  const parVideo = new Map(
    (Array.isArray(videos.data) ? videos.data : [])
      .map((v: { album_id: string; url: string }) => [v.album_id, v.url]));
  const parCompte = new Map(comptes);

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

export function urlApercu(chemin: string): string {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://lulgezzpvrlbftbykzrc.supabase.co";
  return `${base}/storage/v1/object/public/${BUCKET_APERCUS}/${chemin}`;
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
  if (error) throw new ErreurChargement(error);
  if (!Array.isArray(data)) return [];
  return (data as { asset_id: string; preview_path: string | null; thumb_path: string | null }[])
    .map((r) => ({ id: r.asset_id, url: urlApercu((r.preview_path ?? r.thumb_path) ?? "") }))
    .filter((p) => !!p.url);
}
