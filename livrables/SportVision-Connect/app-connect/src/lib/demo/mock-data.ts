// Données factices pour la démo interne /demo — voir src/app/demo/*.
//
// AUCUNE de ces données n'est réelle et AUCUNE page /demo ne doit jamais lire/écrire dans
// Supabase sur des tables sensibles (profils, messages, factures, affiliations...). Seule
// exception volontaire : le catalogue de prestations (`catalogue_offres`) est lu en direct
// via fetchPlayerCatalogue() dans demo/prestations/page.tsx, car cette table a une policy RLS
// de lecture publique (catalogue_public_read) — c'est déjà le même catalogue que la vitrine
// publique affiche sans connexion, donc aucune donnée utilisateur n'est exposée.
//
// Temporaire (demandé par Fouka le 19/08) : à retirer avant le lancement public si plus utile.

import type { ContentItem } from "@/app/(joueur)/contenus/ContentGallery";
import type { CalendarEventData } from "@/app/(joueur)/calendrier/CalendarView";
import type { FundingRow } from "@/app/(joueur)/cotisations/FundingTabs";
import type { FundingDetail } from "@/app/(joueur)/cotisations/[id]/FundingDetailView";
import type { MessageData } from "@/app/(joueur)/messages/messageAttachments";

export const DEMO_FIRST_NAME = "Lucas";
export const DEMO_LAST_NAME = "Martin";
export const DEMO_EMAIL = "lucas.martin@exemple.fr";

export const DEMO_CLUB = {
  id: "demo-club",
  nom: "FC Fontainebleau",
  ville: "Fontainebleau",
  since: "2025-09-02T00:00:00.000Z",
  status: "affilie" as const,
  logoUrl: null as string | null,
};

export const DEMO_CONTENT_ITEMS: ContentItem[] = [
  { id: "demo-c1", title: "Match vs FC Melun — Highlights", type: "video", team: "U17", link: null, tags: "Highlight,Match", createdAt: "2026-08-10T18:00:00.000Z" },
  { id: "demo-c2", title: "Portraits d'équipe — Rentrée 2026", type: "photo", team: "U17", link: null, tags: "Portraits", createdAt: "2026-08-05T10:00:00.000Z" },
  { id: "demo-c3", title: "Célébration après victoire", type: "photo", team: "U17", link: null, tags: "Match", createdAt: "2026-07-28T17:30:00.000Z" },
  { id: "demo-c4", title: "Séance d'entraînement — Ambiance", type: "video", team: "U17", link: null, tags: "Entraînement", createdAt: "2026-07-20T09:00:00.000Z" },
  { id: "demo-c5", title: "Affiche du tournoi d'été", type: "creation", team: null, link: null, tags: "Tournoi", createdAt: "2026-07-12T08:00:00.000Z" },
];

export const DEMO_CALENDAR_EVENTS: CalendarEventData[] = [
  { id: "demo-e1", kind: "match", title: "FC Fontainebleau vs AS Melun", date: "2026-08-24", time: "15:00:00", location: "Stade Municipal, Fontainebleau", clubName: DEMO_CLUB.nom, teamName: "U17" },
  { id: "demo-e2", kind: "entrainement", title: "Entraînement collectif", date: "2026-08-21", time: "18:30:00", location: "Terrain B", clubName: DEMO_CLUB.nom, teamName: "U17" },
  { id: "demo-e3", kind: "prestation", title: "Caméra isolée — captation", date: "2026-08-24", time: "14:45:00", location: "Stade Municipal, Fontainebleau", clubName: DEMO_CLUB.nom, teamName: "U17" },
  { id: "demo-e4", kind: "tournoi", title: "Tournoi inter-clubs", date: "2026-09-06", time: null, location: "Complexe sportif de Melun", clubName: DEMO_CLUB.nom, teamName: "U17" },
];

export const DEMO_MESSAGES: MessageData[] = [
  { id: "demo-m1", auteur: "staff", contenu: "Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.", pieceJointeUrl: null, lu: true, createdAt: "2026-08-01T09:00:00.000Z" },
  { id: "demo-m2", auteur: "client", contenu: "Bonjour, à quelle heure arrive l'opérateur samedi ?", pieceJointeUrl: null, lu: true, createdAt: "2026-08-17T11:15:00.000Z" },
  { id: "demo-m3", auteur: "staff", contenu: "Bonjour Lucas, l'opérateur sera sur place dès 14h45 pour le coup d'envoi à 15h.", pieceJointeUrl: null, lu: false, createdAt: "2026-08-17T11:42:00.000Z" },
];

