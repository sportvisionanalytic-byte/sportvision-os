// Données fictives mais réalistes pour l'espace Tournoi Full Communication — voir ACTIONS.md
// § 10, README.md § Fidélité. Clés par identifiant d'organisation pour suivre le changement
// d'espace actif.
//
// sessionsByCoachOrg/campsByAcademyOrg (Coach/Académie) retirés le 10/08/2026 (plan Tier C
// § Phase 1 Séances/Stages) : /sessions et /camps lisent désormais calendar_events réel (voir
// data/coach/sessions.ts, data/academie/camps.ts), plus besoin de ce mock. eventPhasesByEventOrg/
// liveStatsByEventOrg/liveFeedByEventOrg (Tournoi, /eventtimeline et /live) restent mockés — hors
// périmètre de cette phase, voir le plan Tier C § Phase 4.

import type { EventPhase, LiveFeedItem, LiveStat } from "../types/events";

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
