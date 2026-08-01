-- Migration : XP de mission fiable et backfill historique
--
-- Contexte : jusqu'ici, l'XP de mission (100 XP + 50 si responsable) n'était
-- jamais écrite dans xp_events / profiles.xp. Elle était recalculée à la
-- volée côté client à chaque écran, sans filtre de statut cohérent (certains
-- écrans comptaient même les invitations refusées ou annulées). Résultat :
-- un collaborateur voyait un total différent selon l'écran consulté (son
-- propre tableau de bord vs sa fiche vue par un admin/responsable production,
-- qui ne lit que xp_events et ignorait donc totalement les missions).
--
-- SportVision-OS-Full.html crédite désormais l'XP de mission dans xp_events
-- et profiles.xp via syncMissionXp(), appelée à chaque affichage des
-- tableaux de bord et fiches collaborateur (mécanisme de synchronisation
-- paresseuse, idempotent). Cette migration :
--   1. dédoublonne les xp_events existants par (source_type, source_id, type)
--      par sécurité avant de poser une contrainte d'unicité ;
--   2. pose cette contrainte d'unicité pour empêcher tout double crédit
--      futur (au niveau base, en complément de la vérification applicative) ;
--   3. effectue le backfill historique : crédite immédiatement l'XP de
--      toutes les missions déjà acceptées et déjà livrées/facturées/payées,
--      sans attendre que chaque collaborateur ouvre son tableau de bord.
--
-- Critère d'une mission "réalisée" : prestations_equipe.statut = 'acceptée'
-- ET prestations.statut parmi ('livrée','facturée','partiellement_payée',
-- 'payée','clôturée').
--
-- Idempotente : peut être ré-exécutée sans effet supplémentaire une fois
-- le backfill effectué (la contrainte unique et les vérifications
-- "where not exists" empêchent tout doublon).
-- À exécuter dans Supabase → SQL Editor.

-- 1. Dédoublonnage défensif de xp_events avant la contrainte d'unicité
delete from xp_events a
using xp_events b
where a.id > b.id
  and a.source_type is not null and a.source_id is not null
  and a.source_type = b.source_type
  and a.source_id = b.source_id
  and a.type = b.type;

-- 2. Contrainte d'unicité : une seule ligne xp_events par (source, type)
create unique index if not exists idx_xp_events_source_type_unique
  on xp_events(source_type, source_id, type)
  where source_type is not null and source_id is not null;

-- 3. Backfill de l'XP de mission historique
-- Le CTE "inserted" capture précisément les lignes créées par CETTE exécution
-- (via RETURNING), et profiles.xp n'est incrémenté que de ce montant exact.
-- Une deuxième exécution n'insère plus rien (contrainte unique + not exists)
-- donc ne touche plus profiles.xp non plus : la migration est réellement
-- rejouable sans risque de double crédit.
do $$
declare
  done_statuts text[] := array['livrée','facturée','partiellement_payée','payée','clôturée'];
begin

  with inserted as (
    insert into xp_events (collaborateur_id, montant, type, source_id, source_type, description, attribue_par)
    select
      pe.collaborateur_id,
      100 + case when pe.est_responsable then 50 else 0 end,
      'prestation',
      pe.id,
      'prestations_equipe',
      'Mission réalisée',
      pe.collaborateur_id
    from prestations_equipe pe
    join prestations p on p.id = pe.prestation_id
    where pe.statut = 'acceptée'
      and p.statut::text = any(done_statuts)
      and not exists (
        select 1 from xp_events xe
        where xe.source_type = 'prestations_equipe' and xe.source_id = pe.id and xe.type = 'prestation'
      )
    on conflict do nothing
    returning collaborateur_id, montant
  )
  update profiles pr
  set xp = pr.xp + sub.total
  from (
    select collaborateur_id, sum(montant) as total
    from inserted
    group by collaborateur_id
  ) sub
  where pr.id = sub.collaborateur_id;

end $$;
