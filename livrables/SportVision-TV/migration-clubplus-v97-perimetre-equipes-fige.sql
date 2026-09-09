-- Le périmètre d'équipes d'un membre n'est plus modifiable par ce membre.
--
-- ── Ce qui a été prouvé en production, le 09/09/2026 ──
-- Dans une transaction annulée, sur SF Villemomble : un faux coach avec teams = ["U8 A"]
--
--   is_team_educateur('U8 A')       → true
--   is_team_educateur('Séniors R2') → false
--
-- puis, agissant comme lui-même (role authenticated, jwt sub = son id) :
--
--   update club_members set teams = '["U8 A","Séniors R2"]' where user_id = <lui>   → accepté
--   is_team_educateur('Séniors R2') → true
--
-- Autrement dit : n'importe quel coach pouvait s'accorder n'importe quelle équipe de son club,
-- d'un seul appel API, sans passer par aucun écran. Deux pièces manquaient au même endroit :
--
--   * la policy `cm_self_update` autorise un membre à écrire sur SA ligne (auth.uid() = user_id)
--     et n'a pas de WITH CHECK propre — le contrôle porte sur QUI est la ligne, pas sur ce qui
--     change dedans ;
--   * le trigger `protect_sensitive_club_member_fields` gèle `role`, `status` et `club_id`, mais
--     `teams` a été ajouté après lui (§7.1, "équipe/catégorie facultative") et n'y a jamais été
--     inscrit.
--
-- Tant que `teams` ne servait qu'à filtrer une liste de réservations pour le confort d'un
-- éducateur, la conséquence restait cosmétique. Ce n'est plus le cas : `is_team_educateur` lit ce
-- champ pour décider des droits réels sur une équipe, et la fiche équipe s'appuie dessus pour
-- désigner un coach. Le champ est devenu porteur de droits ; il doit être protégé comme tel.
--
-- ── Ce que la correction fait, exactement ──
-- Un membre qui n'est ni administrateur du club, ni staff SportVision, ne peut plus modifier son
-- propre `teams` — ni celui de personne d'autre. Le contrôle est placé AVANT la branche
-- « auto-acceptation de son invitation » : accepter son invitation reste permis, mais ne devient
-- pas une fenêtre pour se réécrire un périmètre au passage.
--
-- Ce qui NE change pas : le service_role (edge function `clubplus-invite`, qui écrit `teams` à la
-- création) sort toujours en première ligne ; l'admin du club et le staff OS gardent la main ;
-- role, status et club_id restent gelés exactement comme avant.
--
-- Aucun écran ne perd une capacité : `setClubMemberTeams` n'était appelé de nulle part côté
-- Connect avant aujourd'hui, et son premier appelant (la carte Encadrement de la fiche équipe)
-- est réservé à l'administrateur du club.

begin;

create or replace function public.protect_sensitive_club_member_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  is_os_staff boolean;
  is_this_club_admin boolean;
  is_self_accepting_own_invitation boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'com', 'sec')
  ) into is_os_staff;

  select is_club_admin(old.club_id) into is_this_club_admin;

  if new.club_id is distinct from old.club_id then
    raise exception 'Modification non autorisée : club_id est immuable, une adhésion ne se déplace pas par UPDATE.';
  end if;

  -- 19/08/2026 (audit pré-lancement, migration-connect-v15) : un admin ne peut pas
  -- modifier SA PROPRE ligne pour perdre son statut d'admin actif (se suspendre ou
  -- se rétrograder lui-même) via un appel API direct hors UI. Seul le staff OS peut
  -- le faire (branche is_os_staff ci-dessus), pour un transfert de propriété
  -- légitime. Additive : ne touche à rien d'autre du comportement existant.
  if is_this_club_admin and not is_os_staff and old.user_id = auth.uid()
     and (new.status is distinct from 'actif' or new.role is distinct from 'admin')
  then
    raise exception 'Un administrateur ne peut pas se retirer ses propres droits d''administration.';
  end if;

  -- 09/09/2026 — `teams` porte des droits (is_team_educateur), pas une préférence d'affichage :
  -- il se gèle comme role et status. Placé avant l'exception d'auto-acceptation, qui ne concerne
  -- que la transition invitation -> actif et n'a aucune raison d'ouvrir le périmètre.
  if not is_os_staff and not is_this_club_admin
     and new.teams is distinct from old.teams
  then
    raise exception 'Modification non autorisée : le périmètre d''équipes est fixé par l''administrateur du club.';
  end if;

  -- Auto-acceptation de sa propre invitation : la seule transition qu'un
  -- non-admin/non-staff peut déclencher sur role/status. Rôle strictement
  -- inchangé, statut strictement invitation -> actif, et uniquement sur sa
  -- propre ligne (auth.uid() = old.user_id, jamais un tiers).
  is_self_accepting_own_invitation :=
    auth.uid() = old.user_id
    and old.status = 'invitation'
    and new.status = 'actif'
    and new.role = old.role;

  if not is_os_staff and not is_this_club_admin and not is_self_accepting_own_invitation then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
    then
      raise exception 'Modification non autorisée : rôle et statut sont réservés à l''administrateur du club ou au staff SportVision.';
    end if;
  end if;

  return new;
end;
$function$;

commit;
