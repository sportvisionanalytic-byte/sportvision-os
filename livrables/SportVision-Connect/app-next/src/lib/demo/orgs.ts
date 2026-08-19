// Données factices PAR ORGANISATION (pas par profil) — un profil "rôle" (Coach, Trésorier...)
// partage légitimement les données de SON club (c'est le même FC Fontainebleau vu par des
// personnes différentes). Ce qui ne doit JAMAIS être partagé, c'est le contenu entre
// organisations différentes (un coach indépendant, une académie, un tournoi et une agence CM
// n'ont aucune raison de voir les mêmes matchs/contenus/factures que FC Fontainebleau) — bug
// relevé par l'audit du 19/08/2026 sur la première version de cette démo, qui réutilisait un
// unique jeu de données partout.

export interface OrgContentItem {
  title: string;
  kind: string;
}
export interface OrgCalendarItem {
  primary: string;
  secondary?: string;
  meta?: string;
}
export interface OrgInvoiceRow {
  label: string;
  amount: string;
  due: string;
  status: string;
}
export interface OrgTeamRow {
  primary: string;
  secondary?: string;
  meta?: string;
}
export interface OrgData {
  contactName: string;
  content: OrgContentItem[];
  calendar: OrgCalendarItem[];
  invoices: OrgInvoiceRow[];
  teams: OrgTeamRow[];
}

