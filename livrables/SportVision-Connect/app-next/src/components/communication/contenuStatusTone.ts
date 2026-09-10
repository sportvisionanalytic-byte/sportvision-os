import type { BadgeTone } from "@/components/ui/Badge";
import type { ContenuStatut } from "@/lib/data/shared/contenus";

// Libellé + couleur d'un statut `contenus` réel — CHARTE.md § Badges de statut (couleur +
// libellé texte, jamais la couleur seule). Extrait de /communication (page d'origine) pour être
// réutilisé tel quel par le dashboard Full Communication, plutôt que dupliqué avec un risque de
// libellé divergent entre les deux écrans.
export const CONTENU_STATUT_LABEL: Record<ContenuStatut, string> = {
  brouillon: "Brouillon",
  a_valider_interne: "À relire (SportVision)",
  a_valider_tuteur: "À relire (tuteur)",
  pret: "Prêt",
  a_valider_client: "À valider",
  corrections: "Corrections demandées",
  valide: "Validé",
  programme: "Programmé",
  publie: "Publié",
  archive: "Archivé",
};

export const CONTENU_STATUT_TONE: Record<ContenuStatut, BadgeTone> = {
  brouillon: "neutral",
  a_valider_interne: "warning",
  a_valider_tuteur: "warning",
  pret: "info",
  a_valider_client: "warning",
  corrections: "danger",
  valide: "info",
  programme: "info",
  publie: "success",
  archive: "neutral",
};
