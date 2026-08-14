// Types renvoyés par l'edge function connect-player-prestations (voir
// livrables/SportVision-TV/supabase/functions/connect-player-prestations/index.ts) — le shape
// est défini côté fonction, ce fichier ne fait que le typer côté client.

export interface PlayerOrder {
  id: string;
  reference: string;
  statut: string; // valeur brute prestations.statut — voir lib/prestations/status.ts pour le mapping
  offreNom: string | null;
  categorie: string | null;
  datePrestation: string | null;
  heureDebut: string | null;
  heureFin: string | null;
  lieu: string | null;
  adresseComplete: string | null;
  equipes: string | null;
  descriptionBesoin: string | null;
  optionsSelectionnees: string[];
  montantTtc: number | null; // chiffré par le staff (prestations.montant_ttc) si déjà renseigné
  montantEstime: number | null; // sinon, estimation catalogue (offre + options), jamais un prix inventé
  statutFinancier: string;
  acompteRecu: boolean;
  createdAt: string;
}

export interface PlayerOrderDocument {
  kind: "facture" | "paiement";
  id: string;
  reference: string;
  statut: string;
  montant: number;
  date: string | null;
  pdfUrl?: string | null;
}

export interface PlayerInvoice {
  id: string;
  numero: string;
  typeFacture: string | null;
  statut: string;
  prestationId: string | null;
  prestationRef: string | null;
  offreNom: string | null;
  montantHt: number;
  tvaPct: number;
  montantTtc: number;
  dateEmission: string | null;
  dateEcheance: string | null;
  pdfUrl: string | null;
}

export interface PlayerPayment {
  id: string;
  typePaiement: string;
  montant: number;
  statut: string;
  prestationId: string | null;
  prestationRef: string | null;
  offreNom: string | null;
  createdAt: string;
}
