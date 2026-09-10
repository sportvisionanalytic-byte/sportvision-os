-- Joueur et parent : chacun chez soi, et rien de l'interne.
--
-- POURQUOI CE FICHIER EXISTE. Au 10/09/2026, `player_profiles` et `parent_profiles` sont VIDES en
-- production. Ces deux roles n'avaient donc jamais ete mesures autrement que sur des identites non
-- rattachees, qui ne voient rien pour la mauvaise raison : parce qu'elles ne sont rattachees a
-- rien, pas parce que le cloisonnement fonctionne. Un test qui passe faute de decor ne prouve
-- rien. Celui-ci fabrique un vrai decor familial, joue, puis annule tout.
--
-- CE QU'IL VERIFIE, dans l'ordre des questions posees :
--   1. un joueur de l'equipe A n'atteint pas l'equipe B ;
--   2. un parent n'atteint pas l'enfant d'une autre famille ;
--   3. un parent ne peut pas S'ATTRIBUER un enfant, ni par creation ni par deplacement ;
--   4. ni l'un ni l'autre ne lit quoi que ce soit de l'interne (clients, prestations, factures,
--      devis, membres du club, annuaire SportVision).
--
-- UNE LECON EN CHEMIN. En lisant les policies, le point 3 ressemblait a une faille : la policy
-- UPDATE de parent_player_relationships ne contraint que `parent_id`, laissant `player_id` et
-- `statut` libres. La mesure a montre l'inverse — un declencheur dedie
-- (protect_sensitive_ppr_fields) bloque le deplacement. La protection ne vit donc PAS dans la
-- policy, et une migration qui retirerait ce declencheur rouvrirait le trou sans qu'aucune policy
-- ne change. C'est precisement pour ca que ce controle doit exister en test, et pas seulement dans
-- une note d'audit.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $i$;

create or replace function pg_temp.compte(q text) returns integer language plpgsql as $i$
declare n integer;
begin execute 'select count(*) from ('||q||') z' into n; return n;
exception when others then return 0; end $i$;

do $$
declare
  orgA uuid; orgB uuid; teamA uuid; teamB uuid;
  enfantA uuid; enfantB uuid; enfantAutreClub uuid;
  joueurA uuid; parentA uuid; ppA uuid; relA uuid;
  e text[] := '{}'; n integer;
