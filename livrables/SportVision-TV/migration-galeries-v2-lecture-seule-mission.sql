-- ═══════════════════════════════════════════════════════════════════════════════
-- Galeries : correction du perimetre photographe
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Precision de Fouka le 09/09/2026, apres une premiere version trop large :
--   « il ne faut pas que le photographe/videaste puisse creer des galeries, mais il voit les
--     galeries attachees a sa presta et il a le lien pour envoyer. »
--
-- Trois corrections par rapport a migration-galeries-v1 :
--   1. la creation et la modification lui sont retirees ;
--   2. le perimetre devient la MISSION seule — le volet « ses creations » n'a plus d'objet
--      puisqu'il ne peut plus rien creer ;
--   3. l'acces au LIEN de partage est explicitement conserve, mais borne a ses missions.

begin;

-- ── Le perimetre : sa prestation, et rien d'autre ────────────────────────────
-- Meme condition que partout ailleurs dans le module operateur : une ligne dans
-- prestations_equipe. Aucune deuxieme definition de « ma mission ».
create or replace function public.photographe_voit_album(p_album_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from media_albums a
     join prestations_equipe pe on pe.prestation_id = a.mission_id
    where a.id = p_album_id
      and a.mission_id is not null
      and pe.collaborateur_id = auth.uid()
  );
$function$;

comment on function public.photographe_voit_album(uuid) is
  'Un operateur terrain voit une galerie uniquement si elle est rattachee a une prestation ou il figure dans prestations_equipe. Il n''en cree aucune.';

-- ── Retrait des droits de creation et de modification ────────────────────────
-- Poses par erreur dans la premiere version. La creation reste a la Production.
drop policy if exists malbums_photographe_insert on media_albums;
drop policy if exists malbums_photographe_update on media_albums;

-- La ceinture ne porte plus que sur la lecture : plus rien a autoriser en ecriture pour lui.
drop policy if exists malbums_photographe_perimetre on media_albums;
create policy malbums_photographe_perimetre on media_albums as restrictive for all to authenticated
  using (not est_operateur_terrain() or photographe_voit_album(id))
  with check (not est_operateur_terrain());

comment on policy malbums_photographe_perimetre on media_albums is
  'RESTRICTIVE : un operateur terrain ne lit que les galeries de ses prestations, et n''ecrit rien. Aucun autre role n''est affecte.';

-- ── Le lien de partage, borne au meme perimetre ──────────────────────────────
-- `can_access_media()` renvoyait vrai pour tout is_staff(), ce qui incluait le role photo :
-- le lien de n'importe quelle galerie restait donc joignable par son identifiant, et le
-- cloisonnement pose sur la table devenait sans effet.
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

  if v_policy = 'aucune_vente' then
    return false;
  end if;

  return exists (
    select 1 from media_entitlements me
    where me.status = 'active'
      and (me.valid_until is null or me.valid_until > now())
      -- Trouvé en creusant K76 (audit transversal 04/09) : un Pass Saison payé restait valide pour
      -- TOUTES les saisons futures — media_entitlements.saison_id est bien écrit à l'achat
      -- (stripe-webhook/index.ts, product.saison_id) mais jamais vérifié ici. NULL reste permissif
      -- (entitlements plus anciens/scope album-event sans saison définie) pour ne rien casser.
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
  );
end;
$function$;

commit;

select 'OK — photographe : lecture des galeries de ses prestations, lien inclus, aucune creation' as verdict;
