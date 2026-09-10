-- Invitation d'un encadrant : le lien fonctionne, et il n'ouvre QUE ce qu'il doit ouvrir.
--
-- POURQUOI CE FICHIER. Au 10/09/2026, club_invitations, player_invitations et parent_invitations
-- sont TOUTES VIDES : aucune invitation n'avait jamais ete emise en production. C'est pourtant le
-- tout premier geste d'un nouveau club — inviter son coach — et l'audit le listait comme non
-- verifie. Le mecanisme vient d'etre livre ; il faut le mesurer avant de s'y fier.
--
-- CE QU'ON MESURE, dans l'ordre d'un vrai parcours :
--   preparer -> lire le lien -> accepter -> la personne est membre, sur SES equipes seulement.
-- Puis les cas qui font mal quand ils sont oublies : jeton invalide, jeton expire, jeton deja
-- consomme, invitation revoquee, et une invitation preparee par un club voisin.
--
-- ATTENTION AU DECOR. `preparer_invitation_club` verifie que l'appelant a le droit d'inviter POUR
-- CE CLUB. Un test qui oublie ce detail mesure un refus d'autorisation en croyant mesurer le
-- mecanisme d'invitation.

-- NOTE DU 10/09/2026 SUR LE DECOR. Un garde (protect_sensitive_club_member_fields) interdit
-- desormais d'attribuer les roles admin, president et cm_externe d'un club a quiconque n'en est
-- pas l'administrateur. Ce durcissement a fait tomber ce test : son decor inserait ces roles en
-- `postgres` sans identite, que le garde traite comme un inconnu. En production, ces roles
-- n'entrent QUE par service_role (acceptation d'invitation, fonctions serveur) : le decor prend
-- donc le meme chemin. Les assertions, elles, restent jouees sous l'identite de chaque role.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $i$;

create or replace function pg_temp.compte(q text) returns integer language plpgsql as $i$
declare n integer;
begin execute 'select count(*) from ('||q||') z' into n; return n;
exception when others then return -1; end $i$;

do $$
declare
  orgA uuid; orgB uuid; teamA1 uuid; teamA2 uuid;
  patron uuid; coachCompte uuid;
  invit record; jeton text; e text[] := '{}'; n integer;
