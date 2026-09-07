// Récupération d'un calendrier distant, côté serveur uniquement.
//
// ── Pourquoi ça passe par notre serveur ──
// Le navigateur ne peut pas aller chercher l'URL d'abonnement d'une fédération : quasi aucun de
// ces serveurs n'envoie d'en-tête CORS, la requête est bloquée avant d'être émise. Ce module
// existe pour ça, et pour rien d'autre : il rapporte du texte. La lecture, la preview, le diff et
// l'écriture continuent de passer par le même moteur que pour un fichier déposé à la main.
//
// ── Les garde-fous ne sont pas décoratifs ──
// Faire récupérer une URL arbitraire par notre serveur, c'est lui prêter son identité réseau
// (SSRF). Un serveur qui accepte n'importe quelle URL peut servir à atteindre ce que lui seul
// atteint : services internes de l'hébergeur, métadonnées d'instance (169.254.169.254), bases sur
// IP privée. D'où : schéma restreint, hôtes privés refusés, une seule redirection et seulement
// après revalidation de la cible (rediriger vers l'interne est LE contournement classique d'un
// filtre d'URL), taille et délai bornés.
//
// Partagé par le relais appelé depuis l'écran d'import et par la synchronisation nocturne : un
// seul endroit où ces règles sont écrites, donc un seul endroit où les faire évoluer.

import { normalizeCalendarUrl } from "./normalize.ts";

/** 5 Mo : un calendrier de club de 40 équipes sur une saison pèse quelques centaines de Ko. */
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 12_000;

/** Bouclage, réseaux privés RFC 1918, link-local (dont les métadonnées d'instance), CGNAT et
 * adresses IPv6 locales. */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return true;
  }
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function validateCalendarUrl(raw: string): { url: URL } | { error: string } {
  let url: URL;
  try {
    url = new URL(normalizeCalendarUrl(raw));
  } catch {
    return { error: "Adresse invalide. Collez l'URL complète, en commençant par https://" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: "Seules les adresses http:// et https:// sont acceptées." };
  }
  if (isBlockedHost(url.hostname)) {
    return { error: "Cette adresse n'est pas accessible depuis SportVision." };
  }
  return { url };
}

/** Lit le corps en s'arrêtant net au plafond, sans jamais faire confiance à Content-Length : un
 * serveur peut annoncer 1 Ko et envoyer 1 Go. */
async function readCapped(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8").decode(merged);
}

export type RemoteCalendarResult = { text: string } | { error: string; status: number };

export async function fetchRemoteCalendar(rawUrl: string): Promise<RemoteCalendarResult> {
  const validated = validateCalendarUrl(rawUrl);
  if ("error" in validated) return { error: validated.error, status: 400 };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response = await fetch(validated.url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "text/calendar, text/plain;q=0.9, */*;q=0.8", "User-Agent": "SportVision-Calendar/1.0" },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { error: "Redirection sans destination.", status: 502 };
      const next = validateCalendarUrl(new URL(location, validated.url).toString());
      if ("error" in next) return { error: next.error, status: 400 };
      response = await fetch(next.url, { redirect: "error", signal: controller.signal });
    }

    if (!response.ok) {
      return {
        error:
          response.status === 401 || response.status === 403
            ? "La source demande une authentification : cette adresse n'est pas une URL d'abonnement publique."
            : `La source a répondu ${response.status}.`,
        status: 502,
      };
    }

    const text = await readCapped(response);
    if (text === null) return { error: "Fichier trop volumineux ou illisible.", status: 502 };
    if (!text.includes("BEGIN:VCALENDAR")) {
      return {
        error: "Cette adresse ne renvoie pas un calendrier .ics. Vérifiez qu'il s'agit bien d'un lien d'abonnement.",
        status: 422,
      };
    }
    return { text };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { error: aborted ? "La source n'a pas répondu à temps." : "Impossible de joindre cette adresse.", status: 502 };
  } finally {
    clearTimeout(timeout);
  }
}
