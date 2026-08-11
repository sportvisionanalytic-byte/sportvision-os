import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SERVICE_OPTION_BY_CODE,
  SERVICE_TYPE_LABELS,
  type CatalogueOffer,
  type Service,
  type ServiceOptionCode,
  type ServiceStatus,
  type ServiceType,
} from "@/lib/types/services";

const SERVICE_TYPE_KEYS = new Set(Object.keys(SERVICE_TYPE_LABELS));

function guessServiceType(typePrestation: string | null): ServiceType {
  return (typePrestation && SERVICE_TYPE_KEYS.has(typePrestation) ? typePrestation : "sur_mesure") as ServiceType;
}

// catalogue_offres (migration-portail-v1.sql) — même table que le tunnel club
// (ClubServicesBoard/lib/data/club/bookings.ts), lecture publique des lignes actif=true
// (policy catalogue_public_read). Décision Fouka du 11/08/2026 : un seul catalogue de prix dans
// toute l'entreprise, le tunnel Espace Projet ne fixe plus sa propre grille séparée.
interface CatalogueOfferRow {
  id: string;
  nom: string;
  description: string | null;
  categorie: string;
  tarif_type: "fixe" | "sur_devis";
  prix_ht: number | null;
  duree_estimee: string | null;
}

export async function fetchCatalogueOffres(supabase: SupabaseClient): Promise<CatalogueOffer[]> {
  const { data, error } = await supabase
    .from("catalogue_offres")
    .select("id, nom, description, categorie, tarif_type, prix_ht, duree_estimee")
    .eq("actif", true)
    .order("ordre", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as CatalogueOfferRow[]).map((row) => ({
    id: row.id,
    nom: row.nom,
    description: row.description,
    categorie: row.categorie,
    tarifType: row.tarif_type,
    prixHt: row.tarif_type === "sur_devis" ? null : row.prix_ht,
    dureeEstimee: row.duree_estimee,
  }));
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
  offer: CatalogueOffer;
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
    `Prestation demandée (Connect) : ${input.offer.nom}`,
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
 * estimation client-side (computeServicePricing) basée sur le vrai prix HT du catalogue
 * (offre.prixHt), jamais persistée comme un prix réel — c'est le staff qui chiffre depuis
 * Demandes entrantes une fois la demande qualifiée. `offre_id` (FK réelle vers catalogue_offres,
 * migration-portail-v2.sql) est écrit pour que le staff retrouve l'offre exacte choisie ;
 * `type_prestation` reprend `offre.categorie` (même domaine que OFFRE_SLUG_TO_TYPE_PRESTATION
 * dans create-guest-request), le nom précis de l'offre reste de toute façon en tête de
 * description_besoin pour ne perdre aucune information utile au staff.
 *
 * Notification staff : automatique via le trigger trg_prestations_notify_demande (migration-
 * portail-v10.sql), qui appelle notify_staff_by_role(['admin','sec'], ...) sur tout INSERT dans
 * `prestations` où `statut = 'demande_reçue' and created_by is null` — exactement le cas ici
 * (created_by n'est jamais renseigné par un client). Aucun appel explicite requis côté front.
 *
 * Pas de `.select()` après l'insert : PostgREST relit sinon la ligne insérée pour la renvoyer
 * (RETURNING), ce qui exige une policy RLS SELECT sur `prestations` — or seule la vue
 * `client_prestations` (qui filtre déjà côté client, voir fetchClientServices ci-dessus) donne
 * lecture à un client, jamais la table `prestations` elle-même (les colonnes internes comme
 * notes_internes/responsable_prod_id n'ont rien à y faire). Sans `.select()`, l'insert seul
 * suffit (policy prestations_client_insert, migration-connect-v33) — vérifié en direct : la
 * même requête échouait systématiquement en 42501 avec `.select()`, réussissait sans. Le seul
 * appelant (NewServiceTunnel.tsx) n'utilise de toute façon jamais l'id/reference retournés.
 */
export async function submitClientService(
  supabase: SupabaseClient,
  clientId: string,
  input: SubmitClientServiceInput,
): Promise<void> {
  const nowIso = new Date().toISOString();

  const { error } = await supabase.from("prestations").insert({
    statut: "demande_reçue",
    client_id: clientId,
    offre_id: input.offer.id,
    type_prestation: input.offer.categorie,
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
  });
  if (error) throw error;
}
