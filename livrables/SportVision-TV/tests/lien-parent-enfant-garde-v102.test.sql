-- LA GARDE DU LIEN PARENT-ENFANT EST TOUJOURS EN BASE (v102, verifiee le 30/09/2026).
--
-- LA FAILLE QU'ELLE FERME, ET C'EST UN P0. Avant la v102 (10/09/2026), un inconnu devenait parent
-- CONFIRME d'un mineur en fournissant le code d'equipe, le prenom, le nom et la date de naissance de
-- l'enfant. Ces trois informations circulent : une feuille de match affichee au club, une photo
-- d'equipe legendee, une conversation de bord de terrain. Etre parent confirme donne acces aux
-- photos de l'enfant, a son calendrier et a ses donnees.
--
-- La v102 a ajoute `v_enfant_preexistant` : si la fiche de l'enfant existait AVANT l'appel, le lien
-- part en `en_attente_confirmation`. Autrement dit, on ne devient pas parent d'un enfant que le club
-- connait deja sans que quelqu'un le confirme.
--
-- POURQUOI CE TEST EXISTE, ALORS QUE LA GARDE EST EN PLACE. Le fichier
-- `migration-smartlink-particulier-convergence.sql` (04/09) contient encore un
-- `create or replace function connect_join_club_via_smart_link` SANS cette garde. Il est inoffensif
-- tant qu'il dort, parce que la v102 lui est posterieure. Mais le rejouer — par distraction, ou
-- « pour remettre la base d'aplomb apres un incident » — ecraserait la version durcie par la version
-- vulnerable, SANS AUCUN MESSAGE D'ERREUR. Un `create or replace` ne previent jamais qu'il vient de
-- defaire une correction de securite.
--
-- Ce test est donc le garde-fou de ce rejeu. Il regarde le corps de la fonction en base, pas un
-- fichier : c'est ce qui tourne qui compte.
--
-- On ne rejoue pas le parcours complet ici (il est couvert ailleurs) : on tient pour vrai que la
-- garde EST dans le code deploye. Un test bon marche qu'on peut lancer a chaque fois.

begin;

create temporary table verdicts (n serial, controle text, attendu text, obtenu text);

insert into verdicts (controle, attendu, obtenu)
select 'la fonction du Smart Link existe', '1',
       count(*)::text from pg_proc
 where proname = 'connect_join_club_via_smart_link' and pronamespace = 'public'::regnamespace;

insert into verdicts (controle, attendu, obtenu)
select 'elle porte la garde v102 (v_enfant_preexistant)', 'presente',
       coalesce((select case when prosrc like '%v_enfant_preexistant%' then 'presente' else 'ABSENTE' end
                   from pg_proc
                  where proname = 'connect_join_club_via_smart_link'
                    and pronamespace = 'public'::regnamespace), 'fonction absente');

insert into verdicts (controle, attendu, obtenu)
select 'un enfant deja connu du club part en attente de confirmation', 'oui',
       coalesce((select case when prosrc like '%en_attente_confirmation%' then 'oui' else 'NON' end
                   from pg_proc
                  where proname = 'connect_join_club_via_smart_link'
                    and pronamespace = 'public'::regnamespace), 'fonction absente');

-- ET LE STATUT DOIT EXISTER DANS LA TABLE, sinon la garde ecrirait une valeur refusee et l'appel
-- echouerait au lieu de proteger. C'est la lecon du 29/09 : un filtre ou une ecriture sur une valeur
-- qui n'existe pas ne protege rien tout en donnant l'impression du contraire.
insert into verdicts (controle, attendu, obtenu)
select 'le statut « en_attente_confirmation » est accepte par la table', 'oui',
       case when exists (
         select 1 from pg_constraint
          where conrelid = 'public.parent_player_relationships'::regclass
            and contype = 'c'
            and pg_get_constraintdef(oid) like '%en_attente_confirmation%')
         or exists (
         select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
          where e.enumlabel = 'en_attente_confirmation')
       then 'oui' else 'NON' end;

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu
  from verdicts order by n;
rollback;
