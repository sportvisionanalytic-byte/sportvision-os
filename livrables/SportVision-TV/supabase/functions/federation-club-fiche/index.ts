// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement depuis le repo.
// Supabase Dashboard → Edge Functions → federation-club-fiche → Deploy.

// Supabase Edge Function — federation-club-fiche
//
// Rend la fiche fédérale d'un club : identité (numéro d'affiliation FFF, ville, couleurs),
// écusson, équipes engagées avec leur championnat, et matchs à venir avec les écussons des
// adversaires. Alimente la recherche de club de l'OS et la synchronisation de calendrier.
//
// ── Pourquoi une edge function et pas un appel direct depuis le navigateur ──
// Trois raisons, dans cet ordre. La source ne renvoie pas d'en-têtes CORS, donc un appel depuis
// le navigateur échouerait. On veut mettre en cache l'identité du club dans `federation_clubs`,
// ce qui demande le service role. Et un seul point de sortie permet de changer de source plus
// tard sans toucher aux écrans.
//
// ── Pourquoi SportCorico et pas la FFF ──
// Vérifié le 09/09/2026 : tout le domaine fff.fr répond 403 depuis une machine (Akamai Bot
// Manager), pages publiques, médias et api-dofa compris. Un appel direct à la fédération serait
// bloqué au premier essai. SportCorico republie ces mêmes données, autorise le crawl dans son
// robots.txt et expose cette route sans authentification. On n'utilise QUE cette route publique :
// les routes plus riches du site réclament son propre jeton d'API, qui ne nous appartient pas.
//
// ── Ce que la source donne, et ce qu'elle ne donne pas ──
// Elle donne les équipes engagées en compétition officielle (U14 à Senior) et une fenêtre
// glissante d'environ trois semaines de matchs. Elle ne donne PAS la saison entière, ni les
// catégories U6-U13 qui jouent en plateaux et ne sont pas enregistrées comme des rencontres.
//
// Déploiement : Supabase Dashboard → Edge Functions → New Function (federation-club-fiche)
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (présents par défaut)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SOURCE = "SPORTCORICO";
const BASE = "https://api.sportcorico.com/api/clubs";
const DELAI_MS = 15000;

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

/** Un slug de club : minuscules, chiffres et tirets. Tout le reste est refusé avant d'être
 *  concaténé dans une URL — on ne construit jamais une requête sortante avec une saisie brute. */
function slugValide(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,80}$/.test(s);
}

interface MatchSource {
  planned_date?: string | null;
  planned_time?: string | null;
  location?: string | null;
  championship_name?: string | null;
  pool_name?: string | null;
  home_team_name?: string | null;
  outside_team_name?: string | null;
  home_team_club_slug?: string | null;
  home_logo?: string | null;
  outside_logo?: string | null;
  home_score?: number | null;
  outside_score?: number | null;
  exempt?: boolean;
  postponed?: boolean;
  slug?: string | null;
  id?: number;
}

/** JJ/MM/AAAA → AAAA-MM-JJ. Renvoie null sur toute autre forme : une date mal comprise vaut
 *  moins que pas de date du tout, elle se retrouverait silencieusement dans un calendrier. */
