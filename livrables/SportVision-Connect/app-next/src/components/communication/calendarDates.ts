// Petits utilitaires de date pour le planning éditorial — semaine calée sur lundi, pas de
// dépendance externe (aucune lib de date dans package.json, inutile d'en ajouter pour ça).

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Lundi de la semaine contenant `date`. */
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const dow = (d.getDay() + 6) % 7; // 0 = lundi
  return addDays(d, -dow);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Grille de 42 jours (6 semaines) démarrant le lundi de la semaine du 1er du mois. */
export function buildMonthGrid(date: Date): { date: Date; inCurrentMonth: boolean }[] {
  const first = startOfMonth(date);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => {
    const d = addDays(gridStart, i);
    return { date: d, inCurrentMonth: d.getMonth() === date.getMonth() };
  });
}

export function buildWeekDays(date: Date): Date[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export function formatMonthLabel(date: Date): string {
  const label = date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Conserve l'heure d'origine, ne change que le jour — CHARTE.md : le glisser-déposer modifie
 * `scheduledAt` uniquement, jamais le statut. */
export function withNewDay(originalIso: string, newDay: Date): string {
  const original = new Date(originalIso);
  const next = new Date(newDay);
  next.setHours(original.getHours(), original.getMinutes(), original.getSeconds(), 0);
  return next.toISOString();
}
