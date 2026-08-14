// Génération d'un fichier .ics téléchargeable — voir MASTER-CONNECT-V1 §22 : "Ne jamais
// promettre une synchronisation automatique sans vraie intégration bidirectionnelle." Ceci ne
// fait qu'exporter un fichier .ics local, aucun appel réseau, aucune synchronisation.

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function toIcsDate(date: Date): string {
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

function toIcsDateOnly(date: Date): string {
  return date.getUTCFullYear().toString() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate());
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export interface IcsEvent {
  uid: string;
  title: string;
  /** Date au format ISO (YYYY-MM-DD). */
  date: string;
  /** Heure au format HH:MM:SS ou HH:MM, optionnelle (événement journée entière sinon). */
  time?: string | null;
  location?: string | null;
  description?: string | null;
  /** Durée par défaut en minutes si une heure est fournie sans heure de fin explicite. */
  durationMinutes?: number;
}

export function buildIcsContent(event: IcsEvent): string {
  const now = toIcsDate(new Date());
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SportVision Connect//FR", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:${event.uid}@sportvision-an.fr`, `DTSTAMP:${now}`];

  if (event.time) {
    const [h, m, s] = event.time.split(":").map((v) => parseInt(v, 10) || 0);
    const start = new Date(`${event.date}T00:00:00`);
    start.setHours(h ?? 0, m ?? 0, s ?? 0, 0);
    const end = new Date(start.getTime() + (event.durationMinutes ?? 120) * 60 * 1000);
    lines.push(`DTSTART:${toIcsDate(start)}`, `DTEND:${toIcsDate(end)}`);
  } else {
    const day = new Date(`${event.date}T00:00:00`);
    const next = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    lines.push(`DTSTART;VALUE=DATE:${toIcsDateOnly(day)}`, `DTEND;VALUE=DATE:${toIcsDateOnly(next)}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.join("\r\n");
}

export function downloadIcsEvent(event: IcsEvent): void {
  const content = buildIcsContent(event);
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${event.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "evenement"}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
