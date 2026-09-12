-- v201 — Le modèle photo suit la transition de saison (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. La commercialisation photo est entièrement par saison :
-- `media_club_policy` porte une contrainte unique (club, saison) et `media_products.saison_id`
-- est NOT NULL. La transition de saison, elle, avance `clubs.saison` et ne crée rien d'autre.
--
-- `resolve_media_policy` cherche la politique de la saison de l'album et, si elle n'existe pas,
-- renvoie `aucune_vente` — un repli sûr, assumé. `can_access_media` traduit `aucune_vente` par
-- « non ». Donc : le club bascule sur 2027-2028 le 3 juillet, SportVision publie la première
-- galerie de la saison le 10 août, et personne ne peut l'ouvrir ni rien acheter, jusqu'à ce qu'un
-- humain recrée à la main la politique et les produits. L'écran dit « aucune politique média
-- configurée », ce qui est exact, mais le club ne comprend pas qu'il vient de le provoquer.
--
-- CE QUE FAIT CETTE MIGRATION. À la bascule, le modèle de la saison sortante est recopié sur la
-- saison entrante : même politique par défaut, même partage de revenus, mêmes produits, mêmes
-- prix. Ce qui était en vigueur reste en vigueur ; le club et SportVision changent ce qu'ils
-- veulent ensuite, comme avant.
--
-- Ce qui n'est PAS recopié : les produits déjà expirés (`valid_until` passée) et les produits
-- archivés. Et rien n'est recopié si la nouvelle saison a déjà une politique : on ne réécrit
-- jamais par-dessus une décision prise.
-- Idempotente.

create or replace function public.copier_modele_photo_vers_saison(
  p_club_id uuid,
  p_saison_source uuid,
  p_saison_cible uuid
) returns integer
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_copies integer := 0;
begin
  if p_club_id is null or p_saison_source is null or p_saison_cible is null
     or p_saison_source = p_saison_cible then
    return 0;
  end if;
  if not (is_staff() or is_club_admin(p_club_id) or peut_operer_club(p_club_id)) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  -- Une politique déjà posée sur la saison cible fait foi : on ne réécrit rien.
  if exists (select 1 from media_club_policy where club_id = p_club_id and saison_id = p_saison_cible) then
    return 0;
  end if;

  insert into media_club_policy (club_id, saison_id, default_policy, revenue_share_pct, status)
  select p_club_id, p_saison_cible, mcp.default_policy, mcp.revenue_share_pct, mcp.status
    from media_club_policy mcp
   where mcp.club_id = p_club_id and mcp.saison_id = p_saison_source;
  if not found then
    return 0;   -- rien à recopier : le club n'avait pas de modèle
  end if;

  insert into media_products (club_id, saison_id, name, type, price_cents, currency, scope_type,
                              team_ids, physical_product, status, valid_from, valid_until, metadata)
  select p_club_id, p_saison_cible, mp.name, mp.type, mp.price_cents, mp.currency, mp.scope_type,
         mp.team_ids, mp.physical_product, mp.status, null, null, mp.metadata
    from media_products mp
   where mp.club_id = p_club_id
     and mp.saison_id = p_saison_source
     and mp.status <> 'archive'
     and (mp.valid_until is null or mp.valid_until > now());
  get diagnostics v_copies = row_count;

  return v_copies;
end;
$$;

grant execute on function public.copier_modele_photo_vers_saison(uuid, uuid, uuid) to authenticated;
