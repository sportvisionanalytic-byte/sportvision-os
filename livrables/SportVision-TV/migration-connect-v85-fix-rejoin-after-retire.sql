-- migration-connect-v85-fix-rejoin-after-retire.sql
-- EXÉCUTÉE, vérifiée le 20/08/2026.
--
-- Bug remonté en direct (20/08/2026) : "Impossible de rejoindre ce club pour le moment." pour un
-- joueur qui avait quitté un club (action "leave", account_status -> 'retire') puis essaie de le
-- rejoindre à nouveau. guard_player_profile_update() (migration-clubplus-v13/v36, complétée par
-- migration-connect-v81) n'exemptait QUE le sens actif -> 'retire' (quitter), jamais le sens
-- inverse 'retire' -> actif (rejoindre) — alors même que l'action "join" de l'edge function
-- connect-player-onboarding a toujours eu vocation à gérer ce cas précis (voir son commentaire
-- "BUGFIX 13/08" dans supabase/functions/connect-player-onboarding/index.ts, jamais couvert côté
-- trigger jusqu'ici). Ajoute l'exception symétrique : un joueur peut repasser SA PROPRE ligne de
-- 'retire' à 'actif' en self-service, comme il peut déjà passer d'actif à 'retire'.

create or replace function public.guard_player_profile_update()
returns trigger
language plpgsql
as $function$
begin
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
