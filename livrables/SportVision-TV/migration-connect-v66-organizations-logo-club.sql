-- ============================================================
-- SPORTVISION CONNECT — Migration v66 : logo_url sur organizations
--
-- Bug : un joueur affilié à un club Club+ ne voit jamais le logo de son
-- club dans app-connect/ (placeholder texte "logo" à la place). Cause :
-- src/lib/supabase/session.ts (buildPlayerContext) construit
-- player.club en lisant `organizations` (select id, nom, ville), jamais
-- `clubs` — or `logo_url`/`ecusson_url` n'existent QUE sur `clubs`
-- (confirmé par migration-connect-v2-organizations-entitlements.sql
-- §"choix clé" : organizations n'ajoute rien à nom/ville/logo, elle
-- réutilise juste clubs.id comme organizations.id pour un club réel).
--
-- Portée volontairement réduite : uniquement logo_url (image principale,
-- affichée côté Connect). PAS ecusson_url — reste propre à Club+
-- (aucun usage côté Connect aujourd'hui), pas la peine de dupliquer une
-- colonne qui ne sert à rien pour ce cas d'usage.
--
-- 1. Ajoute la colonne (additive, ne touche à rien d'existant).
-- 2. Backfill unique depuis `clubs` pour les clubs réels déjà en place
--    (organizations.id = clubs.id pour un club — voir commentaire
--    ci-dessus) : copie les logos déjà uploadés par de vrais clubs via
--    Club+, sans jamais écraser une valeur déjà présente sur
--    organizations.logo_url (donc rejouable sans effet destructif).
--
-- Ne touche PAS à connect_declared_clubs (clubs "déclarés" par un
-- joueur sans club officiel, hors scope — volontairement sans logo).
--
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL
-- Editor. Idempotente (ADD COLUMN IF NOT EXISTS + UPDATE conditionné
-- sur logo_url IS NULL, sans risque à rejouer).
-- ============================================================

alter table organizations add column if not exists logo_url text;

update organizations o
set logo_url = c.logo_url
from clubs c
where c.id = o.id
  and c.logo_url is not null
  and o.logo_url is null;

-- ============================================================
-- FIN. Actions manuelles requises après relecture :
--   1. Exécuter ce fichier dans Supabase → SQL Editor (idempotent).
--   2. Redéployer app-connect (Netlify) — src/lib/supabase/session.ts,
--      src/app/dashboard/page.tsx et src/app/profil/page.tsx modifiés
--      en parallèle de cette migration pour lire/afficher logo_url.
--   3. Republier livrables/SportVision-Club-Plus/app.html et
--      livrables/SportVision-Connect/app/modules/club-parametres-acces.js
--      (fichiers statiques, pas de build) — modifiés pour tenir
--      organizations.logo_url synchronisé à chaque nouvel upload.
-- ============================================================
