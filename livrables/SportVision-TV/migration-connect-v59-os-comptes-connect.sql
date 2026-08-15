-- ============================================================
-- SPORTVISION — Migration v59
-- Ajoute une lecture staff des comptes Connect (club+ / joueur / particulier)
-- pour la nouvelle section "Comptes Connect" de l'OS — distincte du CRM
-- `clients` (pipeline commercial B2B) : ici ce sont les vrais comptes
-- utilisateurs Connect, en lecture seule pour le staff.
--
-- Suite directe de v58 (qui a arrêté de créer des lignes `profiles` pour ces
-- comptes, donc l'OS n'a plus aucun moyen de les voir du tout). Ce fichier
-- fournit deux RPC staff-only (SECURITY DEFINER + is_staff() vérifié à
-- l'intérieur, comme le reste du schéma Connect) :
--
--   - connect_os_accounts_list()          → liste plate pour le tableau
--   - connect_os_account_detail(user_id)  → fiche détaillée (jsonb)
--
-- Aucune écriture. NON EXÉCUTÉE — à relire puis exécuter par Fouka dans
-- Supabase → SQL Editor. Idempotente (create or replace function).
-- ============================================================


-- ─── Liste ──────────────────────────────────────────────────────────────
-- 3 types, définis par la donnée déjà en place (aucune nouvelle colonne) :
--   'club'       → player_profiles (compte joueur affilié à un club via Club+)
--   'joueur'     → connect_profile_settings.account_type = 'joueur' (Connect
--                  personnel, avec ou sans club déclaré manuellement)
--   'particulier'→ connect_profile_settings.account_type = 'particulier'
--                  (parent/tuteur/agent qui gère un ou plusieurs athlètes)
create or replace function connect_os_accounts_list()
returns table (
  user_id uuid,
  type text,
  prenom text,
  nom text,
  email text,
  ville text,
  club_nom text,
  agent_tier text,
  agent_status text,
  nb_athletes int,
  created_at timestamptz
)
language plpgsql security definer as $$
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: réservé au staff';
  end if;

  return query
  select
    pp.user_id,
    'club'::text,
    pp.prenom,
    pp.nom,
    u.email,
    null::text,
    c.nom,
    null::text,
    null::text,
    null::int,
    pp.created_at
  from player_profiles pp
  join auth.users u on u.id = pp.user_id
  left join clubs c on c.id = pp.club_id
  where pp.user_id is not null

  union all

  select
    cps.user_id,
    cps.account_type,
    coalesce(u.raw_user_meta_data->>'first_name', ''),
    coalesce(u.raw_user_meta_data->>'last_name', ''),
    u.email,
    cps.ville,
    dc.name,
    cas.tier,
    cas.status,
    (select count(*)::int from managed_athlete_profiles map where map.owner_user_id = cps.user_id)
      + (select count(*)::int from connect_access_relationships car
           where car.grantee_user_id = cps.user_id and car.status = 'acceptee'),
    cps.created_at
  from connect_profile_settings cps
  join auth.users u on u.id = cps.user_id
  left join connect_declared_club_players dcp on dcp.user_id = cps.user_id
  left join connect_declared_clubs dc on dc.id = dcp.declared_club_id
  left join connect_agent_subscriptions cas on cas.user_id = cps.user_id
  order by 11 desc;
$$;

revoke all on function connect_os_accounts_list() from public;
grant execute on function connect_os_accounts_list() to authenticated;


-- ─── Fiche détail ───────────────────────────────────────────────────────
create or replace function connect_os_account_detail(p_user_id uuid)
returns jsonb
language plpgsql security definer as $$
declare
  v_result jsonb;
  v_pp record;
  v_cps record;
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: réservé au staff';
  end if;

  select pp.*, c.nom as club_nom, u.email into v_pp
  from player_profiles pp
  join auth.users u on u.id = pp.user_id
  left join clubs c on c.id = pp.club_id
  where pp.user_id = p_user_id;

  if found then
    v_result := jsonb_build_object(
      'user_id', v_pp.user_id,
      'type', 'club',
      'prenom', v_pp.prenom,
      'nom', v_pp.nom,
      'email', v_pp.email,
      'date_naissance', v_pp.date_naissance,
      'numero_licence', v_pp.numero_licence,
      'numero_maillot', v_pp.numero_maillot,
      'account_status', v_pp.account_status,
      'club_nom', v_pp.club_nom,
      'created_at', v_pp.created_at
    );
    return v_result;
  end if;

  select cps.*, u.email, u.raw_user_meta_data into v_cps
  from connect_profile_settings cps
  join auth.users u on u.id = cps.user_id
  where cps.user_id = p_user_id;

  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'user_id', v_cps.user_id,
    'type', v_cps.account_type,
    'prenom', coalesce(v_cps.raw_user_meta_data->>'first_name', ''),
    'nom', coalesce(v_cps.raw_user_meta_data->>'last_name', ''),
    'email', v_cps.email,
    'telephone', v_cps.telephone,
    'ville', v_cps.ville,
    'sport', v_cps.sport,
    'poste', v_cps.poste,
    'categorie', v_cps.categorie,
    'created_at', v_cps.created_at,
    'club_declare', (
      select jsonb_build_object('nom', dc.name, 'ville', dc.city, 'equipe', dcp.team)
      from connect_declared_club_players dcp
      join connect_declared_clubs dc on dc.id = dcp.declared_club_id
      where dcp.user_id = v_cps.user_id
      limit 1
    ),
    'agent_subscription', (
      select jsonb_build_object(
        'tier', cas.tier, 'status', cas.status,
        'current_period_end', cas.current_period_end,
        'cancel_at_period_end', cas.cancel_at_period_end
      )
      from connect_agent_subscriptions cas
      where cas.user_id = v_cps.user_id
    ),
    'managed_athletes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', map.id, 'prenom', map.prenom, 'nom', map.nom,
        'sport', map.sport, 'categorie', map.categorie,
        'relation_label', map.relation_label
      ))
      from managed_athlete_profiles map
      where map.owner_user_id = v_cps.user_id
    ), '[]'::jsonb),
    'athletes_linked', coalesce((
      select jsonb_agg(jsonb_build_object(
        'owner_user_id', car.owner_user_id,
        'relation_type', car.relation_type,
        'relation_label', car.relation_label,
        'status', car.status
      ))
      from connect_access_relationships car
      where car.grantee_user_id = v_cps.user_id and car.status = 'acceptee'
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function connect_os_account_detail(uuid) from public;
grant execute on function connect_os_account_detail(uuid) to authenticated;
