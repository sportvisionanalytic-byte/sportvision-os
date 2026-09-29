-- LES FONCTIONS DE LA RECONNAISSANCE N'EXISTENT QU'EN UN SEUL EXEMPLAIRE (v350, 29/09/2026).
--
-- POURQUOI CE TEST EXISTE. La même faute a été payée trois fois :
--   26/09 — `create or replace` avec un argument par défaut SURCHARGE au lieu de remplacer.
--   v341  — une signature à trois arguments oubliée, PostgREST répondait 300.
--   v345  — `reconnaissance_mettre_en_file(uuid, smallint default 1)` créée à côté de
--           `(uuid)`. PostgreSQL choisit la correspondance EXACTE, donc les deux déclencheurs qui
--           comptent (achat du Pass, dépôt d'une photo de référence) appelaient l'ANCIENNE : les
--           familles entraient en priorité 5, derrière des heures de rattrapage, alors que toute la
--           migration v345 s'appelait « une famille qui attend passe devant ». Découvert le 29/09,
--           quatre jours plus tard, et seulement parce que je regardais ailleurs.
--
-- Une surcharge ne casse rien bruyamment. Elle détourne un appel vers du vieux code, en silence.
-- C'est pour ça qu'elle survit des jours. Ce test la rend impossible à ne pas voir.
--
-- Il tient pour vrai deux choses sur tout le domaine de la reconnaissance :
--   1. aucun nom de fonction n'a deux signatures ;
--   2. aucune de ces fonctions n'est appelable sans compte — elles sont toutes SECURITY DEFINER et
--      travaillent sur des données biométriques (article 9 du RGPD).
-- Ne touche à rien : lecture seule du catalogue.

begin;

create temporary table verdicts (n serial, controle text, attendu text, obtenu text);

insert into verdicts (controle, attendu, obtenu)
select 'aucune fonction de reconnaissance n''a deux signatures', 'aucune',
       coalesce(string_agg(nom || ' (' || n::text || ' signatures)', ', ' order by nom), 'aucune')
  from (select p.proname as nom, count(*) as n
          from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public'
           and (p.proname like 'reconnaissance%' or p.proname like 'visage%' or p.proname like 'media_numero%')
         group by p.proname
        having count(*) > 1) d;

insert into verdicts (controle, attendu, obtenu)
select 'aucune n''est appelable par un visiteur anonyme', 'aucune',
       coalesce(string_agg(p.proname, ', ' order by p.proname), 'aucune')
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public'
   and (p.proname like 'reconnaissance%' or p.proname like 'visage%'
        or p.proname like 'media_numero%' or p.proname like '%biometrie%')
   and has_function_privilege('anon', p.oid, 'execute');

-- Et la faille elle-meme, par son nom : `reconnaissance_preparer_galerie` repondait 200 a un
-- visiteur sans compte et inscrivait du travail dans la file du moteur (v351). Un Mac, quarante
-- minutes par galerie, et personne n'avait besoin d'un compte pour l'occuper.
insert into verdicts (controle, attendu, obtenu)
select 'preparer une galerie reste ferme a l''anonyme', 'ferme',
       case when has_function_privilege('anon',
              'public.reconnaissance_preparer_galerie(uuid)'::regprocedure, 'execute')
            then 'OUVERT' else 'ferme' end;

-- Et la conséquence concrète, celle qui se voyait dans la file : la mise en file passe en
-- priorité 1. Si quelqu'un recrée un jour la signature à un argument, cette valeur retombe à 5.
insert into verdicts (controle, attendu, obtenu)
select 'la mise en file par défaut est prioritaire (une famille attend)', '1',
       coalesce((select pg_get_expr(p.proargdefaults, 0)
                   from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = 'reconnaissance_mettre_en_file'), 'absente');

-- Le moteur, lui, doit pouvoir travailler : un test qui ne vérifie que les interdits laisse passer
-- une correction qui ferme tout (leçon du 11/09, « écran toujours vide = droits trop fermés »).
insert into verdicts (controle, attendu, obtenu)
select 'le moteur peut appeler la mise en file', 'oui',
       case when has_function_privilege('service_role',
              'public.reconnaissance_mettre_en_file(uuid, smallint)'::regprocedure, 'execute')
            then 'oui' else 'NON' end;

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu
  from verdicts order by n;
rollback;