export const ORG_DATA: Record<string, OrgData> = {
  "demo-club": {
    contactName: "Léa Fontaine",
    content: [
      { title: "Match vs AS Melun — Highlights", kind: "video" },
      { title: "Portraits d'équipe — Rentrée", kind: "photo" },
      { title: "Entraînement collectif", kind: "video" },
      { title: "Affiche tournoi de rentrée", kind: "creation" },
      { title: "Interview capitaine", kind: "video" },
      { title: "Célébration but", kind: "photo" },
      { title: "Séance vidéo analyse", kind: "video" },
      { title: "Logo club HD", kind: "creation" },
    ],
    calendar: [
      { primary: "FC Fontainebleau — US Nemours", secondary: "Match · 24/08 15h00", meta: "Stade Municipal" },
      { primary: "Entraînement collectif", secondary: "21/08 18h30", meta: "Terrain B" },
      { primary: "Tournage Match Center", secondary: "SportVision · 24/08 14h45", meta: "Stade Municipal" },
    ],
    invoices: [
      { label: "Abonnement Club+ Performance — Août 2026", amount: "129,00 €", due: "05/08/2026", status: "Payée" },
      { label: "Pack Match Complet — 24/08", amount: "160,00 €", due: "24/08/2026", status: "En attente" },
      { label: "Montage saison U17", amount: "220,00 €", due: "10/08/2026", status: "Payée" },
    ],
    teams: [
      { primary: "U17", secondary: "18 joueurs", meta: "Coach : Marc D." },
      { primary: "U15", secondary: "16 joueurs", meta: "Coach : Sophie L." },
      { primary: "Seniors A", secondary: "22 joueurs", meta: "Coach : Karim B." },
    ],
  },
  "demo-coach": {
    contactName: "Léa Fontaine",
    content: [
      { title: "Séance technique — Nathan R.", kind: "video" },
      { title: "Analyse vidéo — coup franc", kind: "video" },
      { title: "Portrait joueur — bilan de saison", kind: "photo" },
    ],
    calendar: [
      { primary: "Séance technique — Nathan R.", secondary: "21/08 17h00", meta: "Terrain annexe" },
      { primary: "Séance vidéo — analyse match", secondary: "23/08 18h00" },
    ],
    invoices: [
      { label: "Tournage séance technique — 21/08", amount: "90,00 €", due: "21/08/2026", status: "Payée" },
      { label: "Montage analyse vidéo", amount: "60,00 €", due: "28/08/2026", status: "En attente" },
    ],
    teams: [
      { primary: "Nathan R.", secondary: "Suivi individuel", meta: "Depuis 03/2026" },
      { primary: "Emma D.", secondary: "Suivi individuel", meta: "Depuis 05/2026" },
    ],
  },
  "demo-academy": {
    contactName: "Léa Fontaine",
    content: [
      { title: "Portes ouvertes académie", kind: "video" },
      { title: "Portraits promo 2026", kind: "photo" },
      { title: "Bilan stage été", kind: "creation" },
    ],
    calendar: [
      { primary: "Stage vacances d'été", secondary: "24-28/08 · Groupe U13/U15", meta: "Centre sportif" },
      { primary: "Portes ouvertes", secondary: "05/09 10h00" },
    ],
    invoices: [
      { label: "Abonnement Club+ Start — Août 2026", amount: "49,00 €", due: "05/08/2026", status: "Payée" },
      { label: "Reportage portes ouvertes", amount: "180,00 €", due: "05/09/2026", status: "En attente" },
    ],
    teams: [
      { primary: "Groupe U13/U15", secondary: "24 stagiaires", meta: "Responsable : Julie M." },
      { primary: "Groupe U9/U11", secondary: "18 stagiaires", meta: "Responsable : Karim B." },
    ],
  },
  "demo-tournament": {
    contactName: "Léa Fontaine",
    content: [
      { title: "Bande-annonce édition 2026", kind: "video" },
      { title: "Affiche officielle", kind: "creation" },
      { title: "Résumé édition 2025", kind: "video" },
    ],
    calendar: [
      { primary: "Tournoi International U15 — 2026", secondary: "6-7 septembre 2026", meta: "Complexe sportif de Melun" },
      { primary: "Réunion logistique", secondary: "28/08 14h00" },
    ],
    invoices: [
      { label: "Prestation captation — édition 2026", amount: "890,00 €", due: "06/09/2026", status: "En attente" },
    ],
    teams: [
      { primary: "16 équipes inscrites", secondary: "Édition 2026", meta: "Clôture des inscriptions : 30/08" },
    ],
  },
  "demo-camp": {
    contactName: "Léa Fontaine",
    content: [
      { title: "Aftermovie semaine 1", kind: "video" },
      { title: "Photos activités plein air", kind: "photo" },
    ],
    calendar: [
      { primary: "Semaine 1 — U13/U15", secondary: "24-28/08/2026", meta: "Complet" },
      { primary: "Semaine 2 — U9/U11", secondary: "31/08-04/09/2026", meta: "Places disponibles" },
    ],
    invoices: [
      { label: "Prestation captation — Semaine 1", amount: "450,00 €", due: "28/08/2026", status: "En attente" },
    ],
    teams: [
      { primary: "Semaine 1", secondary: "32 participants", meta: "U13/U15" },
      { primary: "Semaine 2", secondary: "20 participants", meta: "U9/U11" },
    ],
  },
  "demo-sponsor": {
    contactName: "Léa Fontaine",
    content: [
      { title: "Logo Decathlon sur maillots U17", kind: "photo" },
      { title: "Story partenariat", kind: "video" },
    ],
    calendar: [{ primary: "Opération dédicace boutique", secondary: "14/09/2026 10h00", meta: "Decathlon Fontainebleau" }],
    invoices: [{ label: "Partenariat annuel 2025-2026", amount: "2 500,00 €", due: "01/09/2025", status: "Payée" }],
    teams: [],
  },
  "demo-generic": {
    contactName: "Léa Fontaine",
    content: [
      { title: "Séance photo studio — commande #1842", kind: "photo" },
      { title: "Livrables retouchés", kind: "photo" },
    ],
    calendar: [{ primary: "Séance photo studio", secondary: "22/08 10h00", meta: "Studio Fontainebleau" }],
    invoices: [{ label: "Séance photo studio", amount: "180,00 €", due: "22/08/2026", status: "En attente" }],
    teams: [],
  },
  "demo-cm-agency": {
    contactName: "Léa Fontaine",
    content: [
      { title: "Planning éditorial multi-clubs — semaine 34", kind: "creation" },
    ],
    calendar: [{ primary: "Point hebdo clubs suivis", secondary: "Chaque lundi 9h00" }],
    invoices: [],
    teams: [
      { primary: "FC Fontainebleau", secondary: "Club suivi", meta: "Accès délégué" },
      { primary: "Académie Horizon Sport", secondary: "Club suivi", meta: "Accès délégué" },
    ],
  },
};

export function orgData(orgId: string): OrgData {
  return ORG_DATA[orgId] ?? ORG_DATA["demo-club"]!;
}
