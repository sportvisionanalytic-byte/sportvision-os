-- Invitations joueur et parent : le lien mene au bon enfant, et a lui seul.
--
-- POURQUOI CE FICHIER. Ces deux parcours n'avaient jamais ete emis en production (les deux tables
-- etaient vides au 10/09/2026) et l'audit les listait comme non verifies. Ils viennent d'etre
-- raccordes. Or c'est la zone la plus sensible de tout l'ecosysteme : derriere un rattachement
-- parent-enfant, il y a la fiche d'un mineur, ses photos, et la signature de son droit a l'image.
-- Une faille exactement la a ete trouvee et fermee le meme jour (migration-clubplus-v102).
--
-- CE QU'ON MESURE :
--   • l'invitation joueur mene au club et a l'equipe prevus, pas ailleurs ;
--   • l'invitation parent rattache a L'ENFANT DESIGNE PAR LE CLUB, et a personne d'autre ;
--   • une invitation ne s'accepte pas depuis un autre compte que celui invite ;
--   • elle ne sert qu'une fois ;
--   • ni le joueur ni le parent n'atteignent l'interne SportVision ni le club voisin.
--
-- Tout est fabrique dans la transaction et annule.

-- NOTE DU 10/09/2026 SUR LE DECOR. Un garde (protect_sensitive_club_member_fields) interdit
-- desormais d'attribuer les roles admin, president et cm_externe d'un club a quiconque n'en est
-- pas l'administrateur. Ce durcissement a fait tomber ce test : son decor inserait ces roles en
-- `postgres` sans identite, que le garde traite comme un inconnu. En production, ces roles
-- n'entrent QUE par service_role (acceptation d'invitation, fonctions serveur) : le decor prend
-- donc le meme chemin. Les assertions, elles, restent jouees sous l'identite de chaque role.

begin;

-- L'incarnation pose aussi le claim `email`. accept_player_invitation et
-- accept_parent_invitation comparent l'adresse de l'invitation a celle du JETON, pas a la ligne
-- auth.users : sans ce claim, elles repondent « Cette invitation ne correspond pas a votre compte »
-- et le test accuse l'application d'un defaut qui n'existe pas. Mesure du 10/09/2026.
-- L'incarnation pose aussi le claim `email`. accept_player_invitation et
-- accept_parent_invitation comparent l'adresse de l'invitation a celle du JETON, pas a la ligne
-- auth.users : sans ce claim, elles repondent « Cette invitation ne correspond pas a votre compte »
-- et le test accuse l'application d'un defaut qui n'existe pas. Mesure du 10/09/2026.
--
-- Les adresses sont resolues une seule fois, dans une table temporaire remplie tant qu'on est
-- encore postgres : `authenticated` n'a aucun droit sur auth.users, et une fonction SECURITY
-- DEFINER ne peut pas changer de role pour contourner ca.
create temp table _mails(id uuid primary key, email text) on commit drop;
grant all on _mails to authenticated, anon;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
declare v_email text;
begin
  select email into v_email from _mails where id = p;
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',
    json_build_object('sub',p::text,'role','authenticated','email',coalesce(v_email,''))::text, true);
end $i$;

create or replace function pg_temp.compte(q text) returns integer language plpgsql as $i$
declare n integer;
begin execute 'select count(*) from ('||q||') z' into n; return n;
exception when others then return -1; end $i$;

do $$
declare
  orgA uuid; orgB uuid; teamA uuid;
  patron uuid; joueurCompte uuid; parentCompte uuid; intrus uuid;
  enfantA uuid; enfantAutre uuid;
  invJoueur uuid; invParent uuid;
  e text[] := '{}'; n integer;
