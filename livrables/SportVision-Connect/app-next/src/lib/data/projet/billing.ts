import type { SupabaseClient } from "@supabase/supabase-js";
import type { Contract, ContractStatus, Invoice, InvoiceStatus } from "@/lib/types/billing";

// client_devis/client_factures/client_contrats (vues, migration-portail-v1/v8, étendues v33) —
// seul chemin d'accès à devis/factures/contrats (tables sources fail-closed, aucune policy RLS
// directe). Écriture EXCLUSIVEMENT via RPC client_decide_devis/client_sign_contrat (jamais de
// PATCH direct sur statut/montant) — voir le plan Phase 3.

const INVOICE_STATUS_MAP: Record<string, InvoiceStatus> = {
  non_facturée: "brouillon",
  en_préparation: "brouillon",
  facturée: "a_payer",
  partiellement_payée: "a_payer",
  payée: "payee",
  en_retard: "en_retard",
  annulée: "annulee",
  remboursée: "remboursee",
};

interface FactureRow {
  id: string;
  numero: string;
  type_facture: string | null;
  statut: string;
  prestation_id: string | null;
  montant_ht: number;
  tva_pct: number;
  montant_ttc: number;
  date_emission: string | null;
  date_echeance: string | null;
  pdf_url: string | null;
  created_at: string;
}

export async function fetchClientInvoices(supabase: SupabaseClient, organizationId: string): Promise<Invoice[]> {
  const { data } = await supabase
    .from("client_factures")
    .select("id, numero, type_facture, statut, prestation_id, montant_ht, tva_pct, montant_ttc, date_emission, date_echeance, pdf_url, created_at")
    .eq("client_id", organizationId)
    .order("date_emission", { ascending: false });

  return ((data ?? []) as FactureRow[]).map((row) => ({
    id: row.id,
    number: row.numero,
    organizationId,
    serviceId: row.prestation_id ?? undefined,
    issueDate: row.date_emission ?? row.created_at,
    dueDate: row.date_echeance ?? row.date_emission ?? row.created_at,
    subject: row.type_facture ?? "Facture",
    lines: [],
    subtotalExclVat: row.montant_ht,
    vatRate: row.tva_pct,
    vatAmount: Math.max(0, row.montant_ttc - row.montant_ht),
    depositApplied: 0,
    totalInclVat: row.montant_ttc,
    status: INVOICE_STATUS_MAP[row.statut] ?? "brouillon",
    pdfUrl: row.pdf_url ?? undefined,
    remindersSentAt: [],
  }));
}

const DEVIS_STATUS_LABEL: Record<string, string> = {
  brouillon: "Brouillon",
  envoyé: "En attente de votre décision",
  en_attente: "En attente de votre décision",
  accepté: "Accepté",
  refusé: "Refusé",
  expiré: "Expiré",
  annulé: "Annulé",
};

const DECIDABLE_DEVIS_STATUSES = new Set(["envoyé", "en_attente"]);

export interface ClientDevis {
  id: string;
  numero: string;
  statut: string;
  statusLabel: string;
  totalTtc: number;
  dateExpiration: string | null;
  decidable: boolean;
}

interface DevisRow {
  id: string;
  numero: string;
  statut: string;
  total_ttc: number;
  date_expiration: string | null;
}

export async function fetchClientDevis(supabase: SupabaseClient, organizationId: string): Promise<ClientDevis[]> {
  const { data } = await supabase
    .from("client_devis")
    .select("id, numero, statut, total_ttc, date_expiration")
    .eq("client_id", organizationId)
    .order("date_envoi", { ascending: false });

  return ((data ?? []) as DevisRow[]).map((row) => ({
    id: row.id,
    numero: row.numero,
    statut: row.statut,
    statusLabel: DEVIS_STATUS_LABEL[row.statut] ?? row.statut,
    totalTtc: row.total_ttc,
    dateExpiration: row.date_expiration,
    decidable: DECIDABLE_DEVIS_STATUSES.has(row.statut),
  }));
}

export async function decideDevis(supabase: SupabaseClient, devisId: string, decision: "accepté" | "refusé"): Promise<void> {
  const { error } = await supabase.rpc("client_decide_devis", { p_devis_id: devisId, p_decision: decision });
  if (error) throw error;
}

const CONTRACT_STATUS_MAP: Record<string, ContractStatus> = {
  brouillon: "brouillon",
  actif: "actif",
  suspendu: "a_renouveler",
  résilié: "resilie",
  expiré: "expire",
};

interface ContratRow {
  id: string;
  type_contrat: string | null;
  statut: string;
  signature_statut: string | null;
  montant_mensuel: number | null;
  frequence: string | null;
  date_debut: string | null;
  date_fin: string | null;
  created_at: string;
}

function contractStatus(row: ContratRow): ContractStatus {
  if (row.signature_statut === "demandee") return "envoye";
  if (row.signature_statut === "signee" && row.statut === "brouillon") return "signe";
  return CONTRACT_STATUS_MAP[row.statut] ?? "brouillon";
}

export interface ClientContract extends Contract {
  awaitingSignature: boolean;
}

export async function fetchClientContracts(supabase: SupabaseClient, organizationId: string): Promise<ClientContract[]> {
  const { data } = await supabase
    .from("client_contrats")
    .select("id, type_contrat, statut, signature_statut, montant_mensuel, frequence, date_debut, date_fin, created_at")
    .eq("client_id", organizationId)
    .order("created_at", { ascending: false });

  return ((data ?? []) as ContratRow[]).map((row) => ({
    id: row.id,
    organizationId,
    name: row.type_contrat ?? "Contrat SportVision",
    kind: "prestation_unique",
    startsAt: row.date_debut ?? row.created_at,
    endsAt: row.date_fin ?? "",
    status: contractStatus(row),
    monthlyAmount: row.montant_mensuel,
    commitmentMonths: 0,
    noticeMonths: 0,
    signatories: [],
    signatureProvider: "yousign",
    annexIds: [],
    amendmentIds: [],
    keyTerms: [],
    conditions: [],
    awaitingSignature: row.signature_statut === "demandee",
  }));
}

export async function signContract(supabase: SupabaseClient, contratId: string, signataireNom: string): Promise<void> {
  const { error } = await supabase.rpc("client_sign_contrat", { p_contrat_id: contratId, p_signataire_nom: signataireNom });
  if (error) throw error;
}