export const DEMO_FUNDING: FundingRow[] = [
  {
    id: "demo-f1",
    group_id: "demo-team",
    group_name: "U17 FC Fontainebleau",
    titre: "Pack Match Complet vs AS Melun",
    contexte: "Match du 24 août",
    catalogue_offre_nom: "Pack Match Complet",
    montant_cible: 160,
    montant_collecte: 100,
    repartition_mode: "egale",
    nb_participants_prevu: 8,
    date_limite: "2026-08-23T00:00:00.000Z",
    statut: "ouverte",
    is_creator: true,
    participants_count: 5,
    my_contribution_amount: 20,
    created_at: "2026-08-18T09:00:00.000Z",
  },
];

export const DEMO_FUNDING_DETAIL: FundingDetail = {
  id: "demo-f1",
  group_id: "demo-team",
  group_name: "U17 FC Fontainebleau",
  created_by: "demo-user",
  is_creator: true,
  titre: "Pack Match Complet vs AS Melun",
  contexte: "Match du 24 août",
  catalogue_offre_nom: "Pack Match Complet",
  montant_cible: 160,
  montant_collecte: 100,
  repartition_mode: "egale",
  nb_participants_prevu: 8,
  date_limite: "2026-08-23T00:00:00.000Z",
  statut: "ouverte",
  share_token: "demo-token",
  created_at: "2026-08-18T09:00:00.000Z",
  my_contribution_amount: 20,
  contributions: [
    { id: "demo-contrib-1", name: "Lucas Martin", is_guest: false, montant: 20, created_at: "2026-08-18T09:05:00.000Z" },
    { id: "demo-contrib-2", name: "Tom D.", is_guest: false, montant: 20, created_at: "2026-08-18T10:30:00.000Z" },
    { id: "demo-contrib-3", name: "Nathan R.", is_guest: false, montant: 20, created_at: "2026-08-18T14:12:00.000Z" },
    { id: "demo-contrib-4", name: "Un proche", is_guest: true, montant: 20, created_at: "2026-08-18T16:45:00.000Z" },
    { id: "demo-contrib-5", name: "Un proche", is_guest: true, montant: 20, created_at: "2026-08-18T18:20:00.000Z" },
  ],
};

export const DEMO_GROUPS = [
  {
    id: "demo-team",
    name: "U17 FC Fontainebleau",
    description: "Groupe de l'équipe pour organiser nos prestations SportVision.",
    created_by: "demo-user",
    is_creator: true,
    member_count: 8,
    member_previews: [
      { user_id: "demo-u1", initial: "L" },
      { user_id: "demo-u2", initial: "T" },
      { user_id: "demo-u3", initial: "N" },
    ],
    has_active_funding: true,
  },
];

// Montant du solde volontairement cohérent avec DEMO_FUNDING (160€ - 100€ déjà collectés via
// le paiement collectif = 60€ restants) — pas les 160€ bruts de la prestation, qui donnerait
// l'impression que rien n'a encore été payé (trouvé lors de l'audit du 19/08).
export const DEMO_INVOICES = [
  {
    id: "demo-i1",
    label: "Pack Match Complet",
    sub: "Solde restant après paiement collectif (100 € déjà collectés sur 160 €)",
    amount: 60,
    status: "a_regler" as const,
    prestationDate: "2026-08-24T00:00:00.000Z",
    factureDate: "2026-08-18T00:00:00.000Z",
  },
  {
    id: "demo-i2",
    label: "Match Photo",
    sub: null,
    amount: 120,
    status: "payee" as const,
    prestationDate: "2026-08-10T00:00:00.000Z",
    factureDate: "2026-08-10T00:00:00.000Z",
  },
];

export const DEMO_ORDERS = [
  { id: "demo-o1", label: "Pack Match Complet vs AS Melun", status: "confirmee" as const, date: "2026-08-24T15:00:00.000Z" },
  { id: "demo-o2", label: "Match Photo vs FC Melun", status: "livree" as const, date: "2026-08-10T15:00:00.000Z" },
];
