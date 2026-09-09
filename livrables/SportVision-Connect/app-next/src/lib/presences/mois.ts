// Le décompte des présences SportVision d'un mois.
//
// ── Ce qui disparaît, et pourquoi ──
// L'écran affichait « 0 présence réalisée sur 12 », avec une barre de progression vers ce 12.
// Le nombre venait de `PLANS[...].seasonPresences`, une inclusion commerciale du plan Full
// Communication. Il ne décrit AUCUNE règle opérationnelle : il n'existe ni obligation de couvrir
// douze événements, ni plafond à douze, ni compteur à consommer.
//
// Fouka, 10/09/2026 : « Le CM choisit librement les matchs/entraînements où SportVision sera
// présent. » Une barre qui progresse vers un objectif dit exactement le contraire — elle
// transforme un choix en dette, et un mois calme en retard à rattraper.
//
// ── Ce qui le remplace ──
// Trois nombres qui ne jugent rien : ce qui est prévu ce mois-ci, ce qui a déjà eu lieu, ce qui
// reste devant. Aucun dénominateur, donc aucun objectif implicite.

/** La forme minimale dont ce module a besoin : ni le libellé, ni l'opérateur, ni le type. */
export interface PresenceDatee {
  /** DATE Postgres, « YYYY-MM-DD ». */
  date: string;
  status: "scheduled" | "completed" | "cancelled";
}

export interface DecompteMois {
  programmees: number;
  realisees: number;
  aVenir: number;
}

function memeMois(date: string, reference: Date): boolean {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (!m) return false;
  return Number(m[1]) === reference.getFullYear() && Number(m[2]) === reference.getMonth() + 1;
}

function isoLocal(d: Date): string {
  const mois = `${d.getMonth() + 1}`.padStart(2, "0");
  const jour = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${mois}-${jour}`;
}

/**
 * Les trois nombres du mois de `reference`.
 *
 * `programmees` compte tout ce qui n'est pas annulé — réalisé compris : c'est le nombre de fois
 * où SportVision est attendu ce mois-ci, pas le reliquat. `aVenir` s'appuie sur la date et non
 * sur le seul statut : une présence encore « scheduled » dont la date est passée n'est plus à
 * venir, elle attend d'être clôturée par la production. La compter comme à venir ferait un
 * décompte qui ne redescend jamais.
 */
export function decompterLeMois(presences: PresenceDatee[], reference: Date = new Date()): DecompteMois {
  const aujourdhui = isoLocal(reference);
  let programmees = 0;
  let realisees = 0;
  let aVenir = 0;

  for (const p of presences) {
    if (!memeMois(p.date, reference) || p.status === "cancelled") continue;
    programmees++;
    if (p.status === "completed") realisees++;
    else if (p.date >= aujourdhui) aVenir++;
  }

  return { programmees, realisees, aVenir };
}

/** « Septembre 2026 », capitale initiale comprise. */
export function libelleMois(reference: Date = new Date()): string {
  const brut = reference.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return brut.charAt(0).toUpperCase() + brut.slice(1);
}
