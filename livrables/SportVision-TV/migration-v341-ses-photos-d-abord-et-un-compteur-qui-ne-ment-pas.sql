-- v341 — SES PHOTOS D'ABORD, ET UN COMPTEUR QUI NE MENT PAS (29/09/2026)
--
-- Deux défauts trouvés en jouant le parcours complet avec un vrai jeton de famille, pas avec la clé
-- de service. Aucun des deux ne se voyait en lisant le code.
--
-- ── 1. LES PHOTOS D'ÉQUIPE PASSAIENT AVANT LES SIENNES ─────────────────────────────────────────
--
-- `media_photos_du_joueur` triait par `photo_de_groupe desc`. C'était sans conséquence tant que les
-- photos d'équipe n'entraient jamais dans la galerie d'un joueur — ce que la v340 vient justement
-- de corriger. Résultat mesuré aussitôt : la famille qui n'a pas encore payé voit quatre photos, et
-- les quatre sont des photos d'équipe ; la photo où l'on voit SON numéro, elle, passe après.
--
-- Ce qu'une famille vient chercher, c'est son enfant. Une photo où il est identifié passe avant une
-- photo d'équipe où il est quelque part.
--
-- ── 2. « NOUS RELISONS 104 PHOTOS » ÉTAIT FAUX ─────────────────────────────────────────────────
--
-- La v340 comptait comme « restant à examiner » les photos sans numéro relevé. Or une photo de face,
-- une photo de banc de touche, un gros plan : il n'y a rien à y lire, et le lecteur est déjà passé
-- dessus. On annonçait donc une relecture de 104 photos déjà lues, et on mettait en file un travail
-- qui ne trouverait rien.
--
-- `numeros_lus_par` ne gardait le nom du lecteur QUE lorsqu'il trouvait quelque chose : impossible
-- de distinguer « pas encore regardé » de « regardé, rien à lire ». Il le garde désormais dans les
-- deux cas. Une saisie humaine reste reconnaissable à ce qu'elle laisse ce champ vide tout en
-- remplissant les numéros.
--
-- CE QUE ÇA APPORTE EN PLUS : le nom porte la VERSION du lecteur. Le jour où un meilleur lecteur
-- arrive, les photos examinées par l'ancien se représentent toutes seules, sans qu'on ait à penser
-- à vider quoi que ce soit.
--
-- Idempotente.

begin;

-- ── 1. SES PHOTOS D'ABORD ──────────────────────────────────────────────────────────────────────
create or replace function public.media_photos_du_joueur(p_album_id uuid, p_player_id uuid)
returns table(asset_id uuid, preview_path text, thumb_path text, preview_clair_path text,
              ordre integer, marque_par text, total integer, apercu_galerie boolean)
