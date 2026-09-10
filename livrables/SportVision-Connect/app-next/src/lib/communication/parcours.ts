// Le parcours d'une demande de communication, en six étapes (demande de Fouka, 10/09/2026) :
// Demande → Brief → Production → Validation → Programmation → Publié.
//
// Aucune étape n'est stockée : elle se DÉDUIT du statut de la demande (`club_requests.status`) et
// de celui de son contenu (`contenus.statut`, relié par `request_id`). Deux sources, une lecture —
// pas de troisième statut qui finirait par diverger. Testé dans __tests__/parcours.test.ts.

export const ETAPES_PARCOURS = ["Demande", "Brief", "Production", "Validation", "Programmation", "Publié"] as const;

export interface EtatParcours {
  /** Index dans ETAPES_PARCOURS, ou -1 quand le parcours s'est arrêté (refus, archive). */
  etape: number;
  arret: string | null;
}

export function etatParcours(statutDemande: string | null, statutContenu: string | null): EtatParcours {
  if (statutDemande === "refusee") return { etape: -1, arret: "Demande refusée" };
  if (!statutContenu) {
    // Pas encore de contenu : la demande est reçue, ou déjà en cours de brief côté CM.
    if (statutDemande === "en_traitement" || statutDemande === "prete_a_creer") return { etape: 1, arret: null };
    return { etape: 0, arret: null };
  }
  switch (statutContenu) {
    case "brouillon":
      return { etape: 1, arret: null };
    case "a_valider_interne":
    case "pret":
      return { etape: 2, arret: null };
    case "a_valider_client":
    case "a_valider_tuteur":
    case "corrections":
      return { etape: 3, arret: null };
    case "valide":
    case "programme":
      return { etape: 4, arret: null };
    case "publie":
      return { etape: 5, arret: null };
    case "archive":
      return { etape: -1, arret: "Contenu archivé" };
    default:
      return { etape: 1, arret: null };
  }
}
