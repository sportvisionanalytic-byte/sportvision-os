-- v298 — 27/09/2026 : la règle du Pass était écrite deux fois, et la seconde copie annulait le gain
--
-- CE QUI L'A RENDUE VISIBLE. La v297 a ouvert les galeries de club au Pass payé, et la mesure a
-- confirmé : galerie verrouillée avant, OUVERTE après. Puis l'étape suivante du parcours rendait
-- toujours zéro :
--
--     APRES achat : galerie OUVERTE
--       0 photo(s) proposées à identifier      ← la famille a payé et ne peut rien identifier
--
-- `media_galerie_a_identifier` s'arrête sur `media_voit_sans_filigrane`, qui gardait SA PROPRE COPIE
-- du test de périmètre — la même que `can_access_media`, au caractère près, y compris le défaut que
-- la v297 venait de corriger dans l'autre. Corriger une copie laisse l'autre se tromper, et le
-- parcours se bloque une marche plus loin, là où on ne cherche plus.
--
-- LE COMMENTAIRE DE LA v281 AVAIT PRÉVENU, à propos d'une autre règle recopiée dans cette même
-- fonction : « recopié, et non réinventé : une seconde écriture de la même règle finirait par
-- diverger ». C'est exactement ce qui s'est produit, sur la règle voisine.
--
-- CE QUE FAIT CETTE MIGRATION : elle extrait le test de périmètre dans `media_droit_paye(album)`,
-- une seule fonction, que les deux appellent. Plus de copie, donc plus de divergence possible — et
-- la prochaine évolution du modèle de vente se fait à un seul endroit.
--
-- Aucun changement de règle : le contenu du test est repris tel quel, v297 comprise.
--
-- Idempotent.

create or replace function public.media_droit_paye(p_album_id uuid)
returns boolean language plpgsql stable security definer set search_path to 'public','pg_temp' as $f$
declare
  v_album record;
  v_equipes uuid[];
begin
  if auth.uid() is null then return false; end if;
  select * into v_album from media_albums where id = p_album_id;
  if not found then return false; end if;

  -- Les categories de la galerie, principale et supplementaires (v280).
  v_equipes := array(
    select distinct e from unnest(
      coalesce(v_album.team_ids, '{}'::uuid[])
      || case when v_album.team_id is null then '{}'::uuid[] else array[v_album.team_id] end
    ) as e where e is not null
  );

  return exists (
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
  );
end $f$;

comment on function public.media_droit_paye(uuid) is
  'v298 : l''unique regle qui dit si un droit PAYE couvre cette galerie. can_access_media et media_voit_sans_filigrane l''appellent toutes les deux au lieu d''en garder chacune une copie.';

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
  -- 12/09/2026 — Le droit paye d'abord, et il se suffit.
  -- v298 : la regle de perimetre vit maintenant dans media_droit_paye(), et nulle part ailleurs.
  if public.media_droit_paye(p_album_id) then
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

CREATE OR REPLACE FUNCTION public.media_voit_sans_filigrane(p_album_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_album record;
  v_equipes uuid[];
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into v_album from media_albums where id = p_album_id;
  if not found then
    return false;
  end if;

  -- 1. Le staff SportVision. Même nuance que can_access_media : un opérateur terrain n'est staff
  -- que pour SES prestations, sinon il récupérerait n'importe quelle galerie par son identifiant.
  if is_staff() then
    return not est_operateur_terrain() or photographe_voit_album(p_album_id);
  end if;

  -- Les catégories de la galerie, principale et supplémentaires (v280).
  v_equipes := array(
    select distinct e from unnest(
      coalesce(v_album.team_ids, '{}'::uuid[])
      || case when v_album.team_id is null then '{}'::uuid[] else array[v_album.team_id] end
    ) as e where e is not null
  );

  -- 2. Le club lui-même : coach de l'équipe concernée, président, secrétaire, CM affilié. Ce sont
  -- eux qui publient et commentent ces photos — leur servir du filigrane serait absurde.
  -- Le cloisonnement du coach de la v155 est conservé : il ne voit sans filigrane que SES équipes,
  -- plus les galeries du club qui n'appartiennent à aucune catégorie.
  if v_album.club_id is not null
     and (is_club_member(v_album.club_id) or v_album.club_id in (select cm_clubs_autorises()))
  then
    -- Le cloisonnement du coach, RECOPIÉ MOT POUR MOT depuis media_club_galleries (v155) : un
    -- coach, un responsable d'équipe ou un directeur sportif ne voit que SES équipes, plus les
    -- galeries du club rattachées à aucune catégorie. Les autres rôles du club voient tout.
    --
    -- Recopié, et non réinventé : une seconde écriture de la même règle finirait par divergér, et
    -- la divergence se verrait ici sous la forme d'un coach qui voit sans filigrane une catégorie
    -- que Club+ lui cache.
    if cardinality(v_equipes) = 0
       or exists (select 1 from unnest(v_equipes) as e where is_team_educateur(e))
       or not exists (
            select 1 from club_members cm
             where cm.club_id = v_album.club_id and cm.user_id = auth.uid()
               and cm.status = 'actif'
               and cm.role in ('coach', 'resp_equipe', 'directeur_sportif'))
    then
      return true;
    end if;
  end if;

  -- 3. Le Pass RÉELLEMENT PAYÉ. `free_members` ne suffit PAS ici, et c'est tout l'objet de cette
  -- migration : en Full Communication la famille voit déjà les photos, ce qu'elle achète avec le
  -- Pass c'est de les voir sans filigrane.
  -- 3. Le Pass REELLEMENT PAYE. `free_members` ne suffit PAS ici : en Full Communication la
  -- famille voit deja les photos, ce qu'elle achete avec le Pass c'est de les voir sans filigrane.
  -- v298 : meme regle que can_access_media, et desormais le MEME CODE.
  return public.media_droit_paye(p_album_id);
end $function$
;