function versDateIso(v: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((v ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function normaliserMatch(m: MatchSource, slugClub: string) {
  const domicile = (m.home_team_club_slug ?? "") === slugClub;
  return {
    // Identité stable côté source → club_matches.external_event_id, pour qu'un match reporté
    // soit reconnu comme le même match au lieu de créer un doublon.
    external_event_id: m.id ? String(m.id) : (m.slug ?? null),
    date: versDateIso(m.planned_date),
    heure: (m.planned_time ?? null) || null,
    lieu: m.location ?? null,
    competition: m.championship_name ?? null,
    poule: m.pool_name ?? null,
    equipe: domicile ? m.home_team_name ?? null : m.outside_team_name ?? null,
    adversaire: domicile ? m.outside_team_name ?? null : m.home_team_name ?? null,
    adversaire_logo: domicile ? m.outside_logo ?? null : m.home_logo ?? null,
    domicile,
    score: m.home_score !== null && m.home_score !== undefined && m.outside_score !== null && m.outside_score !== undefined
      ? `${m.home_score}-${m.outside_score}`
      : null,
    exempt: Boolean(m.exempt),
    reporte: Boolean(m.postponed),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Réservé aux utilisateurs connectés. L'annuaire n'est pas secret, mais cette route déclenche
    // un appel sortant vers un service tiers : l'ouvrir à `anon` en ferait un relais anonyme.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentification requise." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide." }, 401);

    const parametres = new URL(req.url).searchParams;
    const slug = (parametres.get("slug") ?? "").trim().toLowerCase();
    if (!slugValide(slug)) return json({ error: "Identifiant de club invalide." }, 400);

    const controle = new AbortController();
    const minuteur = setTimeout(() => controle.abort(), DELAI_MS);
    let reponse: Response;
    try {
      reponse = await fetch(`${BASE}/${slug}`, {
        signal: controle.signal,
        headers: { Accept: "application/json" },
      });
    } catch (_e) {
      // On ne relaie ni l'URL ni le détail réseau : c'est du bruit pour l'appelant, et l'écran
      // n'a qu'une chose à lui dire, que la source n'a pas répondu.
      return json({ error: "La source fédérale n'a pas répondu." }, 502);
    } finally {
      clearTimeout(minuteur);
    }

    if (reponse.status === 404) return json({ error: "Club introuvable chez la source." }, 404);
    if (!reponse.ok) return json({ error: "La source fédérale a refusé la requête." }, 502);

    const brut = await reponse.json();
    const club = brut?.club;
    if (!club) return json({ error: "Réponse inattendue de la source." }, 502);

    const equipes = (club.categories_matches ?? []).flatMap(
      (cat: { name?: string; is_female?: boolean; teams?: { name_generated?: string; slug?: string }[] }) =>
        (cat.teams ?? []).map((t) => ({
          nom: t.name_generated ?? null,
          slug: t.slug ?? null,
          categorie: cat.name ?? null,
          feminine: Boolean(cat.is_female),
        })),
    );

    const matchs = [
      ...(club.previousMatches ?? []),
      ...(club.currentMatches ?? []),
      ...(club.nextMatches ?? []),
    ].flatMap((jour: { matches?: MatchSource[] }) => (jour.matches ?? []).map((m) => normaliserMatch(m, slug)))
      .filter((m) => m.date !== null);

    // Cache : l'annuaire ne connaissait que l'identifiant de ce club, il connaît maintenant son
    // identité. Écrit avec le service role — `federation_clubs` n'a aucune policy d'écriture,
    // pour qu'un utilisateur ne puisse pas empoisonner l'annuaire.
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await admin.from("federation_clubs").upsert({
      source: SOURCE,
      slug,
      recherche: slug.replace(/-/g, " "),
      nom: club.name ?? null,
      ville: club.city ?? null,
      code_postal: club.zip_code ?? null,
      departement: club.department ?? null,
      region: club.region ?? null,
      sport: club.sport?.name ?? null,
      affiliation_number: club.affiliation_number ?? null,
      logo_url: club.logo_filename ?? null,
      site_url: club.website_url ?? null,
      nb_equipes: club.number_of_teams ?? null,
      enrichi_at: new Date().toISOString(),
    }, { onConflict: "source,slug" });

    return json({
      source: SOURCE,
      club: {
        slug,
        nom: club.name ?? null,
        affiliation_number: club.affiliation_number ?? null,
        ville: club.city ?? null,
        code_postal: club.zip_code ?? null,
        departement: club.department ?? null,
        region: club.region ?? null,
        sport: club.sport?.name ?? null,
        adresse: club.address ?? null,
        site_url: club.website_url ?? null,
        logo_url: club.logo_filename ?? null,
        couleurs: club.colors ?? null,
        nb_equipes: club.number_of_teams ?? null,
        saison: club.active_season?.label ?? null,
      },
      equipes,
      matchs,
    });
  } catch (_e) {
    return json({ error: "Erreur interne." }, 500);
  }
});
