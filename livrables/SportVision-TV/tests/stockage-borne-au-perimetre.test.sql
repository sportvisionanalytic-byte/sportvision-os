-- Le stockage se borne comme les tables (v190, 12/09/2026).
--
-- Le cloisonnement média s'arrêtait à la table : en lecture tout était correct, mais les policies
-- d'ÉCRITURE du stockage ne demandaient que « être admin, sec, prod ou photo », sans jamais
-- regarder de quel album il s'agissait. Un opérateur terrain pouvait donc effacer les originaux
-- vendus de tous les clubs, ou remplacer l'aperçu public d'une galerie en vente.
--
-- Le CV d'un candidat, lui, ne demandait aucun rôle du tout : le fichier était lisible dès lors
-- qu'une candidature le référençait, ce qui annulait le cloisonnement du recrutement (v130).
--
-- Ce test lit les policies de production. Aucune donnée n'est écrite.

begin;
create temp table verdicts (n serial, controle text, attendu text, obtenu text) on commit drop;
create or replace function pg_temp.note(p_c text, p_a text, p_o text) returns void language sql as $$
  insert into verdicts (controle, attendu, obtenu) values (p_c, p_a, p_o); $$;

create or replace function pg_temp.borne(p_policy text) returns text language sql stable as $$
  select case
           when coalesce(qual, with_check) is null then 'policy absente'
           when coalesce(qual, with_check) like '%photographe_voit_album%' then 'bornee'
           else 'ouverte a tout le staff'
         end
    from pg_policies where schemaname = 'storage' and policyname = p_policy;
$$;

select pg_temp.note('effacer un original est borne au perimetre', 'bornee',
  coalesce(pg_temp.borne('sv_media_prive_media_delete'), 'policy absente'));
select pg_temp.note('deposer un original est borne au perimetre', 'bornee',
  coalesce(pg_temp.borne('sv_media_prive_media_write'), 'policy absente'));
select pg_temp.note('effacer un apercu public est borne au perimetre', 'bornee',
  coalesce(pg_temp.borne('galerie_previews_staff_delete'), 'policy absente'));
select pg_temp.note('remplacer un apercu public est borne au perimetre', 'bornee',
  coalesce(pg_temp.borne('galerie_previews_staff_update'), 'policy absente'));
select pg_temp.note('deposer un apercu public est borne au perimetre', 'bornee',
  coalesce(pg_temp.borne('galerie_previews_staff_insert'), 'policy absente'));

select pg_temp.note('lire un CV demande la meme autorisation que la candidature', 'oui',
  (select case when qual like '%peut_voir_candidature%' then 'oui' else 'NON' end
     from pg_policies where schemaname='storage' and policyname='sv_media_prive_recrutement_select'));

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts order by n;
rollback;
