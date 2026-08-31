// Formatage partagé du module Prestations/Commandes/Factures — voir MASTER-CONNECT-V1.md §51
// (dates en Europe/Paris, jamais de prix à décimales artificielles affiché au client).

export function formatEUR(amount: number | null): string {
  if (amount === null || Number.isNaN(amount)) return "—";
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  return (
    amount.toLocaleString("fr-FR", {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: 2,
    }) + " €"
  );
}

export function formatDateLong(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(d);
}

export function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" }).format(d);
}

// prestations.heure_debut/heure_fin sont des colonnes Postgres `time`, sérialisées "HH:MM:SS"
// par PostgREST (donc aussi par connect-player-prestations, qui les renvoie telles quelles) —
// jamais affiché tel quel côté client (bug trouvé lors de l'audit Espace joueur du 30-31/08/2026 :
// "Mes commandes" affichait "15:00:00" au lieu de "15:00"). Même troncature déjà appliquée
// ailleurs dans ce module (src/lib/supabase/dashboard.ts, getNextClubEvent/getNextPrestation).
export function formatTime(hms: string | null): string {
  if (!hms) return "—";
  return hms.slice(0, 5);
}

/**
 * Droit de rétractation (article L221-18 du Code de la consommation) — même formule que
 * app-next/src/lib/types/services.ts:needsRetractationWaiver et le configurateur Projet
 * vanilla. Une prestation dont la date tombe dans les 14 jours nécessite une renonciation
 * expresse du client pour être exécutée avant la fin du délai légal. Reprise à l'identique ici
 * car `prestations` (et les colonnes retractation_renoncee/_at) est la même table pour les
 * deux apps — le garde-fou légal doit s'appliquer de la même façon, quel que soit le point
 * d'entrée qui écrit la ligne.
 */
export function needsRetractationWaiver(dateIso: string): boolean {
  if (!dateIso) return false;
  const target = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(target.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((target.getTime() - today.getTime()) / 86400000);
  return diffDays >= 0 && diffDays < 14;
}
