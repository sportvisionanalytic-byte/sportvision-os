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
//
// "presences" (09/08/2026, Tier B Phase 4) : table club_presences réelle, migration-connect-v17-
// club-presences.sql — À EXÉCUTER PAR FOUKA. Gardé derrière son entitlement `connect_modules`
// (ci-dessous) délibérément : aucun club réel n'a aujourd'hui de contrat Full Communication actif
// (vérifié), donc aucune ligne organization_entitlements pour "presences" n'existe encore pour
// personne — le module reste verrouillé pour tout le monde tant qu'un membre du staff ne l'active
// pas explicitement pour un club qui a vraiment signé cette offre (même geste manuel que pour
// n'importe quel autre entitlement club — jamais d'auto-activation depuis un simple champ texte).
// "sessions"/"camps" (coach/académie, 10/08/2026 — plan Tier C § Phase 1 Séances/Stages) :
// ajoutés maintenant que connect-org-signup peuple organizations.legacy_client_id pour ces deux
// types (bloc "Pont Documents ↔ Portail", même principe que clubplus-onboarding/
// clubs.portail_client_id). Lisent calendar_events (migration-connect-v3-coach-academie-
// requests.sql) filtré organization_id + type='seance'/'stage', en lecture seule (policy
// cal_staff_write : seul le staff écrit, le coach/l'académie consulte) — voir
// data/coach/sessions.ts, data/academie/camps.ts. Le gate réel se fait par organization.type
// ("coach"/"academy" — mapOrgType traduit 'academie' en 'academy', voir supabase/mappers.ts) dans
// sessions/page.tsx et camps/page.tsx, pas par cette seule liste.
//
// "appointments" (10/08/2026) : volontairement absent, même raisonnement que "services" —
// équivalent Next.js de ProjetModules.rdv (vanilla), monté UNIQUEMENT pour l'Espace Projet dans
// l'app en production (espace: 'projet'). `rendez_vous` (migration-portail-v1.sql) n'a de policy
// RLS que pour client_users (rdv_client_own/rdv_client_insert) — aucune extension club_* n'existe
// (contrairement à billing/contracts/documents étendus par migration-clubplus-v33). Le gate se
// fait donc directement sur `ctx.organization.type === "generic"` dans appointments/page.tsx
// (comme services/page.tsx), pas via cette liste : canAccess(ctx, "appointments") reste toujours
// faux, y compris pour un club, tant qu'aucune vraie policy/decision produit n'étend ce périmètre.
//
// "mycm" (10/08/2026, plan MyCM Phase 2) : même famille que billing/contracts/documents — pas de
// clé connect_modules dédiée (l'accès Full Communication n'est pas un entitlement vendu, c'est un
// contrat `contrats.type_contrat='full_communication'` actif, comme pour session.ts:
// buildClubActiveContext → isFullCommunication). Le gate réel se fait dans mycm/page.tsx via
// data/shared/community-manager.ts:fetchIsFullCommunication (interroge client_contrats en
// direct), pas via cette liste ni via MODULE_TO_CONNECT_MODULE — canAccess(ctx, "mycm") ne
// vérifie donc que "module prêt", pas "Full Communication actif".
//
// "accompagnement" (10/08/2026, Tier C Phase 3) : deux branches distinctes dans le même fichier
// (accompagnement/page.tsx) selon organization.type. Club/projet (majoritaire) : inclusions du
// plan (catalogue PLANS, réel), chargé de compte via la vue client_cm (Phase 2, comme mycm), 4
// chiffres du mois vérifiés un par un — voir le commentaire en tête de page.tsx pour le détail
// réel vs honnêtement absent par indicateur. cm_agency : nouvelle table cm_agency_club_access
// (migration-cm-agency-club-access.sql, À EXÉCUTER PAR FOUKA) remplace le mock
// delegatedAccessByCmOrg — data/shared/cm-agency-access.ts. Aucune clé connect_modules dédiée
// (même famille que mycm/messages/communication ci-dessus) : accès ouvert à tout membre actif
// dès que le module est READY.
// "analytics"/"reports" (10/08/2026, Tier C Phase 5 — saisie manuelle de stats) : plus aucune
// intégration Metricool réelle n'est prévue à court terme (plan payant + token absents) — la
// donnée de portée/engagement/vues vient désormais de `contenu_stats` (migration-cm-contenu-
// stats.sql), une ligne par contenu PUBLIÉ, saisie à la main par le CM propriétaire ou le Lead CM
// (jamais par le client, jamais automatique). /analytics et /reports (src/lib/data/shared/
// contenu-stats.ts) agrègent ces lignes à l'affichage ; un contenu jamais renseigné n'entre dans
// aucun total (jamais compté comme 0), et tout chiffre affiché porte la mention "saisi
// manuellement". Même absence de mapping MODULE_TO_CONNECT_MODULE que messages/communication/
// publications/validations ci-dessus : aucune offre club ne vend spécifiquement "analytics"/
// "reports" à ce jour, donc pas d'entitlement dédié — accès ouvert à tout membre actif dès que le
// module est READY, comme le reste du lot Tier B Phase 2.
//
// "events"/"campsessions" (17/08/2026, Bible §14/§15 ; bascule 2 org types séparés le
// 17/08/2026, migration-clubplus-v44) : lisent/écrivent event_editions/event_sessions
// (migration-clubplus-v43), scope organization_id, RLS is_org_member/is_org_admin (voir header
// de la migration). Le gate réel se fait directement par organization.type ===
// "tournament_organizer" dans events/page.tsx et organization.type === "camp" dans
// campsessions/page.tsx, pas par cette seule liste — même pattern que sessions/camps/
// eventtimeline ci-dessus. Pas de mapping MODULE_TO_CONNECT_MODULE : même raisonnement que
// eventtimeline/live, aucune organization_entitlements pour ces deux types.
//
// "eventtimeline"/"live" (10/08/2026, Tier C Phase 4) : lisent event_checklist_items
// (migration-connect-v22-event-checklist-items.sql, checklist 3 phases, écriture staff
// admin/sec/com uniquement — voir SportVision-OS-Full.html § modalChecklistEvenement) et
// contenus/contenu_stats filtrés sur organizations.legacy_client_id (accès étendu par
// migration-connect-v23-event-live-contenus-access.sql). Le gate réel se fait par
// organization.type === "tournament_organizer" dans eventtimeline/page.tsx et live/page.tsx
// (bascule 2 org types séparés, 17/08/2026 — les deux écrans restent spécifiques au tournoi, pas
// étendus à "camp"), pas par cette seule liste — même pattern que sessions/camps (coach/académie).
// Pas de mapping MODULE_TO_CONNECT_MODULE : aucune organization_entitlements n'existe pour ces
// types (Full Communication vendu commercialement, pas mesuré par crédits — même logique que
// coach/académie/sponsor documentée plus haut).
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
  "presences",
  "sessions",
  "camps",
  "mycm",
  "accompagnement",
  "analytics",
  "reports",
  "eventtimeline",
  "live",
  "events",
  "campsessions",
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
  presences: "presences",
};
