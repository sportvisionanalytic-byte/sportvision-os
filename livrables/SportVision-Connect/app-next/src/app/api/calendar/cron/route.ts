import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchDueCalendarSources, syncCalendarSourceOnce, type AutoSyncOutcome } from "@/lib/data/club/calendar-auto";

// Synchronisation nocturne des calendriers — déclenchée par la fonction planifiée Netlify
// (netlify/functions/calendar-nightly.mts, une fois par nuit).
//
// C'est le point où « importer » devient « ne rien avoir à faire » : un club qui a enregistré son
// adresse d'abonnement ne rouvre plus jamais l'écran d'import. Les reports et changements
// d'horaire arrivent tout seuls.
//
// ── Authentification ──
// La route s'exécute avec la clé de service : elle écrit pour des clubs sans qu'aucun humain ne
// soit connecté. Elle est donc protégée par un secret partagé, comparé en temps constant, et ne
// répond rien d'exploitable sans lui. Sans ce secret configuré, la route refuse de tourner du tout
// plutôt que de s'ouvrir : une tâche d'écriture qui s'exécute par défaut est un incident qui
// attend son heure.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Comparaison à temps constant : une comparaison naïve fuit la longueur du préfixe correct et
 * permet de deviner le secret octet par octet. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: Request) {
  const expected = process.env.CALENDAR_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "Synchronisation planifiée non configurée." }, { status: 503 });
  }
  const provided = request.headers.get("x-sportvision-cron") ?? "";
  if (!safeEqual(provided, expected)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Configuration incomplète." }, { status: 503 });
  }

  const sources = await fetchDueCalendarSources(supabase);
  const results: AutoSyncOutcome[] = [];

  // Séquentiel : quelques clubs, quelques secondes. Paralléliser ferait partir autant de requêtes
  // simultanées vers des serveurs fédéraux qui n'ont rien demandé, pour gagner un temps dont
  // personne n'a besoin la nuit.
  for (const source of sources) {
    try {
      results.push(await syncCalendarSourceOnce(supabase, source));
    } catch (error) {
      // Un club dont la synchronisation échoue ne doit pas empêcher les suivants.
      results.push({
        clubId: source.clubId,
        clubName: source.clubName,
        status: "error",
        created: 0,
        updated: 0,
        unchanged: 0,
        pending: 0,
        failed: 0,
        message: error instanceof Error ? error.message : "Erreur inconnue.",
      });
    }
  }

  return NextResponse.json({
    sources: sources.length,
    created: results.reduce((sum, r) => sum + r.created, 0),
    updated: results.reduce((sum, r) => sum + r.updated, 0),
    pending: results.reduce((sum, r) => sum + r.pending, 0),
    errors: results.filter((r) => r.status === "error").length,
    results,
  });
}
