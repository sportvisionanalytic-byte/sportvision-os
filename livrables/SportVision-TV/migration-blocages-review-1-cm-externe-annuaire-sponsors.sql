-- ============================================================================================
-- migration-blocages-review-1-cm-externe-annuaire-sponsors.sql
-- Décision de Fouka du 11/09/2026 : le CM externe (club_members.role = 'cm_externe', CM invité
-- directement par un club) a les mêmes droits que le CM SportVision sur l'annuaire et les sponsors.
-- ============================================================================================
--
-- LE CONSTAT. Les migrations club-donnees-restreintes (11/09) ont réservé l'annuaire du club
-- (téléphone des autres membres, e-mail d'un encadrant invité) et les sponsors (montants compris)
-- à une liste nommée : Owner Club+, Président, CM SportVision du club, Secrétaire, Trésorier
-- (+ Responsable sponsors pour les sponsors). Le CM externe n'y figurait pas, faute d'être nommé
-- dans la décision : il perdait la lecture des sponsors qu'il avait avant le 11/09, et la colonne
-- « Téléphone » de Membres restait vide pour lui alors que Club+ la lui affiche (litAnnuaireDuClub
-- compte `external_cm`, le rôle d'écran commun au CM SportVision délégué et au CM externe).
--
-- CE QUE FAIT CETTE MIGRATION. `cm_externe` rejoint la liste des rôles de club de
-- peut_lire_annuaire_club et de peut_lire_sponsors_club. Rien d'autre.
--   - Toutes les lectures restreintes passent par ces deux fonctions : club_membres_coordonnees,
--     equipe_apercu (e-mail d'un encadrant invité), policies csp_lecteurs_select (club_sponsors)
--     et sop_club_member_select (sponsor_operations). Aucune n'est touchée.
--   - equipe_apercu reste fermée au CM externe (elle exige peut_operer_club ou d'encadrer l'équipe) :
--     cette migration ne lui ouvre pas la fiche d'équipe, seulement l'e-mail DANS la fiche s'il y
--     accédait un jour.
--
-- CE QUI NE CHANGE PAS, VOLONTAIREMENT.
--   - SIRET et identifiants Stripe (peut_lire_siret_club, peut_lire_paiement_club) : le CM
--     SportVision ne les lit pas, le CM externe non plus.
--   - Les ÉCRITURES sur les sponsors (csp_member_insert / csp_member_update, csp_operateur_manage) :
--     la décision porte sur la lecture. Le CM externe ne crée ni ne modifie un sponsor aujourd'hui ;
--     c'est signalé dans le rapport, pas tranché ici.
--
-- GARDE-FOU. Les deux fonctions sont recréées à partir de leur définition de production du
-- 11/09/2026 (migration club-donnees-restreintes-1). Si l'une a changé depuis (d'autres sessions
-- migrent en parallèle), la migration s'arrête AVANT toute modification. Rejouable : un second
-- passage reconnaît ses propres définitions.
--
-- Testée en transaction annulée : tests/blocages-review.test.sql et
-- tests/club-donnees-restreintes.test.sql (rouges sans elle sur les lignes cm_externe).
-- Vérification par le chemin réel après exécution : tests/blocages-review.test.mjs,
-- tests/club-donnees-restreintes.test.mjs.
-- ============================================================================================

begin;

set lock_timeout = '5s';

-- ── 0. Garde-fou ─────────────────────────────────────────────────────────────────────────────
do $garde$
declare
  -- md5(pg_get_functiondef) : définition de production du 11/09/2026, puis celle posée ici.
  f_annuaire text := md5(pg_get_functiondef('public.peut_lire_annuaire_club(uuid)'::regprocedure));
  f_sponsors text := md5(pg_get_functiondef('public.peut_lire_sponsors_club(uuid)'::regprocedure));
begin
  if f_annuaire not in ('63239f0c58d080d607141eb36ce513b1', '15f399f9d30398fbf26da239f3c6920a') then
    raise exception 'blocages-review-1 : peut_lire_annuaire_club a changé depuis le 11/09/2026 (md5 %). Rien n''a été modifié. Reporter l''ajout de cm_externe sur sa NOUVELLE définition et son empreinte ici.', f_annuaire;
  end if;
  if f_sponsors not in ('6c32db3cf133fd613a736087ed1ed180', '18e7739570ecef4006a1dab3fd008df6') then
    raise exception 'blocages-review-1 : peut_lire_sponsors_club a changé depuis le 11/09/2026 (md5 %). Rien n''a été modifié. Reporter l''ajout de cm_externe sur sa NOUVELLE définition et son empreinte ici.', f_sponsors;
  end if;
end $garde$;


-- ── 1. Annuaire : + cm_externe ───────────────────────────────────────────────────────────────
-- peut_operer_club couvre l'Owner Club+, le Président, le CM SportVision du club (affectation,
-- délégation d'agence, CM responsable) et le staff de l'OS. Le CM externe, lui, n'est qu'une
-- ligne club_members : il faut le nommer.
create or replace function public.peut_lire_annuaire_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_club_id is not null and coalesce(
    peut_operer_club(p_club_id)
    or exists (select 1 from club_members m
                where m.club_id = p_club_id and m.user_id = auth.uid() and m.status = 'actif'
                  -- cm_externe : décision de Fouka du 11/09/2026 (mêmes droits que le CM SportVision).
                  and m.role in ('admin', 'president', 'secretaire', 'tresorier', 'cm_externe')),
    false);
$$;


-- ── 2. Sponsors et montants : + cm_externe ───────────────────────────────────────────────────
create or replace function public.peut_lire_sponsors_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_club_id is not null and coalesce(
    peut_operer_club(p_club_id)
    or exists (select 1 from club_members m
                where m.club_id = p_club_id and m.user_id = auth.uid() and m.status = 'actif'
                  -- cm_externe : décision de Fouka du 11/09/2026 (mêmes droits que le CM SportVision).
                  and m.role in ('admin', 'president', 'secretaire', 'tresorier', 'sponsor_mgr', 'cm_externe')),
    false);
$$;

-- Droits d'exécution : `create or replace` les conserve (revoke from public, grant to
-- authenticated, service_role, posés par club-donnees-restreintes-1). Réaffirmés pour qu'un
-- passage sur une base où la fonction aurait été recréée autrement ne rouvre rien à PUBLIC.
revoke execute on function public.peut_lire_annuaire_club(uuid) from public;
revoke execute on function public.peut_lire_sponsors_club(uuid) from public;
grant execute on function public.peut_lire_annuaire_club(uuid) to authenticated, service_role;
grant execute on function public.peut_lire_sponsors_club(uuid) to authenticated, service_role;

commit;