begin
  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);

  orgA := gen_random_uuid(); orgB := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut) values
    (orgA,'club','ZZ Club Fam A','actif_standard'), (orgB,'club','ZZ Club Fam B','actif_standard');
  insert into clubs (id, nom, plan) values (orgA,'ZZ Club Fam A','performance'), (orgB,'ZZ Club Fam B','performance');
  insert into club_teams (club_id, name) values (orgA,'ZZ U13 A') returning id into teamA;
  insert into club_teams (club_id, name) values (orgB,'ZZ U13 B');

  patron := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (patron,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-pat-'||patron||'@example.invalid','',now(),now(),now());
  insert into club_members (club_id, user_id, role, status) values (orgA, patron, 'admin', 'actif');

  -- Deux enfants du club : celui de la famille invitee, et celui d'une autre.
  -- 16 ans : un compte personnel n'est autorise qu'a partir de 14 ans, en dessous c'est un parent
  -- qui invite. Regle mesuree le 10/09/2026 — avec un enfant de 13 ans, la fonction repond « Un
  -- compte personnel n'est pas autorise avant 14 ans ». Le decor doit respecter la regle metier,
  -- sinon on teste le refus au lieu du parcours.
  insert into player_profiles (club_id, prenom, nom, date_naissance) values (orgA,'ZZ','EnfantInvite','2010-04-11') returning id into enfantA;
  insert into player_profiles (club_id, prenom, nom, date_naissance) values (orgA,'ZZ','EnfantAutre','2013-09-02') returning id into enfantAutre;

  -- Trois comptes : le joueur, le parent, et un tiers qui essaiera de s'inviter a leur place.
  joueurCompte := gen_random_uuid(); parentCompte := gen_random_uuid(); intrus := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
    (joueurCompte,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-joueur@example.invalid','',now(),now(),now()),
    (parentCompte,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-parent@example.invalid','',now(),now(),now()),
    (intrus,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-intrus@example.invalid','',now(),now(),now());

  insert into _mails select id, email from auth.users
   where id in (patron, joueurCompte, parentCompte, intrus);

  -- ══ 1. INVITATION JOUEUR ═════════════════════════════════════════════════
  insert into player_invitations (club_id, team_id, email, prenom, nom, date_naissance, invited_by, statut)
    values (orgA, teamA, 'zz-joueur@example.invalid', 'ZZ', 'Joueur', '2010-04-11', patron, 'envoyee')
    returning id into invJoueur;

  -- Un tiers ne doit pas pouvoir accepter une invitation qui ne lui est pas adressee.
  perform pg_temp.incarner(intrus);
  begin
    perform accept_player_invitation(invJoueur);
    perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    select count(*) into n from player_invitations where id = invJoueur and statut = 'acceptee';
    if n > 0 then
      e := e || 'Un tiers a accepte l invitation joueur adressee a quelqu un d autre'::text;
    end if;
  exception when others then null; end;

  -- Le bon compte, lui, doit passer.
  perform pg_temp.incarner(joueurCompte);
  begin
    perform accept_player_invitation(invJoueur);
  exception when others then
    e := e || ('Le joueur invite ne peut pas accepter son invitation — '||left(sqlerrm,70))::text;
  end;

  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select count(*) into n from player_invitations where id = invJoueur and statut in ('acceptee','accepted');
  if n = 0 then
    e := e || 'Apres acceptation, l invitation joueur n est pas marquee acceptee'::text;
  end if;

  -- ══ 1 bis. LA REGLE D AGE ════════════════════════════════════════════════
  -- Un mineur de moins de 14 ans ne doit pas pouvoir ouvrir un compte personnel : c'est un parent
  -- qui l'invite. La regle existe, on verifie qu'elle tient.
  declare
    invTropJeune uuid; enfantJeune uuid; compteJeune uuid := gen_random_uuid();
  begin
    perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (compteJeune,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-jeune@example.invalid','',now(),now(),now());
    insert into _mails values (compteJeune, 'zz-jeune@example.invalid');
    insert into player_profiles (club_id, prenom, nom, date_naissance)
      values (orgA,'ZZ','EnfantTropJeune', (current_date - interval '11 years')::date) returning id into enfantJeune;
    insert into player_invitations (club_id, team_id, email, prenom, nom, date_naissance, invited_by, statut)
      values (orgA, teamA, 'zz-jeune@example.invalid','ZZ','TropJeune',(current_date - interval '11 years')::date, patron,'envoyee')
      returning id into invTropJeune;

    perform pg_temp.incarner(compteJeune);
    begin
      perform accept_player_invitation(invTropJeune);
      perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
      select count(*) into n from player_invitations where id = invTropJeune and statut in ('acceptee','accepted');
      if n > 0 then
        e := e || 'Un enfant de 11 ans a ouvert un compte personnel'::text;
      end if;
    exception when others then null; end;
  end;

  -- ══ 2. INVITATION PARENT ═════════════════════════════════════════════════
  -- C'est le CLUB qui designe l'enfant : c'est ce qui rend ce chemin sur, contrairement au lien
  -- collectif ou la personne declarait elle-meme l'enfant.
  -- L'insertion revient en postgres : le bloc precedent a laisse le role sur `authenticated`, qui
  -- n'a pas le droit d'ecrire dans parent_invitations. C'est le club qui invite, via son ecran.
  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  insert into parent_invitations (club_id, player_id, email, prenom, nom, invited_by, statut)
    values (orgA, enfantA, 'zz-parent@example.invalid', 'ZZ', 'Parent', patron, 'envoyee')
    returning id into invParent;

  perform pg_temp.incarner(intrus);
  begin
    perform accept_parent_invitation(invParent);
    perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    select count(*) into n from parent_player_relationships ppr
      join parent_profiles pp on pp.id = ppr.parent_id
     where pp.user_id = intrus and ppr.player_id = enfantA;
    if n > 0 then
      e := e || 'UN TIERS EST DEVENU PARENT DE L ENFANT VIA UNE INVITATION QUI NE LUI ETAIT PAS ADRESSEE'::text;
    end if;
  exception when others then null; end;

  perform pg_temp.incarner(parentCompte);
  begin
    perform accept_parent_invitation(invParent);
  exception when others then
    e := e || ('Le parent invite ne peut pas accepter son invitation — '||left(sqlerrm,70))::text;
  end;

  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select count(*) into n from parent_player_relationships ppr
    join parent_profiles pp on pp.id = ppr.parent_id
   where pp.user_id = parentCompte and ppr.player_id = enfantA and ppr.statut = 'confirme';
  if n = 0 then
    e := e || 'Apres acceptation, le parent n est pas rattache a son enfant'::text;
  end if;

  -- Et il n'est rattache QU A lui.
  select count(*) into n from parent_player_relationships ppr
    join parent_profiles pp on pp.id = ppr.parent_id
   where pp.user_id = parentCompte and ppr.player_id = enfantAutre;
  if n > 0 then
    e := e || 'Le parent est aussi rattache a l enfant d une autre famille'::text;
  end if;

  -- ══ 3. UNE INVITATION NE SERT QU UNE FOIS ════════════════════════════════
  perform pg_temp.incarner(intrus);
  begin
    perform accept_parent_invitation(invParent);
    perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    select count(*) into n from parent_player_relationships ppr
      join parent_profiles pp on pp.id = ppr.parent_id where pp.user_id = intrus;
    if n > 0 then
      e := e || 'Une invitation parent deja consommee a servi une seconde fois'::text;
    end if;
  exception when others then null; end;

  -- ══ 4. LE PERIMETRE ══════════════════════════════════════════════════════
  perform pg_temp.incarner(parentCompte);
  if pg_temp.compte(format('select 1 from player_profiles where id=%L', enfantAutre)) > 0 then
    e := e || 'Le parent lit la fiche de l enfant d une autre famille'::text;
  end if;
  if pg_temp.compte(format('select 1 from club_teams where club_id=%L', orgB)) > 0 then
    e := e || 'Le parent atteint les equipes du club voisin'::text;
  end if;
  if pg_temp.compte('select 1 from clients') > 0 then
    e := e || 'Le parent lit les clients de SportVision'::text;
  end if;
  if pg_temp.compte('select 1 from profiles where id <> auth.uid()') > 0 then
    e := e || 'Le parent lit l annuaire interne de SportVision'::text;
  end if;

  -- ══ 5. VITALITE ══════════════════════════════════════════════════════════
  if pg_temp.compte(format('select 1 from player_profiles where id=%L', enfantA)) = 0 then
    e := e || 'DECOR MORT : le parent ne voit meme pas SON enfant'::text;
  end if;

  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — une invitation joueur ou parent ne s accepte que depuis le compte invite, ne sert qu une fois, rattache le parent a l enfant DESIGNE PAR LE CLUB et a lui seul, et n ouvre ni le club voisin ni l interne SportVision.' as verdict;

rollback;
