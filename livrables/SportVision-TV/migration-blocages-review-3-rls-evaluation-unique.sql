-- ============================================================================================
-- migration-blocages-review-3-rls-evaluation-unique.sql
-- Blocage n°5 de l'audit Review du 11/09/2026 : timeouts Postgres 57014 intermittents sur les
-- widgets Club+ (tableau de bord, équipes, demandes, actualités) pour 4 rôles sur 5.
-- AUCUN CHANGEMENT DE DROITS : deux fonctions réécrites à l'identique, en plus rapide.
-- ============================================================================================
--
-- CE QUI A ÉTÉ MESURÉ EN PRODUCTION (11/09/2026).
--   - Par le chemin réel (Club+ en ligne, vrais jetons de 7 rôles sur Villeneuve 340 SC) : aucun
--     timeout, aucune requête au-delà de 0,9 s. Le club de test est petit (226 événements).
--   - En transaction annulée, avec un volume proche de Review injecté dans Villeneuve 340 SC
--     (30 équipes, 400 joueurs dont 200 avec parent, 800 événements, 150 actualités / demandes /
--     créations / matchs / contenus) et chaque rôle incarné comme sous PostgREST : le coût d'une
--     lecture de table est LINÉAIRE en nombre de lignes, de 0,8 à 3 ms PAR LIGNE selon la table.
--     À ce rythme, une table de quelques milliers de lignes dépasse le statement_timeout de 8 s du
--     rôle authenticated : c'est le 57014 vu sur Review, qui tourne sur une instance plus lente.
--
-- LA CAUSE. Les policies RLS appellent des fonctions SECURITY DEFINER avec une colonne de la ligne
-- en argument (peut_operer_club(club_id), peut_lire_calendrier_equipe(team_id)…) : elles sont donc
-- évaluées ligne par ligne. Ce n'est pas un problème en soi — is_club_member coûte 50 µs par
-- appel. Mais peut_operer_club en coûte 750 à 870 (mesuré), parce qu'elle est écrite en SQL et
-- qu'elle APPELLE une autre fonction SQL (is_club_admin, cm_clubs_autorises) : en PostgreSQL 17,
-- une fonction SQL non « inlinable » (SECURITY DEFINER) ré-analyse et re-planifie à CHAQUE appel
-- les fonctions SQL qu'elle appelle. Mesure : envelopper is_club_admin (50 µs) dans une fonction
-- SQL identique fait passer l'appel à 725 µs. Et peut_operer_club est dans 37 policies (toutes les
-- `*_operateur_manage`, FOR ALL, donc évaluées aussi en lecture) : newsroom, créations, matchs,
-- calendrier, sponsors… Pour tous les rôles sauf le CM SportVision, qu'une policy évaluée une
-- seule fois (cm_clubs_autorises en sous-requête hachée) laisse passer avant.
--
-- LE CORRECTIF, LE PLUS SÛR. Réécrire ces deux fonctions en PL/pgSQL, MÊME logique, MÊME ordre,
-- MÊME résultat pour toute entrée. En PL/pgSQL, un appel comme `is_club_admin(p_club_id)` dans un
-- IF est une « expression simple » dont l'état (et le plan de la fonction appelée) est gardé pour
-- toute la transaction : plus de re-planification par ligne. Aucune policy n'est touchée, aucune
-- liste de rôles ne change, aucune fonction appelée ne change.
--   - peut_operer_club : 869 → 107 µs par appel (coach), 765 → 56 µs (président).
--   - peut_lire_calendrier_equipe (policy ccal_member_select de club_calendar_events, lue par la
--     fiche d'équipe) : 1 151 → 233 µs par appel (coach).
--
-- AVANT / APRÈS (même volume, même transaction annulée, meilleur de 2 essais, 9 rôles de club) :
--                                   avant            après        cumul des rôles
--   actualités (150 lignes)         115-238 ms       15-47 ms     ×4,3
--   créations à valider (150)       124-196 ms       22-53 ms     ×3,7
--   matchs du club (168)            132-264 ms       17-168 ms    ×2,0
--   calendrier, lecture directe     990-3 057 ms     163-830 ms   ×3,2
--   (800 événements)
--   équipes (32) / demandes (150)   7 / 21 ms        inchangé (déjà rapides)
--   contenus (150)                  165-191 ms       inchangé (voir « ce qui reste »)
-- Même nombre de lignes pour chaque rôle et chaque requête, avant et après.
-- (détail par rôle : tests/blocages-review-perf.test.sql, rouge sans la migration, vert avec).
--
-- CE QUI RESTE, SIGNALÉ ET NON TRAITÉ ICI (même mécanisme, fonctions plus sensibles) :
--   - contenus (planning éditorial, tableau de bord) : ~1 ms par ligne pour tout rôle hors CM,
--     à cause de contenus_visible_par_cm, dont la branche « accompagne le club » appelle la
--     fonction ensemble cm_clubs_autorises_de à chaque ligne. La rendre rapide demanderait de
--     recopier cm_clubs_autorises_de dans contenus_visible_par_cm (risque de divergence) : non fait.
--   - is_family_of_team (~0,7 ms par appel) dans les policies « famille » de club_matches,
--     club_teams et club_calendar_events.
--
-- ÉQUIVALENCE PROUVÉE. tests/blocages-review.test.sql calcule, dans la même transaction annulée,
-- l'ancienne et la nouvelle réponse de chaque fonction pour chaque personne connue de la base (et
-- les comptes du décor : Owner Club+, Président, coach, CM SportVision, CM externe, staff de l'OS,
-- joueur, parent, compte sans lien, anonyme) sur chaque club et chaque équipe, plus NULL et un
-- identifiant inconnu : aucune différence.
--
-- GARDE-FOU. Les deux fonctions sont recréées à partir de leur définition de production du
-- 11/09/2026. Si l'une a changé depuis (d'autres sessions migrent en parallèle), la migration
-- s'arrête AVANT toute modification. Rejouable : un second passage reconnaît ses définitions.
-- Droits d'exécution : `create or replace` les conserve tels quels (y compris anon et PUBLIC, que
-- ces deux fonctions avaient avant et que des policies évaluées pour anon peuvent appeler).
-- ============================================================================================

