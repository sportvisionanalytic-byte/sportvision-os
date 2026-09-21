-- v240 — L'opérateur dépose ce qu'il a produit. Plus aucun livrable imposé.
--
-- DEMANDE DE FOUKA, 21/09/2026 : « quand le photographe-vidéaste termine sa prestation, c'est LUI
-- qui met le nombre de liens à mettre, il ne faut pas lui imposer un nombre de liens. Il met le
-- lien, il envoie à faire vérifier, et ensuite le responsable production vérifie uniquement à
-- partir des liens. Il n'y a pas de lien obligatoire pour valider la prestation. »
--
-- CE QUI EXISTAIT. La clôture déduisait de la couverture (photo / vidéo / photo+vidéo) une liste
-- de livrables OBLIGATOIRES : « Photos traitées », « Montage final », « Rushs vidéo ». Chacun
-- manquant bloquait, et il fallait passer par une déclaration « sans objet » motivée pour s'en
-- défaire. Un opérateur qui avait fait son travail mais autrement — deux liens photo et pas de
-- rushs, un montage livré sans fichier séparé, un drone en plus — se retrouvait bloqué par une
-- liste décidée à sa place.
--
-- CE QUI REMPLACE. On ne demande plus CE QUI a été livré, on vérifie que ce qui a été livré a été
-- RELU :
--   · au moins un lien déposé — sans quoi il n'y a rien à valider ;
--   · aucun lien en correction demandée — un refus se lève avant de clore ;
--   · aucun lien encore « à vérifier » — la Production regarde CHAQUE lien, quel qu'il soit.
-- C'est même plus exigeant qu'avant sur la relecture, et bien moins sur la forme.
--
-- CE QUI RESTE, et n'a rien à voir avec les livrables : la règle des cartes. L'opérateur doit
-- avoir déclaré ses fichiers sécurisés et confirmé un transfert. C'est la règle qui interdit de
-- formater une carte avant d'avoir une seconde copie, et elle protège le travail lui-même.
--
-- `livrables_non_fournis` n'est plus lu ici : il n'y a plus de livrable attendu dont il faudrait
-- se déclarer dispensé. La colonne reste, l'historique avec.
--
-- Idempotent.

create or replace function mission_cloture_manquant(p_prestation_id uuid)
returns text[] language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_statut text;
  v_manque text[] := '{}';
begin
  select statut::text into v_statut from prestations where id = p_prestation_id;

  -- Terrain : l'horodatage personnel de l'opérateur, OU le statut de la mission (v208).
  if not exists (select 1 from mission_suivi_operateur
                  where prestation_id = p_prestation_id and prestation_terminee_at is not null)
     and v_statut not in ('production_terminée','médias_à_transférer','médias_complets','à_monter',
                          'montage_en_cours','prêt_validation','à_valider_client','prête_à_livrer',
                          'livrée','facturée','partiellement_payée','payée','clôturée') then
    v_manque := v_manque || 'Prestation non déclarée réalisée'::text;
  end if;

  -- La règle des cartes : une carte ne se formate pas avant d'avoir une seconde copie.
  if not exists (select 1 from mission_suivi_operateur
                  where prestation_id = p_prestation_id and fichiers_securises_at is not null) then
    v_manque := v_manque || 'Fichiers non sécurisés'::text;
  end if;

  if not exists (select 1 from media_liens
                  where prestation_id = p_prestation_id and transfert_confirme is true) then
    v_manque := v_manque || 'Sauvegarde non confirmée par l''opérateur (il doit cocher « fichiers copiés et vérifiés »)'::text;
  end if;

  -- v240 : ce que l'opérateur a livré, quoi qu'il ait livré.
  if not exists (select 1 from media_liens where prestation_id = p_prestation_id) then
    v_manque := v_manque || 'Aucun lien déposé par l''opérateur'::text;
  end if;

  if exists (select 1 from media_liens where prestation_id = p_prestation_id
              and statut = 'correction_demandee') then
    v_manque := v_manque || 'Un lien attend une correction demandée par la Production'::text;
  end if;

  if exists (select 1 from media_liens where prestation_id = p_prestation_id
              and coalesce(statut,'a_verifier') = 'a_verifier') then
    v_manque := v_manque || 'Un lien n''a pas encore été vérifié par la Production'::text;
  end if;

  -- v232 : un travail refusé par la Production empêche de clore la mission.
  v_manque := v_manque || mission_travail_refuse_manquant(p_prestation_id);

  return v_manque;
end $$;

comment on function mission_cloture_manquant is
  'Ce qui manque pour clôturer une mission (v240). Plus aucun livrable imposé par la couverture : l''opérateur dépose ce qu''il a produit, autant de liens qu''il veut, et la Production relit CHAQUE lien. Restent la déclaration de terrain et la règle des cartes.';
