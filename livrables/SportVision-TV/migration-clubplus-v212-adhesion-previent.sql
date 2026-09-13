-- v212 — Une demande d'adhésion prévient le club, et sa validation prévient la famille
-- (13/09/2026).
--
-- CE QUI N'ALLAIT PAS. Deux silences dans le parcours d'inscription, vérifiés en base : aucun
-- déclencheur sur `membership_requests`, et `validate_team_membership` n'écrit aucune notification.
--
--   • Un joueur ou un parent envoie sa demande. Personne au club ne l'apprend. Elle attend que
--     quelqu'un pense à ouvrir l'écran des affiliations.
--   • Le club valide. L'écran de Connect promet pourtant « vous serez prévenu ». Personne ne l'est.
--
-- C'est le parcours par lequel arriveront tous les joueurs des clubs : ces deux silences se
-- paient en appels téléphoniques.
--
-- CE QUE FAIT CETTE MIGRATION. Deux déclencheurs, sur le modèle de ceux déjà posés. À l'arrivée
-- d'une demande, ceux qui peuvent la traiter sont prévenus : l'administration du club, et
-- l'éducateur de l'équipe visée. À la validation ou au refus, celui qui a demandé est prévenu.
-- Idempotente.

create or replace function public.notifier_demande_adhesion()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_joueur text;
  v_equipe text;
begin
  select coalesce(nullif(btrim(p.prenom || ' ' || p.nom), ''), 'Un joueur') into v_joueur
    from player_profiles p where p.id = new.player_id;
  select t.name into v_equipe from club_teams t where t.id = new.team_id;

  insert into member_notifications (user_id, category, title, body, target_href)
  select distinct cm.user_id, 'users',
         'Nouvelle demande d''adhésion',
         coalesce(v_joueur, 'Un joueur') || ' demande à rejoindre '
           || coalesce('l''équipe ' || v_equipe, 'le club') || '.',
         '/team-requests'
    from club_members cm
   where cm.club_id = new.club_id
     and cm.status = 'actif'
     and cm.user_id is not null
     and (
       cm.role in ('admin', 'president')
       -- L'éducateur de l'équipe visée : c'est lui qui valide au quotidien.
       or (new.team_id is not null and is_team_educateur_for(cm.user_id, new.team_id))
     );

  return new;
end $$;

-- Petit utilitaire : `is_team_educateur` raisonne sur l'appelant, or ici on parcourt les membres.
create or replace function public.is_team_educateur_for(p_user_id uuid, p_team_id uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
      from club_members cm
      join club_teams t on t.id = p_team_id
     where cm.user_id = p_user_id
       and cm.club_id = t.club_id
       and cm.status = 'actif'
       and cm.role in ('coach', 'resp_equipe', 'directeur_sportif')
       and (
         cm.teams is null
         or jsonb_array_length(coalesce(cm.teams, '[]'::jsonb)) = 0
         or exists (select 1 from jsonb_array_elements_text(coalesce(cm.teams, '[]'::jsonb)) e
                     where lower(btrim(e)) = lower(btrim(t.name)))
       )
  );
$$;

drop trigger if exists trg_notifier_demande_adhesion on membership_requests;
create trigger trg_notifier_demande_adhesion
  after insert on membership_requests
  for each row execute function notifier_demande_adhesion();

-- ─── La réponse revient à celui qui a demandé ────────────────────────────────
create or replace function public.notifier_reponse_adhesion()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_club text;
  v_equipe text;
begin
  if new.statut = old.statut or new.statut not in ('validee', 'refusee') then
    return new;
  end if;
  if new.requested_by_user_id is null then
    return new;
  end if;

  select c.nom into v_club from clubs c where c.id = new.club_id;
  select t.name into v_equipe from club_teams t where t.id = new.team_id;

  insert into member_notifications (user_id, category, title, body, target_href)
  values (
    new.requested_by_user_id,
    'users',
    case when new.statut = 'validee' then 'Adhésion acceptée' else 'Adhésion refusée' end,
    case when new.statut = 'validee'
         then coalesce(v_club, 'Votre club') || ' a accepté votre adhésion'
              || coalesce(' à l''équipe ' || v_equipe, '') || '. Vos contenus arrivent.'
         else coalesce(v_club, 'Votre club') || ' n''a pas validé votre demande d''adhésion.'
    end,
    '/mes-invitations'
  );

  return new;
end $$;

drop trigger if exists trg_notifier_reponse_adhesion on membership_requests;
create trigger trg_notifier_reponse_adhesion
  after update of statut on membership_requests
  for each row execute function notifier_reponse_adhesion();
