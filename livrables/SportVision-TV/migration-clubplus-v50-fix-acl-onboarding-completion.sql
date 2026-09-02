-- migration-clubplus-v50-fix-acl-onboarding-completion.sql
-- Bug trouvé en QA le 02/09/2026 (test d'isolation RLS sur la nouvelle page /onboarding) :
-- club_onboarding_completion(uuid) est SECURITY DEFINER, grantée à `authenticated`, mais ne
-- vérifiait jamais l'appelant malgré son propre commentaire ("Appelable par le club (is_club_member)
-- ou le staff"). Un compte authentifié quelconque, non membre du club, pouvait lire la progression
-- de n'importe quel club en passant directement son UUID. Pas de fuite de données personnelles,
-- mais une vraie faille d'autorisation — corrigée en ajoutant la vérification que le commentaire
-- promettait déjà.

create or replace function public.club_onboarding_completion(p_club_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_identite boolean;
  v_responsables boolean;
  v_equipes boolean;
  v_entrainements boolean;
  v_calendrier boolean;
  v_branding boolean;
  v_sponsors boolean;
  v_communication boolean;
  v_droit_image boolean;
  v_sections_total int := 9;
  v_sections_ok int;
begin
  if not (is_club_member(p_club_id) or is_staff()) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  select (nom is not null and ville is not null and adresse is not null)
    into v_identite from clubs where id = p_club_id;

  select exists(select 1 from club_members where club_id = p_club_id and status = 'actif')
    into v_responsables;

  select exists(select 1 from club_teams where club_id = p_club_id)
    into v_equipes;

  select exists(
    select 1 from club_team_training_slots ctts
    join club_teams ct on ct.id = ctts.team_id
    where ct.club_id = p_club_id
  ) into v_entrainements;

  select exists(select 1 from club_calendar_events where club_id = p_club_id)
    into v_calendrier;

  select (logo_url is not null or ecusson_url is not null)
    into v_branding from clubs where id = p_club_id;

  select exists(select 1 from club_sponsors where club_id = p_club_id)
    into v_sponsors;

  select (
    exists(select 1 from club_social_accounts where club_id = p_club_id)
    and objectifs_communication is not null and array_length(objectifs_communication, 1) > 0
  ) into v_communication from clubs where id = p_club_id;

  select (droit_image_mode is not null) into v_droit_image from clubs where id = p_club_id;

  v_sections_ok := (case when v_identite then 1 else 0 end)
    + (case when v_responsables then 1 else 0 end)
    + (case when v_equipes then 1 else 0 end)
    + (case when v_entrainements then 1 else 0 end)
    + (case when v_calendrier then 1 else 0 end)
    + (case when v_branding then 1 else 0 end)
    + (case when v_sponsors then 1 else 0 end)
    + (case when v_communication then 1 else 0 end)
    + (case when v_droit_image then 1 else 0 end);

  return jsonb_build_object(
    'identite', coalesce(v_identite, false),
    'responsables', v_responsables,
    'equipes', v_equipes,
    'entrainements', v_entrainements,
    'calendrier', v_calendrier,
    'branding', coalesce(v_branding, false),
    'sponsors', v_sponsors,
    'communication', coalesce(v_communication, false),
    'droit_image', coalesce(v_droit_image, false),
    'sections_completees', v_sections_ok,
    'sections_total', v_sections_total,
    'pourcentage', round((v_sections_ok::numeric / v_sections_total) * 100)
  );
end;
$function$;

comment on function public.club_onboarding_completion(uuid) is 'Progression de l''onboarding Communication d''un club, calculée EN DIRECT depuis les vraies tables (clubs/club_members/club_teams/club_team_training_slots/club_calendar_events/club_sponsors/club_social_accounts) — jamais un pourcentage stocké séparément qui pourrait désynchroniser de la réalité. Appelable par le club (is_club_member) ou le staff uniquement (vérifié en code depuis v50, cf. faille QA du 02/09), SECURITY DEFINER pour lire uniformément malgré les RLS de chaque table sous-jacente.';
