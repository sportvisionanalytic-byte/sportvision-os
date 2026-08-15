-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v69
-- Nom d'agence facultatif pour un compte Agent (décidé par Fouka le 15/08) : un agent peut
-- renseigner le nom de son agence sur son profil, visible par les sportifs qui lui ont accordé
-- l'accès (écran "Accès à mon profil" / connect_get_athlete_access_grants côté propriétaire).
--
-- Simple colonne texte facultative, pertinente uniquement pour profil_particulier='agent'
-- (migration-connect-v67) mais pas restreinte au niveau base (aucun intérêt à un CHECK qui
-- imposerait un ordre d'écriture entre les deux colonnes — le frontend n'affiche le champ que
-- pour un agent, c'est suffisant).
--
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL Editor. Idempotente (add
-- column if not exists).
-- ============================================================

alter table connect_profile_settings add column if not exists nom_agence text;

comment on column connect_profile_settings.nom_agence is
  'Nom de l''agence, facultatif — pertinent pour profil_particulier=''agent'' uniquement (migration-'
  'connect-v67), affiché aux sportifs qui ont accepté une relation ''agent'' avec ce compte sur '
  'leur écran "Accès à mon profil". NULL = non renseigné, jamais affiché dans ce cas.';
