-- Une commande de Pass ne doit pas être signalée « payée sans accès » (v335, 28/09/2026).
--
-- CE QUE FOUKA A VU. « Sur l'OS je vois 2 commandes ouvertes, payé sans accès ouvert. »
--
-- LE DÉFAUT. `media_sante` cherchait un droit de TÉLÉCHARGEMENT (`media_download_grants`) pour
-- toute commande payée. C'est la bonne question pour un achat de photos à l'unité — on paie, on
-- télécharge. Mais un PASS n'ouvre pas de téléchargement : il ouvre un droit
-- (`media_entitlements`), qui donne accès à ses photos dans la galerie. Aucun Pass n'a donc jamais
-- de download_grant, et tous étaient signalés comme anomalie CRITIQUE.
--
-- Ce n'est pas un détail d'affichage : c'est la liste que le staff regarde pour savoir si un
-- client a payé sans rien recevoir. Une liste qui crie au loup à chaque vente finit par ne plus
-- être lue du tout — et le jour où une vraie commande orpheline s'y glisse, personne ne la voit.
--
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('b5110000-0000-0000-0000-000000000001','zz-sante-staff@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, role, actif) values ('b5110000-0000-0000-0000-000000000001','admin',true)
on conflict (id) do update set role='admin', actif=true;

insert into clubs (id, nom, ville, plan) values ('b5110000-0000-0000-0000-0000000000c1','ZZ Sante Club','ZZ','performance');
insert into player_profiles (id, club_id, prenom, nom, date_naissance) values
  ('b5110000-0000-0000-0000-0000000000d1','b5110000-0000-0000-0000-0000000000c1','ZZ','Sante','2010-01-01');

-- Trois commandes payees, trois situations.
-- `purchased_by_user_id` n'est pas decoratif : une commande sans acheteur identifiable est refusee.
insert into media_orders (id, club_id, status, amount_cents, currency, source, paid_at, beneficiary_person_id, purchased_by_user_id) values
  ('b5110000-0000-0000-0000-0000000000e1','b5110000-0000-0000-0000-0000000000c1','paid',3999,'eur','apple',now(),'b5110000-0000-0000-0000-0000000000d1','b5110000-0000-0000-0000-000000000001'),
  ('b5110000-0000-0000-0000-0000000000e2','b5110000-0000-0000-0000-0000000000c1','paid',1000,'eur','stripe',now(),null,'b5110000-0000-0000-0000-000000000001'),
  ('b5110000-0000-0000-0000-0000000000e3','b5110000-0000-0000-0000-0000000000c1','paid',3999,'eur','apple',now(),'b5110000-0000-0000-0000-0000000000d1','b5110000-0000-0000-0000-000000000001');

-- e1 : un PASS, dont l'acces passe par un droit. Elle ne doit PAS etre signalee.
insert into media_entitlements (club_id, saison_id, beneficiary_person_id, scope_type, scope_id, status, valid_from, order_id)
select 'b5110000-0000-0000-0000-0000000000c1', (select id from saisons order by created_at desc limit 1),
       'b5110000-0000-0000-0000-0000000000d1','club',
       'b5110000-0000-0000-0000-0000000000c1','active', now(), 'b5110000-0000-0000-0000-0000000000e1';

-- e2 : un achat de photos a l'unite, avec son droit de telechargement. Pas signalee non plus.
insert into media_download_grants (order_id, email, expires_at)
values ('b5110000-0000-0000-0000-0000000000e2', 'zz-sante@example.invalid', now() + interval '30 days');

-- e3 : rien du tout. C'est LA vraie anomalie, celle qu'on veut voir.

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

create or replace function pg_temp.signalees() returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','b5110000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  select string_agg(x, ' ' order by x) into v from (
    select jsonb_array_elements(s.detail)->>'commande' x
      from media_sante() s where s.probleme like '%sans accès%'
  ) y where x like 'b5110000%';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return coalesce(v, 'aucune');
end $$;

select pg_temp.note('seule la commande sans aucun acces est signalee',
  'b5110000-0000-0000-0000-0000000000e3', pg_temp.signalees());

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
