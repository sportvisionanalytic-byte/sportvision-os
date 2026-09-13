/**
 * Parse une valeur DATE Postgres ("YYYY-MM-DD", sans heure ni fuseau — calendar_events.event_date,
 * club_matches.match_date, event_editions.date_debut/date_fin, event_sessions.date_debut/date_fin…)
 * en objet Date à MINUIT LOCAL, jamais en UTC.
 *
 * `new Date("YYYY-MM-DD")` (spec ES2015+) parse cette chaîne comme minuit **UTC**. Une fois reformatée
 * avec toLocaleDateString/toDateString (qui utilisent le fuseau LOCAL du navigateur), un fuseau à
 * décalage négatif par rapport à UTC (Amériques, Pacifique…) fait reculer la date affichée d'un jour
 * — même classe de bug que le décalage de mois déjà trouvé et corrigé côté OS. Ne se manifeste pas
 * pour un utilisateur en Europe/Paris (décalage positif), donc invisible en test local, mais bien réel
 * pour tout utilisateur dans un fuseau à l'ouest de Greenwich.
 *
 * Cette fonction construit la Date à partir des composants Y/M/D directement en heure locale
 * (`new Date(y, m, d)`), ce qui élimine toute conversion de fuseau : le jour affiché est toujours
 * celui stocké en base, quel que soit le fuseau du navigateur.
 *
 * Ne pas utiliser sur un timestamp complet (avec heure/fuseau, ex. created_at, verified_at,
 * fait_le) : `new Date(isoString)` reste correct pour ceux-là.
 */
export function parseDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return new Date(value);
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

/**
 * La date du jour telle que l'entend SportVision : celle d'Europe/Paris, jamais celle d'UTC.
 *
 * POURQUOI (14/09/2026, bug réel trouvé à 00h50). Le contexte d'un CM vérifiait son affectation
 * avec `new Date().toISOString().slice(0, 10)`, c'est-à-dire la date UTC. Entre minuit et 2 h du
 * matin heure de Paris (1 h en hiver), cette date est celle de la VEILLE. Une affectation qui
 * commence « aujourd'hui » n'existait donc pas encore, et le CM était renvoyé sur la liste de ses
 * clubs, sans explication, alors que la liste lui proposait ce club — parce que la base, elle,
 * compare en `(now() at time zone 'Europe/Paris')::date`.
 *
 * Deux règles pour la même donnée, c'est un écran qui propose ce qu'un autre refuse. Le serveur
 * Netlify tourne en UTC : ce n'était donc pas un cas de bord, mais deux heures par nuit.
 */
export function dateDuJourParis(): string {
  // `en-CA` rend « YYYY-MM-DD », le format d'une colonne DATE Postgres.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
}
