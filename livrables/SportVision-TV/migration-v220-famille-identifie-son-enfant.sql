-- v220 — La famille identifie son enfant sur les photos (14/09/2026, décision de Fouka).
--
-- LE PROBLÈME QUE ÇA RÈGLE. Le modèle « mes photos » (v219) suppose que chaque photo porte le
-- marquage des joueurs qui y figurent. Jusqu'ici, seul le staff pouvait marquer : soixante photos
-- et quinze joueurs après chaque match, c'est le travail qui conditionne la vente, et il retombait
-- entièrement sur l'opérateur. Une photo non marquée n'est vue par personne, donc jamais achetée.
--
-- LA DÉCISION. Ce sont les familles qui identifient leur enfant — elles le font mieux et plus vite
-- que quiconque. Fouka, sur les deux options possibles : on leur montre les photos et elles disent
-- « c'est mon enfant ». Pas de reconnaissance faciale : aucune donnée biométrique n'est traitée
-- ici, donc ni consentement au sens de l'article 9 du RGPD, ni analyse d'impact, ni moteur à
-- héberger. Le socle biométrique du 12/09 reste en place pour plus tard, inutilisé.
--
-- Effet du marquage : IMMÉDIAT (décision de Fouka). La famille n'attend pas après avoir payé. Le
-- contrôle vient ensuite : le coach et SportVision voient qui a marqué quoi, et peuvent corriger.
--
-- CE QUE ÇA IMPLIQUE, ET QUI EST ASSUMÉ. Pour dire « c'est mon enfant », il faut voir les photos.
-- Une famille voit donc les APERÇUS FILIGRANÉS de la galerie de l'équipe de son enfant — des
-- photos de l'équipe où joue son enfant, jamais d'un autre club, et jamais en qualité
-- téléchargeable. Ce qu'elle peut TÉLÉCHARGER reste strictement ce que dit la v219 : ses photos
-- marquées et les photos de groupe.
--
-- Idempotente.

-- ── 1. Ce qu'on montre à une famille pour qu'elle identifie ──────────────────
create or replace function public.media_galerie_a_identifier(p_album_id uuid, p_player_id uuid)
returns table(asset_id uuid, preview_path text, thumb_path text, ordre integer,
              de_groupe boolean, mienne boolean, marquee_par_une_autre boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select a.id, a.preview_path, a.thumb_path, a.position,
         a.photo_de_groupe,
         exists (select 1 from media_player_tags t
                  where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
                    and t.player_id = p_player_id and t.statut = 'valide'),
         exists (select 1 from media_player_tags t
                  where t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
                    and t.player_id <> p_player_id and t.statut = 'valide')
    from media_assets a
    join media_albums al on al.id = a.album_id
   where a.album_id = p_album_id
     and a.status = 'ready'
     and al.status = 'published'
     and auth.uid() is not null
     -- Seule la famille de CE joueur, et seulement si l'enfant est bien dans l'équipe de la
     -- galerie : on ne montre pas les photos d'une équipe où il ne joue pas.
     and (is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id))
     and (
       al.team_id is null
       or exists (select 1 from team_memberships tm
                   where tm.team_id = al.team_id and tm.player_id = p_player_id and tm.statut = 'active')
     )
   order by a.position, a.id;
$$;

comment on function public.media_galerie_a_identifier(uuid, uuid) is
  'v220 — Les aperçus d''une galerie, montrés à la famille pour qu''elle identifie son enfant. Ne donne aucun accès au fichier original.';

