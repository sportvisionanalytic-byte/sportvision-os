import type { ModuleKey } from "@/lib/types";

// Pilotage réel des modules — voir le plan Phase 1 § Décisions d'architecture n°4.
//
// READY_MODULES : seuls ces modules lisent de vraies données (src/lib/data/club/*).
// Tout module absent de cette liste DOIT être verrouillé pour un contexte club en Phase 1 —
// jamais laissé "ouvert par défaut", ce qui exposerait du contenu mock (clubs/joueurs fictifs)
// sur le compte d'un vrai club connecté.
// "billing"/"contracts"/"documents" (09/08/2026, chantier Tier B) : les vues client_devis/
// client_factures/client_contrats sont étendues aux clubs depuis migration-clubplus-v33-club-
// documents-access.sql (exécutée) — un membre actif d'un club dont clubs.portail_client_id est
// renseigné peut lire ses vrais documents (club_member_has_client_access()). Résolution du
// client_id via resolveClubPortailClientId (data/club/portail-link.ts) ; un club jamais relié
// affiche un état honnête "pas encore relié", pas une erreur.
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
//
// "messages"/"communication"/"publications"/"validations" (09/08/2026, chantier Tier B Phase 2) :
// messages_client et contenus (planning éditorial), accès club étendu par migration-clubplus-v34-
// club-messages-contenus-access.sql — À EXÉCUTER PAR FOUKA, non exécutée à ce jour. L'Espace
// Projet (client_users direct) fonctionne déjà sans cette migration ; un club verra un message
// d'erreur honnête ("Impossible de charger…") tant qu'elle n'est pas passée, jamais une fausse
// donnée. Voir data/shared/contenus.ts, data/shared/messages.ts.
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
  "billing",
  "contracts",
  "documents",
  "messages",
  "communication",
  "publications",
  "validations",
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
