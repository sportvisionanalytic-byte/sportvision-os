-- ============================================================
-- SPORTVISION CONNECT — Migration v4 : socle minimal Espace Sponsor
--
-- Comme Coach et Académie, un Sponsor n'a aujourd'hui aucune existence
-- en tant qu'utilisateur connecté : `club_sponsors` est une fiche tenue
-- PAR le club sur son sponsor, jamais un compte que le sponsor lui-même
-- peut consulter. Cette migration ne recrée rien : elle relie une fiche
-- club_sponsors existante à une organisation de type 'sponsor' (déjà un
-- type valide depuis migration-connect-v2, jamais encore utilisé), pour
-- que ce sponsor puisse se connecter et voir SA fiche, ses contreparties
-- et les créations qui le mentionnent.
--
-- Additif, non destructif : deux colonnes nullable ajoutées, RLS
-- élargie (jamais restreinte) sur club_sponsors et club_creations. Rien
-- n'est cassé si aucune organisation sponsor n'existe encore.
--
-- ── Ce qui n'est PAS traité ici, volontairement ──────────────────────
-- L'invitation d'un sponsor (création de son organisation + membership)
-- n'a pas de flux self-service : contrairement à Club+ (clubplus-invite),
-- aucune edge function n'existe pour Coach/Académie/Sponsor. Aujourd'hui,
-- seul le staff SportVision (rôle admin/sec, policy "mb_staff_write" de
-- migration-connect-v2) peut créer la ligne organizations + memberships
-- d'un sponsor, directement en base. C'est une limite connue, pas un
-- oubli — un vrai flux d'invitation en self-service pour ces 3 espaces
-- est un chantier à part (edge function generique "org-invite" sur le
-- modèle de clubplus-invite), non fait ici pour ne pas improviser un
-- envoi d'e-mail réel sans le tester.
--
-- Idempotente. À exécuter dans Supabase → SQL Editor, après
-- migration-connect-v2-organizations-entitlements.sql.
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. LIEN club_sponsors ↔ organisation sponsor
-- ═══════════════════════════════════════════════════════════════

alter table club_sponsors
  add column if not exists sponsor_organization_id uuid references organizations(id) on delete set null;

create index if not exists idx_club_sponsors_org on club_sponsors(sponsor_organization_id);

drop policy if exists "csp_sponsor_org_select" on club_sponsors;
create policy "csp_sponsor_org_select" on club_sponsors for select using (
  sponsor_organization_id is not null and is_org_member(sponsor_organization_id)
);


-- ═══════════════════════════════════════════════════════════════
-- 2. LIEN club_creations ↔ organisation sponsor (pour que les créations
--    liées à un sponsor lui soient visibles depuis son propre espace,
--    sans dépendre d'un rapprochement fragile sur le champ texte libre
--    `sponsor`, conservé tel quel pour l'affichage/rétrocompatibilité).
-- ═══════════════════════════════════════════════════════════════

alter table club_creations
  add column if not exists sponsor_organization_id uuid references organizations(id) on delete set null;

create index if not exists idx_club_creations_sponsor_org on club_creations(sponsor_organization_id);

drop policy if exists "ccr_sponsor_org_select" on club_creations;
create policy "ccr_sponsor_org_select" on club_creations for select using (
  sponsor_organization_id is not null and is_org_member(sponsor_organization_id)
);


-- ============================================================
-- NOTE — organization_entitlements pour un sponsor
--
-- Contrairement à Coach/Académie, aucun module dédié n'a été seedé dans
-- connect_modules pour l'espace sponsor à l'étape v2 (le cahier des
-- charges d'origine marquait déjà "Sponsor - phase ultérieure"). Le
-- module Connect construit par-dessus ce socle (voir
-- app/modules/sponsor-espace.js) utilise directement club_sponsors +
-- club_creations + les tables génériques requests/calendar_events, sans
-- dépendre d'organization_entitlements — à revoir si des offres
-- commerciales spécifiques aux sponsors sont introduites plus tard.
-- ============================================================
