// Registre des providers de calendrier. Un seul endroit à modifier pour en ajouter un.
//
// Providers disponibles aujourd'hui :
//   CSV             — prêt
//   ICS             — prêt
//   FOOTCLUBS_XLSX  — lecture technique prête, mapping métier à faire quand un vrai export Footclubs
//                     sera fourni (isReady = false, l'UI le signale)
//   FFF             — inexistant. L'audit du 04/09/2026 a conclu qu'aucune API FFF n'est ouverte aux
//                     tiers (api-dofa non documentée, doc retirée, accès durci après la cyberattaque
//                     de mars 2024). Aucun stub n'est créé ici : un provider vide donnerait
//                     l'illusion qu'il suffit de le brancher.

import { csvProvider } from "./csv.ts";
import { icsProvider } from "./ics.ts";
import { xlsxProvider } from "./xlsx.ts";
import type { CalendarProvider, ProviderId } from "../types.ts";

export const CALENDAR_PROVIDERS: CalendarProvider[] = [csvProvider, icsProvider, xlsxProvider];

export function getProvider(id: ProviderId): CalendarProvider | null {
  return CALENDAR_PROVIDERS.find((p) => p.id === id) ?? null;
}

/** Extensions acceptées par l'<input type="file"> de l'écran d'import. */
export const CALENDAR_ACCEPT = CALENDAR_PROVIDERS.map((p) => p.accept).join(",");

/**
 * Choisit le provider d'un fichier. `head` est le début du contenu texte (vide pour un binaire) :
 * il permet de reconnaître un .ics renommé, cas déjà géré avant ce chantier et conservé.
 * Renvoie null plutôt qu'un provider par défaut — mieux vaut dire "format non reconnu" que de
 * parser un fichier avec le mauvais lecteur et produire un import silencieusement faux.
 */
export function detectProvider(fileName: string, head: string): CalendarProvider | null {
  return CALENDAR_PROVIDERS.find((p) => p.detect(fileName, head)) ?? null;
}

export { csvProvider, icsProvider, xlsxProvider };