-- ── 2. La famille marque, ou retire son marquage ─────────────────────────────
create or replace function public.media_famille_marque(p_asset_id uuid, p_player_id uuid, p_cest_lui boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_album uuid;
  v_team uuid;
  v_existant uuid;
  v_source text;
begin
  if not (is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id)) then
    raise exception 'Vous ne pouvez identifier que votre propre sportif.' using errcode = '42501';
  end if;

  select a.album_id, al.team_id into v_album, v_team
    from media_assets a join media_albums al on al.id = a.album_id
   where a.id = p_asset_id and a.status = 'ready' and al.status = 'published';
  if v_album is null then
    raise exception 'Photo introuvable.' using errcode = '22023';
  end if;

  -- L'enfant doit jouer dans l'équipe de la galerie. Sans ce contrôle, une famille pourrait se
  -- marquer sur les photos de n'importe quelle équipe du club.
  if v_team is not null and not exists (
    select 1 from team_memberships tm
     where tm.team_id = v_team and tm.player_id = p_player_id and tm.statut = 'active')
  then
    raise exception 'Votre sportif ne fait pas partie de l''équipe de cette galerie.' using errcode = '42501';
  end if;

  select id, source into v_existant, v_source from media_player_tags
   where media_ref_type = 'media_asset' and media_ref_id = p_asset_id and player_id = p_player_id;

  if p_cest_lui then
    if v_existant is null then
      insert into media_player_tags (media_ref_type, media_ref_id, player_id, tagged_by, source, statut, valide_par, valide_le)
      values ('media_asset', p_asset_id, p_player_id, auth.uid(), 'famille', 'valide', auth.uid(), now());
    else
      update media_player_tags
         set statut = 'valide', valide_par = auth.uid(), valide_le = now()
       where id = v_existant;
    end if;
    return jsonb_build_object('marque', true);
  end if;

  -- Retirer : une famille ne défait QUE son propre marquage. Un marquage posé par SportVision ou
  -- par le coach reste — sinon on pourrait effacer le travail de celui qui a livré la galerie.
  if v_existant is not null and v_source = 'famille' then
    delete from media_player_tags where id = v_existant;
    return jsonb_build_object('marque', false);
  end if;
  if v_existant is not null then
    raise exception 'Ce marquage a été posé par le club ou par SportVision : demandez-leur de le retirer.'
      using errcode = '42501';
  end if;
  return jsonb_build_object('marque', false);
end $$;

comment on function public.media_famille_marque(uuid, uuid, boolean) is
  'v220 — Une famille identifie son sportif sur une photo. Effet immédiat, tracé, contrôlable ensuite par le club et SportVision.';

-- ── 3. Le contrôle, pour le coach et SportVision ─────────────────────────────
create or replace function public.media_marquages_famille(p_album_id uuid)
returns table(asset_id uuid, player_id uuid, joueur text, marque_le timestamptz, marque_par uuid,
              total_photos_album integer, photos_marquees_par_cette_famille integer)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select t.media_ref_id, t.player_id,
         coalesce(nullif(btrim(p.prenom || ' ' || p.nom), ''), 'Sportif'),
         t.valide_le, t.valide_par,
         (select count(*)::integer from media_assets x where x.album_id = p_album_id and x.status = 'ready'),
         (select count(*)::integer from media_player_tags t2
            join media_assets a2 on a2.id = t2.media_ref_id
           where a2.album_id = p_album_id and t2.player_id = t.player_id
             and t2.source = 'famille' and t2.statut = 'valide')
    from media_player_tags t
    join media_assets a on a.id = t.media_ref_id
    join player_profiles p on p.id = t.player_id
   where a.album_id = p_album_id
     and t.media_ref_type = 'media_asset'
     and t.source = 'famille'
     and t.statut = 'valide'
     -- Réservé à qui encadre cette galerie : le staff SportVision dans son périmètre, ou
     -- l'encadrement du club pour l'équipe concernée.
     and (
       peut_marquer_galerie(p_album_id)
       or exists (select 1 from media_albums al
                   where al.id = p_album_id and al.team_id is not null and is_team_educateur(al.team_id))
     )
   order by t.valide_le desc;
$$;

comment on function public.media_marquages_famille(uuid) is
  'v220 — Qui a identifié qui, et sur combien de photos : le contrôle a posteriori des marquages faits par les familles.';

revoke all on function public.media_galerie_a_identifier(uuid, uuid) from public;
revoke all on function public.media_famille_marque(uuid, uuid, boolean) from public;
revoke all on function public.media_marquages_famille(uuid) from public;
grant execute on function public.media_galerie_a_identifier(uuid, uuid) to authenticated;
grant execute on function public.media_famille_marque(uuid, uuid, boolean) to authenticated;
grant execute on function public.media_marquages_famille(uuid) to authenticated;
