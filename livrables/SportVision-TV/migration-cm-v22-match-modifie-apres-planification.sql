-- ═══════════════════════════════════════════════════════════════════════════════
-- VAGUE C — Un événement déplacé après planification doit se voir côté Production
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- C'est le point le plus dangereux du lot : une presence prevue a 16h pour un match passe a 18h
-- envoie un photographe pour rien. Le controle est donc en BASE, pas dans un gestionnaire
-- d'interface : un match se modifie depuis Club+, depuis l'OS, par un import de calendrier, et
-- demain par une automatisation. Tous ces chemins passent par cet UPDATE, aucun ne peut l'oublier.
--
-- Ce qui est surveille : la date, l'heure, le lieu, l'adversaire, et l'annulation.
--
-- L'ancienne information n'est pas ecrasee : le detail dit ce qui a change, en clair, pour que la
-- Production comprenne sans avoir a enqueter.
--
-- Une seule notification par enregistrement, meme si trois champs changent en meme temps.

begin;

create or replace function public.signaler_evenement_modifie()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_changements text[] := '{}';
  v_detail text;
  v_presence record;
  v_club text;
  v_destinataire uuid;
begin
  select pp.* into v_presence from planned_presences pp
  where pp.match_id = new.id and pp.statut <> 'annule' limit 1;
  if v_presence.id is null then
    return new;  -- personne n'a prevu de couverture : rien a signaler
  end if;

  if new.match_date is distinct from old.match_date then
    v_changements := v_changements || ('date : ' || to_char(old.match_date,'DD/MM/YYYY') ||
                                       ' → ' || to_char(new.match_date,'DD/MM/YYYY'))::text;
  end if;
  if new.kickoff_time is distinct from old.kickoff_time then
    v_changements := v_changements || ('horaire : ' || coalesce(to_char(old.kickoff_time,'HH24:MI'),'non précisé') ||
                                       ' → ' || coalesce(to_char(new.kickoff_time,'HH24:MI'),'non précisé'))::text;
  end if;
  if coalesce(new.lieu,'') is distinct from coalesce(old.lieu,'') then
    v_changements := v_changements || ('lieu : ' || coalesce(nullif(old.lieu,''),'non précisé') ||
                                       ' → ' || coalesce(nullif(new.lieu,''),'non précisé'))::text;
  end if;
  if coalesce(new.opponent,'') is distinct from coalesce(old.opponent,'') then
    v_changements := v_changements || ('adversaire : ' || coalesce(nullif(old.opponent,''),'?') ||
                                       ' → ' || coalesce(nullif(new.opponent,''),'?'))::text;
  end if;
  if coalesce(new.sport_status,'') is distinct from coalesce(old.sport_status,'')
     and new.sport_status in ('cancelled','postponed') then
    v_changements := v_changements ||
      (case new.sport_status when 'cancelled' then 'match ANNULÉ' else 'match REPORTÉ' end)::text;
  end if;

  if array_length(v_changements,1) is null then
    return new;
  end if;

  v_detail := array_to_string(v_changements, ' · ');

  -- La couverture n'est jamais supprimee d'office, meme sur une annulation : c'est la Production
  -- qui decide de la suite, et l'historique de ce qui etait prevu a de la valeur.
  update planned_presences
  set evenement_modifie_at = now(),
      evenement_modifie_detail = v_detail,
      updated_at = now()
  where id = v_presence.id;

  select c.nom into v_club from clubs c where c.id = new.club_id;

  -- Le moteur de notifications existe deja : on s'y branche, on n'en construit pas un second.
  for v_destinataire in select p.id from profiles p where p.role in ('prod','admin') loop
    insert into notifications (destinataire_id, type, titre, message, priorite, source_type, source_id)
    values (
      v_destinataire,
      'presence_evenement_modifie',
      'Événement modifié après planification',
      coalesce(v_club,'Club') || ' — ' || coalesce(new.team,'équipe') || ' contre ' ||
        coalesce(new.opponent,'?') || ' : ' || v_detail,
      'haute',
      'planned_presence',
      v_presence.id
    );
  end loop;

  return new;
end $function$;

drop trigger if exists trg_signaler_evenement_modifie on club_matches;
create trigger trg_signaler_evenement_modifie
  after update on club_matches
  for each row execute function public.signaler_evenement_modifie();

commit;

select 'OK — la Production est prevenue quand un match couvert bouge' as verdict;
