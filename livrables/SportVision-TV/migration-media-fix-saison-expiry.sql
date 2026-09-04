-- Finding K76 (audit transversal, 04/09/2026) : un Pass Saison acheté restait valide pour toutes
-- les saisons futures d'un club — media_entitlements.saison_id est bien écrit correctement à
-- l'achat (stripe-webhook/index.ts, product.saison_id) mais can_access_media() ne le vérifiait
-- jamais. Correctif additif : ajout d'une condition sur saison_id, NULL restant permissif pour ne
-- rien casser sur les entitlements plus anciens/scopes album-event où la saison n'a pas de sens.
-- Vérifié en conditions réelles : un Pass saison 2026-2027 n'ouvre plus l'accès à un album publié
-- pour la saison 2027-2028, l'accès à un album de la même saison reste intact.

create or replace function can_access_media(p_album_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
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
    return true;
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
