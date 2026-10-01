-- Constituer l'effectif d'avance, et la photo qui attend l'accord (v384, v385, v386 — 01/10/2026).
--
-- CE QUE CE TEST DÉFEND, et pourquoi il mérite d'exister :
--
--   1. LE PÉRIMÈTRE DU COACH. Fouka : « le coach UNIQUEMENT pour sa catégorie ». C'est la seule
--      borne qui protège le fichier joueurs d'un club : si elle saute, un coach de U9 crée et
--      photographie les enfants des Seniors. Elle ne tient pas à une policy — l'équipe n'est pas
--      une colonne de player_profiles — mais à une fonction. Donc elle se teste.
--
--   2. L'ORDRE PHOTO PUIS ACCORD PUIS EMPREINTE. On dépose la photo d'un mineur avant que sa
--      famille ait rien signé. C'est permis : c'est une photo. Ce qui ne l'est pas, c'est d'en
--      calculer le gabarit biométrique avant l'accord. Trois verrous indépendants l'empêchent
--      aujourd'hui, et ce test vérifie qu'ils sont tous les trois encore là.
--
--   3. « ON LUI PROPOSE SA PHOTO, IL GÈRE ». Poser la photo de profil de quelqu'un d'autre doit
--      rester impossible, y compris à l'administration SportVision.
--
-- Décor entièrement fictif, tout est annulé par le rollback final.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('ef110000-0000-0000-0000-000000000001','zz-coach-a@example.invalid','',now(),'authenticated','authenticated'),
  ('ef110000-0000-0000-0000-000000000002','zz-coach-b@example.invalid','',now(),'authenticated','authenticated'),
  ('ef110000-0000-0000-0000-000000000003','zz-president@example.invalid','',now(),'authenticated','authenticated'),
  ('ef110000-0000-0000-0000-000000000004','zz-parent@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

create temp table ctx on commit drop as
  with clu as (insert into clubs (nom, plan) values ('ZZ Club Effectif','performance') returning id),
       sai as (select id, label from saisons where active order by date_debut desc limit 1),
       ea as (insert into club_teams (club_id, name, categorie, saison_id)
              select clu.id, 'ZZ-U9', 'U9', sai.id from clu, sai returning id),
       eb as (insert into club_teams (club_id, name, categorie, saison_id)
              select clu.id, 'ZZ-Seniors', 'Seniors', sai.id from clu, sai returning id)
  select (select id from clu) club, (select id from ea) equipe_a, (select id from eb) equipe_b,
         (select id from sai) saison, (select label from sai) saison_label;
grant select on ctx to authenticated;

-- Le coach A n'encadre que ZZ-U9. Le coach B que ZZ-Seniors. `club_members.teams` porte le NOM de
-- l'équipe, c'est ce que `is_team_educateur` compare.
insert into club_members (club_id, user_id, role, prenom, nom, teams, status)
select club, 'ef110000-0000-0000-0000-000000000001', 'coach', 'ZZ', 'Coach A', '["ZZ-U9"]'::jsonb, 'actif' from ctx;
insert into club_members (club_id, user_id, role, prenom, nom, teams, status)
select club, 'ef110000-0000-0000-0000-000000000002', 'coach', 'ZZ', 'Coach B', '["ZZ-Seniors"]'::jsonb, 'actif' from ctx;
insert into club_members (club_id, user_id, role, prenom, nom, teams, status)
select club, 'ef110000-0000-0000-0000-000000000003', 'president', 'ZZ', 'President', '[]'::jsonb, 'actif' from ctx;

insert into parent_profiles (id, user_id, prenom, nom)
values ('ef110000-0000-0000-0000-000000000004','ef110000-0000-0000-0000-000000000004','ZZ','Parent')
on conflict (id) do nothing;

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant all on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(c text, a text, o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (c, a, o); $$;

create or replace function pg_temp.devenir(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.redevenir_systeme() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"service_role"}', true); end $$;

-- Constituer : rend l'identifiant de la fiche, ou « refuse ».
create or replace function pg_temp.constituer(p_qui uuid, p_equipe uuid, p_nom text, p_dn text)
returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.devenir(p_qui);
  select coalesce(fiche_id::text, 'sans fiche : ' || verdict) into r
    from effectif_constituer(p_equipe,
      jsonb_build_array(jsonb_build_object('prenom','ZZ','nom',p_nom,'date_naissance',p_dn)));
  perform pg_temp.redevenir_systeme();
  return coalesce(r, 'aucune ligne rendue');
exception when others then
  perform pg_temp.redevenir_systeme();
  return 'refuse';
end $$;

create or replace function pg_temp.deposer(p_qui uuid, p_joueur uuid) returns text language plpgsql as $$
begin
  perform pg_temp.devenir(p_qui);
  perform effectif_deposer_photo(p_joueur, 'effectif/' || p_joueur::text || '/zz.jpg');
  perform pg_temp.redevenir_systeme();
  return 'accepte';
exception when others then
  perform pg_temp.redevenir_systeme();
  return 'refuse';
end $$;

-- ═══ 1. LE PÉRIMÈTRE ═══════════════════════════════════════════════════════════════════════════

create temp table fiches on commit drop as
  select pg_temp.constituer('ef110000-0000-0000-0000-000000000001', (select equipe_a from ctx), 'Enfant U9', '2017-03-04') as par_coach_a,
         pg_temp.constituer('ef110000-0000-0000-0000-000000000002', (select equipe_a from ctx), 'Intrus U9', '2017-05-05') as par_coach_b_hors_perimetre,
         pg_temp.constituer('ef110000-0000-0000-0000-000000000003', (select equipe_b from ctx), 'Senior', '2000-01-01') as par_president;

select pg_temp.note('le coach cree une fiche dans SON equipe', 'oui',
  case when (select par_coach_a from fiches) ~ '^[0-9a-f-]{36}$' then 'oui' else (select par_coach_a from fiches) end);

select pg_temp.note('le coach d''une AUTRE equipe est refuse', 'refuse',
  (select par_coach_b_hors_perimetre from fiches));

select pg_temp.note('le president du club cree partout dans son club', 'oui',
  case when (select par_president from fiches) ~ '^[0-9a-f-]{36}$' then 'oui' else (select par_president from fiches) end);

-- Idempotence : rejouer la MÊME ligne ne crée pas de doublon.
select pg_temp.note('rejouer la meme ligne ne cree pas de doublon', '1',
  (select count(*)::text from player_profiles
    where club_id = (select club from ctx) and nom = 'Enfant U9'));
select pg_temp.note('et la seconde passe rend la MEME fiche', 'oui',
  case when pg_temp.constituer('ef110000-0000-0000-0000-000000000001', (select equipe_a from ctx), 'Enfant U9', '2017-03-04')
            = (select par_coach_a from fiches) then 'oui' else 'non' end);

-- La date de naissance ne s'invente pas : c'est elle qui décide qui donne l'accord.
-- Appelée SOUS L'IDENTITÉ du coach : en service_role, auth.uid() est nul et la fonction refuse
-- tout. Une sonde mal identifiée accuse le produit (premier passage de ce test).
create or replace function pg_temp.verdict_ligne(p_qui uuid, p_equipe uuid, p_ligne jsonb)
returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.devenir(p_qui);
  select verdict into r from effectif_constituer(p_equipe, jsonb_build_array(p_ligne));
  perform pg_temp.redevenir_systeme();
  return coalesce(r, 'aucune ligne rendue');
exception when others then
  perform pg_temp.redevenir_systeme();
  return 'refuse a la porte';
end $$;

select pg_temp.note('une ligne sans date de naissance est refusee', 'refusee',
  pg_temp.verdict_ligne('ef110000-0000-0000-0000-000000000001', (select equipe_a from ctx),
                        '{"prenom":"ZZ","nom":"Sans Date"}'::jsonb));
select pg_temp.note('une date de naissance dans le futur est refusee', 'refusee',
  pg_temp.verdict_ligne('ef110000-0000-0000-0000-000000000001', (select equipe_a from ctx),
                        '{"prenom":"ZZ","nom":"Futur","date_naissance":"2030-01-01"}'::jsonb));

-- ═══ 2. LA PHOTO AVANT L'ACCORD, L'EMPREINTE APRÈS ═════════════════════════════════════════════

select pg_temp.note('le coach depose la photo de SON sportif, sans aucun accord', 'accepte',
  pg_temp.deposer('ef110000-0000-0000-0000-000000000001', (select par_coach_a from fiches)::uuid));

select pg_temp.note('le coach d''une autre equipe ne depose pas sa photo', 'refuse',
  pg_temp.deposer('ef110000-0000-0000-0000-000000000002', (select par_coach_a from fiches)::uuid));

-- LE POINT LE PLUS IMPORTANT DE CE FICHIER. La photo est là, et pourtant rien du côté biométrique.
select pg_temp.note('la photo attend : AUCUNE photo de reference', '0',
  (select count(*)::text from player_face_refs where player_id = (select par_coach_a from fiches)::uuid));
select pg_temp.note('la photo attend : AUCUNE empreinte', '0',
  (select count(*)::text from visages_reference where player_id = (select par_coach_a from fiches)::uuid));
select pg_temp.note('mais la photo est bien enregistree', '1',
  (select count(*)::text from photos_reference_attente
    where player_id = (select par_coach_a from fiches)::uuid and promue_le is null));

-- Le verrou de la table : même en service_role, une référence sans accord est refusée.
create or replace function pg_temp.forcer_reference(p_joueur uuid) returns text language plpgsql as $$
declare v_c uuid;
begin
  select id into v_c from consentements_biometrie where player_id = p_joueur limit 1;
  insert into player_face_refs (player_id, consentement_id, moteur, storage_path)
  values (p_joueur, coalesce(v_c, gen_random_uuid()), 'zz', 'effectif/zz.jpg');
  return 'accepte';
exception when others then return 'refuse';
end $$;
select pg_temp.note('forcer une reference sans accord : refuse meme en systeme', 'refuse',
  pg_temp.forcer_reference((select par_coach_a from fiches)::uuid));

-- L'accord arrive. Le parent doit d'abord être confirmé : c'est le club qui le décide, ou une
-- invitation nominative. Ici on pose le lien comme `accept_parent_invitation` le poserait.
insert into parent_player_relationships (parent_id, player_id, relation_type, statut, confirmed_at)
values ('ef110000-0000-0000-0000-000000000004', (select par_coach_a from fiches)::uuid, 'parent', 'confirme', now());

create or replace function pg_temp.accorder(p_qui uuid, p_joueur uuid) returns text language plpgsql as $$
begin
  perform pg_temp.devenir(p_qui);
  perform donner_consentement_biometrie(p_joueur, 'v2-2026-09');
  perform pg_temp.redevenir_systeme();
  return 'accorde';
exception when others then
  perform pg_temp.redevenir_systeme();
  return 'refuse';
end $$;

select pg_temp.note('le parent confirme donne l''accord', 'accorde',
  pg_temp.accorder('ef110000-0000-0000-0000-000000000004', (select par_coach_a from fiches)::uuid));

select pg_temp.note('la photo deposee d''avance est DEVENUE une reference', '1',
  (select count(*)::text from player_face_refs where player_id = (select par_coach_a from fiches)::uuid));
select pg_temp.note('elle est marquee promue dans la file d''attente', '1',
  (select count(*)::text from photos_reference_attente
    where player_id = (select par_coach_a from fiches)::uuid and promue_le is not null));

-- ET L'EMPREINTE, TOUJOURS PAS. C'est le moteur qui la calcule, après, hors de la base.
select pg_temp.note('l''accord ne calcule AUCUNE empreinte : c''est le moteur, apres', '0',
  (select count(*)::text from visages_reference where player_id = (select par_coach_a from fiches)::uuid));

-- L'accord retiré emporte tout, y compris ce que le club avait déposé.
update consentements_biometrie set statut = 'retire'
 where player_id = (select par_coach_a from fiches)::uuid;
select pg_temp.note('accord retire : plus aucune reference', '0',
  (select count(*)::text from player_face_refs where player_id = (select par_coach_a from fiches)::uuid));
select pg_temp.note('accord retire : la photo du club part aussi', '0',
  (select count(*)::text from photos_reference_attente
    where player_id = (select par_coach_a from fiches)::uuid and refusee_le is null));

-- ═══ 3. LA PHOTO DU COACH EST PROPOSÉE, JAMAIS POSÉE ═══════════════════════════════════════════

create temp table membre on commit drop as
  select id, user_id from club_members
   where club_id = (select club from ctx) and user_id = 'ef110000-0000-0000-0000-000000000001';
grant select on membre to authenticated;

create or replace function pg_temp.poser_de_force(p_qui uuid) returns text language plpgsql as $$
begin
  perform pg_temp.devenir(p_qui);
  execute 'set local role authenticated';
  update club_members set photo_path = 'profils/force.jpg' where id = (select id from membre);
  execute 'reset role';
  perform pg_temp.redevenir_systeme();
  return 'accepte';
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform pg_temp.redevenir_systeme();
  return 'refuse';
end $$;

select pg_temp.note('le president ne pose pas la photo de son coach', 'refuse',
  pg_temp.poser_de_force('ef110000-0000-0000-0000-000000000003'));
select pg_temp.note('le coach ne la pose pas lui-meme en direct non plus', 'refuse',
  pg_temp.poser_de_force('ef110000-0000-0000-0000-000000000001'));

create or replace function pg_temp.proposer(p_qui uuid) returns text language plpgsql as $$
begin
  perform pg_temp.devenir(p_qui);
  perform proposer_photo_profil((select id from membre),
          'profils/' || (select user_id from membre)::text || '/zz.jpg', 'Prise au tournoi');
  perform pg_temp.redevenir_systeme();
  return 'accepte';
exception when others then
  perform pg_temp.redevenir_systeme();
  return 'refuse';
end $$;

select pg_temp.note('le president PROPOSE', 'accepte',
  pg_temp.proposer('ef110000-0000-0000-0000-000000000003'));
select pg_temp.note('proposer ne pose rien', 'rien',
  coalesce((select photo_path from club_members where id = (select id from membre)), 'rien'));

create or replace function pg_temp.repondre(p_qui uuid, p_oui boolean) returns text language plpgsql as $$
declare v uuid;
begin
  select id into v from photos_profil_proposees
   where club_member_id = (select id from membre) and statut = 'proposee' limit 1;
  perform pg_temp.devenir(p_qui);
  perform repondre_photo_profil(v, p_oui);
  perform pg_temp.redevenir_systeme();
  return 'accepte';
exception when others then
  perform pg_temp.redevenir_systeme();
  return 'refuse';
end $$;

select pg_temp.note('le president ne repond pas a la place du coach', 'refuse',
  pg_temp.repondre('ef110000-0000-0000-0000-000000000003', true));
select pg_temp.note('le coach accepte', 'accepte',
  pg_temp.repondre('ef110000-0000-0000-0000-000000000001', true));
select pg_temp.note('et LA VALEUR est posee, pas seulement la ligne comptee', 'oui',
  case when (select photo_path from club_members where id = (select id from membre))
            = 'profils/ef110000-0000-0000-0000-000000000001/zz.jpg' then 'oui'
       else coalesce((select photo_path from club_members where id = (select id from membre)), 'rien') end);

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
