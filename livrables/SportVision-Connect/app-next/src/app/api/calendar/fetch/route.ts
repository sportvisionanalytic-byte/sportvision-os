import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchRemoteCalendar } from "@/lib/calendar/remote";

// Relais CORS pour l'écran d'import : le navigateur ne peut pas aller chercher lui-même l'URL
// d'abonnement d'une fédération (aucun en-tête CORS côté source). Cette route ne parse rien,
// n'écrit rien, ne décide rien : elle rapporte du texte. Tout le reste se passe ensuite dans le
// navigateur, avec le même moteur et la même validation humaine que pour un fichier déposé.
//
// Les garde-fous réseau (schéma, hôtes privés, redirections, taille, délai) vivent dans
// lib/calendar/remote.ts, partagés avec la synchronisation nocturne.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Le relais n'est pas ouvert : sans cette garde, n'importe qui sur Internet pourrait faire
  // émettre des requêtes réseau par notre serveur.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  let body: { url?: string };
  try {
    body = (await request.json()) as { url?: string };
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  if (!body.url) return NextResponse.json({ error: "Adresse manquante." }, { status: 400 });

  const result = await fetchRemoteCalendar(body.url);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ text: result.text });
}