begin
  perform set_config('role','postgres',true);

  -- ── Deux clubs, deux equipes, trois enfants ───────────────────────────────
  orgA := gen_random_uuid(); orgB := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut) values
    (orgA,'club','ZZ Club H1','actif_standard'), (orgB,'club','ZZ Club H2','actif_standard');
  insert into clubs (id, nom, plan) values (orgA,'ZZ Club H1','performance'), (orgB,'ZZ Club H2','performance');
  insert into club_teams (club_id, name) values (orgA,'ZZ Equipe A') returning id into teamA;
  insert into club_teams (club_id, name) values (orgA,'ZZ Equipe B') returning id into teamB;

  -- Le compte du joueur est cree AVANT sa fiche : guard_player_profile_update() interdit de poser
  -- `user_id` par une modification ulterieure, meme en superutilisateur. On le pose a l'insertion.
  joueurA := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (joueurA,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-jou-'||joueurA||'@example.invalid','',now(),now(),now());
  insert into player_profiles (club_id, prenom, nom, date_naissance, user_id)
    values (orgA,'ZZ','EnfantA','2012-05-04', joueurA) returning id into enfantA;
  insert into player_profiles (club_id, prenom, nom, date_naissance) values (orgA,'ZZ','EnfantB','2011-03-09') returning id into enfantB;
  insert into player_profiles (club_id, prenom, nom, date_naissance) values (orgB,'ZZ','EnfantAutreClub','2012-01-20') returning id into enfantAutreClub;

  insert into team_memberships (player_id, team_id, club_id, saison) values
    (enfantA, teamA, orgA, '2026-2027'), (enfantB, teamB, orgA, '2026-2027');

  -- ── Le parent : rattache a l'enfant A, confirme ───────────────────────────
  parentA := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (parentA,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-par-'||parentA||'@example.invalid','',now(),now(),now());
  insert into parent_profiles (user_id, prenom, nom) values (parentA,'ZZ','ParentA') returning id into ppA;
  insert into parent_player_relationships (parent_id, player_id, relation_type, statut)
    values (ppA, enfantA, 'parent', 'confirme') returning id into relA;

  -- ══ 1. LE JOUEUR ═════════════════════════════════════════════════════════
  perform pg_temp.incarner(joueurA);

  if pg_temp.compte('select 1 from player_profiles where id='''||enfantA||'''') = 0 then
    e := e || 'DECOR MORT : le joueur ne voit pas sa propre fiche'::text;
  end if;
  if pg_temp.compte('select 1 from player_profiles where id='''||enfantB||'''') > 0 then
    e := e || 'Le joueur lit la fiche d un camarade d une AUTRE equipe'::text;
  end if;
  if pg_temp.compte('select 1 from player_profiles where id='''||enfantAutreClub||'''') > 0 then
    e := e || 'Le joueur lit la fiche d un enfant d un AUTRE CLUB'::text;
  end if;
  if pg_temp.compte('select 1 from team_memberships where team_id='''||teamB||'''') > 0 then
    e := e || 'Le joueur lit l effectif de l equipe B'::text;
  end if;

  -- ══ 2. LE PARENT ═════════════════════════════════════════════════════════
  perform pg_temp.incarner(parentA);

  if pg_temp.compte('select 1 from player_profiles where id='''||enfantA||'''') = 0 then
    e := e || 'DECOR MORT : le parent ne voit pas son propre enfant'::text;
  end if;
  if pg_temp.compte('select 1 from player_profiles where id='''||enfantB||'''') > 0 then
    e := e || 'Le parent lit la fiche de l enfant d une autre famille'::text;
  end if;
  if pg_temp.compte('select 1 from player_profiles where id='''||enfantAutreClub||'''') > 0 then
    e := e || 'Le parent lit la fiche d un enfant d un autre club'::text;
  end if;

  -- ══ 3. S'ATTRIBUER UN ENFANT ═════════════════════════════════════════════
  -- (a) creer une relation de toutes pieces
  begin
    insert into parent_player_relationships (parent_id, player_id, relation_type, statut)
      values (ppA, enfantB, 'parent', 'confirme');
    e := e || 'Un parent a CREE un rattachement vers l enfant d une autre famille'::text;
  exception when others then null; end;

  -- (b) deplacer sa relation existante vers un autre enfant. C'est ici que la lecture des
  --     policies induisait en erreur : seul un declencheur l'empeche.
  begin
    update parent_player_relationships set player_id = enfantB where id = relA;
    get diagnostics n = row_count;
    if n > 0 then
      e := e || 'Un parent a DEPLACE son rattachement vers l enfant d une autre famille'::text;
    end if;
  exception when others then null; end;

  -- (c) et vers un enfant d un autre club
  begin
    update parent_player_relationships set player_id = enfantAutreClub where id = relA;
    get diagnostics n = row_count;
    if n > 0 then
      e := e || 'Un parent a deplace son rattachement vers un enfant d un AUTRE CLUB'::text;
    end if;
  exception when others then null; end;

  -- (c bis) se CONFIRMER soi-meme sur un lien en attente.
  --
  -- Ce cas manquait a la premiere version de ce fichier, et c'etait la vraie porte : elle a ete
  -- trouvee et fermee le 10/09/2026 (migration-clubplus-v102). La policy laissait alors un parent
  -- modifier SA ligne sans aucune contrainte sur le statut — creer le lien « en attente » puis le
  -- passer a « confirme » d'un seul UPDATE suffisait. Ce qui s'ouvrait derriere n'etait pas
  -- theorique : fiche du mineur, ses medias, et la signature de son droit a l'image.
  --
  -- On sonde ici les deux sens : le parent doit pouvoir REFUSER ou RETIRER un lien, jamais le
  -- confirmer lui-meme.
  declare
    relAttente uuid;
  begin
    perform set_config('role','postgres',true);
    insert into parent_player_relationships (parent_id, player_id, relation_type, statut)
      values (ppA, enfantB, 'parent', 'en_attente_confirmation') returning id into relAttente;
    perform pg_temp.incarner(parentA);

    begin
      update parent_player_relationships set statut = 'confirme' where id = relAttente;
      get diagnostics n = row_count;
      if n > 0 then
        e := e || 'Un parent s est CONFIRME lui-meme sur un enfant d une autre famille'::text;
      end if;
    exception when others then null; end;

    -- Et la soupape doit rester ouverte : refuser un lien qu'on n'a pas demande.
    begin
      update parent_player_relationships set statut = 'refuse' where id = relAttente;
      get diagnostics n = row_count;
      if n = 0 then
        e := e || 'Un parent ne peut plus REFUSER un rattachement qu il n a pas demande'::text;
      end if;
    exception when others then
      e := e || ('Un parent ne peut plus refuser un rattachement — '||left(sqlerrm,50))::text;
    end;
  end;

  -- (d) consequence : rien ne doit avoir bouge
  if pg_temp.compte('select 1 from player_profiles where id='''||enfantB||'''') > 0 then
    e := e || 'APRES tentative : le parent atteint l enfant d une autre famille'::text;
  end if;

  -- ══ 4. AUCUNE DONNEE INTERNE ═════════════════════════════════════════════
  declare
    qui text; uid uuid;
  begin
    foreach qui in array array['joueur','parent'] loop
      uid := case qui when 'joueur' then joueurA else parentA end;
      perform pg_temp.incarner(uid);
      if pg_temp.compte('select 1 from clients') > 0 then e := e || format('Le %s lit les clients', qui); end if;
      if pg_temp.compte('select 1 from prestations') > 0 then e := e || format('Le %s lit les prestations', qui); end if;
      if pg_temp.compte('select 1 from factures') > 0 then e := e || format('Le %s lit les factures', qui); end if;
      if pg_temp.compte('select 1 from devis') > 0 then e := e || format('Le %s lit les devis', qui); end if;
      if pg_temp.compte('select 1 from club_members') > 0 then e := e || format('Le %s lit les membres du club', qui); end if;
      if pg_temp.compte('select 1 from profiles where id <> auth.uid()') > 0 then e := e || format('Le %s lit l annuaire SportVision', qui); end if;
      if pg_temp.compte('select 1 from collaborateur_coordonnees') > 0 then e := e || format('Le %s lit les coordonnees des collaborateurs', qui); end if;
      if pg_temp.compte('select 1 from collaborateur_logistique') > 0 then e := e || format('Le %s lit la logistique des collaborateurs', qui); end if;
    end loop;
  end;

  perform set_config('role','postgres',true);
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — un joueur ne sort pas de son equipe, un parent ne sort pas de sa famille, aucun des deux ne peut s attribuer un enfant ni lire quoi que ce soit de l interne SportVision.' as verdict;

rollback;
