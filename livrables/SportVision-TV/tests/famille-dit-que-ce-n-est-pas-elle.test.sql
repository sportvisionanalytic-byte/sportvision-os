-- « Est-ce bien vous ? » doit accepter les deux réponses (v329, 28/09/2026).
--
-- Fouka, en testant : « ça a mis : est-ce que c'est bien vous ? Et j'ai mis : non, c'est pas moi.
-- Ça a mis : votre réponse n'a pas pu être enregistrée. »
--
-- L'écran ne montre QUE des suggestions de la machine. Or `media_famille_marque` ne laissait la
-- famille retirer que ses propres marquages : face à une suggestion, elle tombait dans « ce
-- marquage a été posé par le club ». La moitié du geste était impossible — et c'est la moitié qui
-- protège, celle qui dit à la machine qu'elle s'est trompée.
--
-- CE TEST TIENT LES DEUX BORNES. La famille refuse ce que la MACHINE propose ; elle ne défait pas
-- le travail d'un HUMAIN. Et le refus doit TENIR : il est enregistré, pas effacé, sinon le moteur
-- reproposerait la même photo à la passe suivante et la famille redirait non indéfiniment.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('af110000-0000-0000-0000-000000000001','zz-famille-joueur@example.invalid','',now(),'authenticated','authenticated'),
  ('af110000-0000-0000-0000-000000000009','zz-famille-staff@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, role, actif) values ('af110000-0000-0000-0000-000000000009','admin',true)
on conflict (id) do update set role = 'admin', actif = true;

insert into clubs (id, nom, ville, plan) values ('af110000-0000-0000-0000-0000000000c1','ZZ Famille Club','ZZ','performance');
insert into club_teams (id, club_id, name) values ('af110000-0000-0000-0000-0000000000a1','af110000-0000-0000-0000-0000000000c1','ZZ U16 Famille');

insert into player_profiles (id, prenom, nom, date_naissance, user_id) values
  ('af110000-0000-0000-0000-0000000000d1','ZZ','Joueur','2010-01-01','af110000-0000-0000-0000-000000000001');
insert into team_memberships (player_id, team_id, club_id, saison, statut) values
  ('af110000-0000-0000-0000-0000000000d1','af110000-0000-0000-0000-0000000000a1','af110000-0000-0000-0000-0000000000c1','2026-2027','active');

insert into media_albums (id, club_id, team_id, title, status) values
  ('af110000-0000-0000-0000-0000000000b1','af110000-0000-0000-0000-0000000000c1',
   'af110000-0000-0000-0000-0000000000a1','ZZ Galerie Famille','published');
insert into media_assets (id, album_id, original_path, status) values
  ('af110000-0000-0000-0000-0000000000f1','af110000-0000-0000-0000-0000000000b1','zz/f1.jpg','ready'),
  ('af110000-0000-0000-0000-0000000000f2','af110000-0000-0000-0000-0000000000b1','zz/f2.jpg','ready');

-- Ce que l'ecran affiche : une suggestion de la machine, non tranchee.
insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut, score, moteur) values
  ('media_asset','af110000-0000-0000-0000-0000000000f1','af110000-0000-0000-0000-0000000000d1','suggestion','propose',0.48,'zz-modele');
-- Et un marquage pose par un humain du club, que la famille ne doit pas pouvoir defaire.
insert into media_player_tags (media_ref_type, media_ref_id, player_id, tagged_by, source, statut) values
  ('media_asset','af110000-0000-0000-0000-0000000000f2','af110000-0000-0000-0000-0000000000d1',
   'af110000-0000-0000-0000-000000000009','humain','valide');

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant insert, select on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

create or replace function pg_temp.repond(p_uid uuid, p_asset uuid, p_cest_lui boolean) returns text
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform media_famille_marque(p_asset, 'af110000-0000-0000-0000-0000000000d1', p_cest_lui);
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return 'enregistre';
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return 'REFUSE';
end $$;

-- ── Le défaut que Fouka a rencontré ───────────────────────────────────────────────────────────
select pg_temp.note('« non, ce n''est pas moi » sur une suggestion est enregistre', 'enregistre',
  pg_temp.repond('af110000-0000-0000-0000-000000000001','af110000-0000-0000-0000-0000000000f1', false));

-- Le refus doit TENIR : sans ligne « rejete », le moteur reproposerait la meme photo.
select pg_temp.note('le refus est conserve, pas efface', 'rejete',
  (select coalesce(statut,'∅') from media_player_tags
    where media_ref_id = 'af110000-0000-0000-0000-0000000000f1'
      and player_id = 'af110000-0000-0000-0000-0000000000d1'));

-- ── Et l'autre réponse marche toujours ────────────────────────────────────────────────────────
select pg_temp.note('« oui c''est moi » reste possible, et revient sur un refus', 'enregistre',
  pg_temp.repond('af110000-0000-0000-0000-000000000001','af110000-0000-0000-0000-0000000000f1', true));

select pg_temp.note('la photo redevient sienne', 'valide',
  (select coalesce(statut,'∅') from media_player_tags
    where media_ref_id = 'af110000-0000-0000-0000-0000000000f1'
      and player_id = 'af110000-0000-0000-0000-0000000000d1'));

-- ── La borne : le travail d'un humain ne se défait pas ────────────────────────────────────────
select pg_temp.note('elle ne defait pas un marquage pose par le club', 'REFUSE',
  pg_temp.repond('af110000-0000-0000-0000-000000000001','af110000-0000-0000-0000-0000000000f2', false));

select pg_temp.note('et ce marquage est intact', 'valide',
  (select coalesce(statut,'∅') from media_player_tags
    where media_ref_id = 'af110000-0000-0000-0000-0000000000f2'
      and player_id = 'af110000-0000-0000-0000-0000000000d1'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
