-- migration-connect-v79-athletes-club-kind.sql (02/09/2026)
--
-- Ajoute un 3e "kind" ('club') à connect_list_my_athletes()/connect_get_athlete_detail() —
-- jusqu'ici ces 2 RPC ne connaissaient que 'linked' (connect_access_relationships, un tiers avec
-- son propre compte qui a accepté une demande d'accès) et 'managed' (managed_athlete_profiles, un
-- profil déclaré jamais vérifié). Aucune des deux ne couvre le VRAI système d'affiliation club
-- (parent_profiles/parent_player_relationships/team_memberships), qui existe et fonctionne mais
-- n'avait jamais été relié à l'Espace particulier de Connect (app-connect) — la seule persona
-- Joueur/Parent réellement joignable, Club+ ayant explicitement retiré ces espaces le 19/08/2026
-- (commit a893f3f : "ces personas appartiennent exclusivement à SportVision Connect").
--
-- Additif strict : AUCUNE ligne existante de logique 'linked'/'managed' n'est modifiée, seule une
-- 3e branche est ajoutée à chaque fonction (UNION ALL / elsif). Droits volontairement minimaux
-- pour 'club' : SEUL `calendrier` passe à true (déjà supporté génériquement par le bloc next_event
-- existant, indépendant du kind). reserver/voir/commandes/factures/payer/cotisation/modifier
-- restent à false — ces fonctionnalités (réservation de prestation, contenus/commandes/factures
-- filtrés par client_id) n'ont aucun support backend pour un enfant affilié à un club (qui n'a pas
-- de client_id au sens Portail/OS) ; les activer créerait des boutons qui pointent vers des flux
-- cassés. L'accès aux photos du moteur média générique est un NOUVEAU bouton dédié, hors du
-- système `rights` existant (voir AthleteDetailView.tsx).

