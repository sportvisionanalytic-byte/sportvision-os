// Ce que la demande de présence fait de la liste des événements : filtres rapides, recherche,
// regroupement par journée, récapitulatif.
//
// Refonte demandée par Fouka le 10/09/2026, au premier usage réel : la liste était un bloc brut,
// sans filtre ni repère de journée, et le bouton d'envoi se perdait sous tout le reste. Ces règles
// vivent ici, sans React, pour être testées seules (node --test).

import type { CalendarEvent } from "../types/calendar";

export type FiltreRapide = "tous" | "matchs" | "entrainements" | "semaine" | "weekend";

export const FILTRES_RAPIDES: { id: FiltreRapide; libelle: string }[] = [
  { id: "tous", libelle: "Tous" },
  { id: "matchs", libelle: "Matchs" },
  { id: "entrainements", libelle: "Entraînements" },
  { id: "semaine", libelle: "Cette semaine" },
  { id: "weekend", libelle: "Ce week-end" },
];

type Evenement = Pick<CalendarEvent, "id" | "kind" | "title" | "startsAt" | "allDay" | "teamName" | "location" | "opponent">;

function debutDuJour(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function plusJours(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** [début, fin[ de la fenêtre d'un filtre de période, en heure locale. */
export function fenetre(filtre: "semaine" | "weekend", maintenant: Date): [Date, Date] {
  const aujourdhui = debutDuJour(maintenant);
  const jour = aujourdhui.getDay(); // 0 = dimanche
  if (filtre === "semaine") {
    // Jusqu'au dimanche soir inclus : un dimanche, la semaine se limite à la journée.
    const jusquaDimanche = jour === 0 ? 0 : 7 - jour;
    return [aujourdhui, plusJours(aujourdhui, jusquaDimanche + 1)];
  }
  // Le week-end en cours s'il a commencé, sinon le prochain.
  const samedi = jour === 0 ? plusJours(aujourdhui, -1) : plusJours(aujourdhui, 6 - jour);
  return [samedi, plusJours(samedi, 2)];
}

/** Minuscules, sans accents : « Entraînement » se trouve en tapant « entrainement ». */
export function normaliser(texte: string): string {
  return texte.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function filtrerEvenements<E extends Evenement>(
  evenements: E[],
  filtre: FiltreRapide,
  recherche: string,
  maintenant: Date,
): E[] {
  const terme = normaliser(recherche);
  const periode = filtre === "semaine" || filtre === "weekend" ? fenetre(filtre, maintenant) : null;
  return evenements.filter((e) => {
    if (filtre === "matchs" && e.kind !== "match") return false;
    if (filtre === "entrainements" && e.kind !== "training") return false;
    if (periode) {
      const t = new Date(e.startsAt).getTime();
      if (t < periode[0].getTime() || t >= periode[1].getTime()) return false;
    }
    if (terme) {
      const texte = normaliser([e.title, e.teamName, e.location, e.opponent].filter(Boolean).join(" "));
      if (!texte.includes(terme)) return false;
    }
    return true;
  });
}

export interface Journee<E> {
  cle: string;
  libelle: string;
  evenements: E[];
}

/** Clé AAAA-MM-JJ en heure locale (pas en UTC : un match de 23 h ne change pas de jour). */
export function cleJour(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function libelleJour(iso: string, maintenant: Date): string {
  const d = debutDuJour(new Date(iso));
  const ecart = Math.round((d.getTime() - debutDuJour(maintenant).getTime()) / 86_400_000);
  const date = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  if (ecart === 0) return `Aujourd'hui · ${date}`;
  if (ecart === 1) return `Demain · ${date}`;
  return date.charAt(0).toUpperCase() + date.slice(1);
}

/** Les événements par journée, dans l'ordre chronologique (l'entrée doit déjà être triée). */
export function grouperParJour<E extends Evenement>(evenements: E[], maintenant: Date): Journee<E>[] {
  const journees: Journee<E>[] = [];
  for (const e of evenements) {
    const cle = cleJour(e.startsAt);
    const derniere = journees[journees.length - 1];
    if (derniere && derniere.cle === cle) derniere.evenements.push(e);
    else journees.push({ cle, libelle: libelleJour(e.startsAt, maintenant), evenements: [e] });
  }
  return journees;
}

/** L'heure d'un événement, ou rien s'il dure la journée ou n'a pas d'heure connue. */
export function heure(e: Pick<Evenement, "startsAt" | "allDay">): string | null {
  if (e.allDay) return null;
  const d = new Date(e.startsAt);
  if (d.getHours() === 0 && d.getMinutes() === 0) return null;
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function libelleSelection(n: number): string {
  if (n === 0) return "Aucun événement sélectionné";
  return n === 1 ? "1 événement sélectionné" : `${n} événements sélectionnés`;
}
