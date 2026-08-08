// Données fictives mais réalistes pour les espaces Coach / Académie / Tournoi Full
// Communication — voir ACTIONS.md § 10, README.md § Fidélité. Clés par identifiant
// d'organisation pour suivre le changement d'espace actif.

import type { Camp, CoachSession, EventPhase, LiveFeedItem, LiveStat } from "../types/events";

// ---------------------------------------------------------------------------------------------
// Coach Full Com — /sessions (ACTIONS.md § 10). Chris Performance.
// ---------------------------------------------------------------------------------------------

export const sessionsByCoachOrg: Record<string, CoachSession[]> = {
  "org-chrisperformance": [
    { id: "sess-1", title: "Séance individuelle — travail de finition", date: "12 août 2026", time: "17h00", location: "Stade Pierre-Bardin, Fontainebleau", status: "confirmed" },
    { id: "sess-2", title: "Préparation physique — groupe U17", date: "14 août 2026", time: "18h30", location: "Complexe sportif, Varenne", status: "capture_planned" },
    { id: "sess-3", title: "Séance individuelle — gardien", date: "19 août 2026", time: "10h00", location: "Centre Elite Academy, Melun", status: "to_confirm" },
    { id: "sess-4", title: "Masterclass — prise de décision", date: "22 août 2026", time: "16h00", location: "Stade Pierre-Bardin, Fontainebleau", status: "confirmed" },
  ],
};

// ---------------------------------------------------------------------------------------------
// Académie Full Com — /camps (ACTIONS.md § 10, DATA_MODEL.md § Camp). Elite Academy.
// ---------------------------------------------------------------------------------------------

export const campsByAcademyOrg: Record<string, Camp[]> = {
  "org-eliteacademy": [
    {
      id: "camp-toussaint",
      name: "Stage de la Toussaint",
      startsAt: "2026-10-19",
      endsAt: "2026-10-23",
      venue: "Centre sportif régional, Melun",
      groups: ["U11", "U13", "U15"],
      capacity: 60,
      registered: 47,
      status: "open",
    },
    {
      id: "camp-ete",
      name: "Stage d'été — perfectionnement",
      startsAt: "2026-07-06",
      endsAt: "2026-07-10",
      venue: "Centre sportif régional, Melun",
      groups: ["U15", "U17"],
      capacity: 40,
      registered: 40,
      status: "completed",
    },
    {
      id: "camp-gardiens",
      name: "Stage spécifique gardiens",
      startsAt: "2026-12-21",
      endsAt: "2026-12-23",
      venue: "Gymnase Coubertin, Melun",
      groups: ["U13", "U15", "U17"],
      capacity: 16,
      registered: 9,
      status: "upcoming",
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// Tournoi Full Com — /eventtimeline et /live (ACTIONS.md § 10, DATA_MODEL.md § EventPhase).
// Elite Cup 2026.
// ---------------------------------------------------------------------------------------------

export const eventPhasesByEventOrg: Record<string, EventPhase[]> = {
  "org-elitecup": [
    {
      phase: "before",
      label: "Avant l'événement",
      dateLabel: "Jusqu'au 25 août 2026",
      status: "in_progress",
      items: [
        { label: "Teasing", description: "Publications de mise en tension sur les réseaux", done: true },
        { label: "Présentation des équipes", description: "Portraits et effectifs des 16 équipes engagées", done: true },
        { label: "Mise en avant des sponsors", description: "Communiqué et visuels partenaires", done: false },
        { label: "Informations pratiques", description: "Accès, horaires, restauration, billetterie", done: false },
      ],
    },
    {
      phase: "during",
      label: "Jour J",
      dateLabel: "26 août 2026",
      status: "planned",
      items: [
        { label: "Stories en direct", description: "Suivi minute par minute sur Instagram", done: false },
        { label: "Résultats en temps réel", description: "Scores et classements mis à jour au fil des matchs", done: false },
        { label: "Photos d'action", description: "Captation terrain par l'équipe SportVision", done: false },
        { label: "Clips et temps forts", description: "Montages courts diffusés en fin de journée", done: false },
      ],
    },
    {
      phase: "after",
      label: "Après l'événement",
      dateLabel: "À partir du 27 août 2026",
      status: "planned",
      items: [
        { label: "Galerie complète", description: "Toutes les photos triées et livrées", done: false },
        { label: "Aftermovie", description: "Film souvenir de l'édition 2026", done: false },
        { label: "Remerciements partenaires", description: "Publication dédiée aux sponsors de l'événement", done: false },
        { label: "Rapport", description: "Bilan de portée et d'engagement de l'édition", done: false },
      ],
    },
  ],
};

export const liveStatsByEventOrg: Record<string, LiveStat[]> = {
  "org-elitecup": [
    { label: "Publications sorties", value: "6" },
    { label: "Portée du jour", value: "18 400" },
    { label: "Interactions", value: "1 260" },
    { label: "Photos livrées", value: "212" },
  ],
};

export const liveFeedByEventOrg: Record<string, LiveFeedItem[]> = {
  "org-elitecup": [
    { id: "live-1", time: "09h05", label: "Ouverture du tournoi — story récapitulative", platform: "Instagram" },
    { id: "live-2", time: "10h32", label: "Résultat — Elite Academy 3-1 AS Melun", platform: "Instagram" },
    { id: "live-3", time: "11h48", label: "Clip — but du match, Elite Academy", platform: "TikTok" },
    { id: "live-4", time: "13h15", label: "Photos d'action — phase de poules", platform: "Instagram" },
    { id: "live-5", time: "15h02", label: "Résultat — demi-finale 1", platform: "Instagram" },
  ],
};
