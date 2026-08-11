import type { ServiceOptionCode, ServiceType } from "@/lib/types/services";

// État local du tunnel de demande — voir ACTIONS.md § 12 « Tunnel — 5 étapes ». Espace Projet
// (organization.type === "generic") uniquement : la soumission finale déclenche un vrai INSERT
// dans `prestations` — voir NewServiceTunnel.tsx:handleSubmit et lib/data/projet/services.ts.
//
// Pas de champ `depositMethod` (carte/espèces) : le choix du mode de règlement de l'acompte a
// été retiré du tunnel de réservation public (reserver.html, 09/08/2026) et n'a jamais eu de
// colonne dédiée côté `prestations` pour un client Connect authentifié (mode_paiement_choisi
// n'existe que côté vitrine/invité) — décision reprise ici à l'identique pour rester cohérent.
export interface TunnelState {
  serviceType: ServiceType | null;
  date: string;
  startTime: string;
  endTime: string;
  address: string;
  teamLabel: string;
  contactName: string;
  contactPhone: string;
  needs: string;
  optionCodes: ServiceOptionCode[];
  /** Renonciation au droit de rétractation — voir needsRetractationWaiver (lib/types/services.ts). */
  retractationRenoncee: boolean;
  acceptedTerms: boolean;
}

export const INITIAL_TUNNEL_STATE: TunnelState = {
  serviceType: null,
  date: "",
  startTime: "",
  endTime: "",
  address: "",
  teamLabel: "",
  contactName: "",
  contactPhone: "",
  needs: "",
  optionCodes: [],
  retractationRenoncee: false,
  acceptedTerms: false,
};

export const TUNNEL_STEPS = [
  "Type de prestation",
  "Informations et lieu",
  "Options",
  "Tarification",
  "Récapitulatif",
];
