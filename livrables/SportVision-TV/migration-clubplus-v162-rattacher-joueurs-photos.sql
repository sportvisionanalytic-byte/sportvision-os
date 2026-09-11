-- v162 : rattacher un joueur à une photo de galerie, côté Production (12/09/2026).
--
-- Sans ce geste, « les photos de mon enfant » ne montre jamais rien : c'est ici que le rattachement
-- se crée. Il se fait à la main aujourd'hui ; quand le moteur de reconnaissance existera, il posera
-- des suggestions dans la même table et la Production n'aura plus qu'à trancher celles dont le
-- moteur n'est pas sûr. Les deux chemins arrivent donc au même endroit, media_player_tags.
--
-- POURQUOI DES FONCTIONS ET PAS LA TABLE EN DIRECT. Les policies existantes de media_player_tags
-- ont été écrites pour les médias du module club (media_ref_club_id ne sait pas lire une photo de
-- galerie) : elles refusent tout sur 'media_asset'. Plutôt que de les élargir, ce qui ouvrirait le
-- marquage aux membres du club, on garde la table fermée et on passe par quatre fonctions réservées
-- au staff SportVision, cloisonnées par pôle pour un photographe.
-- Test : tests/rattacher-joueurs-photos.test.sql

-- Qui peut marquer les photos de cette galerie : le staff média, et pour un opérateur terrain
-- seulement les galeries de son pôle.
create or replace function public.peut_marquer_galerie(p_album_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select media_upload_staff()
     and (not est_operateur_terrain() or photographe_voit_album(p_album_id));
$$;
revoke execute on function public.peut_marquer_galerie(uuid) from public, anon;
grant execute on function public.peut_marquer_galerie(uuid) to authenticated;

-- La liste des joueurs de l'équipe de la galerie, avec ce qu'il faut pour travailler : combien de
-- photos lui sont déjà rattachées, et si sa famille a donné l'accord de reconnaissance.
create or replace function public.media_joueurs_de_galerie(p_album_id uuid)
returns table (player_id uuid, prenom text, nom text, nb_photos integer, reconnaissance boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.prenom, p.nom,
         (select count(*)::int from media_player_tags t
           join media_assets a on a.id = t.media_ref_id
          where t.media_ref_type = 'media_asset' and t.player_id = p.id
            and t.statut = 'valide' and a.album_id = p_album_id),
         consentement_biometrie_actif(p.id)
    from media_albums al
    join team_memberships tm on tm.team_id = al.team_id and tm.statut = 'active'
    join player_profiles p on p.id = tm.player_id
   where al.id = p_album_id and peut_marquer_galerie(p_album_id)
   order by p.nom, p.prenom;
$$;
revoke execute on function public.media_joueurs_de_galerie(uuid) from public, anon;
grant execute on function public.media_joueurs_de_galerie(uuid) to authenticated;

-- Tous les rattachements de la galerie, validés et proposés : l'écran affiche les deux, mais seuls
-- les validés ouvrent quoi que ce soit à une famille.
create or replace function public.media_tags_de_galerie(p_album_id uuid)
returns table (tag_id uuid, asset_id uuid, player_id uuid, prenom text, nom text,
               statut text, source text, score numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, a.id, p.id, p.prenom, p.nom, t.statut, t.source, t.score
    from media_assets a
    join media_player_tags t on t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
    join player_profiles p on p.id = t.player_id
   where a.album_id = p_album_id and t.statut in ('valide', 'propose')
     and peut_marquer_galerie(p_album_id)
   order by a.position, p.nom;
$$;
revoke execute on function public.media_tags_de_galerie(uuid) from public, anon;
grant execute on function public.media_tags_de_galerie(uuid) to authenticated;

-- Rattacher ou détacher, en un geste. Le détachement d'une suggestion la marque 'rejete' au lieu de
-- l'effacer : sans cette trace, le moteur reproposerait la même photo au tour suivant.
create or replace function public.media_rattacher_joueur(p_asset_id uuid, p_player_id uuid, p_attacher boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_album uuid; v_id uuid; v_source text;
begin
  select album_id into v_album from media_assets where id = p_asset_id;
  if v_album is null then
    raise exception 'Photo introuvable.' using errcode = '22023';
  end if;
  if not peut_marquer_galerie(v_album) then
    raise exception 'Vous ne pouvez pas marquer les photos de cette galerie.' using errcode = '42501';
  end if;
  -- Le joueur doit appartenir à l'équipe de la galerie : sans cela, on rattacherait la photo d'un
  -- match à un enfant d'un autre club.
  if not exists (select 1 from media_albums al
                   join team_memberships tm on tm.team_id = al.team_id and tm.statut = 'active'
                  where al.id = v_album and tm.player_id = p_player_id) then
    raise exception 'Ce joueur ne fait pas partie de l''équipe de cette galerie.' using errcode = '42501';
  end if;

  if p_attacher then
    select id, source into v_id, v_source from media_player_tags
     where media_ref_type = 'media_asset' and media_ref_id = p_asset_id and player_id = p_player_id;
    if found then
      update media_player_tags
         set statut = 'valide', valide_par = auth.uid(), valide_le = now()
       where id = v_id;
    else
      insert into media_player_tags (media_ref_type, media_ref_id, player_id, tagged_by, source, statut, valide_par, valide_le)
      values ('media_asset', p_asset_id, p_player_id, auth.uid(), 'humain', 'valide', auth.uid(), now())
      returning id into v_id;
    end if;
    return jsonb_build_object('tag_id', v_id, 'statut', 'valide');
  end if;

  select id, source into v_id, v_source from media_player_tags
   where media_ref_type = 'media_asset' and media_ref_id = p_asset_id and player_id = p_player_id;
  if not found then
    return jsonb_build_object('tag_id', null, 'statut', 'absent');
  end if;
  if v_source = 'humain' then
    delete from media_player_tags where id = v_id;
    return jsonb_build_object('tag_id', v_id, 'statut', 'supprime');
  end if;
  update media_player_tags set statut = 'rejete', valide_par = auth.uid(), valide_le = now() where id = v_id;
  return jsonb_build_object('tag_id', v_id, 'statut', 'rejete');
end $$;
revoke execute on function public.media_rattacher_joueur(uuid, uuid, boolean) from public, anon;
grant execute on function public.media_rattacher_joueur(uuid, uuid, boolean) to authenticated;

-- Ce qui attend une décision humaine, toutes galeries confondues : la file de travail de la
-- Production quand le moteur sera branché.
create or replace function public.media_suggestions_a_trancher(p_limite integer default 200)
returns table (tag_id uuid, album_id uuid, galerie text, asset_id uuid, preview_path text,
               player_id uuid, prenom text, nom text, score numeric, moteur text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, al.id, al.title, a.id, a.preview_path, p.id, p.prenom, p.nom, t.score, t.moteur
    from media_player_tags t
    join media_assets a on a.id = t.media_ref_id and t.media_ref_type = 'media_asset'
    join media_albums al on al.id = a.album_id
    join player_profiles p on p.id = t.player_id
   where t.statut = 'propose' and peut_marquer_galerie(al.id)
   order by t.score desc nulls last, t.created_at
   limit greatest(1, least(coalesce(p_limite, 200), 500));
$$;
revoke execute on function public.media_suggestions_a_trancher(integer) from public, anon;
grant execute on function public.media_suggestions_a_trancher(integer) to authenticated;
