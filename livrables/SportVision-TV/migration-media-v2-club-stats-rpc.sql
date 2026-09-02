-- migration-media-v2-club-stats-rpc.sql (02/09/2026)
--
-- Club+ doit pouvoir consulter de vraies statistiques (§16 du master prompt : "nombre de pass
-- actifs... jamais de faux KPI"), mais media_entitlements n'a délibérément AUCUNE policy RLS
-- SELECT pour is_club_member() — exposer les lignes brutes révélerait qui a acheté quoi (violerait
-- la règle de confidentialité stricte de l'addendum : "le club ne voit jamais les données
-- personnelles Connect d'un individu"). Un simple COUNT() via l'API REST resterait à 0 pour un
-- club admin faute de policy, et ajouter une policy SELECT donnerait accès aux lignes complètes.
--
-- Solution : une RPC SECURITY DEFINER qui ne renvoie qu'un agrégat (comptages), même doctrine que
-- club_onboarding_completion (garde is_club_member()/is_staff() explicite, cf. correctif v50).

create or replace function public.club_media_stats(p_club_id uuid, p_saison_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_entitlements int;
  v_albums int;
begin
  if not (is_club_member(p_club_id) or is_staff()) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  select count(*) into v_entitlements
  from media_entitlements
  where club_id = p_club_id and saison_id = p_saison_id and status = 'active';

  select count(*) into v_albums
  from media_albums
  where club_id = p_club_id and saison_id = p_saison_id and status = 'published';

  return jsonb_build_object('active_entitlements', v_entitlements, 'published_albums', v_albums);
end;
$function$;
comment on function public.club_media_stats(uuid, uuid) is 'Statistiques agrégées (comptages uniquement, jamais les lignes) pour l''écran Club+ lecture seule du moteur média — jamais de fuite de "qui a acheté quoi" à un admin de club (voir ADDENDUM CRITIQUE §35).';

grant execute on function public.club_media_stats(uuid, uuid) to authenticated;
