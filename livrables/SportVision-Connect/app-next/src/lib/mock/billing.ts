import type { Contract, ContractSchedule, Invoice, PaymentMethod } from "../types/billing";

// Données fictives mais réalistes — voir README.md § Fidélité. Alignées sur les organisations et
// abonnements de mock-data.ts (FC Fontainebleau · Club+ Performance, US Varenne · Full
// Communication). La facture SV-2026-0418 reprend volontairement le même montant et le même
// retard que celle déjà citée dans ClubPlusDashboard.tsx, pour rester cohérent d'un écran à
// l'autre.

/** Date de référence de la maquette — voir CLAUDE.md, la session en cours simule le 2026-08-08. */
const NOW = new Date("2026-08-08T12:00:00.000Z");

export function daysLate(dueDate: string): number {
  const diff = NOW.getTime() - new Date(dueDate).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

export const mockContracts: Contract[] = [
  {
    id: "contract-fcf",
    organizationId: "org-fcf",
    name: "Club+ Performance",
    kind: "abonnement",
    planCode: "club_plus_performance",
    startsAt: "2025-09-01",
    endsAt: "2026-09-01",
    status: "actif",
    monthlyAmount: 690,
    commitmentMonths: 12,
    noticeMonths: 2,
    signatories: [
      { name: "Sophie Martin", role: "Responsable communication", signedAt: "2025-08-20" },
      { name: "Théo Marchand", role: "Chargé de compte SportVision", signedAt: "2025-08-20" },
    ],
    signatureProvider: "yousign",
    signedAt: "2025-08-20",
    documentId: "doc-contract-fcf",
    annexIds: ["doc-annex-fcf-tarifs", "doc-annex-fcf-cgv"],
    amendmentIds: [],
    keyTerms: [
      { id: "kt-1", label: "Les crédits visuels ne sont pas reportables d'un mois sur l'autre." },
      { id: "kt-2", label: "5 présences terrain incluses par saison, au-delà 240 € l'unité." },
      { id: "kt-3", label: "Reconduction tacite pour 12 mois sauf préavis." },
      { id: "kt-4", label: "Résiliation possible par écrit avec un préavis de 2 mois avant l'échéance." },
      { id: "kt-5", label: "Mensualité prélevée le 1er de chaque mois." },
    ],
    conditions: [
      { label: "Offre", value: "Club+ Performance" },
      { label: "Durée d'engagement", value: "12 mois" },
      { label: "Préavis de résiliation", value: "2 mois" },
      { label: "Mensualité", value: "690,00 € TTC / mois" },
      { label: "Date de début", value: "1er septembre 2025" },
      { label: "Prochaine échéance", value: "1er septembre 2026" },
      { label: "Renouvellement", value: "Reconduction tacite" },
      { label: "Moyen de paiement", value: "Carte bancaire •••• 4242" },
    ],
  },
  {
    id: "contract-usv",
    organizationId: "org-usv",
    name: "Full Communication",
    kind: "abonnement",
    planCode: "full_communication",
    startsAt: "2025-11-03",
    endsAt: "2026-11-03",
    status: "a_renouveler",
    monthlyAmount: null,
    commitmentMonths: 12,
    noticeMonths: 2,
    signatories: [
      { name: "Camille Bertrand", role: "Présidente", signedAt: "2025-10-25" },
      { name: "Nina Berger", role: "Community Manager SportVision", signedAt: "2025-10-25" },
    ],
    signatureProvider: "yousign",
    signatureUrl: "https://yousign.example/avenant-usv-2026",
    signatureRequestedAt: "2026-08-04",
    viewedAt: "2026-08-05",
    documentId: "doc-contract-usv",
    annexIds: ["doc-annex-usv-cgv"],
    amendmentIds: ["doc-amendment-usv-2026"],
    keyTerms: [
      { id: "kt-6", label: "Accompagnement sur mesure, tarif établi sur devis." },
      { id: "kt-7", label: "12 présences terrain incluses par saison, au-delà 240 € l'unité." },
      { id: "kt-8", label: "Community Manager SportVision dédié — Nina Berger." },
      { id: "kt-9", label: "Reconduction tacite pour 12 mois sauf préavis." },
      { id: "kt-10", label: "Résiliation possible par écrit avec un préavis de 2 mois avant l'échéance." },
    ],
    conditions: [
      { label: "Offre", value: "Full Communication" },
      { label: "Durée d'engagement", value: "12 mois" },
      { label: "Préavis de résiliation", value: "2 mois" },
      { label: "Mensualité", value: "Sur devis" },
      { label: "Date de début", value: "3 novembre 2025" },
      { label: "Prochaine échéance", value: "3 novembre 2026" },
      { label: "Renouvellement", value: "Avenant à signer" },
      { label: "Moyen de paiement", value: "Carte bancaire •••• 8410" },
    ],
  },
];

export const mockContractSchedules: ContractSchedule[] = [
  { id: "cs-1", contractId: "contract-fcf", dueDate: "2026-08-01", label: "Mensualité — août 2026", amount: 690, kind: "installment", status: "depasse" },
  { id: "cs-2", contractId: "contract-fcf", dueDate: "2026-09-01", label: "Mensualité — septembre 2026", amount: 690, kind: "installment", status: "a_venir" },
  { id: "cs-3", contractId: "contract-fcf", dueDate: "2026-07-01", label: "Fenêtre de préavis avant reconduction", kind: "notice_window", status: "depasse" },
  { id: "cs-4", contractId: "contract-fcf", dueDate: "2026-09-01", label: "Fin de l'engagement initial", kind: "contract_end", status: "a_venir" },
  { id: "cs-5", contractId: "contract-usv", dueDate: "2026-09-03", label: "Fenêtre de préavis avant reconduction", kind: "notice_window", status: "du" },
  { id: "cs-6", contractId: "contract-usv", dueDate: "2026-11-03", label: "Fin de l'engagement initial", kind: "contract_end", status: "a_venir" },
];

export const mockInvoices: Invoice[] = [
  {
    id: "inv-fcf-0418",
    number: "SV-2026-0418",
    organizationId: "org-fcf",
    contractId: "contract-fcf",
    issueDate: "2026-08-01",
    dueDate: "2026-08-05",
    subject: "Mensualité Club+ Performance — Août 2026",
    lines: [{ label: "Abonnement Club+ Performance — Août 2026", quantity: 1, unitPriceExclVat: 575, totalExclVat: 575 }],
    subtotalExclVat: 575,
    vatRate: 20,
    vatAmount: 115,
    depositApplied: 0,
    totalInclVat: 690,
    status: "en_retard",
    paymentMethod: "Carte bancaire •••• 4242",
    pdfUrl: "#",
    remindersSentAt: ["2026-08-08"],
  },
  {
    id: "inv-fcf-0470",
    number: "SV-2026-0470",
    organizationId: "org-fcf",
    contractId: "contract-fcf",
    issueDate: "2026-09-01",
    dueDate: "2026-09-05",
    subject: "Mensualité Club+ Performance — Septembre 2026",
    lines: [{ label: "Abonnement Club+ Performance — Septembre 2026", quantity: 1, unitPriceExclVat: 575, totalExclVat: 575 }],
    subtotalExclVat: 575,
    vatRate: 20,
    vatAmount: 115,
    depositApplied: 0,
    totalInclVat: 690,
    status: "a_payer",
    paymentMethod: "Carte bancaire •••• 4242",
    pdfUrl: "#",
    remindersSentAt: [],
  },
  {
    id: "inv-fcf-0350",
    number: "SV-2026-0350",
    organizationId: "org-fcf",
    contractId: "contract-fcf",
    issueDate: "2026-07-01",
    dueDate: "2026-07-05",
    subject: "Mensualité Club+ Performance — Juillet 2026",
    lines: [{ label: "Abonnement Club+ Performance — Juillet 2026", quantity: 1, unitPriceExclVat: 575, totalExclVat: 575 }],
    subtotalExclVat: 575,
    vatRate: 20,
    vatAmount: 115,
    depositApplied: 0,
    totalInclVat: 690,
    status: "payee",
    paymentMethod: "Carte bancaire •••• 4242",
    paidAt: "2026-07-03",
    pdfUrl: "#",
    receiptUrl: "#",
    remindersSentAt: [],
  },
  {
    id: "inv-fcf-0280",
    number: "SV-2026-0280",
    organizationId: "org-fcf",
    contractId: "contract-fcf",
    issueDate: "2026-06-01",
    dueDate: "2026-06-05",
    subject: "Mensualité Club+ Performance — Juin 2026",
    lines: [{ label: "Abonnement Club+ Performance — Juin 2026", quantity: 1, unitPriceExclVat: 575, totalExclVat: 575 }],
    subtotalExclVat: 575,
    vatRate: 20,
    vatAmount: 115,
    depositApplied: 0,
    totalInclVat: 690,
    status: "payee",
    paymentMethod: "Carte bancaire •••• 4242",
    paidAt: "2026-06-02",
    pdfUrl: "#",
    receiptUrl: "#",
    remindersSentAt: [],
  },
  {
    id: "inv-usv-0512",
    number: "SV-2026-0512",
    organizationId: "org-usv",
    contractId: "contract-usv",
    issueDate: "2026-08-01",
    dueDate: "2026-08-15",
    subject: "Accompagnement Full Communication — Août 2026",
    lines: [
      { label: "Accompagnement Full Communication — Août 2026", quantity: 1, unitPriceExclVat: 1900, totalExclVat: 1900 },
      { label: "Présence terrain supplémentaire", quantity: 1, unitPriceExclVat: 100, totalExclVat: 100 },
    ],
    subtotalExclVat: 2000,
    vatRate: 20,
    vatAmount: 400,
    depositApplied: 0,
    totalInclVat: 2400,
    status: "a_payer",
    paymentMethod: "Carte bancaire •••• 8410",
    pdfUrl: "#",
    remindersSentAt: [],
  },
  {
    id: "inv-usv-0410",
    number: "SV-2026-0410",
    organizationId: "org-usv",
    contractId: "contract-usv",
    issueDate: "2026-07-01",
    dueDate: "2026-07-15",
    subject: "Accompagnement Full Communication — Juillet 2026",
    lines: [{ label: "Accompagnement Full Communication — Juillet 2026", quantity: 1, unitPriceExclVat: 2000, totalExclVat: 2000 }],
    subtotalExclVat: 2000,
    vatRate: 20,
    vatAmount: 400,
    depositApplied: 0,
    totalInclVat: 2400,
    status: "payee",
    paymentMethod: "Carte bancaire •••• 8410",
    paidAt: "2026-07-04",
    pdfUrl: "#",
    receiptUrl: "#",
    remindersSentAt: [],
  },
];

export const mockPaymentMethods: Record<string, PaymentMethod> = {
  "org-fcf": { brand: "visa", last4: "4242", expMonth: 11, expYear: 2027 },
  "org-usv": { brand: "mastercard", last4: "8410", expMonth: 3, expYear: 2028 },
};

export function contractsForOrganization(organizationId: string): Contract[] {
  return mockContracts.filter((c) => c.organizationId === organizationId);
}

export function schedulesForContract(contractId: string): ContractSchedule[] {
  return mockContractSchedules.filter((s) => s.contractId === contractId);
}

export function invoicesForOrganization(organizationId: string): Invoice[] {
  return mockInvoices
    .filter((i) => i.organizationId === organizationId)
    .sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));
}
