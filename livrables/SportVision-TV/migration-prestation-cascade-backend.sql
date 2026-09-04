-- Finding réel trouvé en testant le parcours final (audit transversal, 04/09/2026), corrigé sur
-- décision explicite de Fouka : la cascade "un opérateur accepte → la mission avance planifiée→
-- équipe_affectée" (et son symétrique "un opérateur refuse → la mission repart en planifiée si
-- personne d'autre n'a accepté") ne vivait QUE côté JS (repondreInvitation(), SportVision-OS-
-- Full.html) — un appel API/mobile/intégration qui PATCH directement prestations_equipe.statut
-- sans passer par cette fonction précise laissait la mission bloquée dans un état incohérent
-- (opérateur accepté mais mission toujours "à attribuer"). Portée fidèlement en trigger pour que
-- l'intégrité de ce workflow ne dépende plus d'un seul point d'entrée frontend.
--
-- Comportement identique à repondreInvitation() (lignes 13213-13259 de l'OS), jamais réinventé :
-- - acceptée : avance planifiée→équipe_affectée UNIQUEMENT si c'est l'état exact actuel (sinon
--   ignore silencieusement — ex. déjà avancée manuellement, ou un autre opérateur avait déjà fait
--   avancer la mission).
-- - refusée : repart équipe_affectée→planifiée UNIQUEMENT si aucun AUTRE opérateur n'est resté
--   "acceptée" sur cette même mission (un refus parmi plusieurs opérateurs ne doit pas défaire ce
--   que les autres ont déjà confirmé) — même condition que le trigger existant migration-
--   prestations-refus-reattribution.sql, qui n'ajoutait que la transition autorisée sans jamais la
--   déclencher lui-même.
-- Le trigger validate_prestation_statut_transition (déjà existant) continue de valider que ces 2
-- transitions précises sont légales — ce nouveau trigger ne fait que décider QUAND les déclencher,
-- exactement comme le faisait jusqu'ici repondreInvitation().

create or replace function cascade_prestations_equipe_reponse()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pres_statut text;
  v_autres_acceptes boolean;
begin
  if new.statut is distinct from old.statut then
    if new.statut = 'acceptée' then
      select statut into v_pres_statut from prestations where id = new.prestation_id;
      if v_pres_statut = 'planifiée' then
        update prestations set statut = 'équipe_affectée' where id = new.prestation_id;
      end if;
    elsif new.statut = 'refusée' then
      select statut into v_pres_statut from prestations where id = new.prestation_id;
      if v_pres_statut = 'équipe_affectée' then
        select exists(
          select 1 from prestations_equipe
          where prestation_id = new.prestation_id and statut = 'acceptée' and id <> new.id
        ) into v_autres_acceptes;
        if not v_autres_acceptes then
          update prestations set statut = 'planifiée' where id = new.prestation_id;
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_cascade_prestations_equipe_reponse on prestations_equipe;
create trigger trg_cascade_prestations_equipe_reponse after update on prestations_equipe
  for each row execute function cascade_prestations_equipe_reponse();
