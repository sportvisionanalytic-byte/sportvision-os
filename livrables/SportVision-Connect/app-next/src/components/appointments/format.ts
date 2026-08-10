import type { BadgeTone } from "@/components/ui/Badge";
import type { RdvStatut, RdvType } from "@/lib/data/projet/rdv";

// Libellés et tons — reprend RDV_BADGE du vanilla (app/modules/projet-demandes-livrables-
// messagerie-compte.js, ligne 109) : a_confirmer/confirme/annule/realise sont les 4 seules
// valeurs du CHECK sur rendez_vous.statut (migration-portail-v1.sql), même énumération utilisée
// côté OS (confirmerRdvClient/annulerRdvClient/marquerRealiseRdvClient).

export const RDV_STATUT_LABEL: Record<RdvStatut, string> = {
  a_confirmer: "À confirmer",
  confirme: "Confirmé",
  annule: "Annulé",
  realise: "Réalisé",
};

export const RDV_STATUT_TONE: Record<RdvStatut, BadgeTone> = {
  a_confirmer: "warning",
  confirme: "success",
  annule: "danger",
  realise: "neutral",
};

export const RDV_TYPE_LABEL: Record<RdvType, string> = {
  appel: "Appel téléphonique",
  physique: "Rendez-vous physique",
};

export function formatRdvDate(dateDemandee: string | null, heureDemandee: string | null): string {
  if (!dateDemandee) return "—";
  const date = new Date(dateDemandee).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  return heureDemandee ? `${date} à ${heureDemandee.slice(0, 5)}` : date;
}
