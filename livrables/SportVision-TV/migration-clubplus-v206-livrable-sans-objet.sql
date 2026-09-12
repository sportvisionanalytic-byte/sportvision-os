-- v206 — L'opérateur peut livrer ce qu'il a, et la Production l'apprend (13/09/2026).
--
-- CE QUI N'ALLAIT PAS. L'écran Sauvegarde & livraison déduit les livrables attendus de la
-- couverture de la mission : `photo_video` en exige trois — photos traitées, montage final, rushs
-- vidéo. Le bouton « Envoyer à Production » n'apparaît que si les TROIS sont fournis.
--
-- Cas réel du 12/09 : la mission SV-2026-0268 est enregistrée en `photo_video`, Michael n'a fait
-- que la photo. Il ne pouvait donc rien valider, et aucun écran ne lui offrait de dire « il n'y a
-- pas de vidéo sur cette mission ». Sa seule sortie était d'attendre que quelqu'un corrige la
-- couverture en base.
--
-- Second défaut, du même coup : même en livrant tout, PERSONNE n'était prévenu côté SportVision.
-- Le seul déclencheur de notification sur `prestations` prévient le CLIENT. Le responsable
-- production découvrait la livraison en allant regarder.
--
-- CE QUE FAIT CETTE MIGRATION.
--   1. `livrables_non_fournis` : ce que l'opérateur déclare sans objet, avec un motif et un
--      horodatage. Ce n'est pas un oubli silencieux, c'est une déclaration tracée et relisible.
--   2. Au passage en `prêt_validation`, la Production est prévenue, avec ce qui a été livré et ce
--      qui a été déclaré sans objet. `destinataires_production` fait foi : le responsable nommé
--      sur la mission, sinon le pôle production.
-- Idempotente.

alter table mission_suivi_operateur
  add column if not exists livrables_non_fournis jsonb not null default '{}'::jsonb;

comment on column mission_suivi_operateur.livrables_non_fournis is
  'Livrables attendus par la couverture que l''opérateur déclare sans objet : {"montage":{"motif":"…","at":"…"}}. Une déclaration, pas un oubli.';

create or replace function public.notifier_production_livraison_operateur()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  d uuid;
  v_client text;
  v_liens text;
  v_sans_objet text;
begin
  if new.statut is not distinct from old.statut or new.statut <> 'prêt_validation' then
    return new;
  end if;

  select c.nom into v_client from clients c where c.id = new.client_id;

  select string_agg(distinct coalesce(nullif(btrim(ml.nom), ''), ml.categorie), ', ')
    into v_liens
    from media_liens ml
   where ml.prestation_id = new.id
     and coalesce(ml.categorie, '') not in ('rushs', 'travail', 'depot');

  select string_agg(cle || ' (' || coalesce(valeur ->> 'motif', 'sans motif') || ')', ', ')
    into v_sans_objet
    from mission_suivi_operateur m,
         lateral jsonb_each(coalesce(m.livrables_non_fournis, '{}'::jsonb)) as t(cle, valeur)
   where m.prestation_id = new.id;

  for d in select * from destinataires_production(new.id) loop
    perform notifier(
      d, 'taches', 'livraison_recue',
      'Livraison à vérifier — ' || coalesce(new.reference, 'mission'),
      coalesce(v_client, 'Un client') || ' : l''opérateur a terminé sa livraison.'
        || coalesce(' Fourni : ' || v_liens || '.', ' Aucun lien déposé.')
        || coalesce(' Déclaré sans objet : ' || v_sans_objet || '.', ''),
      new.id, 'haute',
      'livraison_operateur:' || new.id
    );
  end loop;

  return new;
end $$;

drop trigger if exists trg_notifier_production_livraison on prestations;
create trigger trg_notifier_production_livraison
  after update of statut on prestations
  for each row execute function notifier_production_livraison_operateur();
