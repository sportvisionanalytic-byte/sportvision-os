-- Audit transversal end-to-end (04/09/2026) — batch 2, trouvé en TESTANT réellement le fix du
-- claim mineur (batch1) plutôt qu'en le lisant seulement : guard_player_profile_update()
-- (migration-clubplus-v36-player-self-leave.sql) ne laisse jamais passer service_role, contrairement
-- à toutes les autres triggers de garde du projet (protect_sensitive_club_fields,
-- protect_client_cm_assignment...) qui commencent systématiquement par `if auth.role() =
-- 'service_role' then return new; end if;`. Résultat : find_unclaimed_player_profile()
-- fonctionnait (renvoie le bon id), mais l'UPDATE réel depuis l'edge function
-- (connect-player-onboarding, client service_role) échouait avec "Modification non autorisée sur
-- ces champs" dès qu'elle posait user_id sur une fiche jusque-là non réclamée. Ajout du même
-- garde-fou service_role que partout ailleurs, RESTE DE LA LOGIQUE INCHANGÉE (self-service leave,
-- club admin, protection date_naissance/club_id restent identiques).

create or replace function public.guard_player_profile_update()
returns trigger
language plpgsql
as $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if not is_club_admin(new.club_id) then
    if new.user_id is distinct from old.user_id
       or (
         new.account_status is distinct from old.account_status
         and not (
           (new.account_status = 'retire' and old.user_id = auth.uid())
           or (old.account_status = 'retire' and new.account_status = 'actif' and old.user_id = auth.uid())
         )
       )
       or (
         new.club_id is distinct from old.club_id
         and old.user_id is distinct from auth.uid()
       )
       or (
         new.date_naissance is distinct from old.date_naissance
         and old.user_id is distinct from auth.uid()
       )
    then
      raise exception 'Modification non autorisée sur ces champs';
    end if;
  end if;
  return new;
end;
$function$;
