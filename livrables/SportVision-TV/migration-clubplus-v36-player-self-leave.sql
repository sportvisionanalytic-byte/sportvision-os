-- Fix : l'action "Quitter cette affiliation" (Connect personnel, espace
-- joueur, /affiliations) met account_status='retire' sur SA PROPRE fiche
-- player_profiles, mais le trigger guard_player_profile_update() (migration-
-- clubplus-v13.sql) bloquait TOUTE modification de account_status par un
-- non-admin, sans aucune distinction — y compris l'auto-désaffiliation
-- volontaire d'un joueur sur son propre compte.
--
-- Découvert le 12/08/2026 en testant en conditions réelles l'edge function
-- connect-player-onboarding (action "leave") : la requête échouait avec
-- "Modification non autorisée sur ces champs" MÊME via service role, car ce
-- trigger n'a jamais eu d'exception pour le service role — les triggers
-- s'exécutent toujours pour toute UPDATE sur la table, contrairement aux
-- policies RLS que le service role contourne. Comme is_club_admin() s'appuie
-- sur auth.uid() (NULL en contexte service role), le check échouait de la
-- même façon qu'un utilisateur normal non-admin.
--
-- Cette migration ajoute UNE seule exception étroite : un joueur peut mettre
-- SA PROPRE fiche à account_status='retire', et RIEN D'AUTRE — club_id,
-- user_id, date_naissance restent protégés dans tous les cas, et aucune
-- autre valeur de account_status n'est permise en libre-service (en
-- particulier pas 'actif', qui reste réservé à l'admin — l'objectif initial
-- du trigger "empêche l'auto-activation" reste intact).
--
-- Idempotente. À exécuter dans Supabase → SQL Editor.

create or replace function guard_player_profile_update()
returns trigger language plpgsql as $$
begin
  if not is_club_admin(new.club_id) then
    if new.club_id is distinct from old.club_id
       or new.user_id is distinct from old.user_id
       or new.date_naissance is distinct from old.date_naissance
       or (
         new.account_status is distinct from old.account_status
         and not (new.account_status = 'retire' and old.user_id = auth.uid())
       )
    then
      raise exception 'Modification non autorisée sur ces champs';
    end if;
  end if;
  return new;
end;
$$;
