-- v183 : un parent peut enfin réserver une prestation pour son enfant affilié à un club
-- (12/09/2026).
--
-- Le cas le plus naturel du produit était le seul fermé. Un parent confirmé voyait la fiche de son
-- enfant, son calendrier, ses photos, mais « Réserver » lui était refusé : la résolution du
-- bénéficiaire ne connaissait que « moi », « un compte qui m'a donné accès » et « une fiche que
-- j'ai créée moi-même ». Pour un enfant réellement affilié à un club, elle levait « Type de
-- bénéficiaire invalide » — d'où le droit `reserver` à false côté écran, et un renvoi vers un
-- e-mail manuel.
--
-- Le client facturé reste la FAMILLE, jamais le club : une fiche client au nom de l'enfant, avec
-- les coordonnées du parent qui réserve. Ce dernier point règle au passage un défaut signalé par
-- le même audit : les fiches clients créées pour un enfant n'avaient ni e-mail ni téléphone, et
-- l'opérateur arrivait sur le terrain sans personne à joindre.
-- Test : tests/reservation-parent-enfant-club.test.sql

create or replace function public.connect_resolve_beneficiary_client_id(p_kind text, p_ref_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $function$

declare
  v_owner uuid;
  v_client_id uuid;
  v_prenom text;
  v_nom text;
  v_email text;
  v_label text;
  v_client_row jsonb;
  v_created boolean;
  v_sport text;
  v_pole_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  -- ── Enfant affilié à un club partenaire (12/09/2026) ──
  -- Ce cas n'existait pas : un parent confirmé ne pouvait rien réserver pour son enfant, alors
  -- que c'est le cas le plus courant du produit. Il retombait sur un e-mail manuel.
  --
  -- Le client facturé n'est PAS le club : c'est la famille. On crée donc, comme pour un profil
  -- géré, une fiche client au nom de l'enfant — mais avec les coordonnées du PARENT qui réserve,
  -- pour que l'opérateur ait quelqu'un à joindre le jour de la prestation. Sans e-mail ni
  -- téléphone, une mission arrive sur le terrain sans contact.
  if p_kind = 'club' then
    if p_ref_id is null then
      raise exception 'Sportif requis.';
    end if;
    if not is_confirmed_parent_of(p_ref_id) then
      raise exception 'Cet enfant n''est pas le vôtre, ou le rattachement n''est pas confirmé.';
    end if;

    select pp.client_id, pp.prenom, pp.nom, c.discipline
      into v_client_id, v_prenom, v_nom, v_sport
      from player_profiles pp left join clubs c on c.id = pp.club_id
     where pp.id = p_ref_id;
    if v_client_id is not null then
      return v_client_id;
    end if;

    v_pole_id := resolve_pole_by_sport(v_sport);
    select u.email into v_email from auth.users u where u.id = auth.uid();

    insert into clients (nom, type_client, prenom_contact, nom_contact, email, telephone, pole_id, origine_prospect)
    select coalesce(v_prenom, '') || ' ' || coalesce(v_nom, ''), 'particulier',
           pf.prenom, pf.nom, v_email,
           (select cps.telephone from connect_profile_settings cps where cps.user_id = auth.uid()),
           coalesce(v_pole_id, pole_football_id()), 'connect'
      from parent_profiles pf where pf.user_id = auth.uid()
    returning id into v_client_id;

    update player_profiles set client_id = v_client_id where id = p_ref_id;
    insert into messages_client (client_id, auteur_type, auteur_staff_id, contenu)
      values (v_client_id, 'staff', null, 'Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.');
    return v_client_id;
  end if;

  if p_kind = 'managed' then
    if not exists (select 1 from managed_athlete_profiles where id = p_ref_id and owner_user_id = auth.uid()) then
      raise exception 'Profil géré introuvable ou accès refusé.';
    end if;

    select client_id, prenom, nom, sport into v_client_id, v_prenom, v_nom, v_sport
      from managed_athlete_profiles where id = p_ref_id;
    if v_client_id is not null then
      return v_client_id;
    end if;

    -- FIX v33 : sport du profil géré (managed_athlete_profiles.sport, saisi dans
    -- ManagedAthleteForm.tsx) résolu en pôle réel s'il en existe un, même logique que
    -- self/linked ci-dessous (resolve_pole_by_sport, v13) — jamais fait avant cette
    -- migration, la ligne clients retombait silencieusement sur pole_football_id().
    v_pole_id := resolve_pole_by_sport(v_sport);

    -- Pas de rattachement par e-mail ici : un profil géré (enfant, proche) n'a pas
    -- d'adresse e-mail propre, donc rien à retrouver dans clients par ce biais.
    insert into clients (nom, type_client, prenom_contact, nom_contact, pole_id)
      values (v_prenom || ' ' || v_nom, 'particulier', v_prenom, v_nom, coalesce(v_pole_id, pole_football_id()))
      returning id into v_client_id;
    update managed_athlete_profiles set client_id = v_client_id, updated_at = now() where id = p_ref_id;
    insert into messages_client (client_id, auteur_type, auteur_staff_id, contenu)
      values (v_client_id, 'staff', null, 'Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.');
    return v_client_id;
  end if;

  if p_kind = 'self' then
    v_owner := auth.uid();
  elsif p_kind = 'linked' then
    if p_ref_id is null then
      raise exception 'Sportif requis.';
    end if;
    if p_ref_id = auth.uid() then
      v_owner := auth.uid(); -- garde-fou : "linked" vers soi-même équivaut à "self"
    elsif not exists (
      select 1 from connect_access_relationships
      where owner_user_id = p_ref_id and grantee_user_id = auth.uid()
        and status = 'acceptee' and right_reserver
    ) then
      raise exception 'Autorisation de réservation manquante pour ce sportif.';
    else
      v_owner := p_ref_id;
    end if;
  else
    raise exception 'Type de bénéficiaire invalide.';
  end if;

  select email, raw_user_meta_data->>'first_name', raw_user_meta_data->>'last_name'
    into v_email, v_prenom, v_nom
    from auth.users where id = v_owner;

  -- BUGFIX v13 : sport choisi à l'inscription (state.sport, /signup/sport),
  -- écrit dans connect_profile_settings.sport au premier login (voir
  -- lib/signup/pending-onboarding.ts côté app-connect) — résolu ici en pôle
  -- réel s'il en existe un, sinon reste NULL (capté comme signal de demande,
  -- voir resolve_pole_by_sport ci-dessus).
  select sport into v_sport from connect_profile_settings where user_id = v_owner;
  v_pole_id := resolve_pole_by_sport(v_sport);

  select client_id into v_client_id
    from player_profiles where user_id = v_owner limit 1;
  if found then
    if v_client_id is not null then
      return v_client_id;
    end if;

    if v_email is not null then
      v_client_row := find_or_create_client_by_email(
        v_email, 'prospect', 'particulier',
        nullif(trim(coalesce(v_prenom, '') || ' ' || coalesce(v_nom, '')), ''),
        v_nom, v_prenom, null, 'connect', null, null, v_pole_id
      );
      v_client_id := (v_client_row->>'id')::uuid;
      v_created := coalesce((v_client_row->>'_created')::boolean, true);
    else
      -- Filet historique : pas d'e-mail résolvable (cas théorique), comportement inchangé
      -- hormis pole_id, désormais posé explicitement comme partout ailleurs dans cette fonction.
      insert into clients (nom, type_client, prenom_contact, nom_contact, pole_id)
        values (coalesce(v_prenom, '') || ' ' || coalesce(v_nom, ''), 'particulier', v_prenom, v_nom, coalesce(v_pole_id, pole_football_id()))
        returning id into v_client_id;
      v_created := true;
    end if;

    -- Premier rattachement de la fiche à son client : marqueur reconnu par proteger_identite_joueur
    -- (blocages-review-4, 11/09/2026), retiré aussitôt la mise à jour faite.
    perform set_config('sv.ecriture_systeme', 'client_joueur', true);
    update player_profiles set client_id = v_client_id where user_id = v_owner;
    perform set_config('sv.ecriture_systeme', '', true);
    if v_created then
      insert into messages_client (client_id, auteur_type, auteur_staff_id, contenu)
        values (v_client_id, 'staff', null, 'Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.');
    end if;
    return v_client_id;
  end if;

  -- Pas de player_profiles (particulier, ou joueur/sportif sans club) :
  -- connect_profile_settings.client_id, provisionné à la demande.
  select client_id into v_client_id from connect_profile_settings where user_id = v_owner;
  if v_client_id is not null then
    return v_client_id;
  end if;

  v_label := nullif(trim(coalesce(v_prenom, '') || ' ' || coalesce(v_nom, '')), '');
  if v_label is null then
    v_label := coalesce(split_part(v_email, '@', 1), 'Client Connect');
  end if;

  if v_email is not null then
    v_client_row := find_or_create_client_by_email(
      v_email, 'prospect', 'particulier', v_label, v_nom, v_prenom, null, 'connect', null, null, v_pole_id
    );
    v_client_id := (v_client_row->>'id')::uuid;
    v_created := coalesce((v_client_row->>'_created')::boolean, true);
  else
    -- Filet historique : pas d'e-mail résolvable (cas théorique), comportement inchangé
    -- hormis pole_id, désormais posé explicitement comme partout ailleurs dans cette fonction.
    insert into clients (nom, type_client, prenom_contact, nom_contact, pole_id)
      values (v_label, 'particulier', v_prenom, v_nom, coalesce(v_pole_id, pole_football_id()))
      returning id into v_client_id;
    v_created := true;
  end if;

  insert into connect_profile_settings (user_id, client_id, account_type)
    values (v_owner, v_client_id, 'particulier')
  on conflict (user_id) do update set client_id = excluded.client_id;

  if v_created then
    insert into messages_client (client_id, auteur_type, auteur_staff_id, contenu)
      values (v_client_id, 'staff', null, 'Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.');
  end if;

  return v_client_id;
end;
$function$;

-- Les droits du parent sur la fiche de son enfant affilié. Ils étaient tous à « non » : l'écran
-- annonçait donc, à juste titre, qu'il ne pouvait rien faire. Ce n'est plus vrai.
create or replace function public.connect_list_my_athletes()
returns table (kind text, ref_id uuid, relationship_id uuid, first_name text, last_name text,
               sport text, categorie text, club_nom text, club_status text, relation_label text,
               status text, right_voir boolean, right_download boolean, right_reserver boolean,
               right_commandes boolean, right_factures boolean, right_payer boolean,
               right_cotisation boolean, right_calendrier boolean, right_modifier boolean)
language plpgsql stable security definer set search_path = public
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
    -- 12/09/2026 : le parent confirmé d'un enfant affilié peut voir, télécharger, réserver, suivre
    -- ses commandes et ses factures, et payer. Tout était à « non » depuis la v79, faute de
    -- support serveur pour la réservation ; il existe depuis la v183. Reste à « non » : la
    -- cotisation collective (elle se crée depuis le groupe) et la modification de la fiche, qui
    -- appartient au club.
    true, true, true, true, true, true, false, true, false
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
