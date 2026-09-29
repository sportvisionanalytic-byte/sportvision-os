-- v340 — LE PARCOURS DE LA FAMILLE, SANS QUESTIONNAIRE (29/09/2026)
--
-- CE QUE FOUKA DEMANDE, mot pour mot : « ça lui propose pas est-ce que c'est vous, est-ce que c'est
-- vous. C'est seulement s'il y a des doutes. Au plus possible et au plus proche, dès que tu es sûr,
-- boum, tu les mets dans sa galerie. Photos de groupe, tu les mets aussi. Dès qu'il renseigne son
-- numéro, tu lances la recherche et tu lui dis de revenir dans 5-10 minutes. »
--
-- Trois choses manquaient pour que ce parcours existe vraiment.
--
-- ── 1. LES PHOTOS DE GROUPE N'ARRIVAIENT NULLE PART ────────────────────────────────────────────
--
-- `media_assets.photo_de_groupe` existe depuis la v219, et le moteur le renseigne depuis le 29/09
-- (8 photos sur les 110 de la galerie de démonstration). Mais `media_photos_du_joueur` ne s'en
-- servait QUE POUR TRIER : une photo d'équipe n'entrait dans la galerie d'un joueur que si un
-- marquage individuel l'y mettait — c'est-à-dire presque jamais, puisque sur une photo à vingt-deux
-- têtes chaque visage fait quelques pixels et qu'aucun ne passe le seuil.
--
-- Une photo d'équipe appartient à toute l'équipe. On n'a pas besoin d'y reconnaître quelqu'un pour
-- savoir qu'il y est.
--
-- ── 2. UN NUMÉRO DÉCLARÉ NE VALAIT QU'UNE QUESTION ─────────────────────────────────────────────
--
-- La v305 PROPOSAIT les photos portant le numéro déclaré, et la famille devait confirmer une par
-- une. C'était prudent tant que la machine inventait les numéros — ce qu'elle faisait, et la v338
-- l'a arrêtée. Depuis, le lecteur est mesuré : 6 relevés sur 110 photos, 6 exacts, chacun vérifié en
-- ouvrant la photo.
--
-- Deux informations indépendantes se croisent ici : le numéro que la famille déclare pour SON enfant,
-- et le numéro que la machine lit sur le dos. Quand les deux coïncident, demander « est-ce bien
-- vous ? » revient à demander à quelqu'un de confirmer ce qu'il vient de dire.
--
-- CE QUI PROTÈGE ENCORE : deux sportifs qui revendiquent le même numéro sur le même match → on ne
-- propose rien (v305, inchangé) ; une décision déjà prise par la famille n'est jamais écrasée ; et
-- la famille peut toujours dire « ce n'est pas moi » (v329).
--
-- CE QU'ON TRACE : ces marquages portent `source = 'numero'`. Ils ne viennent ni d'un humain qui a
-- regardé la photo, ni du visage — et le moteur ne doit pas s'en servir pour apprendre : sur une
-- vue de dos, le seul visage de l'image est celui de quelqu'un d'autre.
--
-- ── 3. DÉCLARER SON NUMÉRO NE LANÇAIT RIEN ─────────────────────────────────────────────────────
--
-- La recherche ne portait que sur les numéros DÉJÀ relevés. Une galerie publiée cinq minutes plus
-- tôt n'en a aucun, et la famille recevait « rien trouvé » alors que rien n'avait encore été
-- cherché. On met désormais le travail en file, et on rend de quoi le dire honnêtement.
--
-- Idempotente.

begin;

-- ── La provenance « numéro » ───────────────────────────────────────────────────────────────────
alter table media_player_tags drop constraint if exists media_player_tags_source_check;
alter table media_player_tags add constraint media_player_tags_source_check
  check (source = any (array['humain','suggestion','famille','numero']));

-- ── 1. UNE PHOTO D'ÉQUIPE APPARTIENT À TOUTE L'ÉQUIPE ──────────────────────────────────────────
create or replace function public.media_photos_du_joueur(p_album_id uuid, p_player_id uuid)
returns table(asset_id uuid, preview_path text, thumb_path text, preview_clair_path text,
              ordre integer, marque_par text, total integer, apercu_galerie boolean)
