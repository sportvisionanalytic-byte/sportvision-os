import type { SupabaseClient } from "@supabase/supabase-js";
import { SERVICE_TYPE_LABELS, type Service, type ServiceStatus, type ServiceType } from "@/lib/types/services";

const SERVICE_TYPE_KEYS = new Set(Object.keys(SERVICE_TYPE_LABELS));

function guessServiceType(typePrestation: string | null): ServiceType {
  return (typePrestation && SERVICE_TYPE_KEYS.has(typePrestation) ? typePrestation : "sur_mesure") as ServiceType;
}

// client_prestations (vue, migration-portail-v2.sql, sur `prestations`) — contrairement à
// club_bookings (verrouillé en Phase 1), cette table a des montants numériques réels
// (montant_ttc, acompte_montant) : la liste/kanban est donc branchable honnêtement. La fiche
// détail à 10 onglets et le tunnel de création à 5 étapes du design (équipe, jalons, livrables,
// fichiers, messages — aucun n'a d'équivalent réel) restent hors scope de cette phase, voir le
// plan Phase 3 § Hors scope — /services/[id] et /services/new continuent de résoudre "introuvable"
// / verrouillé pour un vrai client, sans donnée fabriquée.
//
// Écriture : INSERT direct autorisé par `prestations_client_insert` (policy stricte : force
// statut='demande_reçue' et tous les champs financiers/internes à leur valeur neutre — voir la
// migration) ; annulation via la RPC `client_cancel_prestation` (avant qu'un devis soit accepté).

const STATUS_MAP: Record<string, ServiceStatus> = {
  demande_reçue: "demande_recue",
  à_qualifier: "demande_recue",
  offre_en_préparation: "a_valider",
  devis_envoyé: "devis_envoye",
  en_attente_réponse: "devis_envoye",
  devis_accepté: "contrat_a_signer",
  en_attente_signature: "contrat_a_signer",
  en_attente_acompte: "paiement_en_attente",
  documents_complets: "paiement_en_attente",
  à_valider_production: "planifiee",
  confirmée: "planifiee",
  à_planifier: "planifiee",
  planifiée: "planifiee",
  équipe_affectée: "planifiee",
  prête: "planifiee",
  équipe_en_route: "planifiee",
  arrivée_sur_place: "planifiee",
  production_démarrée: "en_cours",
  production_terminée: "en_cours",
  médias_à_transférer: "en_cours",
  médias_complets: "en_cours",
  à_monter: "postproduction",
  montage_en_cours: "postproduction",
  prêt_validation: "postproduction",
  à_valider_client: "a_valider_livrables",
  prête_à_livrer: "livree",
  livrée: "livree",
  facturée: "terminee",
  partiellement_payée: "terminee",
  payée: "terminee",
  clôturée: "terminee",
  annulée: "annulee",
  refusée: "annulee",
};

interface PrestationRow {
  id: string;
  reference: string | null;
  statut: string;
  type_prestation: string | null;
  date_prestation: string | null;
  heure_debut: string | null;
  heure_fin: string | null;
  lieu: string | null;
  adresse_complete: string | null;
  contact_sur_place: string | null;
  telephone_sur_place: string | null;
  description_besoin: string | null;
  montant_ttc: number | null;
  acompte_montant: number | null;
  acompte_recu: boolean;
  acompte_date: string | null;
  created_at: string;
}

const SELECT =
  "id, reference, statut, type_prestation, date_prestation, heure_debut, heure_fin, lieu, adresse_complete, contact_sur_place, telephone_sur_place, description_besoin, montant_ttc, acompte_montant, acompte_recu, acompte_date, created_at";

export async function fetchClientServices(supabase: SupabaseClient, organizationId: string): Promise<Service[]> {
  const { data } = await supabase.from("client_prestations").select(SELECT).order("date_prestation", { ascending: false });

  return ((data ?? []) as PrestationRow[]).map((row) => ({
    id: row.id,
    reference: row.reference ?? row.id.slice(0, 8).toUpperCase(),
    organizationId,
    serviceType: guessServiceType(row.type_prestation),
    date: row.date_prestation ?? row.created_at,
    startTime: row.heure_debut ?? "",
    endTime: row.heure_fin ?? "",
    address: row.adresse_complete ?? row.lieu ?? "",
    onSiteContactName: row.contact_sur_place ?? "",
    onSiteContactPhone: row.telephone_sur_place ?? "",
    brief: { objective: row.description_besoin ?? "" },
    optionCodes: [],
    basePrice: row.montant_ttc ?? 0,
    optionsTotal: 0,
    discountAmount: 0,
    travelFees: 0,
    totalPrice: row.montant_ttc ?? 0,
    depositAmount: row.acompte_montant ?? 0,
    depositPaidAt: row.acompte_recu ? (row.acompte_date ?? undefined) : undefined,
    status: STATUS_MAP[row.statut] ?? "demande_recue",
    progressPercent: 0,
    operatorIds: [],
    isIncludedInPlan: false,
    createdAt: row.created_at,
    team: [],
    milestones: [],
    deliverables: [],
    files: [],
    history: [],
    messages: [],
    horairesConfirmed: false,
  }));
}

export async function cancelClientService(supabase: SupabaseClient, prestationId: string): Promise<void> {
  const { error } = await supabase.rpc("client_cancel_prestation", { p_prestation_id: prestationId });
  if (error) throw error;
}
