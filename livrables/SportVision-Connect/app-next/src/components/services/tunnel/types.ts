import type { ServiceOptionCode, ServiceType } from "@/lib/types/services";

// État local du tunnel de demande — voir ACTIONS.md § 12 « Tunnel — 5 étapes ». Aucune
// persistance : la demande est simulée côté client, il n'y a pas encore de backend
// (voir app-next/README.md § Décision volontairement pas prise ici).
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
  depositMethod: "card" | "cash";
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
  depositMethod: "card",
  acceptedTerms: false,
};

export const TUNNEL_STEPS = [
  "Type de prestation",
  "Informations et lieu",
  "Options",
  "Tarification",
  "Récapitulatif",
];