language sql stable security definer set search_path to 'public','pg_temp' as $f$
  with droit as (
    select media_voit_sans_filigrane(p_album_id) as clair
  ), autorise as (
    -- v304 — LA FAMILLE DOIT AUSSI ÊTRE CONCERNÉE PAR CETTE GALERIE, et pas seulement être celle de
    -- l'enfant. Mesure du 27/09, avant correction : une famille de U18 R3 obtenait QUATRE PHOTOS
    -- d'une galerie U10 en passant simplement son identifiant.
    select 1
     where auth.uid() is not null
       and (
         ((is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id))
          and public.media_galerie_concerne_le_joueur(p_album_id, p_player_id))
         or (media_upload_staff() and (not est_operateur_terrain() or photographe_voit_album(p_album_id)))
       )
  ), siennes as (
    -- Une photo est la sienne si elle porte son marquage validé, OU si c'est une photo d'équipe
    -- qu'il n'a pas écartée. Le `left join` évite de la compter deux fois quand les deux sont vrais.
    select a.id, a.preview_path, a.thumb_path, a.preview_clair_path, a.position,
           coalesce(t.source, 'groupe') as source, a.photo_de_groupe
      from media_assets a
      join media_albums al on al.id = a.album_id
      left join media_player_tags t
        on t.media_ref_type = 'media_asset' and t.media_ref_id = a.id
       and t.player_id = p_player_id and t.statut = 'valide'
     where a.album_id = p_album_id
       and a.status = 'ready'
       and al.status = 'published'
       and exists (select 1 from autorise)
       and (
         t.id is not null
         or (a.photo_de_groupe and not exists (
               select 1 from media_player_tags r
                where r.media_ref_type = 'media_asset' and r.media_ref_id = a.id
                  and r.player_id = p_player_id and r.statut = 'rejete'))
       )
  ), toute_la_galerie as (
    -- Le repli. Il ne sert QUE si la famille n'a aucune photo ET n'a pas encore payé : celle qui a
    -- payé veut ses photos, pas une vitrine.
    select a.id, a.preview_path, a.thumb_path, a.preview_clair_path, a.position,
           null::text as source, a.photo_de_groupe
      from media_assets a
      join media_albums al on al.id = a.album_id
     where a.album_id = p_album_id
       and a.status = 'ready'
       and al.status = 'published'
       and exists (select 1 from autorise)
       and not (select clair from droit)
       and not exists (select 1 from siennes)
  ), lignes as (
    select *, false as repli from siennes
    union all
    select *, true  as repli from toute_la_galerie
  ), compte as (
    select count(*)::integer as n from lignes
  )
  select l.id, l.preview_path, l.thumb_path,
         -- Le chemin clair ne sort QUE pour qui y a droit.
         case when (select clair from droit) then l.preview_clair_path else null end,
         l.position, l.source,
         (select n from compte),
         l.repli
    from lignes l
   order by l.repli, l.photo_de_groupe desc, l.position, l.id
   limit case when (select clair from droit) then null else 4 end;
$f$;

comment on function public.media_photos_du_joueur(uuid, uuid) is
  'v340 : ses photos marquees, PLUS les photos d''equipe de la galerie, qui appartiennent a tout le monde. Repli de 4 photos pour qui n''a pas encore paye.';

-- ── 2. UN NUMÉRO DÉCLARÉ VAUT UNE IDENTIFICATION ───────────────────────────────────────────────
create or replace function public.media_suggerer_par_numero(p_album_id uuid)
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_posees integer := 0;
begin
  with litigieux as (
    -- Les numéros revendiqués par DEUX sportifs ou plus sur ce match : on ne met rien. Deviner
    -- entre deux enfants serait pire que ne rien mettre.
    select numero from media_numeros_de_match
     where album_id = p_album_id group by numero having count(distinct player_id) > 1
  ), a_poser as (
    select distinct x.id as asset_id, d.player_id
      from media_numeros_de_match d
      join media_assets x on x.album_id = p_album_id and x.status = 'ready'
       and d.numero = any(x.numeros_visibles)
     where d.album_id = p_album_id
       and d.numero not in (select numero from litigieux)
       -- On ne repasse jamais par-dessus une décision déjà prise : ni un marquage validé, ni un
       -- refus. Une famille qui a dit « ce n'est pas moi » ne doit pas se le voir remettre.
       and not exists (
         select 1 from media_player_tags t
          where t.media_ref_type = 'media_asset' and t.media_ref_id = x.id
            and t.player_id = d.player_id and t.statut in ('valide','rejete'))
  )
  insert into media_player_tags (media_ref_type, media_ref_id, player_id, tagged_by, source, statut,
                                 valide_par, valide_le)
  select 'media_asset', asset_id, player_id, auth.uid(), 'numero', 'valide', auth.uid(), now()
    from a_poser
  on conflict (media_ref_type, media_ref_id, player_id) do update
     set source = 'numero', statut = 'valide', valide_par = auth.uid(), valide_le = now()
   where media_player_tags.statut = 'propose';

  get diagnostics v_posees = row_count;
  return v_posees;
