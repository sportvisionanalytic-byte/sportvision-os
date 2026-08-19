-- migration-connect-v84-remove-minor-parental-auth-gate.sql
-- EXÉCUTÉE, vérifiée le 20/08/2026.
--
-- Décision explicite de Fouka (20/08/2026) : validate_team_membership() refusait de valider
-- l'affiliation d'un joueur mineur tant qu'une autorisation parentale ('creation_compte',
-- 'acces_clubplus', 'traitement_donnees' sur parental_authorizations) n'était pas 'valide' —
-- ce garde-fou est retiré à sa demande explicite, après l'avoir prévenu que c'était un vrai
-- contrôle légal (même famille que la clause SV-CL-006 désactivée en attendant relecture
-- juridique). Un dirigeant/éducateur peut désormais valider n'importe quelle demande, mineur ou
-- majeur, sans dépendre d'une autorisation parentale enregistrée.
--
-- Ne touche ni parental_authorizations, ni bootstrap_player_authorizations (toujours appelée
-- plus bas dans la fonction, toujours peuplée pour un mineur) : seul le blocage de validation est
-- retiré, la donnée d'autorisation elle-même continue d'exister et de se remplir normalement —
-- réversible sans perte si ce choix est reconsidéré plus tard.

create or replace function public.validate_team_membership(p_request_id uuid)
returns membership_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_req membership_requests;
begin
  select * into v_req from membership_requests where id = p_request_id;
  if v_req.id is null then raise exception 'Demande introuvable'; end if;
  if v_req.statut in ('validee', 'refusee') then raise exception 'Cette demande a déjà été traitée'; end if;

  if v_req.validation_mode = 'double' then
    if v_req.educateur_confirme_at is null then
      raise exception 'Cette demande doit d''abord être confirmée par un éducateur (mode double validation)';
    end if;
    if not is_club_admin(v_req.club_id) then raise exception 'Seul un administrateur peut valider en mode double validation'; end if;
  elsif v_req.validation_mode = 'controle' then
    if not is_club_admin(v_req.club_id) then raise exception 'Seul un administrateur peut valider sur ce club'; end if;
  else
    if not (is_club_admin(v_req.club_id) or (v_req.team_id is not null and is_team_educateur(v_req.team_id))) then
      raise exception 'Non autorisé';
    end if;
  end if;

  update membership_requests
  set statut = 'validee', admin_valide_par = auth.uid(), admin_valide_at = now()
  where id = p_request_id
  returning * into v_req;

  if v_req.team_id is not null then
    insert into team_memberships (player_id, team_id, club_id, saison, statut)
    values (v_req.player_id, v_req.team_id, v_req.club_id, coalesce((select saison from clubs where id = v_req.club_id), '2026-2027'), 'active')
    on conflict (player_id, team_id, saison) do update set statut = 'active';
  end if;

  update player_profiles
  set account_status = 'actif'
  where id = v_req.player_id and account_status in ('en_attente_activation') and user_id is not null;

  insert into membership_request_events (request_id, event_type, acted_by) values (p_request_id, 'validee', auth.uid());
  return v_req;
end;
$function$;
