import type { ModuleKey } from "@/lib/types";

// Pilotage réel des modules — voir le plan Phase 1 § Décisions d'architecture n°4.
//
// READY_MODULES : seuls ces modules lisent de vraies données (src/lib/data/club/*).
// Tout module absent de cette liste DOIT être verrouillé pour un contexte club en Phase 1 —
// jamais laissé "ouvert par défaut", ce qui exposerait du contenu mock (clubs/joueurs fictifs)
// sur le compte d'un vrai club connecté.
// "billing" est délibérément absent : la page /billing réelle n'affiche que des factures, et ni
// `factures` ni `contrats`/`devis` n'ont de policy RLS accessible à un membre club (staff-only) —
// voir le plan Phase 1 § Gaps de données. Les crédits (seule partie réellement trackée côté
// `clubs`) sont déjà affichés sur /dashboard via ctx.subscription, pas sur /billing. Idem
// "contracts" (jamais ajouté).
//
// "services" est également délibérément absent : club_bookings (migration-clubplus-v6.sql) n'a
// ni prix numérique structuré (juste `price_label` texte libre), ni catégorie de prestation, ni
// les 12 statuts du design (6 réels) — la liste comme le détail du design affichent un prix et un
// type de prestation typés, obligatoires. Forcer un mapping produirait un prix "0 €" trompeur
// plutôt qu'une absence honnête de donnée. Reste verrouillé jusqu'à une vraie décision produit
// sur comment représenter ce module (hors scope Phase 1).
//
// "children"/"authorizations" (Phase 2, Espace Famille) : ajoutés une fois /children et
// /authorizations remodelés sur parent_player_relationships/parental_authorizations réels — voir
// le plan Phase 2. Pas de clé connect_modules équivalente (module personnel, pas un module club).
export const READY_MODULES: ReadonlySet<ModuleKey> = new Set([
  "dashboard",
  "teams",
  "matchcenter",
  "newsroom",
  "content",
  "sponsors",
  "calendar",
  "visual_requests",
  "support",
  "settings",
  "children",
  "authorizations",
]);

/**
 * ModuleKey (design) → connect_modules.key (réel). Un module de READY_MODULES absent
 * de cette table n'est gated par aucun entitlement — accès "core", garanti à tout membre actif
 * (ex. dashboard, calendar, services, support, billing, settings : pas de ligne connect_modules
 * dédiée côté Club+ Start, cf. ARCHITECTURE-CONNECT.md § Correspondance offres → entitlements).
 */
export const MODULE_TO_CONNECT_MODULE: Partial<Record<ModuleKey, string>> = {
  teams: "equipes",
  matchcenter: "match_center",
  newsroom: "newsroom",
  visual_requests: "demandes_visuels",
  content: "bibliotheque_contenus",
  sponsors: "sponsors",
};
