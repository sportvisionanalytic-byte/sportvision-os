-- ============================================================
-- SPORTVISION CONNECT — Migration v81
-- Idempotente.
--
-- Portée (19/08/2026, remonté par Fouka : "impossible de rejoindre le club
-- affilié") : un joueur qui a DÉJÀ une ligne player_profiles (ex. a choisi
-- "Continuer sans club" à l'inscription, ou a quitté un club) ne pouvait
-- jamais rejoindre un club ensuite via /affiliations/ajouter.
--
-- ─── Cause réelle ──────────────────────────────────────────────────────
-- connect-player-onboarding (action "join") met à jour la ligne existante
-- via le client SERVICE ROLE (`admin`), pas le JWT du joueur. Le trigger
-- guard_player_profile_update() (migration-clubplus-v13/v36) bloque tout
-- changement de club_id tant que is_club_admin(new.club_id) est faux — et
-- en contexte service role, auth.uid() est NULL, donc is_club_admin() est
-- TOUJOURS faux, quel que soit l'appelant. Résultat : l'UPDATE échoue
-- systématiquement avec "Modification non autorisée sur ces champs",
-- masqué côté client par le message générique "Impossible de rejoindre ce
-- club pour le moment." Vérifié en conditions réelles : un compte SANS
-- ligne player_profiles préalable (passe par un INSERT, jamais concerné
-- par ce trigger de update) rejoint un club sans problème — seul le cas
-- UPDATE (ligne déjà existante) était cassé, silencieusement, depuis
-- l'introduction du trigger.
--
-- ─── Correctif ───────────────────────────────────────────────────────────
-- 1. Le trigger gagne deux exceptions étroites, symétriques à celle déjà en
--    place pour account_status='retire' : un joueur peut changer SA PROPRE
--    ligne (old.user_id = auth.uid()) de club_id ET de date_naissance
--    librement — l'action "join" envoie systématiquement les deux (voir
--    connect-player-onboarding, action "join", ligne de l'UPDATE), et
--    c'est exactement l'action déjà autorisée sans réserve côté INSERT
--    (un nouveau profil peut être créé avec n'importe quel club_id/date de
--    naissance) : l'UPDATE doit avoir le même droit pour la même personne.
--    account_status garde sa seule exception existante ('retire') — pas
--    élargi à 'actif' ici, pour ne jamais laisser un joueur s'auto-
--    réactiver si le statut avait été changé par un admin/staff pour une
--    autre raison que "retire" (suspension...), question hors du bug
--    remonté ce soir, à trancher séparément si jamais rencontrée.
-- 2. connect-player-onboarding (Edge Function, fichier séparé) doit être
--    mis à jour pour faire cet UPDATE via le JWT de l'appelant (userClient),
--    pas via `admin` — sans quoi auth.uid() reste NULL et les exceptions
--    ci-dessous ne s'appliquent toujours pas. Voir le commit qui accompagne
--    cette migration.
--
-- Vérifié en conditions réelles (compte de test avec ligne player_profiles
-- préexistante, JWT réel) avant et après ce correctif.
-- ============================================================

create or replace function public.guard_player_profile_update()
returns trigger
language plpgsql
as $function$
begin
  if not is_club_admin(new.club_id) then
    if new.user_id is distinct from old.user_id
       or (
         new.account_status is distinct from old.account_status
         and not (new.account_status = 'retire' and old.user_id = auth.uid())
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