language sql stable security definer set search_path to 'public','pg_temp' as $f$
  with droit as (
    select media_voit_sans_filigrane(p_album_id) as clair
  ), autorise as (
    select 1
     where auth.uid() is not null
       and (
         ((is_own_player(p_player_id) or is_confirmed_parent_of(p_player_id))
          and public.media_galerie_concerne_le_joueur(p_album_id, p_player_id))
         or (media_upload_staff() and (not est_operateur_terrain() or photographe_voit_album(p_album_id)))
       )
  ), siennes as (
    select a.id, a.preview_path, a.thumb_path, a.preview_clair_path, a.position,
           coalesce(t.source, 'groupe') as source, a.photo_de_groupe,
           -- Ce qui la met dans sa galerie : un marquage à lui, ou le fait que ce soit une photo
           -- d'équipe. Le premier passe devant.
           (t.id is not null) as identifie
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
    select a.id, a.preview_path, a.thumb_path, a.preview_clair_path, a.position,
           null::text as source, a.photo_de_groupe, false as identifie
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
         case when (select clair from droit) then l.preview_clair_path else null end,
         l.position, l.source,
         (select n from compte),
         l.repli
    from lignes l
   -- Ce qu'une famille vient chercher, c'est son enfant : les photos où il est identifié d'abord,
   -- les photos d'équipe ensuite.
   order by l.repli, l.identifie desc, l.photo_de_groupe desc, l.position, l.id
   limit case when (select clair from droit) then null else 4 end;
$f$;

comment on function public.media_photos_du_joueur(uuid, uuid) is
  'v341 : ses photos identifiees d''abord, puis les photos d''equipe de la galerie, qui appartiennent a tout le monde. Repli de 4 photos pour qui n''a pas encore paye.';

-- ── 2. LE LECTEUR DIT QU'IL EST PASSÉ, MÊME QUAND IL NE TROUVE RIEN ────────────────────────────
create or replace function public.media_numeros_lus(
  p_asset_id uuid, p_numeros smallint[], p_lecteur text)
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_album uuid; v_nettoyes smallint[];
begin
  if auth.role() <> 'service_role' then
    raise exception 'Seul un lecteur automatique passe par ici. Les numéros saisis à la main vont dans media_numeros_de_la_photo.'
      using errcode = '42501';
  end if;
  if coalesce(trim(p_lecteur), '') = '' then
    raise exception 'Un lecteur doit se nommer : sans cela on ne saura pas quoi effacer le jour où il se trompe.'
      using errcode = '22023';
  end if;

  select album_id into v_album from media_assets where id = p_asset_id;
  if v_album is null then raise exception 'Photo introuvable.' using errcode = '22023'; end if;

  -- ON NE PASSE JAMAIS PAR-DESSUS UN HUMAIN : sa saisie vient de quelqu'un qui a regardé la photo.
  if exists (select 1 from media_assets
              where id = p_asset_id and numeros_lus_par is null and cardinality(numeros_visibles) > 0) then
    return 0;
  end if;

  v_nettoyes := array(select distinct n from unnest(coalesce(p_numeros,'{}'::smallint[])) n
                       where n between 1 and 99 order by n);

  perform set_config('sportvision.numeros_humains', 'on', true);
  -- ON GARDE LE NOM DU LECTEUR MÊME QUAND IL NE TROUVE RIEN. C'est ce qui distingue « pas encore
  -- regardé » de « regardé, rien à lire » — et sans cette distinction on annonce à une famille
  -- qu'on relit cent photos déjà lues.
  update media_assets
     set numeros_visibles = v_nettoyes,
         numeros_lus_par = p_lecteur,
         updated_at = now()
   where id = p_asset_id;
  perform set_config('sportvision.numeros_humains', 'off', true);

  return public.media_suggerer_par_numero(v_album);
end $f$;

comment on function public.media_numeros_lus(uuid, smallint[], text) is
  'v341 : la porte du lecteur automatique. Exige son nom ET SA VERSION, qu''elle garde meme quand il ne trouve rien — c''est ce qui permet de savoir ce qui reste a examiner, et de tout reexaminer quand un meilleur lecteur arrive.';

-- ── 3. LE COMPTEUR COMPTE CE QUI RESTE VRAIMENT À LIRE ─────────────────────────────────────────
--
-- SURCHARGE N'EST PAS REMPLACEMENT, et c'est la deuxième fois. `create or replace` avec un argument
-- de plus ne remplace rien : il crée une SECONDE fonction, et PostgREST répond alors 300 « function
-- overloading can be resolved » — l'application reçoit une erreur sur un appel qui marchait la
-- minute d'avant. On supprime donc explicitement l'ancienne signature.
drop function if exists public.media_declarer_mon_numero(uuid, uuid, smallint);

create or replace function public.media_declarer_mon_numero(
  p_album_id uuid, p_player_id uuid, p_numero smallint, p_lecteur text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_posees integer; v_conflit boolean; v_restantes integer;
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

  v_posees := public.media_suggerer_par_numero(p_album_id);

  -- CE QUI RESTE VRAIMENT À LIRE : les photos qu'AUCUN lecteur n'a encore examinées, ou qu'un
  -- lecteur plus ancien a examinées. Une photo déjà lue par le lecteur courant, même sans rien y
  -- trouver, n'est pas « en attente » : il n'y a rien à y lire.
  select count(*)::integer into v_restantes
    from media_assets x
   where x.album_id = p_album_id and x.status = 'ready'
     and cardinality(x.numeros_visibles) = 0
     -- Sans lecteur precise, « reste a lire » veut dire « jamais examinee par personne ». Avec un
     -- lecteur precise, une photo lue par une version plus ancienne redevient a lire : c'est ce qui
     -- fait qu'un meilleur lecteur repasse tout seul, sans qu'on ait a vider quoi que ce soit.
     and (case when p_lecteur is null then x.numeros_lus_par is null
               else x.numeros_lus_par is distinct from p_lecteur end);

  if v_restantes > 0
     and not exists (select 1 from reconnaissance_a_faire
                      where album_id = p_album_id and player_id = p_player_id and traite_le is null) then
    insert into reconnaissance_a_faire (album_id, player_id) values (p_album_id, p_player_id);
  end if;

  return jsonb_build_object(
    'numero', p_numero,
    'conflit', v_conflit,
    'photos_ajoutees', v_posees,
    'recherche_en_cours', v_restantes > 0,
    'photos_a_examiner', v_restantes,
    'photos_avec_ce_numero', (select count(*) from media_assets x
                               where x.album_id = p_album_id and x.status='ready'
                                 and p_numero = any(x.numeros_visibles)));
end $f$;

comment on function public.media_declarer_mon_numero(uuid, uuid, smallint, text) is
  'v341 : enregistre le numero, met tout de suite dans la galerie les photos ou ce numero est deja lu, et ne met en file que ce qui reste VRAIMENT a examiner. p_lecteur = la version du lecteur que l''application connait ; sans lui, on considere que tout ce qui n''a pas de numero reste a lire.';

grant execute on function public.media_declarer_mon_numero(uuid, uuid, smallint, text) to authenticated;

commit;
