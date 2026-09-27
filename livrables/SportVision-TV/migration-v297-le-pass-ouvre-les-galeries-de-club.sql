-- v297 — 27/09/2026 : le Pass payé restait bloqué devant les galeries de club
--
-- TROUVÉ EN VÉRIFIANT LA v296. Après avoir rattaché les 24 galeries à leur club, j'ai payé un Pass
-- pour un joueur de démonstration et mesuré l'accès. Il était TOUJOURS refusé :
--
--     galerie témoin : rc argenteuil vs Villemomble
--     AVANT achat  : can_access_media = f
--     APRES achat  : can_access_media = f      ← 39,90 € payés, cadenas identique
--
-- POURQUOI. `media_activer_commande` ouvre un droit de périmètre `team` (l'équipe du joueur). Ces
-- galeries-là n'ont AUCUNE équipe : c'est justement ce que Fouka a décidé le 27/09, une galerie de
-- club. Le test `me.scope_id = any(v_equipes)` compare donc à un tableau vide, et il est faux.
--
-- C'est exactement le défaut que la v280 avait corrigé pour les galeries à PLUSIEURS équipes, un
-- cran plus loin. Son commentaire disait déjà tout : « sans le `any`, la famille d'un U7 paierait
-- un Pass et resterait devant un cadenas sur le plateau où son enfant a joué ». Le cas « aucune
-- équipe » manquait.
--
-- CE QUE ÇA N'OUVRE PAS. `can_access_asset` vérifie ENSUITE, photo par photo, que la photo porte le
-- marquage d'un sportif de la famille — ou qu'elle est une photo de groupe. Cette ligne ouvre la
-- porte de la galerie, jamais son contenu. Le modèle de Fouka tient : « ses photos plus les photos
-- de groupe, jamais celles des autres ».
--
-- Idempotent.

CREATE OR REPLACE FUNCTION public.can_access_media(p_album_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_album record;
  v_policy text;
  v_family boolean;
  v_equipes uuid[];
begin
  if auth.uid() is null then
    return false;
  end if;
  if is_staff() then
    -- 09/09/2026 : un opérateur terrain n'est staff que pour SES prestations. Sans cette nuance il
    -- récupérait le lien de partage de n'importe quelle galerie par son identifiant.
    return not est_operateur_terrain() or photographe_voit_album(p_album_id);
  end if;

  select * into v_album from media_albums where id = p_album_id;
  if not found then
    return false;
  end if;

  -- Toutes les catégories de la galerie, la principale comprise, sans doublon ni null.
  v_equipes := array(
    select distinct e from unnest(
      coalesce(v_album.team_ids, '{}'::uuid[]) || case when v_album.team_id is null then '{}'::uuid[] else array[v_album.team_id] end
    ) as e where e is not null
  );

  -- 12/09/2026 — Le droit payé d'abord, et il se suffit. `purchased_by_user_id` est celui qui a
  -- réglé : il garde son accès même si l'enfant a quitté le club.
  if exists (
    select 1 from media_entitlements me
    where me.status = 'active'
      and (me.valid_until is null or me.valid_until > now())
      -- Borne de saison (04/09) : un Pass Saison ne vaut pas pour les saisons suivantes.
      and (me.saison_id is null or me.saison_id = v_album.saison_id)
      and (
        (me.scope_type = 'club' and me.club_id = v_album.club_id)
        -- v280 : un Pass d'équipe ouvre la galerie dès que SON équipe est couverte, principale ou
        -- supplémentaire. Sans le `any`, la famille d'un U7 paierait un Pass et resterait devant
        -- un cadenas sur le plateau où son enfant a joué.
        or (me.scope_type = 'team' and me.scope_id = any(v_equipes))
        -- v297, 27/09/2026 : UNE GALERIE SANS AUCUNE ÉQUIPE EST CELLE DE TOUT LE CLUB, et un Pass
        -- pris pour un enfant de ce club l'ouvre. Sans cette ligne, la famille qui venait de payer
        -- 39,90 € restait devant un cadenas sur les 18 galeries de son club — un plateau, une
        -- Villemomble Cup, un match d'une autre catégorie où son enfant jouait quand même. C'est le
        -- même défaut que la v280 corrigeait pour les galeries à PLUSIEURS équipes, un cran plus
        -- loin : celles qui n'en ont AUCUNE.
        --
        -- Ça n'ouvre pas les photos des autres enfants : `can_access_asset` exige, photo par photo,
        -- un marquage valide pour un sportif de la famille (ou une photo de groupe). Cette ligne
        -- ouvre la porte de la galerie, pas son contenu.
        or (me.scope_type = 'team' and cardinality(v_equipes) = 0 and me.club_id = v_album.club_id)
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

  if cardinality(v_equipes) > 0 then
    -- Famille de N'IMPORTE LAQUELLE des catégories couvertes. La même règle que la liste, sinon un
    -- cadenas s'afficherait sur une galerie visible.
    select bool_or(is_family_of_team(e)) into v_family from unnest(v_equipes) as e;
    v_family := coalesce(v_family, false);
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
$function$
;