begin;

set lock_timeout = '5s';

-- ── 0. Garde-fou ─────────────────────────────────────────────────────────────────────────────
do $garde$
declare
  f_operer text := md5(pg_get_functiondef('public.peut_operer_club(uuid)'::regprocedure));
  f_equipe text := md5(pg_get_functiondef('public.peut_lire_calendrier_equipe(uuid)'::regprocedure));
begin
  if f_operer not in ('8d47123bcd7c22169d9867a6281cdd2b', 'd1f0696b061a7137f329ee89a8aac9a3') then
    raise exception 'blocages-review-3 : peut_operer_club a changé depuis le 11/09/2026 (md5 %). Rien n''a été modifié. Reporter la réécriture sur sa NOUVELLE définition et son empreinte ici.', f_operer;
  end if;
  if f_equipe not in ('751532f7b29e981778c5c7e5f7a17953', '547f3e967f6bdb32b7b9dc67d10f6e46') then
    raise exception 'blocages-review-3 : peut_lire_calendrier_equipe a changé depuis le 11/09/2026 (md5 %). Rien n''a été modifié. Reporter la réécriture sur sa NOUVELLE définition et son empreinte ici.', f_equipe;
  end if;
end $garde$;


-- ── 1. peut_operer_club — l'autorité « opérer un club » (10/09), à l'identique ───────────────
-- Définition d'origine (SQL) :
--   select p_club_id is not null
--      and coalesce(is_club_admin(p_club_id)
--                   or (exists (profil actif admin/com/sec/cm) and p_club_id in (select cm_clubs_autorises())),
--                   false);
-- Même résultat ligne à ligne : NULL → false ; is_club_admin vrai → true ; sinon la seconde branche,
-- ramenée à false quand elle vaut NULL (coalesce d'origine). is_club_admin et exists() ne rendent
-- jamais NULL.
create or replace function public.peut_operer_club(p_club_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Sur un p_club_id nul, l'ancienne expression rendait false grâce au coalesce : un NULL dans un
  -- `if not (...)` n'aurait pas déclenché la branche de refus (défaut trouvé sur
  -- peut_preparer_club(null) le 08/09). Toujours un booléen, jamais NULL.
  if p_club_id is null then
    return false;
  end if;
  -- Owner Club+, Président, délégation d'agence CM, CM responsable. Écrit en expression simple :
  -- PL/pgSQL garde l'état de cet appel pour la transaction, là où l'ancienne version SQL
  -- re-planifiait is_club_admin à chaque ligne d'une policy (≈ 700 µs perdus par ligne).
  if is_club_admin(p_club_id) then
    return true;
  end if;
  -- CM SportVision et staff de l'OS, cloisonnés par cm_clubs_autorises : inchangé.
  return coalesce(
    exists (
      select 1 from profiles p
       where p.id = auth.uid()
         and p.actif
         and p.role in ('admin', 'com', 'sec', 'cm')
    )
    and p_club_id in (select public.cm_clubs_autorises()),
    false);
end;
$$;


-- ── 2. peut_lire_calendrier_equipe — à l'identique ───────────────────────────────────────────
-- Définition d'origine (SQL) : exists (rôle administratif actif du club de l'équipe)
--                              or is_team_educateur(p_team_id).
-- Aucune des deux branches ne rend NULL : même résultat pour toute entrée.
create or replace function public.peut_lire_calendrier_equipe(p_team_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if exists (
    select 1 from club_members cm, club_teams ct
    where ct.id = p_team_id and cm.club_id = ct.club_id and cm.user_id = auth.uid() and cm.status = 'actif'
      and cm.role in (
        'admin', 'president', 'secretaire', 'tresorier', 'membre_bureau', 'administratif',
        'comm', 'cm_externe', 'lecture_seule'
      )
  ) then
    return true;
  end if;
  -- Expression simple : is_team_educateur n'est plus re-planifiée à chaque ligne de la policy.
  return is_team_educateur(p_team_id);
end;
$$;

commit;
