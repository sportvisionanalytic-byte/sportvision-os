-- ═══════════════════════════════════════════════════════════════════════════════
-- CORRECTIF — peut_preparer_club(null) doit valoir « non », pas « je ne sais pas »
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Regression introduite par la v11. L'ancien garde-fou `is_club_admin(p_club_id)` renvoyait
-- false sur un identifiant null. Le mien renvoyait NULL pour un CM, parce que
-- `null in (select ...)` vaut NULL et que `false or (true and null)` vaut NULL.
--
-- Or `if not null then raise exception` ne leve rien. Un appel avec un club_id null traversait
-- donc le controle. Trouve en rejouant l'audit, pas en relisant le code.
--
-- Une autorisation ne doit jamais pouvoir valoir « inconnu » : en cas de doute, c'est non.

create or replace function public.peut_preparer_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p_club_id is not null
     and coalesce(
           is_club_admin(p_club_id)
             or (est_cm_cloisonne() and p_club_id in (select cm_clubs_autorises())),
           false);
$function$;

select 'OK — peut_preparer_club ne renvoie plus jamais NULL' as verdict;
