-- Une photo confirmée par la famille devient une référence — mais seulement si l'accord le couvre
-- (v334, 28/09/2026).
--
-- DÉCISION DE FOUKA : « oui, les conserver ». Un « c'est bien moi » est la meilleure donnée du
-- système — une certitude humaine, sur une vraie photo de match, sous un angle que la photo de
-- référence ne couvre pas. C'est le seul mécanisme qui s'améliore tout seul à l'usage.
--
-- CE QUE CE TEST PROTÈGE, ET C'EST L'ESSENTIEL. Le texte accepté jusqu'ici dit « la photo que vous
-- déposez et son empreinte, RIEN D'AUTRE ». Conserver en plus les empreintes de galerie est un
-- changement substantiel du traitement de données biométriques de mineurs. Un accord donné sur
-- l'ancien texte ne le couvre pas, et l'élargir en silence serait une faute. Le test vérifie donc
-- qu'un accord en `v1` ne produit RIEN, et qu'un accord en `v2` produit la référence.
--
-- IL TIENT AUSSI LA DEUXIÈME BORNE : seule une photo tranchée par UNE PERSONNE devient référence.
-- Si une certitude machine pouvait en devenir une, une erreur se renforcerait elle-même à chaque
-- passe, indéfiniment.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('b4110000-0000-0000-0000-000000000001','zz-gal-joueur@example.invalid','',now(),'authenticated','authenticated'),
  ('b4110000-0000-0000-0000-000000000009','zz-gal-staff@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, role, actif) values ('b4110000-0000-0000-0000-000000000009','admin',true)
on conflict (id) do update set role='admin', actif=true;

insert into clubs (id, nom, ville, plan) values ('b4110000-0000-0000-0000-0000000000c1','ZZ Gal Club','ZZ','performance');
insert into club_teams (id, club_id, name) values ('b4110000-0000-0000-0000-0000000000a1','b4110000-0000-0000-0000-0000000000c1','ZZ U16 Gal');
insert into player_profiles (id, club_id, prenom, nom, date_naissance, account_status, user_id) values
  ('b4110000-0000-0000-0000-0000000000d1','b4110000-0000-0000-0000-0000000000c1','ZZ','Galerie','2010-01-01','actif','b4110000-0000-0000-0000-000000000001');
insert into team_memberships (player_id, team_id, club_id, saison, statut) values
  ('b4110000-0000-0000-0000-0000000000d1','b4110000-0000-0000-0000-0000000000a1','b4110000-0000-0000-0000-0000000000c1','2026-2027','active');

-- L'ACCORD EST D'ABORD DONNE SUR L'ANCIEN TEXTE : c'est le cas qui doit ne rien produire.
insert into consentements_biometrie (id, player_id, donne_par, qualite, texte_version, statut) values
  ('b4110000-0000-0000-0000-0000000000cc','b4110000-0000-0000-0000-0000000000d1',
   'b4110000-0000-0000-0000-000000000009','parent','v1-2026-09','accorde');

insert into media_albums (id, club_id, team_id, title, status) values
  ('b4110000-0000-0000-0000-0000000000b1','b4110000-0000-0000-0000-0000000000c1',
   'b4110000-0000-0000-0000-0000000000a1','ZZ Galerie Gal','published');
insert into media_assets (id, album_id, original_path, status) values
  ('b4110000-0000-0000-0000-0000000000f1','b4110000-0000-0000-0000-0000000000b1','zz/g1.jpg','ready'),
  ('b4110000-0000-0000-0000-0000000000f2','b4110000-0000-0000-0000-0000000000b1','zz/g2.jpg','ready');

-- Photo 1 : confirmee PAR UNE PERSONNE (valide_par renseigne).
insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut, valide_par, valide_le) values
  ('media_asset','b4110000-0000-0000-0000-0000000000f1','b4110000-0000-0000-0000-0000000000d1',
   'famille','valide','b4110000-0000-0000-0000-000000000001', now());
-- Photo 2 : validee PAR LA MACHINE (valide_par nul) — elle ne doit jamais devenir une reference.
insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut, score, moteur) values
  ('media_asset','b4110000-0000-0000-0000-0000000000f2','b4110000-0000-0000-0000-0000000000d1',
   'suggestion','valide',0.31,'zz-modele');

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.vecteur(p_a numeric) returns text language sql immutable as $$
  select '[' || p_a || repeat(',0', 127) || ']'; $$;

create or replace function pg_temp.essai(p_asset uuid, p_val numeric) returns text
language plpgsql as $$
declare v uuid;
begin
  v := visage_reference_depuis_galerie('b4110000-0000-0000-0000-0000000000d1', p_asset,
        pg_temp.vecteur(p_val)::vector, 'zz-modele');
  return case when v is null then 'rien' else 'reference' end;
exception when others then
  return 'refuse';
end $$;

-- ── La borne juridique : l'ancien accord ne couvre pas ce traitement ──────────────────────────

select pg_temp.note('accord sur l''ANCIEN texte : rien n''est conserve', 'rien',
  pg_temp.essai('b4110000-0000-0000-0000-0000000000f1', 1));

select pg_temp.note('et aucune empreinte n''est apparue', '0',
  (select count(*)::text from visages_reference where player_id = 'b4110000-0000-0000-0000-0000000000d1'));

-- La famille redonne son accord sur le nouveau texte, en connaissance de cause.
update consentements_biometrie set texte_version = 'v2-2026-09'
 where id = 'b4110000-0000-0000-0000-0000000000cc';

select pg_temp.note('accord sur le NOUVEAU texte : la photo confirmee devient reference', 'reference',
  pg_temp.essai('b4110000-0000-0000-0000-0000000000f1', 1));

-- ── La borne technique : une certitude MACHINE ne devient jamais une référence ────────────────
--
-- Sans ce contrôle, une erreur de la machine se renforcerait elle-même à chaque passe.
select pg_temp.note('une photo validee par la MACHINE ne devient pas reference', 'refuse',
  pg_temp.essai('b4110000-0000-0000-0000-0000000000f2', 2));

-- ── Et le retrait d'accord efface tout, ces empreintes comprises ──────────────────────────────

select pg_temp.note('le sportif a bien une empreinte de galerie', '1',
  (select count(*)::text from visages_reference
    where player_id = 'b4110000-0000-0000-0000-0000000000d1' and origine = 'galerie'));

select set_config('request.jwt.claims',
  json_build_object('sub','b4110000-0000-0000-0000-000000000001','role','authenticated')::text, true);
select retirer_consentement_biometrie('b4110000-0000-0000-0000-0000000000d1');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select pg_temp.note('retirer l''accord efface AUSSI les empreintes de galerie', '0',
  (select count(*)::text from visages_reference where player_id = 'b4110000-0000-0000-0000-0000000000d1'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
