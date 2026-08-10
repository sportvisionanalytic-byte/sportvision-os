// Données fictives mais réalistes pour les espaces Joueur, Parent, Sponsor, CM externe, Client
// ponctuel et Structure générique — voir README.md § Fidélité. À remplacer par de vraies
// requêtes quand la couche de données réelle sera branchée (décision séparée, voir
// src/lib/mock-data.ts). Clés par identifiant d'organisation pour suivre le changement
// d'espace actif (useSession().ctx.organization.id).

import type {
  AccompagnementInclusion,
  ChildDocument,
  ChildImageRight,
  ChildProfile,
  DelegatedAccess,
  SponsorOperation,
} from "../types/persona";

// ---------------------------------------------------------------------------------------------
// Parent — /children et /authorizations (ACTIONS.md § 20). Famille Fournier suit deux enfants
// licenciés à FC Fontainebleau.
// ---------------------------------------------------------------------------------------------

export const childrenByParentOrg: Record<string, ChildProfile[]> = {
  "org-fournier": [
    {
      id: "child-lea",
      firstName: "Léa",
      lastName: "Fournier",
      age: 14,
      clubName: "FC Fontainebleau",
      teamName: "U15 Filles",
      shirtNumber: "7",
      position: "Milieu offensif",
      coachName: "Karim Belaïd",
      contentCount: 18,
      imageRightStatus: "signed",
    },
    {
      id: "child-noah",
      firstName: "Noah",
      lastName: "Fournier",
      age: 11,
      clubName: "FC Fontainebleau",
      teamName: "U13",
      shirtNumber: "10",
      position: "Attaquant",
      coachName: "Sami Rachedi",
      contentCount: 6,
      imageRightStatus: "pending",
    },
  ],
};

export const childImageRightsByChild: Record<string, ChildImageRight> = {
  "child-lea": {
    childId: "child-lea",
    scopes: {
      team_match_photos: true,
      videos_highlights: true,
      individual_portraits: true,
      commercial_use: false,
      off_club_distribution: false,
    },
    signedByName: "Camille Fournier",
    signedAt: "2025-09-04",
  },
  "child-noah": {
    childId: "child-noah",
    scopes: {
      team_match_photos: false,
      videos_highlights: false,
      individual_portraits: false,
      commercial_use: false,
      off_club_distribution: false,
    },
  },
};

export const childDocumentsByChild: Record<string, ChildDocument[]> = {
  "child-lea": [
    { id: "doc-lea-1", childId: "child-lea", label: "Autorisation droit à l'image", action: "download", status: "up_to_date" },
    { id: "doc-lea-2", childId: "child-lea", label: "Certificat médical de non contre-indication", action: "upload", status: "up_to_date" },
  ],
  "child-noah": [
    { id: "doc-noah-1", childId: "child-noah", label: "Autorisation droit à l'image", action: "sign", status: "action_required" },
    { id: "doc-noah-2", childId: "child-noah", label: "Fiche sanitaire de liaison", action: "upload", status: "action_required" },
  ],
};

// ---------------------------------------------------------------------------------------------
// SportVision — interlocuteurs, pour /dashboard et /accompagnement (ACTIONS.md § 21).
// ---------------------------------------------------------------------------------------------

export const SV_TEAM: Record<string, { name: string; role: string }> = {
  "sv-theo-marchand": { name: "Théo Marchand", role: "Chargé de compte" },
  "sv-nina-berger": { name: "Nina Berger", role: "Community Manager" },
};

/** Client classique — 4 cartes d'inclusions dérivées du catalogue (ACTIONS.md § 21). */
export function accompagnementInclusions(planName: string, creditsLabel: string, presences: number): AccompagnementInclusion[] {
  return [
    { title: "Votre chargé de compte", description: "Un interlocuteur unique pour vos demandes, vos prestations et le suivi de votre contrat." },
    { title: "Le Studio SportVision", description: `${creditsLabel} pour vos visuels — templates, mises en page et exports prêts à publier.` },
    { title: "Vos présences terrain", description: `${presences} présence${presences > 1 ? "s" : ""} SportVision incluse${presences > 1 ? "s" : ""} dans votre offre ${planName}.` },
    { title: "Suivi et support", description: "Une réponse sous 24 h ouvrées, un point de suivi mensuel et un accès direct à votre conseiller." },
  ];
}

// followUpPoints / monthlyFigures / accompagnementContacts (mock) supprimés le 10/08/2026 —
// remplacés par de vraies données dans accompagnement/page.tsx (Tier C Phase 3) : chargé de
// compte via client_cm (data/shared/community-manager.ts, comme /mycm), 4 chiffres du mois
// vérifiés un par un (voir le commentaire en tête de page.tsx). Aucune source réelle
// n'existe pour un « point de suivi mensuel » à date (ni RDV CM↔client, voir le raisonnement déjà
// posé pour /mycm) — la page l'indique honnêtement plutôt que d'inventer un calendrier.

// ---------------------------------------------------------------------------------------------
// CM externe — /accompagnement « Mes accès délégués » (ACTIONS.md § 21).
// ---------------------------------------------------------------------------------------------

export const delegatedAccessByCmOrg: Record<string, DelegatedAccess[]> = {
  "org-ninaberger": [
    {
      id: "delegated-fcf",
      clubName: "FC Fontainebleau",
      allowed: ["Créer des publications", "Répondre aux messages Communication", "Consulter la médiathèque"],
      denied: ["Facturation", "Gestion des utilisateurs", "Paramètres du club"],
      expiresAt: "2026-12-31",
    },
    {
      id: "delegated-melun",
      clubName: "AS Melun",
      allowed: ["Créer des publications", "Programmer le planning éditorial"],
      denied: ["Facturation", "Contrats", "Gestion des utilisateurs"],
      expiresAt: "2026-10-15",
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// Sponsor — /dashboard (ACTIONS.md § 20 bis). Varenne Auto suit sa visibilité chez US Varenne.
// ---------------------------------------------------------------------------------------------

export const sponsorOperationsByOrg: Record<string, SponsorOperation[]> = {
  "org-varenneauto": [
    { label: "Bâche publicitaire — bord de terrain", date: "Saison 2026-2027", status: "completed" },
    { label: "Mention sur le maillot extérieur", date: "Saison 2026-2027", status: "completed" },
    { label: "Publication dédiée — présentation partenaire", date: "18 septembre 2026", status: "planned" },
  ],
};

export const sponsorDeliverables: Record<string, { delivered: number; planned: number }> = {
  "org-varenneauto": { delivered: 7, planned: 12 },
};
