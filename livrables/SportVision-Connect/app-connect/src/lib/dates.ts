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
