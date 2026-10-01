-- v410 — UNE MISSION À DEUX OPÉRATEURS NE SE CLÔTURAIT JAMAIS (01/10/2026)
--
-- == LE SYMPTÔME ===============================================================================
--
-- SV-2026-0274 est au statut `livrée` depuis le 25 septembre. `mission_cloture_manquant` ne lui
-- reproche RIEN : le tableau revient vide. Et pourtant elle ne se clôture pas, ni par le bouton
-- « → » de l'OS, ni par `validate_production()`. Mesuré en transaction annulée, jeton de Mikael :
--
--   ERROR 23505 : duplicate key value violates unique constraint "idx_xp_events_source_type_unique"
--   DETAIL : Key (source_type, source_id, type)=(prestation, f799e384-…, prestation) already exists
--   CONTEXT : fonction attribuer_xp_mission_validee() ligne 25
--
-- == LA CAUSE : UNE IDEMPOTENCE QUI NE REGARDE PAS LA BONNE CLÉ =================================
--
-- `attribuer_xp_mission_validee()` boucle sur les opérateurs `acceptée` de la mission et, pour
-- chacun, teste s'il a DÉJÀ sa ligne d'XP :
--
--     where x.collaborateur_id = v_op.collaborateur_id and x.source_id = new.id and …
--
-- Mais l'index unique qui garde la table NE CONTIENT PAS `collaborateur_id` :
--
--     idx_xp_events_source_type_unique on (source_type, source_id, type)
--
-- Donc à la DEUXIÈME itération, le test « cette personne-là a-t-elle sa ligne ? » répond non — la
-- ligne existante appartient à l'autre opérateur — et l'insertion viole l'index. Le trigger lève,
-- l'UPDATE est annulé, la mission reste ouverte. Aucune donnée n'est corrompue : rien ne passe.
--
-- CONSÉQUENCE EXACTE, MESURÉE : toute mission ayant DEUX opérateurs `acceptée` ou plus est
-- définitivement inclôturable, par n'importe quelle interface. Aujourd'hui SV-2026-0274 (Antoine
-- Blin + Mikael Athanase Ruffine) et SV-2026-3843 (Antoine Blin + Quentin Caffiaux). Les trois
-- missions qui se sont clôturées jusqu'ici (SV-2026-0268, SV-2026-0725, SV-2026-3122) avaient
-- toutes exactement UN opérateur : le défaut n'avait donc jamais eu l'occasion de se voir.
--
-- Et la clôture n'est pas cosmétique : `validate_production()` fait passer
-- `prestations_equipe.statut_paiement` de `en_attente` à `validé`. Tant qu'elle échoue, le payable
-- du freelance ne bouge pas.
--
-- == LE CORRECTIF : LA MÊME GARDE QUE `mission_valider_travail` =================================
--
-- La fonction sœur, écrite le 25/09, a déjà appris la leçon et le dit dans son propre commentaire :
-- « c'est LUI (l'index) qui garantit qu'on ne crédite qu'une fois, pas un test préalable qui
-- pourrait courir avec un autre appel ». On reprend exactement son geste, prédicat partiel
-- compris — sans lui, PostgreSQL ne reconnaît pas l'index partiel et refuse l'ON CONFLICT.
--
-- ON GARDE LA BOUCLE, et elle devient ORDONNÉE : le responsable d'abord, puis la plus ancienne
-- affectation. L'index n'autorisant qu'une ligne par mission, le bonus de clôture va donc au
-- responsable de la mission — un choix nommé, et non plus le hasard de l'ordre de lecture. Le jour
-- où l'index gagnerait `collaborateur_id`, cette fonction créditerait tout le monde sans retouche.
--
-- CE QUE CETTE MIGRATION NE DÉCIDE PAS, ET QUI APPARTIENT À FOUKA : le barème. Un opérateur touche
-- déjà 100 XP (150 s'il est responsable) par `mission_valider_travail`, source_type
-- `prestations_equipe`. Les 50 XP de clôture, source_type `prestation`, sont donc un SECOND
-- versement, et l'index les borne à un par mission. Si l'intention est « 50 XP à chaque opérateur
-- de la mission », il faut ajouter `collaborateur_id` à l'index unique — ce qui touche aussi les
-- 83 lignes d'XP de formation et l'ON CONFLICT de `mission_valider_travail`. Cette migration ne
-- fait que rendre la clôture possible.

create or replace function public.attribuer_xp_mission_validee()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_xp constant integer := 50;   -- barème de départ, à changer ici
  v_op record;
begin
  if new.statut <> 'clôturée' or old.statut = 'clôturée' then
    return new;
  end if;

  for v_op in
    select pe.collaborateur_id
      from prestations_equipe pe
     where pe.prestation_id = new.id
       and pe.statut = 'acceptée'
       and pe.collaborateur_id is not null
     group by pe.collaborateur_id
     -- Le responsable d'abord, puis la plus ancienne affectation : l'index n'autorise qu'une ligne
     -- par mission, autant que ce soit toujours la même personne et qu'on sache laquelle.
     order by bool_or(coalesce(pe.est_responsable, false)) desc, min(pe.created_at)
  loop
    -- L'INDEX FAIT FOI, PAS UN TEST PRÉALABLE. `idx_xp_events_source_type_unique` est PARTIEL :
    -- son prédicat doit être répété, sinon PostgreSQL répond « there is no unique or exclusion
    -- constraint matching the ON CONFLICT specification ».
    insert into xp_events (collaborateur_id, montant, type, source_id, source_type, description)
    values (v_op.collaborateur_id, v_xp, 'prestation', new.id, 'prestation',
            'Mission validée par la Production — ' || coalesce(new.reference, 'prestation'))
    on conflict (source_type, source_id, type)
      where source_type is not null and source_id is not null
      do nothing;
  end loop;

  return new;
end $function$;
