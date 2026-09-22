// Les dates, comptees a Paris (22/09/2026).
//
// Une lecon deja payee : « aujourd'hui » calcule en UTC coupait l'acces d'un CM a son club entre
// minuit et 2 h. Le telephone d'un joueur peut aussi bien etre en voyage ; la reference reste le
// fuseau du club.
const MOIS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const MOIS_COURT = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];
const JOURS = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];

/** La date du jour au format AAAA-MM-JJ, telle qu'on la vit en France. */
export function dateDuJourParis(): string {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** Une date AAAA-MM-JJ en objet, a midi, pour ne jamais glisser d'un jour selon le fuseau. */
export function versDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

export function jourNumero(iso: string): number { return versDate(iso).getDate(); }
export function moisCourt(iso: string): string { return MOIS_COURT[versDate(iso).getMonth()] ?? ""; }

/** « samedi 27 septembre » */
export function dateLongue(iso: string): string {
  const d = versDate(iso);
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`;
}

/** L'heure sans les secondes : « 15:00:00 » devient « 15h00 ». */
export function heureCourte(brut?: string | null): string | null {
  if (!brut) return null;
  return brut.slice(0, 5).replace(":", "h");
}

/** « Aujourd'hui », « Demain », sinon la date longue. Le repere le plus utile en premier. */
export function quand(iso: string): string {
  const aujourdhui = dateDuJourParis();
  if (iso === aujourdhui) return "Aujourd'hui";
  const demain = new Date(versDate(aujourdhui).getTime() + 86400000);
  const isoDemain = `${demain.getFullYear()}-${String(demain.getMonth() + 1).padStart(2, "0")}-${String(demain.getDate()).padStart(2, "0")}`;
  if (iso === isoDemain) return "Demain";
  return dateLongue(iso);
}
