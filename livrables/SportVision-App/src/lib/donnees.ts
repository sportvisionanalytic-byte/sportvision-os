// Ce que l'application va chercher en base (22/09/2026).
//
// Une regle : les memes tables et les memes fonctions que le site. Quand le site passe par une
// RPC (media_album_list), on passe par elle aussi — c'est elle qui porte les droits, et une
// requete directe « equivalente » finirait par diverger d'un cote ou de l'autre.
import { supabase } from "./supabase";
import { dateDuJourParis } from "./dates";

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
}

/**
 * Le calendrier du joueur : les evenements du club et les matchs de son equipe.
 * Les deux sources sont distinctes en base (club_calendar_events et club_matches) et le joueur
 * ne les distingue pas — il veut son mois, dans l'ordre.
 */
export async function lireEvenements(clubId: string): Promise<Evenement[]> {
  const [cal, matchs] = await Promise.all([
    supabase
      .from("club_calendar_events")
      .select("id, event_date, type, title, team, event_time, location")
      .eq("club_id", clubId)
      .order("event_date", { ascending: true }),
    supabase
      .from("club_matches")
      .select("id, team, opponent, match_date, kickoff_time, lieu, score, is_home, competition")
      .eq("club_id", clubId)
      .order("match_date", { ascending: true }),
  ]);

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
    });
  }

  return liste.sort((a, b) =>
    a.date === b.date ? (a.heure ?? "").localeCompare(b.heure ?? "") : a.date.localeCompare(b.date));
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
  const { data, error } = await supabase.rpc("media_album_list", {
    p_club_id: clubId, p_team_id: teamId, p_saison_id: saisonId,
  });
  if (error || !Array.isArray(data)) return [];

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