create or replace function public.connect_list_my_athletes()
returns table(kind text, ref_id uuid, relationship_id uuid, first_name text, last_name text, sport text, categorie text, club_nom text, club_status text, relation_label text, status text, right_voir boolean, right_download boolean, right_reserver boolean, right_commandes boolean, right_factures boolean, right_payer boolean, right_cotisation boolean, right_calendrier boolean, right_modifier boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  return query
  select
    'linked'::text, car.owner_user_id, car.id,
    coalesce(pp.prenom, split_part(car.grantee_display_name, ' ', 1), 'Sportif'),
    coalesce(pp.nom, ''),
    cps.sport, cps.categorie,
    org.nom, case when pp.club_id is not null and pp.account_status <> 'retire' then 'affilie' else null end,
    initcap(car.relation_type), 'actif',
    car.right_voir, car.right_download, car.right_reserver, car.right_commandes, car.right_factures,
    car.right_payer, car.right_cotisation, car.right_calendrier, car.right_modifier
  from connect_access_relationships car
  left join player_profiles pp on pp.user_id = car.owner_user_id
  left join organizations org on org.id = pp.club_id
  left join connect_profile_settings cps on cps.user_id = car.owner_user_id
  where car.grantee_user_id = auth.uid() and car.status = 'acceptee'

  union all
  select
    'managed'::text, map.id, map.id,
    map.prenom, map.nom, map.sport, map.categorie,
    map.club_declare, null,
    map.relation_label, 'gere',
    true, true, true, true, true, true, true, true, true
  from managed_athlete_profiles map
  where map.owner_user_id = auth.uid()

  union all
  select
    'club'::text, pp.id, ppr.id,
    pp.prenom, pp.nom, c.discipline, tm_lat.categorie,
    c.nom, 'affilie'::text,
    initcap(ppr.relation_type), 'actif',
    false, false, false, false, false, false, false, true, false
  from parent_player_relationships ppr
  join parent_profiles pf on pf.id = ppr.parent_id
  join player_profiles pp on pp.id = ppr.player_id
  left join clubs c on c.id = pp.club_id
  left join lateral (
    select ct.categorie
    from team_memberships m
    join club_teams ct on ct.id = m.team_id
    where m.player_id = pp.id and m.statut = 'active'
    order by m.created_at desc
    limit 1
  ) tm_lat on true
  where pf.user_id = auth.uid() and ppr.statut = 'confirme'

  order by 4;
end;
$function$;

create or replace function public.connect_get_athlete_detail(p_kind text, p_ref_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_client_id uuid;
  v_result jsonb;
  v_car connect_access_relationships%rowtype;
  v_map managed_athlete_profiles%rowtype;
  v_first text; v_last text; v_sport text; v_categorie text; v_club text; v_club_id uuid; v_relation text;
  v_next_presta jsonb; v_next_event jsonb; v_funding jsonb;
  v_relationship_id uuid;
  v_team_id uuid; v_saison_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;
  if p_kind not in ('linked', 'managed', 'club') then
    return null;
  end if;

  if p_kind = 'linked' then
    select * into v_car from connect_access_relationships
      where owner_user_id = p_ref_id and grantee_user_id = auth.uid() and status = 'acceptee';
    if not found then return null; end if;
    v_owner := p_ref_id;
    select pp.prenom, pp.nom, cps.sport, cps.categorie, org.nom, pp.club_id
      into v_first, v_last, v_sport, v_categorie, v_club, v_club_id
      from player_profiles pp
      left join organizations org on org.id = pp.club_id
      left join connect_profile_settings cps on cps.user_id = pp.user_id
      where pp.user_id = v_owner;
    if v_first is null then
      v_first := coalesce(split_part(v_car.grantee_display_name, ' ', 1), 'Sportif');
      v_last := '';
    end if;
    v_relation := initcap(v_car.relation_type);
    v_client_id := connect_owner_client_id(v_owner);
    v_relationship_id := v_car.id;
  elsif p_kind = 'club' then
    -- Le player_id fourni (p_ref_id) n'est JAMAIS pris tel quel : revérifié ici via une relation
    -- parent confirmée sur CET appelant, même doctrine que le reste du moteur média (voir
    -- create-pass-photo-checkout).
    select ppr.id, pp.prenom, pp.nom, c.discipline, c.nom, pp.club_id, initcap(ppr.relation_type)
      into v_relationship_id, v_first, v_last, v_sport, v_club, v_club_id, v_relation
      from parent_player_relationships ppr
      join parent_profiles pf on pf.id = ppr.parent_id
      join player_profiles pp on pp.id = ppr.player_id
      left join clubs c on c.id = pp.club_id
      where pf.user_id = auth.uid() and ppr.player_id = p_ref_id and ppr.statut = 'confirme';
    if not found then return null; end if;
    select tm.team_id, tm.saison_id, ct.categorie
      into v_team_id, v_saison_id, v_categorie
      from team_memberships tm
      join club_teams ct on ct.id = tm.team_id
      where tm.player_id = p_ref_id and tm.statut = 'active'
      order by tm.created_at desc
      limit 1;
    v_client_id := null;
  else
    select * into v_map from managed_athlete_profiles where id = p_ref_id and owner_user_id = auth.uid();
    if not found then return null; end if;
    v_first := v_map.prenom; v_last := v_map.nom; v_sport := v_map.sport; v_categorie := v_map.categorie;
    v_club := v_map.club_declare; v_club_id := null; v_relation := v_map.relation_label;
    v_client_id := v_map.client_id;
    v_relationship_id := null;
  end if;

  if v_client_id is not null then
    select jsonb_build_object(
      'id', p.id, 'reference', p.reference, 'statut', p.statut,
      'date', p.date_prestation, 'lieu', p.lieu
    ) into v_next_presta
    from prestations p
    where p.client_id = v_client_id and p.statut not in ('terminee', 'annulee')
    order by p.date_prestation asc nulls last limit 1;
  end if;

  if v_club_id is not null then
    select jsonb_build_object(
      'title', title, 'date', event_date, 'time', event_time, 'location', location
    ) into v_next_event
    from club_calendar_events
    where club_id = v_club_id and event_date >= current_date
    order by event_date asc limit 1;
  end if;

  select jsonb_build_object(
    'id', gf.id, 'titre', gf.titre, 'montant_cible', gf.montant_cible, 'montant_collecte', gf.montant_collecte
  ) into v_funding
  from group_fundings gf
  where gf.statut in ('ouverte', 'objectif_atteint')
    and (
      (p_kind = 'linked' and gf.beneficiary_kind = 'linked' and gf.beneficiary_owner_user_id = p_ref_id)
      or (p_kind = 'managed' and gf.beneficiary_kind = 'managed' and gf.beneficiary_managed_id = p_ref_id)
    )
  order by gf.created_at desc limit 1;

  select jsonb_build_object(
    'kind', p_kind,
    'ref_id', p_ref_id,
    'first_name', v_first,
    'last_name', v_last,
    'sport', v_sport,
    'categorie', v_categorie,
    'club_nom', v_club,
    'club_id', v_club_id,
    'relation_label', v_relation,
    'status', case when p_kind = 'managed' then 'gere' else 'actif' end,
    'client_id', v_client_id,
    'relationship_id', v_relationship_id,
    'team_id', v_team_id,
    'saison_id', v_saison_id,
    'rights', case
        when p_kind = 'managed' then
          jsonb_build_object('voir', true, 'download', true, 'reserver', true, 'commandes', true, 'factures', true, 'payer', true, 'cotisation', true, 'calendrier', true, 'modifier', true)
        when p_kind = 'club' then
          jsonb_build_object('voir', false, 'download', false, 'reserver', false, 'commandes', false, 'factures', false, 'payer', false, 'cotisation', false, 'calendrier', true, 'modifier', false)
        else
          jsonb_build_object(
            'voir', v_car.right_voir, 'download', v_car.right_download, 'reserver', v_car.right_reserver,
            'commandes', v_car.right_commandes, 'factures', v_car.right_factures, 'payer', v_car.right_payer,
            'cotisation', v_car.right_cotisation, 'calendrier', v_car.right_calendrier, 'modifier', v_car.right_modifier
          )
      end,
    'next_prestation', v_next_presta,
    'next_event', v_next_event,
    'funding', v_funding
  ) into v_result;

  return v_result;
end;
$function$;
