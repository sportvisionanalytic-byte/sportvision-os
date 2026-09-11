-- « Résultats à renseigner » : le tableau de bord compte comme le Match Center (v147, 11/09/2026).
--
-- Depuis le 10/09, un score publié par la fédération ne clôt pas un match : il manque buteurs,
-- passeurs, homme du match, et le Match Center le garde « à renseigner » tant que le club n'a pas
-- confirmé (statut « recu »). Le tableau de bord, lui, ne comptait que les matchs sans score :
-- Villemomble lisait 49 à renseigner sur l'un, 50 sur l'autre.
--
-- Ce que ce test tient pour vrai : parmi les matchs passés, comptent ceux sans score ET ceux au
-- score officiel non confirmé ; pas ceux confirmés, reportés ou annulés ; jamais un match à venir.
-- Décor fictif, tout est annulé.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('f4f4f4f4-0000-0000-0000-000000000001','zz-res-cm@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;
insert into profiles (id, prenom, nom, role, actif) values ('f4f4f4f4-0000-0000-0000-000000000001','QA','CM','cm',true)
on conflict (id) do update set role = excluded.role;
create temp table ctx on commit drop as
  with cli as (insert into clients (nom, statut_relation, cm_id) values ('ZZ Club Résultats (test)', 'partenaire', 'f4f4f4f4-0000-0000-0000-000000000001') returning id),
       clu as (insert into clubs (nom, portail_client_id) select 'ZZ Club Résultats (test)', id from cli returning id)
  select (select id from clu) club_id;
grant select on ctx to authenticated;
insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'f4f4f4f4-0000-0000-0000-000000000001'::uuid, 'principal', current_date - 1, true from ctx;
-- Il y a 10 jours : sans score / score officiel non confirmé / confirmé / reporté / annulé.
-- Il y a 5 jours : un second score officiel non confirmé. Il y a 2 jours : sans score (récent).
-- Dans 3 jours : à venir. Ancienne règle : a, d, f = 3. Nouvelle : a, b, h, f = 4.
-- Le report et l'annulation passent par sport_status : un déclencheur en déduit le statut.
insert into club_matches (club_id, team, opponent, match_date, kickoff_time, score, status, sport_status)
select ctx.club_id, 'ZZ Séniors', 'ZZ Adversaire ' || v.k, current_date + v.j, '15:00', v.score, v.st, v.sp
  from ctx, (values ('a', -10, null, 'a_venir', 'scheduled'), ('b', -10, '2-1', 'a_venir', 'scheduled'),
                    ('c', -10, '3-0', 'recu', 'completed'), ('d', -10, null, 'a_venir', 'postponed'),
                    ('e', -10, null, 'a_venir', 'cancelled'), ('f', -2, null, 'a_venir', 'scheduled'),
                    ('g', 3, null, 'a_venir', 'scheduled'), ('h', -5, '0-0', 'a_venir', 'completed')) v(k, j, score, st, sp);

create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
grant usage on sequence verdicts_n_seq to authenticated;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;
create or replace function pg_temp.compteurs() returns text language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"f4f4f4f4-0000-0000-0000-000000000001","role":"authenticated"}', true);
  execute 'set local role authenticated';
  v := cm_tableau_de_bord((select club_id from ctx));
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return (v->'a_faire'->>'resultats_manquants') || '/' || (v->'a_faire'->>'resultats_recents');
end $$;

select pg_temp.note('à renseigner / dont récents : sans score (2) + scores officiels non confirmés (2), ni reporté ni annulé ; récent (1)', '4/1', pg_temp.compteurs());

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
