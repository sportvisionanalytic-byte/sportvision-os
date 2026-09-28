-- v317 — 28/09/2026 : une galerie multi-catégories ne reconnaissait que sa première équipe
--
-- LA MESURE D'ABORD. Sur les 49 galeries réelles : 11 portent un `team_id`, 5 portent des
-- `team_ids`, et les 5 qui en portent ne contiennent JAMAIS leur propre `team_id` dedans.
-- `team_ids` liste donc les équipes SUPPLÉMENTAIRES, jamais l'ensemble. L'ensemble des équipes
-- d'une galerie est l'UNION des deux, et lire l'un sans l'autre voit une galerie incomplète.
--
-- CETTE UNION ÉTAIT ÉCRITE CINQ FOIS, caractère pour caractère, dans can_access_media,
-- media_droit_paye, media_club_voit_la_galerie, media_galerie_concerne_le_joueur et
-- media_voit_sans_filigrane. Et QUATRE AUTRES fonctions ne faisaient que la moitié du travail,
-- chacune avec sa propre lecture de `al.team_id` seul. Sur une galerie U14 + U16 :
--
--   reconnaissance_joueurs_prets   ne proposait AUCUN joueur U16 au marquage
--   visage_rapprocher_direct       n'ajoutait aucun visage U16 à la comparaison, donc ne le trouvait jamais
--   marquer_par_reconnaissance     refusait un joueur U16 : « ne fait pas partie de l'équipe de cette galerie »
--   media_marquages_famille        cachait les marquages au coach de l'équipe U16
--
-- C'est l'exact contraire de la v309, qui autorise la famille d'un surclassé à voir et à confirmer
-- ses photos d'un match d'une autre catégorie : le côté famille était ouvert, le côté staff fermé.
-- Personne ne pouvait donc poser le marquage que la famille était censée confirmer.
--
-- LA CORRECTION EST STRUCTURELLE, pas locale : la règle sort dans UNE fonction,
-- `media_equipes_de_la_galerie`, et les neuf endroits l'appellent. Trois régressions de la journée
-- venaient déjà d'une règle recopiée qui avait divergé (media_droit_paye,
-- media_club_voit_la_galerie, media_galerie_concerne_le_joueur) — la quatrième occurrence de ce
-- motif en un jour. Neuf copies d'une règle, c'est neuf endroits où la prochaine décision métier
-- devra être portée, et un oubli suffit.
--
-- CE QUE LA CORRECTION NE FAIT PAS : élargir la borne. Un joueur d'AUCUNE des équipes de la
-- galerie reste refusé, et le test le vérifie explicitement — sans ce contrôle, « réparer »
-- l'union pourrait tout ouvrir sans que rien ne le signale.
--
-- Idempotent.

-- ── La règle, à un seul endroit ─────────────────────────────────────────────────────────────────
create or replace function public.media_equipes_de_la_galerie(p_album_id uuid)
returns uuid[] language sql stable security definer set search_path to 'public','pg_temp' as $f$
  select array(
    select distinct e from unnest(
      coalesce(al.team_ids, '{}'::uuid[])
      || case when al.team_id is null then '{}'::uuid[] else array[al.team_id] end
    ) as e where e is not null
  )
    from media_albums al where al.id = p_album_id;
$f$;

comment on function public.media_equipes_de_la_galerie(uuid) is
  'Toutes les equipes d''une galerie : team_id (principale) ET team_ids (supplementaires). Mesure du '
  '28/09/2026 : team_ids ne contient jamais team_id, donc lire l''un sans l''autre voit une galerie '
  'incomplete. Cette fonction est la SEULE ecriture de cette regle : ne pas la recopier.';

grant execute on function public.media_equipes_de_la_galerie(uuid) to authenticated, anon;

-- ── 1. Les joueurs proposés au marquage ─────────────────────────────────────────────────────────
create or replace function public.reconnaissance_joueurs_prets(p_album_id uuid)
returns table(player_id uuid, joueur text, chemin_photo text, a_une_empreinte boolean)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $function$
declare v_teams uuid[];
begin
  if not peut_marquer_galerie(p_album_id) then
    raise exception 'Non autorisé.' using errcode = '42501';
  end if;
  v_teams := public.media_equipes_de_la_galerie(p_album_id);

  return query
  select p.id,
         coalesce(nullif(btrim(p.prenom || ' ' || p.nom), ''), 'Sportif'),
         r.storage_path,
         exists (select 1 from visages_reference vr where vr.player_id = p.id)
    from player_profiles p
    join team_memberships tm on tm.player_id = p.id and tm.statut = 'active'
    left join lateral (
      select fr.storage_path from player_face_refs fr
       where fr.player_id = p.id order by fr.created_at desc limit 1
    ) r on true
   where coalesce(cardinality(v_teams), 0) > 0
     and tm.team_id = any(v_teams)
     -- L'accord d'abord : un joueur sans consentement n'entre jamais dans le rapprochement.
     and consentement_biometrie_actif(p.id)
   group by p.id, p.prenom, p.nom, r.storage_path
   order by 2;
end $function$;

