import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchRemoteCalendar, type FormatAttendu } from "@/lib/calendar/remote";

// Relais CORS pour l'écran d'import : le navigateur ne peut pas aller chercher lui-même l'URL
// d'abonnement d'une fédération (aucun en-tête CORS côté source). Cette route ne parse rien,
// n'écrit rien, ne décide rien : elle rapporte le fichier. Tout le reste se passe ensuite dans le
// navigateur, avec le même moteur et la même validation humaine que pour un fichier déposé.
//
// Depuis le 25/09/2026 elle rapporte aussi les CLASSEURS, pas seulement les .ics : un club qui
// tient son planning sur Google Sheets colle son lien ici comme il collerait une URL
// d'abonnement. Un .xlsx étant un ZIP, il repart encodé en base64 — le JSON ne transporte pas
// d'octets bruts, et les laisser passer par un TextDecoder détruirait le fichier en silence.
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

  let body: { url?: string; format?: FormatAttendu };
  try {
    body = (await request.json()) as { url?: string; format?: FormatAttendu };
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  if (!body.url) return NextResponse.json({ error: "Adresse manquante." }, { status: 400 });

  // Le format est déduit de l'adresse quand l'appelant ne dit rien : un club colle un lien, pas
  // un type MIME. Les garde-fous de contenu, eux, restent dans remote.ts.
  const format: FormatAttendu = body.format
    ?? (/spreadsheets|\.xlsx(\?|$)|format=xlsx/i.test(body.url) ? "tableur" : "ics");

  const result = await fetchRemoteCalendar(body.url, format);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  if (format === "tableur") {
    return NextResponse.json({
      format,
      bytesBase64: Buffer.from(result.bytes).toString("base64"),
    });
  }
  return NextResponse.json({ format, text: result.text });
}
