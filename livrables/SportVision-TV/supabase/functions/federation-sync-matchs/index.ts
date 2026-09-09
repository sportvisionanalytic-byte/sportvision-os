// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Supabase Dashboard → Edge Functions → federation-sync-matchs → Deploy.

// Supabase Edge Function — federation-sync-matchs
//
// Rafraîchit les matchs des clubs dont une source fédérale est enregistrée. Appelée par pg_cron
// une fois par semaine, ou à la main depuis l'OS.
//
// ── Ce qu'elle apporte, et ce qu'elle n'apporte pas ──
// La source expose deux surfaces. Cette fonction n'interroge QUE l'API JSON, qui rend une fenêtre
// glissante d'environ trois semaines. C'est peu, mais c'est la seule qui porte les LIEUX, et c'est
// exactement la fenêtre utile : au moment d'envoyer quelqu'un sur le terrain.
// La saison complète, elle, se charge à la main (scripts/charger-saison-federale.mjs) : elle exige
// d'évaluer un bloc de code du site, ce qui n'a pas sa place dans un automatisme nocturne que
// personne ne surveille. Décision de Fouka, 09/09/2026.
//
// ── Ce qu'elle ne touche jamais ──
// Le score, les buteurs, l'homme du match, les contenus, le statut de production. Une synchro de
// calendrier renseigne QUAND et OÙ on joue ; ce qu'un coach a saisi après le match lui appartient.
// Le rattachement à une équipe (`team_id`) confirmé par un humain n'est jamais défait non plus.
//
// Sécurité : la clé partagée FEDERATION_SYNC_KEY, même mécanisme que dispatch-notifications.
// Aucun jeton utilisateur n'entre ici : la fonction agit sur tous les clubs configurés.
//
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FEDERATION_SYNC_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const API = "https://api.sportcorico.com/api/clubs";
const PROVIDER = "SPORTCORICO";
const DELAI_MS = 20000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Ramène une heure à HH:MM, quelle que soit sa forme d'origine. Sert uniquement à comparer. */
function heure(v: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((v ?? "").trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** JJ/MM/AAAA → AAAA-MM-JJ, ou null. Une date mal comprise vaut moins que pas de date. */
function versIso(v: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

interface MatchSource {
  id?: number;
  planned_date?: string | null;
  planned_time?: string | null;
  location?: string | null;
  championship_name?: string | null;
  home_team_name?: string | null;
  outside_team_name?: string | null;
  home_club_slug?: string | null;
  home_team_club_slug?: string | null;
  home_team_category_and_code_name?: string | null;
  outside_team_category_and_code_name?: string | null;
  postponed?: boolean;
  exempt?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const attendue = Deno.env.get("FEDERATION_SYNC_KEY");
  const fournie = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!attendue || fournie !== attendue) return json({ error: "Non autorisé." }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: sources, error: errSources } = await admin
    .from("club_calendar_sources")
    .select("id, club_id, saison_id, external_club_id, external_club_name")
    .eq("provider", PROVIDER)
    .eq("is_enabled", true);

  if (errSources) return json({ error: "Lecture des sources impossible." }, 500);
  if (!sources?.length) return json({ traite: 0, message: "Aucune source fédérale active." });

  const rapport: unknown[] = [];

  for (const s of sources) {
    const debut = new Date().toISOString();
    let creees = 0, majs = 0, inchanges = 0;
    const erreurs: string[] = [];
    let statut = "success";

    try {
      const slug = (s.external_club_id ?? "").trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(slug)) throw new Error("Identifiant de club invalide.");

      const controle = new AbortController();
      const minuteur = setTimeout(() => controle.abort(), DELAI_MS);
      let reponse: Response;
      try {
        reponse = await fetch(`${API}/${slug}`, {
          signal: controle.signal,
          headers: { Accept: "application/json" },
        });
      } finally {
        clearTimeout(minuteur);
      }
      if (!reponse.ok) throw new Error(`La source a répondu ${reponse.status}.`);

      const club = (await reponse.json())?.club;
      if (!club) throw new Error("Réponse inattendue de la source.");

      const matchs = [
        ...(club.previousMatches ?? []),
        ...(club.currentMatches ?? []),
        ...(club.nextMatches ?? []),
      ].flatMap((j: { matches?: MatchSource[] }) => j.matches ?? [])
        .filter((m) => m.id && !m.exempt && versIso(m.planned_date));

      for (const m of matchs) {
        const clubDomicile = m.home_club_slug ?? m.home_team_club_slug ?? null;
        const domicile = clubDomicile === slug;
        const adversaire = domicile ? m.outside_team_name : m.home_team_name;
        if (!adversaire) continue;

        const externalId = String(m.id);
        const { data: existant } = await admin
          .from("club_matches")
          .select("id, match_date, kickoff_time, lieu")
          .eq("club_id", s.club_id)
          .eq("provider", PROVIDER)
          .eq("external_event_id", externalId)
          .maybeSingle();

        const ligne = {
          club_id: s.club_id,
          // Le libellé court (« U14 3 »), pas le nom complet (« Villemomble Sports U14 3 »).
          // Répéter le nom du club dans chacune de ses propres équipes n'apprend rien, et surtout
          // la garde anti-doublon compare `team` : deux écritures qui ne s'accordent pas sur la
          // forme du libellé recréeraient chaque match à côté de lui-même.
          team: (domicile ? m.home_team_category_and_code_name : m.outside_team_category_and_code_name)
            ?? (domicile ? m.home_team_name : m.outside_team_name)?.replace(/^.*?\bSports\s+/, "")
            ?? "—",
          opponent: adversaire,
          match_date: versIso(m.planned_date),
          kickoff_time: m.planned_time || null,
          // Le lieu ne sort de la fenêtre glissante que pour les matchs proches. On ne l'efface
          // jamais : sinon chaque passage viderait le lieu des matchs devenus lointains.
          lieu: m.location ?? existant?.lieu ?? null,
          competition: m.championship_name ?? null,
          is_home: domicile,
          provider: PROVIDER,
          external_event_id: externalId,
          saison_id: s.saison_id,
          sport_status: m.postponed ? "postponed" : "scheduled",
          last_synced_at: new Date().toISOString(),
        };

        if (!existant) {
          // La source expose parfois DEUX identifiants pour une meme rencontre : le calendrier de
          // SENIORS 3 et celui de U14 2 etaient integralement dupliques (44 et 40 matchs au lieu
          // de 22 et 20), avec des ids differents mais memes date, heure, competition et equipes.
          // Se fier au seul identifiant ne pouvait pas le voir. On verifie donc aussi la
          // signature metier avant de creer.
          // On compare (date, adversaire, competition) et NON le libelle d'equipe : deux
          // ecritures peuvent nommer la meme equipe differemment (« SENIORS 3 » cote pages de
          // saison, « Seniors 3 » cote API), et un doublon est deja passe par cette faille.
          // Deux equipes d'un meme club peuvent affronter le meme adversaire le meme jour, mais
          // jamais dans la meme competition.
          let requete = admin
            .from("club_matches")
            .select("id")
            .eq("club_id", s.club_id)
            .eq("opponent", ligne.opponent)
            .eq("match_date", ligne.match_date!);
          requete = ligne.competition
            ? requete.eq("competition", ligne.competition)
            : requete.is("competition", null);
          const { data: jumeau } = await requete.limit(1).maybeSingle();
          if (jumeau) {
            inchanges++;
          } else {
            const { error } = await admin.from("club_matches").insert(ligne);
            if (error) erreurs.push(`${externalId} : ${error.message}`);
            else creees++;
          }
        } else if (
          existant.match_date !== ligne.match_date ||
          // Postgres rend une heure en HH:MM:SS, la source la donne en HH:MM. Comparer les deux
          // formes brutes declarait les 17 matchs « modifies » a CHAQUE passage : le journal
          // annoncait du changement la ou il n'y en avait aucun, et on reecrivait pour rien.
          heure(existant.kickoff_time) !== heure(ligne.kickoff_time) ||
          (existant.lieu ?? null) !== (ligne.lieu ?? null)
        ) {
          const { error } = await admin.from("club_matches").update(ligne).eq("id", existant.id);
          if (error) erreurs.push(`${externalId} : ${error.message}`);
          else majs++;
        } else {
          inchanges++;
        }
      }

      if (erreurs.length) statut = creees + majs > 0 ? "partial" : "error";
    } catch (e) {
      statut = "error";
      erreurs.push(e instanceof Error ? e.message : "Erreur inconnue.");
    }

    await admin.from("calendar_sync_runs").insert({
      club_id: s.club_id,
      saison_id: s.saison_id,
      source_id: s.id,
      provider: PROVIDER,
      trigger_kind: "scheduled",
      started_at: debut,
      finished_at: new Date().toISOString(),
      status: statut,
      events_created: creees,
      events_updated: majs,
      events_cancelled: 0,
      events_unchanged: inchanges,
      changes: {},
      errors: erreurs,
      source_label: s.external_club_name ?? s.external_club_id,
    });

    await admin.from("club_calendar_sources").update({
      last_sync_at: new Date().toISOString(),
      sync_status: statut === "success" ? "ok" : statut === "partial" ? "partial" : "error",
      last_error: erreurs.length ? erreurs.slice(0, 3).join(" · ").slice(0, 500) : null,
    }).eq("id", s.id);

    rapport.push({
      club: s.external_club_name ?? s.external_club_id,
      statut, creees, majs, inchanges, erreurs: erreurs.length,
    });
  }

  return json({ traite: sources.length, rapport });
});