-- ── 2. Le rapprochement de visage ───────────────────────────────────────────────────────────────
create or replace function public.visage_rapprocher_direct(p_asset_id uuid, p_empreinte vector, p_modele text, p_seuil numeric default 0.55)
returns table(player_id uuid, distance numeric)
language plpgsql stable security definer set search_path to 'public','extensions','pg_temp' as $function$
declare v_teams uuid[]; v_album uuid;
begin
  select a.album_id into v_album
    from media_assets a where a.id = p_asset_id;
  if v_album is null then
    raise exception 'Photo introuvable.' using errcode = '22023';
  end if;
  if not peut_marquer_galerie(v_album) then
    raise exception 'Non autorisé.' using errcode = '42501';
  end if;
  v_teams := public.media_equipes_de_la_galerie(v_album);

  -- On ne compare qu'aux joueurs des équipes de cette galerie — TOUTES ses équipes, y compris les
  -- supplémentaires — et seulement à ceux dont l'accord est en cours. Un visage ne peut donc être
  -- rapproché ni d'un enfant d'un autre club, ni de quelqu'un qui n'a rien autorisé.
  return query
  select r.player_id, min(p_empreinte <=> r.empreinte)::numeric as d
    from visages_reference r
   where r.modele = p_modele
     and consentement_biometrie_actif(r.player_id)
     and (coalesce(cardinality(v_teams), 0) = 0 or exists (
           select 1 from team_memberships tm
            where tm.team_id = any(v_teams) and tm.player_id = r.player_id and tm.statut = 'active'))
   group by r.player_id
  having min(p_empreinte <=> r.empreinte) < p_seuil
   order by d
   limit 3;
end $function$;

-- ── 3. Poser le marquage ────────────────────────────────────────────────────────────────────────
create or replace function public.marquer_par_reconnaissance(p_asset_id uuid, p_player_id uuid, p_distance numeric, p_modele text, p_certain boolean)
returns uuid language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_album uuid; v_teams uuid[]; v_id uuid;
begin
  select a.album_id into v_album
    from media_assets a where a.id = p_asset_id;
  if v_album is null then
    raise exception 'Photo introuvable.' using errcode = '22023';
  end if;
  if not peut_marquer_galerie(v_album) then
    raise exception 'Non autorisé.' using errcode = '42501';
  end if;
  if not consentement_biometrie_actif(p_player_id) then
    raise exception 'Ce sportif n''a pas autorisé la reconnaissance.' using errcode = '42501';
  end if;
  v_teams := public.media_equipes_de_la_galerie(v_album);
  if coalesce(cardinality(v_teams), 0) > 0 and not exists (
    select 1 from team_memberships tm
     where tm.team_id = any(v_teams) and tm.player_id = p_player_id and tm.statut = 'active') then
    raise exception 'Ce sportif ne fait partie d''aucune des équipes de cette galerie.' using errcode = '42501';
  end if;

  -- Un marquage posé par un humain fait foi : la machine ne le contredit pas.
  select id into v_id from media_player_tags
   where media_ref_type = 'media_asset' and media_ref_id = p_asset_id and player_id = p_player_id;
  if found then
    return v_id;
  end if;

  insert into media_player_tags (media_ref_type, media_ref_id, player_id, tagged_by, source, statut,
                                 score, moteur, valide_par, valide_le)
  values ('media_asset', p_asset_id, p_player_id, auth.uid(), 'suggestion',
          -- Au-dessus du seuil de certitude, le marquage vaut ; en dessous, il attend un humain.
          case when p_certain then 'valide' else 'propose' end,
          p_distance, p_modele,
          case when p_certain then auth.uid() end,
          case when p_certain then now() end)
  returning id into v_id;
  return v_id;
end $function$;

-- ── 4. Ce que l'encadrement du club voit des marquages des familles ─────────────────────────────
create or replace function public.media_marquages_famille(p_album_id uuid)
returns table(asset_id uuid, player_id uuid, joueur text, marque_le timestamptz, marque_par uuid,
              total_photos_album integer, photos_marquees_par_cette_famille integer)
language sql stable security definer set search_path to 'public','pg_temp' as $function$
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
     -- l'encadrement du club pour N'IMPORTE LAQUELLE des équipes concernées. Le coach de l'équipe
     -- supplémentaire d'une galerie U14 + U16 en fait partie : c'est son équipe aussi.
     and (
       peut_marquer_galerie(p_album_id)
       or exists (select 1 from unnest(public.media_equipes_de_la_galerie(p_album_id)) e
                   where is_team_educateur(e))
     )
   order by t.valide_le desc;
$function$;

-- ── 5. La variable morte de media_famille_marque ────────────────────────────────────────────────
-- `v_team` y était lue et jamais utilisée : la fonction délègue correctement à
-- media_galerie_concerne_le_joueur. Une variable qui porte une règle sans l'appliquer se fait
-- prendre pour la règle à la lecture suivante — c'est ce qui m'a fait suspecter cette fonction
-- avant de vérifier. On la retire.
create or replace function public.media_famille_marque(p_asset_id uuid, p_player_id uuid, p_cest_lui boolean)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_album uuid;
  v_existant uuid;
  v_source text;
begin
  if not (is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id)) then
    raise exception 'Vous ne pouvez identifier que votre propre sportif.' using errcode = '42501';
  end if;

  select a.album_id into v_album
    from media_assets a join media_albums al on al.id = a.album_id
   where a.id = p_asset_id and a.status = 'ready' and al.status = 'published';
  if v_album is null then
    raise exception 'Photo introuvable.' using errcode = '22023';
  end if;

  -- v309 : la famille peut repondre partout ou elle a le droit de LIRE, et nulle part ailleurs. La
  -- meme regle que sa liste et que ses photos, donc une seule ecriture (media_galerie_concerne_le_joueur) :
  -- son equipe, ou une galerie ou sa presence a deja ete constatee par un humain ou par la
  -- reconnaissance. Un enfant surclasse peut ainsi confirmer ses photos d'un match U16.
  --
  -- Ce qu'elle ne peut TOUJOURS pas faire : se marquer d'elle-meme sur une galerie d'une autre
  -- categorie ou rien ne la relie. Elle repond a une proposition, elle ne la cree pas.
  if not public.media_galerie_concerne_le_joueur(v_album, p_player_id) then
    raise exception 'Cette galerie ne concerne pas votre sportif.' using errcode = '42501';
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
end $function$;
