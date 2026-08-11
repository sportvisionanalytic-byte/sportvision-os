import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SERVICE_OPTION_BY_CODE,
  SERVICE_TYPE_LABELS,
  type Service,
  type ServiceOptionCode,
  type ServiceStatus,
  type ServiceType,
} from "@/lib/types/services";

const SERVICE_TYPE_KEYS = new Set(Object.keys(SERVICE_TYPE_LABELS));

function guessServiceType(typePrestation: string | null): ServiceType {
  return (typePrestation && SERVICE_TYPE_KEYS.has(typePrestation) ? typePrestation : "sur_mesure") as ServiceType;
}

/**
 * ServiceType (design, 11 valeurs, Step1Type) → prestations.type_prestation réel. Ce champ est
 * un simple `text default 'match'` sans contrainte CHECK côté schéma, mais le reste de l'OS
 * traite un domaine fixe de 8 valeurs (dropdown de création manuelle SportVision-OS-Full.html,
 * filtre du flux Brief) — même domaine que OFFRE_SLUG_TO_TYPE_PRESTATION dans l'edge function
 * create-guest-request. Un mapping naïf 1:1 est impossible (11 valeurs design vs 8 valeurs OS) :
 * le libellé précis choisi par le client est donc aussi reporté en tête de description_besoin
 * (voir buildDescription) pour ne perdre aucune information utile au staff qui qualifie la
 * demande, même quand deux types design retombent sur le même type_prestation OS.
 */
const SERVICE_TYPE_TO_TYPE_PRESTATION: Record<ServiceType, string> = {
  match_complet: "match",
  entrainement: "entraînement",
  portraits_joueurs: "portrait",
  interview: "autre",
  evenement_club: "événement",
  tournoi_stage: "tournoi",
  shooting_equipe: "portrait",
  captation_drone: "autre",
  evenement_entreprise: "événement",
  contenu_reseaux: "réseaux_sociaux",
  sur_mesure: "autre",
};

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
  description_besoin: string | null;
  montant_ttc: number | null;
  acompte_montant: number | null;
  acompte_recu: boolean;
  acompte_date: string | null;
  created_at: string;
}

// Colonnes réellement exposées par la vue client_prestations (migration-portail-v2.sql, la
// définition la plus récente) — contact_sur_place/telephone_sur_place n'existent ni dans la
// vue ni dans `prestations` et faisaient échouer silencieusement toute la requête (42703).
const SELECT =
  "id, reference, statut, type_prestation, date_prestation, heure_debut, heure_fin, lieu, adresse_complete, description_besoin, montant_ttc, acompte_montant, acompte_recu, acompte_date, created_at";

export async function fetchClientServices(supabase: SupabaseClient, organizationId: string): Promise<Service[]> {
  const { data, error } = await supabase
    .from("client_prestations")
    .select(SELECT)
    .order("date_prestation", { ascending: false });
  if (error) throw error;

  return ((data ?? []) as PrestationRow[]).map((row) => ({
    id: row.id,
    reference: row.reference ?? row.id.slice(0, 8).toUpperCase(),
    organizationId,
    serviceType: guessServiceType(row.type_prestation),
    date: row.date_prestation ?? row.created_at,
    startTime: row.heure_debut ?? "",
    endTime: row.heure_fin ?? "",
    address: row.adresse_complete ?? row.lieu ?? "",
    onSiteContactName: "",
    onSiteContactPhone: "",
    brief: { objective: row.description_besoin ?? "" },
    optionCodes: [],
    basePrice: row.montant_ttc,
    optionsTotal: 0,
    discountAmount: 0,
    travelFees: 0,
    totalPrice: row.montant_ttc,
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

export interface SubmitClientServiceInput {
  serviceType: ServiceType;
  date: string;
  startTime: string;
  endTime: string;
  address: string;
  teamLabel: string;
  contactName: string;
  contactPhone: string;
  needs: string;
  optionCodes: ServiceOptionCode[];
  /** Renonciation au droit de rétractation (article L221-18) — requise quand la date choisie
   * tombe dans les 14 jours, voir needsRetractationWaiver dans lib/types/services.ts. */
  retractationRenoncee: boolean;
}

function buildDescription(input: SubmitClientServiceInput): string | null {
  const parts = [
    `Prestation demandée (Connect) : ${SERVICE_TYPE_LABELS[input.serviceType]}`,
    input.needs.trim() ? `Besoins spécifiques : ${input.needs.trim()}` : null,
  ].filter((p): p is string => !!p);
  return parts.length ? parts.join("\n\n") : null;
}

/**
 * Étape 5 du tunnel (NewServiceTunnel) → INSERT direct dans `prestations`, exactement le même
 * mécanisme que le configurateur Projet vanilla (app/modules/projet-configurateur.js) et le
 * Portail pour un client connecté : la policy RLS "prestations_client_insert" (migration-
 * portail-v2.sql) vérifie `client_users.id = auth.uid() and client_users.client_id =
 * prestations.client_id`, force `statut = 'demande_reçue'` et neutralise tous les champs
 * financiers/internes (staff uniquement). Pour un espace Projet, organizations.id EST
 * clients.id (migration-connect-v2-organizations-entitlements.sql §3.2) : `clientId` ci-dessous
 * est donc directement `ctx.organization.id`, aucune résolution supplémentaire nécessaire.
 *
 * Aucun montant n'est jamais écrit ici (montant_ht/montant_ttc/acompte_montant restent null,
 * comme l'exige la policy) : la tarification affichée aux étapes 4/5 du tunnel est une
 * estimation client-side (computeServicePricing), jamais persistée comme un prix réel — c'est
 * le staff qui chiffre depuis Demandes entrantes une fois la demande qualifiée.
 *
 * Notification staff : automatique via le trigger trg_prestations_notify_demande (migration-
 * portail-v10.sql), qui appelle notify_staff_by_role(['admin','sec'], ...) sur tout INSERT dans
 * `prestations` où `statut = 'demande_reçue' and created_by is null` — exactement le cas ici
 * (created_by n'est jamais renseigné par un client). Aucun appel explicite requis côté front.
 */
export async function submitClientService(
  supabase: SupabaseClient,
  clientId: string,
  input: SubmitClientServiceInput,
): Promise<{ id: string; reference: string | null }> {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("prestations")
    .insert({
      statut: "demande_reçue",
      client_id: clientId,
      type_prestation: SERVICE_TYPE_TO_TYPE_PRESTATION[input.serviceType],
      date_prestation: input.date || null,
      heure_debut: input.startTime || null,
      heure_fin: input.endTime || null,
      adresse_complete: input.address || null,
      equipes: input.teamLabel || null,
      contact_sur_place: input.contactName || null,
      telephone_sur_place: input.contactPhone || null,
      description_besoin: buildDescription(input),
      options_selectionnees: input.optionCodes.map((code) => SERVICE_OPTION_BY_CODE[code].label),
      retractation_renoncee: input.retractationRenoncee,
      retractation_renoncee_at: input.retractationRenoncee ? nowIso : null,
      cgv_acceptee: true,
      cgv_acceptee_le: nowIso,
    })
    .select("id, reference")
    .single();
  if (error || !data) throw error ?? new Error("Envoi de la demande impossible.");
  return data as { id: string; reference: string | null };
}