end $f$;

comment on function public.media_suggerer_par_numero(uuid) is
  'v340 : croise « on lit le 7 sur cette photo » et « j''etais le 7 a ce match » et MET la photo dans la galerie de la famille, sans lui redemander. Ne touche jamais a une decision deja prise, et ne met rien quand deux sportifs revendiquent le meme numero.';

-- ── 3. DÉCLARER SON NUMÉRO LANCE LA RECHERCHE ──────────────────────────────────────────────────
create or replace function public.media_declarer_mon_numero(
  p_album_id uuid, p_player_id uuid, p_numero smallint)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_posees integer; v_conflit boolean; v_restantes integer; v_en_cours boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '42501';
  end if;
  if not (is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id)) then
    raise exception 'Ce sportif n''est pas rattaché à votre compte.' using errcode = '42501';
  end if;
  if not public.media_galerie_concerne_le_joueur(p_album_id, p_player_id) then
    raise exception 'Cette galerie ne concerne pas ce sportif.' using errcode = '42501';
  end if;
  if p_numero is null or p_numero < 1 or p_numero > 99 then
    raise exception 'Un numéro de maillot est entre 1 et 99.' using errcode = '22023';
  end if;

  insert into media_numeros_de_match (album_id, player_id, numero, declare_par)
  values (p_album_id, p_player_id, p_numero, auth.uid())
  on conflict (album_id, player_id)
    do update set numero = excluded.numero, declare_par = excluded.declare_par, updated_at = now();

  v_conflit := exists (
    select 1 from media_numeros_de_match
     where album_id = p_album_id and numero = p_numero and player_id <> p_player_id);

  -- Ce qu'on peut faire TOUT DE SUITE, avec les numéros déjà relevés.
  v_posees := public.media_suggerer_par_numero(p_album_id);

  -- ET CE QU'IL RESTE À CHERCHER. Le lecteur de dossards ne passe qu'une fois par photo ; une
  -- galerie publiée il y a cinq minutes n'a encore rien de relevé, et répondre « rien trouvé »
  -- à quelqu'un dont on n'a rien cherché, c'est lui faire croire qu'il n'y a rien.
  select count(*)::integer into v_restantes
    from media_assets x
   where x.album_id = p_album_id and x.status = 'ready'
     and x.numeros_lus_par is null and cardinality(x.numeros_visibles) = 0;

  if v_restantes > 0 then
    -- On met le travail en file, sans l'empiler : une demande en attente suffit.
    if not exists (select 1 from reconnaissance_a_faire
                    where album_id = p_album_id and player_id = p_player_id and traite_le is null) then
      insert into reconnaissance_a_faire (album_id, player_id) values (p_album_id, p_player_id);
    end if;
    v_en_cours := true;
  else
    v_en_cours := false;
  end if;

  return jsonb_build_object(
    'numero', p_numero,
    'conflit', v_conflit,
    'photos_ajoutees', v_posees,
    'recherche_en_cours', v_en_cours,
    'photos_a_examiner', v_restantes,
    'photos_avec_ce_numero', (select count(*) from media_assets x
                               where x.album_id = p_album_id and x.status='ready'
                                 and p_numero = any(x.numeros_visibles)));
end $f$;

comment on function public.media_declarer_mon_numero(uuid, uuid, smallint) is
  'v340 : enregistre le numero, met tout de suite les photos deja relevees dans la galerie de la famille, et met le reste de la galerie en file de lecture. Rend recherche_en_cours pour que l''ecran puisse dire « revenez dans quelques minutes » au lieu de « rien trouve ».';

commit;
