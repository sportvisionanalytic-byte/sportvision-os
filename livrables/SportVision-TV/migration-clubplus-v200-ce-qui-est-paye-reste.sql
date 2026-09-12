-- v200 — Ce qui est payé reste accessible (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. `can_access_media` posait ses questions dans le mauvais ordre :
--   1. êtes-vous une famille de ce club AUJOURD'HUI ? sinon, non ;
--   2. quelle est la politique média ? ;
--   3. avez-vous payé ?
-- La troisième question n'était jamais atteinte pour une famille qui n'était plus « active ».
--
-- Or `is_family_of_team` et `is_family_of_club` exigent un `team_memberships` de statut `active`,
-- sans aucune notion de saison, et la transition de saison archive précisément ces lignes
-- (`archivee`, `en_attente_renouvellement`, `quittee_club`). Cette policy est la seule lecture du
-- dossier des photos dans le stockage.
--
-- Le scénario : en juillet, le président fait sa transition et coche « a quitté le club » pour
-- trois joueurs. Le soir même, leurs parents ouvrent Connect et n'ont plus une seule photo — y
-- compris celles du Pass Saison à 30 EUR qu'ils venaient de payer, y compris les albums de la
-- saison écoulée. Aucun message, rien à comprendre, et le club n'a rien fait de visible.
--
-- CE QUE FAIT CETTE MIGRATION. Le droit payé est vérifié EN PREMIER, et se suffit à lui-même :
-- qui a payé garde l'accès à ce qu'il a payé, qu'il soit encore au club ou non. Le reste est
-- inchangé : sans droit payé, la famille active accède selon la politique du club, et un
-- opérateur terrain reste borné à ses missions.
--
-- La borne de saison posée le 04/09 (un Pass Saison ne vaut pas pour les saisons suivantes) est
-- conservée telle quelle : payer ne donne pas plus que ce qui a été acheté.
-- Idempotente.

create or replace function public.can_access_media(p_album_id uuid)
returns boolean
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_album record;
  v_policy text;
  v_family boolean;
begin
  if auth.uid() is null then
    return false;
  end if;
  if is_staff() then
    -- Ajout 09/09/2026 : un operateur terrain n'est staff que pour SES prestations. Sans cette
    -- nuance il recuperait le lien de partage de n'importe quelle galerie par son identifiant,
    -- ce qui rendait le cloisonnement de media_albums sans effet.
    return not est_operateur_terrain() or photographe_voit_album(p_album_id);
  end if;

  select * into v_album from media_albums where id = p_album_id;
  if not found then
    return false;
  end if;

  -- 12/09/2026 — Le droit payé d'abord, et il se suffit. `purchased_by_user_id` est celui qui a
  -- réglé : il garde son accès même si l'enfant a quitté le club, ce qui est exactement le cas
  -- que la transition de saison cassait.
  if exists (
    select 1 from media_entitlements me
    where me.status = 'active'
      and (me.valid_until is null or me.valid_until > now())
      -- Borne de saison (04/09) : un Pass Saison ne vaut pas pour les saisons suivantes.
      and (me.saison_id is null or me.saison_id = v_album.saison_id)
      and (
        (me.scope_type = 'club' and me.club_id = v_album.club_id)
        or (me.scope_type = 'team' and v_album.team_id is not null and me.scope_id = v_album.team_id)
        or (me.scope_type = 'album' and me.scope_id = v_album.id)
        or (me.scope_type = 'event' and v_album.event_id is not null and me.scope_id = v_album.event_id)
      )
      and (
        me.purchased_by_user_id = auth.uid()
        or is_own_player(me.beneficiary_person_id)
        or is_confirmed_parent_of(me.beneficiary_person_id)
      )
  ) then
    return true;
  end if;

  if v_album.team_id is not null then
    v_family := is_family_of_team(v_album.team_id);
  else
    v_family := is_family_of_club(v_album.club_id);
  end if;
  if not v_family then
    return false;
  end if;

  v_policy := resolve_media_policy(p_album_id);

  if v_policy in ('free_members','public') then
    return true;
  end if;

  return false;
end;
$function$;
