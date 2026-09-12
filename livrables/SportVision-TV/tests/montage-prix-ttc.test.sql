-- Le Montage & compilation coûte bien 39,90 € au client (v177, 12/09/2026).
--
-- Ce que ce test tient pour vrai : le prix hors taxes du catalogue, majoré de la TVA, redonne le
-- prix affiché sur le site, et il est cohérent avec le reste de la grille (100 → 120, 125 → 150).
-- Lecture seule, rien n'est modifié.

begin;
create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

select pg_temp.note('le montage revient à 39,90 € TTC', '39.90',
  (select round(prix_ht * 1.20, 2)::text from catalogue_offres where nom = 'Montage Compilation'));
select pg_temp.note('aucune prestation du catalogue n''a un prix hors taxes déjà TTC', '0',
  (select count(*)::text from catalogue_offres
    where prix_ht is not null and round(prix_ht * 1.20, 2) not in (120.00, 150.00, 160.00, 180.00, 39.90)));
select pg_temp.note('le match photo reste à 120 € TTC', '120.00',
  (select round(prix_ht * 1.20, 2)::text from catalogue_offres where nom = 'Match Photo'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
