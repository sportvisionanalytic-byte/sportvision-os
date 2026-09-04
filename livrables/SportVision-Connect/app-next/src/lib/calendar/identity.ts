// IDENTITÉ D'UN MATCH — règle unique du chantier, à ne dupliquer nulle part ailleurs.
//
//   Si `external_event_id` existe :
//       identité = club_id + provider + external_event_id
//       → la date, l'heure, le lieu ou même l'adversaire peuvent changer sans créer un nouveau
//         match. C'est TOUT l'intérêt d'un identifiant stable : un report est une mise à jour.
//
//   Sinon (CSV/ICS sans UID, saisie manuelle) :
//       identité = club_id + team_id + adversaire normalisé + match_date + kickoff_time
//       → deux matchs le même jour contre le même adversaire à des heures différentes sont deux
//         matchs distincts et légitimes (cas du tournoi).
//
// Ces deux clés sont le miroir exact des deux index uniques posés en base (Lot 0) :
//   club_matches_provider_external_uniq (club_id, provider, external_event_id)
//       WHERE external_event_id is not null
//   club_matches_fallback_uniq (club_id, team_id, lower(opponent), match_date, kickoff_time)
//       NULLS NOT DISTINCT WHERE external_event_id is null
//
// `club_id` n'apparaît pas dans les clés calculées ici parce que tout le moteur travaille déjà à
// club fixé (un import appartient à un club). Il reste indispensable côté base : quand deux clubs
// clients se rencontrent, la source leur donne le MÊME external_event_id, et une clé sans club_id
// ferait qu'un club écraserait le match de l'autre.

import { opponentKey } from "./normalize.ts";
import type { ProviderId } from "./types.ts";

export interface IdentityFields {
  provider: ProviderId;
  externalEventId: string | null;
  teamId: string | null;
  opponent: string;
  matchDate: string | null;
  kickoffTime: string | null;
}

// Séparateur non imprimable (et non "|" ou " ") : un nom d'adversaire réel peut contenir
// n'importe quel caractère imprimable, barre verticale comprise. Avec un séparateur imprimable,
// ("A|B", "C") et ("A", "B|C") produiraient la même clé et fusionneraient deux matchs distincts.
const SEP = "\u0000";

/** Clé principale, ou null si la source n'a pas d'identifiant pour cette ligne. */
export function externalIdentityKey(fields: Pick<IdentityFields, "provider" | "externalEventId">): string | null {
  if (!fields.externalEventId) return null;
  return `${fields.provider}${SEP}${fields.externalEventId}`;
}

/**
 * Clé de repli. Les NULL sont représentés par une chaîne vide et non ignorés : c'est la sémantique
 * `NULLS NOT DISTINCT` de l'index de repli. Sans ça, deux lignes CSV identiques sans heure (le cas
 * le plus fréquent d'un export incomplet) seraient considérées comme distinctes ici alors que la
 * base, elle, les refuserait — la preview annoncerait "2 nouveaux" et l'import n'en écrirait qu'un.
 */
export function fallbackIdentityKey(
  fields: Pick<IdentityFields, "teamId" | "opponent" | "matchDate" | "kickoffTime">,
): string {
  return [
    fields.teamId ?? "",
    opponentKey(fields.opponent),
    fields.matchDate ?? "",
    fields.kickoffTime ?? "",
  ].join(SEP);
}
