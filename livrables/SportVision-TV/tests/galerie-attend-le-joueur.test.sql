-- Un joueur validé APRÈS la publication d'une galerie est prévenu de ce qui l'attend.
--
-- POURQUOI CE FICHIER (13/09/2026). L'ordre réel des premières semaines d'un club est l'inverse de
-- celui qu'on imagine : on photographie un match, on publie la galerie, PUIS les familles créent
-- leur compte et sont validées. Le déclencheur de publication (v156) ne prévient que ceux qui sont
-- déjà là ; toutes ces validations arrivaient donc dans le silence, au moment précis où l'on vend
-- une photo. v213 comble ce trou.
--
-- CE QU'ON MESURE : le joueur et ses parents confirmés sont prévenus ; une seule notification même
-- pour plusieurs galeries ; rien pour une équipe sans galerie ; rien pour une galerie trop
-- ancienne ; pas de doublon si l'affiliation repasse en active ; et le parent atterrit sur la page
-- des photos de SON enfant, pas sur une page d'Espace joueur qui ne lui montrerait rien.

begin;

do $$
declare
  org uuid; team uuid; team_vide uuid; saison uuid;
  joueur uuid; compte_joueur uuid; parent uuid; compte_parent uuid; parent_profil uuid;
  e text[] := '{}'; n int; cible text;
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);

  org := gen_random_uuid();
  insert into organizations (id, organization_type, nom, statut)
    values (org,'club','ZZ Club Galerie Attente','actif_standard');
  insert into clubs (id, nom, plan) values (org,'ZZ Club Galerie Attente','performance');
  insert into club_teams (club_id, name) values (org,'ZZ Attente U13 A') returning id into team;
  insert into club_teams (club_id, name) values (org,'ZZ Attente U13 B') returning id into team_vide;

  compte_joueur := gen_random_uuid(); compte_parent := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      (compte_joueur,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-attente-joueur@example.invalid','',now(),now(),now()),
      (compte_parent,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-attente-parent@example.invalid','',now(),now(),now());

  insert into player_profiles (user_id, prenom, nom, club_id, date_naissance)
    values (compte_joueur,'ZZ','Joueur Attente',org, date '2013-05-04') returning id into joueur;
  insert into parent_profiles (user_id, prenom, nom)
    values (compte_parent,'ZZ','Parent Attente') returning id into parent_profil;
  insert into parent_player_relationships (parent_id, player_id, statut)
    values (parent_profil, joueur, 'confirme');

  -- Deux galeries récentes déjà publiées, et une trop ancienne.
  insert into media_albums (club_id, team_id, title, status, published_at)
    values (org, team, 'ZZ Match du 7', 'published', now() - interval '3 days'),
           (org, team, 'ZZ Match du 10', 'published', now() - interval '1 day'),
           (org, team, 'ZZ Saison passée', 'published', now() - interval '200 days');

  -- ══ 1. LE JOUEUR ARRIVE : IL EST PRÉVENU, UNE SEULE FOIS ═════════════════
  insert into team_memberships (player_id, team_id, club_id, statut, saison)
    values (joueur, team, org, 'active', '2026-2027');

  select count(*) into n from member_notifications
   where user_id = compte_joueur and target_href like '%galerie=recap-'||team::text;
  if n <> 1 then e := e || format('joueur : %s notification au lieu de 1', n); end if;

  -- Deux galeries récentes, une seule ligne, et le titre le dit.
  select count(*) into n from member_notifications
   where user_id = compte_joueur and title like '2 galeries%';
  if n <> 1 then e := e || 'le recapitulatif ne dit pas combien de galeries attendent'::text; end if;

  -- La galerie de la saison passée ne doit pas gonfler le compte.
  if exists (select 1 from member_notifications where user_id = compte_joueur and title like '3 galeries%') then
    e := e || 'une galerie de plus de 90 jours est comptee'::text;
  end if;

  -- ══ 2. LE PARENT AUSSI, SUR LA PAGE DE SON ENFANT ════════════════════════
  select target_href into cible from member_notifications
   where user_id = compte_parent and target_href like '%recap-'||team::text limit 1;
  if cible is null then
    e := e || 'le parent confirme n est pas prevenu'::text;
  elsif cible not like '/particulier/sportifs/club/'||joueur::text||'/photos%' then
    e := e || ('le parent est renvoye vers '||cible||' au lieu des photos de son enfant')::text;
  end if;

  -- ══ 3. PAS DE DOUBLON SI L'AFFILIATION REBOUGE ═══════════════════════════
  update team_memberships set statut = 'archivee' where player_id = joueur and team_id = team;
  update team_memberships set statut = 'active' where player_id = joueur and team_id = team;
  select count(*) into n from member_notifications
   where user_id = compte_joueur and target_href like '%galerie=recap-'||team::text;
  if n <> 1 then e := e || format('apres une reactivation : %s notifications au lieu de 1', n); end if;

  -- ══ 4. UNE ÉQUIPE SANS GALERIE NE PRÉVIENT PERSONNE ══════════════════════
  insert into team_memberships (player_id, team_id, club_id, statut, saison)
    values (joueur, team_vide, org, 'active', '2026-2027');
  select count(*) into n from member_notifications
   where user_id = compte_joueur and target_href like '%recap-'||team_vide::text;
  if n <> 0 then e := e || format('equipe sans galerie : %s notification au lieu de 0', n); end if;

  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — le joueur validé après coup est prévenu, ses parents aussi et sur la bonne page ; un seul récapitulatif ; ni les vieilles galeries ni les équipes sans photo ne font de bruit.' as verdict;

rollback;
