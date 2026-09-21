-- L'écusson du club sur la fiche d'un sportif (21/09/2026)
--
-- Fouka, sur l'espace parent : « faut qu'il puisse voir aussi le club, du coup voir le logo ».
--
-- La fiche affichait un carré gris portant le mot « logo » écrit en toutes lettres — un décor de
-- maquette resté en production. Le club était nommé, mais son écusson n'existait nulle part dans
-- la réponse : l'écran ne pouvait pas l'afficher.
--
-- Résolu ici plutôt que recopié sur la fiche du joueur : remplacer un écusson met alors à jour
-- toutes les fiches d'un coup, au lieu de laisser des copies se périmer une par une.
-- `ecusson_url` d'abord, `logo_url` à défaut : c'est l'écusson qui représente l'équipe.

CREATE OR REPLACE FUNCTION public.connect_get_athlete_detail(p_kind text, p_ref_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- 21/09/2026 — L'ecusson du club. La fiche affichait un carre gris portant le mot « logo »
    -- ecrit en toutes lettres : un decor de maquette reste en production. Resolu ici plutot que
    -- copie sur la fiche du joueur, pour qu'un ecusson remplace se mette a jour partout d'un coup.
    'club_logo_url', (select coalesce(c.ecusson_url, c.logo_url) from clubs c where c.id = v_club_id),
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
$function$

