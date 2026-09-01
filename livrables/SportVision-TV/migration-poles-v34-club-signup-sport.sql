-- ============================================================================
-- migration-poles-v34-club-signup-sport.sql
-- Audit de cohérence global (01/09/2026) — agent d'audit dédié à Club+,
-- finding CRITIQUE #1 : le tunnel "Demande d'ouverture d'un espace Club+"
-- (connect-club-signup-request → connect-club-signup-review) ne collecte
-- jamais de sport et ne pose jamais pole_id sur la ligne `clients` créée à
-- la validation — contrairement à Connect (corrigé le 31/08, migration-
-- poles-v13, puis v33 pour la branche 'managed'). Toute structure Club+
-- retombe donc silencieusement sur le pôle Football, Basket inclus.
--
-- Ajoute simplement la colonne pour capter le sport déclaré à l'étape
-- "Votre structure" du tunnel — la résolution sport → pôle réutilise
-- resolve_pole_by_sport() (déjà existante, migration-poles-v13), posée côté
-- Edge Function connect-club-signup-review au moment de la validation (pas
-- ici en SQL pur, la fonction a besoin de composer avec structure_type/
-- organization_type existants).
-- ============================================================================

alter table public.connect_clubplus_signup_requests
  add column if not exists sport text;

comment on column public.connect_clubplus_signup_requests.sport is 'Sport déclaré à l''étape "Votre structure" du tunnel (mêmes 9 valeurs que le sélecteur Connect /signup/sport : Football, Futsal, Basketball, Handball, Rugby, Volleyball, Athlétisme, Tennis, Autre) — résolu en pole_id réel via resolve_pole_by_sport() par connect-club-signup-review au moment de la validation de la demande (migration-poles-v34, 01/09/2026).';

-- ROLLBACK :
-- alter table public.connect_clubplus_signup_requests drop column if exists sport;
