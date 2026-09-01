-- ============================================================================
-- migration-poles-v30-proposer-candidature-direction.sql
-- "Mon pôle > Recrutement" (migration-poles-v27/v28) : un Responsable non-
-- admin/sec/rh ne peut pas appeler invite-collaborateur (edge function
-- réservée à ces 3 rôles, comportement volontairement inchangé) — il
-- "propose" une candidature retenue à la Direction plutôt que de la
-- finaliser lui-même. notify_staff_by_role() est verrouillée (revoke
-- execute from authenticated, migration-securite-notify-staff-by-role.sql) :
-- nouvelle petite fonction dédiée, callable par tout profil staff, qui
-- vérifie que l'appelant est bien Responsable du pôle de CETTE candidature
-- avant de notifier admin/sec/rh.
-- ============================================================================

create or replace function public.propose_candidature_direction(p_candidature_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pole_id uuid;
  v_nom text;
  v_prenom text;
  v_poste text;
  v_ok boolean;
begin
  select pole_id, nom, prenom, poste into v_pole_id, v_nom, v_prenom, v_poste
    from recruitment_applications where id = p_candidature_id;
  if not found then
    raise exception 'Candidature introuvable.';
  end if;

  v_ok := is_staff() and (v_pole_id is null or is_pole_responsable(v_pole_id) or exists (
    select 1 from profiles where id = auth.uid() and role in ('admin','rh')
  ));
  if not v_ok then
    raise exception 'Accès refusé à cette candidature.';
  end if;

  insert into notifications (type, titre, message, destinataire_id, lue, priorite, created_at)
  select 'systeme',
    'Candidature proposée par un Responsable de pôle',
    coalesce(v_prenom,'') || ' ' || coalesce(v_nom,'') || ' (' || coalesce(v_poste,'poste') || ') a été proposé(e) par le Responsable de pôle pour finalisation.',
    pr.id, false, 'normale', now()
  from profiles pr
  where pr.role in ('admin','sec','rh')
    and (v_pole_id is null or pr.role in ('admin','rh') or exists (
      select 1 from pole_affectations pa where pa.user_id = pr.id and pa.pole_id = v_pole_id
    ));
end;
$function$;

comment on function public.propose_candidature_direction(uuid) is 'Notifie admin/sec/rh (scopés au pôle de la candidature quand connu) qu''un Responsable de pôle propose une candidature retenue pour finalisation -- ne crée jamais de compte lui-même, invite-collaborateur reste réservé admin/sec/rh (migration-poles-v30).';

revoke all on function public.propose_candidature_direction(uuid) from public, anon;
grant execute on function public.propose_candidature_direction(uuid) to authenticated;

-- ROLLBACK : drop function public.propose_candidature_direction(uuid);
