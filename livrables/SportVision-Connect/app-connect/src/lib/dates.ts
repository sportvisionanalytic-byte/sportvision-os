/**
 * La date du jour telle que l'entend SportVision : celle d'Europe/Paris, jamais celle d'UTC.
 *
 * POURQUOI (14/09/2026). `new Date().toISOString().slice(0, 10)` rend la date UTC. Le serveur qui
 * rend ces pages tourne en UTC : entre minuit et 2 h du matin heure de Paris (1 h en hiver), cette
 * date est celle de la VEILLE. Un « prochain rendez-vous » proposait alors encore celui de la
 * veille, et la base, elle, compare en `(now() at time zone 'Europe/Paris')::date`.
 *
 * Le même écart, sur l'accès d'un CM à son club, le renvoyait purement et simplement dehors : voir
 * `dateDuJourParis` dans Club+ (app-next/src/lib/date-only.ts) et la correction du 14/09.
 *
 * Côté navigateur, le fuseau local d'un utilisateur français donne déjà le bon jour ; cette
 * fonction le garantit aussi pour un rendu serveur, et pour un utilisateur en déplacement.
 */
export function dateDuJourParis(): string {
  // `en-CA` rend « YYYY-MM-DD », le format d'une colonne DATE Postgres.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
}

/** Le jour d'un horodatage, à Paris : « YYYY-MM-DD ». */
export function jourParis(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
}

/**
 * L'heure d'un message, toujours à Paris.
 *
 * POURQUOI (14/09/2026). Ces libellés étaient calculés dans le fuseau LOCAL. Or la page est rendue
 * une première fois par le serveur — qui tourne en UTC — puis reprise par le navigateur, en heure
 * de Paris. Les deux textes diffèrent de deux heures, React constate que le rendu ne correspond pas
 * (erreurs #425 et #422, mesurées sur l'écran Messages de l'Espace joueur) et rejette toute la
 * section avant de la refaire côté client : l'écran clignote, et une partie peut rester vide.
 *
 * En imposant Europe/Paris des deux côtés, le serveur et le navigateur écrivent la même chose.
 */
export function heureParis(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
}

/** « Aujourd'hui », « Hier », sinon la date en toutes lettres — à Paris, serveur comme navigateur. */
export function jourLisibleParis(iso: string): string {
  const jour = jourParis(iso);
  const aujourdhui = dateDuJourParis();
  if (jour === aujourdhui) return "Aujourd'hui";
  const veille = new Date(`${aujourdhui}T12:00:00Z`);
  veille.setUTCDate(veille.getUTCDate() - 1);
  if (jour === veille.toISOString().slice(0, 10)) return "Hier";
  return new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
}