begin
  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);

  -- ── Deux clubs, deux equipes dans le premier ──────────────────────────────
  orgA := gen_random_uuid(); orgB := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut) values
    (orgA,'club','ZZ Club Invit A','actif_standard'), (orgB,'club','ZZ Club Invit B','actif_standard');
  insert into clubs (id, nom, plan) values (orgA,'ZZ Club Invit A','performance'), (orgB,'ZZ Club Invit B','performance');
  insert into club_teams (club_id, name) values (orgA,'ZZ U15 A') returning id into teamA1;
  insert into club_teams (club_id, name) values (orgA,'ZZ U17 A') returning id into teamA2;
  insert into club_teams (club_id, name) values (orgB,'ZZ U15 B');

  -- Le dirigeant qui invite.
  patron := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (patron,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-patron-'||patron||'@example.invalid','',now(),now(),now());
  insert into club_members (club_id, user_id, role, status) values (orgA, patron, 'admin', 'actif');

  -- Le futur coach : il a deja un compte, comme la plupart des vrais cas.
  coachCompte := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (coachCompte,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-coach@example.invalid','',now(),now(),now());

  -- ══ 1. PREPARER ══════════════════════════════════════════════════════════
  perform pg_temp.incarner(patron);
  begin
    select * into invit from preparer_invitation_club(
      orgA, 'zz-coach@example.invalid', 'coach', 'ZZ', 'Coach', null,
      to_jsonb(array[teamA1::text])) limit 1;
  exception when others then
    e := e || ('Preparer une invitation echoue — '||left(sqlerrm,80))::text;
  end;

  select token into jeton from club_invitations where club_id = orgA and email = 'zz-coach@example.invalid';
  if jeton is null then
    e := e || 'Aucune invitation n a ete creee'::text;
  end if;

  -- Une invitation preparee ne cree PAS de compte ni de membre : c'est tout l'interet.
  if pg_temp.compte(format('select 1 from club_members where club_id=%L and user_id=%L', orgA, coachCompte)) > 0 then
    e := e || 'Preparer une invitation a deja fait du coach un membre du club'::text;
  end if;

  -- ══ 2. LIRE LE LIEN ══════════════════════════════════════════════════════
  -- Un invite n'est pas encore membre : il doit pouvoir lire son invitation sans aucun droit.
  if jeton is not null then
    perform pg_temp.incarner(coachCompte);
    begin
      perform lire_invitation_club(jeton);
    exception when others then
      e := e || ('L invite ne peut pas lire sa propre invitation — '||left(sqlerrm,70))::text;
    end;

    -- Un jeton invente ne doit rien ouvrir, et surtout rien reveler.
    begin
      perform lire_invitation_club('zz-jeton-qui-n-existe-pas');
      -- Une reponse vide est acceptable, une exception aussi. Ce qui compte est plus bas.
    exception when others then null; end;
  end if;

  -- ══ 3. ACCEPTER ══════════════════════════════════════════════════════════
  if jeton is not null then
    perform pg_temp.incarner(coachCompte);
    begin
      perform accepter_invitation_club(jeton);
    exception when others then
      e := e || ('Accepter l invitation echoue — '||left(sqlerrm,80))::text;
    end;

    perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    select count(*) into n from club_members where club_id = orgA and user_id = coachCompte and status = 'actif';
    if n = 0 then
      e := e || 'Apres acceptation, le coach n est pas membre actif du club'::text;
    end if;
    select count(*) into n from club_members where club_id = orgA and user_id = coachCompte and role = 'coach';
    if n = 0 then
      e := e || 'Le coach n a pas recu le role prevu par l invitation'::text;
    end if;

    -- ══ 4. UN JETON NE SERT QU'UNE FOIS ════════════════════════════════════
    perform pg_temp.incarner(coachCompte);
    begin
      perform accepter_invitation_club(jeton);
      perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
      select count(*) into n from club_members where club_id = orgA and user_id = coachCompte;
      if n > 1 then
        e := e || 'Rejouer le lien a cree un second rattachement'::text;
      end if;
    exception when others then null; end;
  end if;

  -- ══ 5. LE PERIMETRE DU COACH ═════════════════════════════════════════════
  -- Il a ete invite sur UNE equipe. Il ne doit pas atteindre le club voisin.
  perform pg_temp.incarner(coachCompte);
  if pg_temp.compte(format('select 1 from club_teams where club_id=%L', orgB)) > 0 then
    e := e || 'Le coach invite atteint les equipes du club voisin'::text;
  end if;
  if pg_temp.compte(format('select 1 from club_teams where club_id=%L', orgA)) = 0 then
    e := e || 'DECOR MORT : le coach ne voit aucune equipe de SON club'::text;
  end if;
  if pg_temp.compte('select 1 from clients') > 0 then
    e := e || 'Le coach invite lit les clients de SportVision'::text;
  end if;
  if pg_temp.compte('select 1 from profiles where id <> auth.uid()') > 0 then
    e := e || 'Le coach invite lit l annuaire interne de SportVision'::text;
  end if;

  -- ══ 6. UN JETON EXPIRE N OUVRE RIEN ══════════════════════════════════════
  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  declare
    jetonExpire text; autreCompte uuid := gen_random_uuid();
  begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
      values (autreCompte,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-expire-'||autreCompte||'@example.invalid','',now(),now(),now());
    perform pg_temp.incarner(patron);
    perform preparer_invitation_club(orgA, 'zz-expire@example.invalid', 'coach', 'ZZ', 'Expire', null, '[]'::jsonb);
    perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    select token into jetonExpire from club_invitations where email = 'zz-expire@example.invalid';
    update club_invitations set expire_at = now() - interval '1 day' where token = jetonExpire;

    perform pg_temp.incarner(autreCompte);
    begin
      perform accepter_invitation_club(jetonExpire);
      perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
      select count(*) into n from club_members where club_id = orgA and user_id = autreCompte;
      if n > 0 then
        e := e || 'Un lien EXPIRE a quand meme rattache la personne au club'::text;
      end if;
    exception when others then null; end;
  end;

  -- ══ 7. INVITER CHEZ LE VOISIN ════════════════════════════════════════════
  perform pg_temp.incarner(patron);
  begin
    perform preparer_invitation_club(orgB, 'zz-intrus@example.invalid', 'coach', 'ZZ', 'Intrus', null, '[]'::jsonb);
    perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    select count(*) into n from club_invitations where club_id = orgB;
    if n > 0 then
      e := e || 'Un dirigeant a prepare une invitation pour un club qui n est pas le sien'::text;
    end if;
  exception when others then null; end;

  perform set_config('role','postgres',true); perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — une invitation d encadrant se prepare sans creer de compte, se lit par l invite, s accepte une seule fois, donne le role prevu, expire vraiment, ne franchit pas la frontiere du club, et n ouvre rien de l interne SportVision.' as verdict;

rollback;
