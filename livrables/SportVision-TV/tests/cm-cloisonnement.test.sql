-- Un CM affecté au Club A ne doit RIEN voir du Club B.
--
-- C'est le test du §80, et il est écrit avant la migration : c'est lui qui dit si le
-- cloisonnement fonctionne, pas la lecture du code.
--
-- Méthode : on cree deux clubs, deux CM, on affecte chacun au sien, puis on se met REELLEMENT
-- dans la peau de chaque CM (set local role authenticated + request.jwt.claims) et on compte ce
-- que la base lui rend. Aucune supposition sur les policies : on mesure ce qui sort.
--
-- Tout s'execute dans une transaction annulee.

begin;

-- Se mettre dans la peau d'un utilisateur : c'est auth.uid() qui gouverne toutes les policies.
-- Definie dans la transaction, elle disparait avec le rollback.
create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $inner$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $inner$;

do $$
declare
  v_cmA uuid; v_cmB uuid; v_clubA uuid; v_clubB uuid;
  v_teamA uuid; v_teamB uuid; v_aff uuid;
  n integer; e text[] := '{}'; v_admin uuid;

begin
  perform set_config('role','postgres',true);

  -- ── Decor : deux clubs, deux CM ────────────────────────────────────────────
  insert into organizations (id, organization_type, nom, statut)
  values (gen_random_uuid(),'club','ZZ Club A test','actif_standard') returning id into v_clubA;
  insert into organizations (id, organization_type, nom, statut)
  values (gen_random_uuid(),'club','ZZ Club B test','actif_standard') returning id into v_clubB;
  insert into clubs (id, nom) values (v_clubA,'ZZ Club A test');
  insert into clubs (id, nom) values (v_clubB,'ZZ Club B test');
  insert into club_teams (club_id, name) values (v_clubA,'ZZ U18 A') returning id into v_teamA;
  insert into club_teams (club_id, name) values (v_clubB,'ZZ U18 B') returning id into v_teamB;

  -- Deux CM REELS plutot que des profils fabriques : profiles reference auth.users, et surtout
  -- le test doit mesurer ce que voient les personnes qui utilisent vraiment l'OS.
  select id into v_cmA from profiles where role = 'cm' order by created_at limit 1;
  select id into v_cmB from profiles where role = 'cm' and id <> v_cmA order by created_at limit 1;
  if v_cmA is null or v_cmB is null then
    raise exception 'Il faut au moins deux collaborateurs de role cm pour jouer ce test.';
  end if;

  insert into club_cm_affectations (club_id, cm_id, role, actif)
  values (v_clubA, v_cmA, 'principal', true) returning id into v_aff;
  insert into club_cm_affectations (club_id, cm_id, role, actif)
  values (v_clubB, v_cmB, 'principal', true);

  -- ══ 1. Le CM A voit SON club ═══════════════════════════════════════════════
  perform pg_temp.incarner(v_cmA);
  select count(*)::integer into n from clubs where id = v_clubA;
  if n <> 1 then e := e || 'CM A ne voit pas son propre club'::text; end if;
  select count(*)::integer into n from club_teams where club_id = v_clubA;
  if n <> 1 then e := e || 'CM A ne voit pas les equipes de son club'::text; end if;

  -- ══ 2. Le CM A ne voit RIEN du club B ══════════════════════════════════════
  select count(*)::integer into n from clubs where id = v_clubB;
  if n <> 0 then e := e || ('FUITE : CM A lit le club B ('||n||' ligne)'); end if;
  select count(*)::integer into n from club_teams where club_id = v_clubB;
  if n <> 0 then e := e || ('FUITE : CM A lit les equipes du club B ('||n||')'); end if;
  select count(*)::integer into n from organizations where id = v_clubB;
  if n <> 0 then e := e || ('FUITE : CM A lit l organisation du club B'); end if;
  select count(*)::integer into n from club_onboarding_progress where club_id = v_clubB;
  if n <> 0 then e := e || 'FUITE : CM A lit l onboarding du club B'::text; end if;
  select count(*)::integer into n from team_invite_codes where club_id = v_clubB;
  if n <> 0 then e := e || 'FUITE : CM A lit les liens d inscription du club B'::text; end if;
  select count(*)::integer into n from membership_requests where club_id = v_clubB;
  if n <> 0 then e := e || 'FUITE : CM A lit les demandes d adhesion du club B'::text; end if;
  select count(*)::integer into n from memberships where organization_id = v_clubB;
  if n <> 0 then e := e || 'FUITE : CM A lit les affiliations du club B'::text; end if;
  select count(*)::integer into n from player_invitations where club_id = v_clubB;
  if n <> 0 then e := e || 'FUITE : CM A lit les invitations joueur du club B'::text; end if;
  select count(*)::integer into n from club_members where club_id = v_clubB;
  if n <> 0 then e := e || 'FUITE : CM A lit les membres du club B'::text; end if;

  -- ══ 3. Le CM A ne MODIFIE rien du club B ═══════════════════════════════════
  begin
    update club_teams set name = 'PIRATE' where club_id = v_clubB;
    get diagnostics n = row_count;
    if n > 0 then e := e || ('FUITE : CM A a modifie '||n||' equipe(s) du club B'); end if;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into club_teams (club_id, name) values (v_clubB, 'PIRATE');
    e := e || 'FUITE : CM A a cree une equipe dans le club B'::text;
  exception when others then null;
  end;

  -- ══ 4. Une affectation desactivee retire les droits IMMEDIATEMENT ══════════
  perform set_config('role','postgres',true);
  update club_cm_affectations set actif = false where id = v_aff;
  perform pg_temp.incarner(v_cmA);
  select count(*)::integer into n from clubs where id = v_clubA;
  if n <> 0 then e := e || ('Desactivation sans effet : CM A lit encore son ancien club'); end if;
  select count(*)::integer into n from club_teams where club_id = v_clubA;
  if n <> 0 then e := e || 'Desactivation sans effet : CM A lit encore les equipes'::text; end if;

  -- ══ 5. Une affectation expiree ne donne plus rien ══════════════════════════
  perform set_config('role','postgres',true);
  -- date_debut recule aussi : la contrainte cca_dates_coherentes refuse une fin anterieure au
  -- debut, et elle a raison de le faire.
  update club_cm_affectations
     set actif = true, date_debut = current_date - 10, date_fin = current_date - 1
   where id = v_aff;
  perform pg_temp.incarner(v_cmA);
  select count(*)::integer into n from clubs where id = v_clubA;
  if n <> 0 then e := e || 'Une affectation expiree donne encore acces'::text; end if;

  -- ══ 6. Une affectation qui commence demain ne donne rien aujourd'hui ═══════
  perform set_config('role','postgres',true);
  update club_cm_affectations set date_fin = null, date_debut = current_date + 1 where id = v_aff;
  -- (affectation qui ne commence que demain)
  perform pg_temp.incarner(v_cmA);
  select count(*)::integer into n from clubs where id = v_clubA;
  if n <> 0 then e := e || 'Une affectation future donne deja acces'::text; end if;

  -- ══ 7. L'admin, lui, continue de tout voir ═════════════════════════════════
  perform set_config('role','postgres',true);
  update club_cm_affectations set date_debut = current_date where id = v_aff;
  begin
    select id into v_admin from profiles where role = 'admin' limit 1;
    if v_admin is not null then
      perform pg_temp.incarner(v_admin);
      select count(*)::integer into n from clubs where id in (v_clubA, v_clubB);
      if n <> 2 then e := e || ('L admin ne voit plus les deux clubs ('||n||'/2) — le cloisonnement deborde'); end if;
    end if;
  end;

  perform set_config('role','postgres',true);
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — un CM ne voit et ne modifie que les clubs qui lui sont affectes ; desactivation, expiration et date future retirent l acces immediatement ; l admin garde sa vue globale.' as verdict;

rollback;
