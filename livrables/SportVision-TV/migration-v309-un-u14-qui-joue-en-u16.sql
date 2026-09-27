-- v309 — 27/09/2026 : un U14 qui joue en U16 doit pouvoir être reconnu
--
-- DEMANDE DE FOUKA : « parfois il se peut qu'il y a un U14 qui joue en U15 ou U16. Il faudrait quand
-- même que ça le reconnaisse automatiquement s'il a mis la reconnaissance faciale. Donc il y aura
-- parfois des joueurs qui vont pas appartenir à une catégorie, mais qui seront dans le match en
-- question. Après ça lui met une proposition, est-ce que c'est bien toi. »
--
-- CE QUI L'EMPÊCHAIT : six fonctions exigeaient que l'enfant soit membre actif de l'ÉQUIPE de la
-- galerie. Un surclassé était donc introuvable dans la galerie du match qu'il venait de jouer — ni la
-- reconnaissance ni un humain ne pouvaient le rattacher, et il n'apparaissait même pas dans la liste
-- proposée par l'OS.
--
-- LA FRONTIÈRE, ET ELLE N'EST PAS AU MÊME ENDROIT SELON LE GESTE. Un élargissement uniforme aurait
-- ouvert une brèche, donc les deux règles sont distinctes :
--
--   RATTACHER (staff, reconnaissance)   le CLUB de la galerie suffit
--                                       un humain ou un visage a constaté la présence
--   LIRE ET CONFIRMER (famille)         son équipe, OU un marquage qui existe déjà
--                                       elle répond à une proposition, elle ne la crée pas
--
-- POURQUOI PAS LE CLUB POUR LA FAMILLE AUSSI : parce que n'importe quelle famille du club lirait
-- alors n'importe quelle galerie du club — exactement ce que Fouka a refusé le matin même (« tout le
-- monde voit les galeries de tout le monde »). Et la déclaration de numéro (v305) reste volontairement
-- bornée à l'équipe : une famille ne doit pas pouvoir AFFIRMER une présence hors catégorie, sinon il
-- suffirait de deviner un numéro courant pour s'attacher à la photo d'un autre enfant. Hors
-- catégorie, le premier lien vient toujours d'un humain ou de la reconnaissance.
--
-- CE QUI NE BOUGE PAS : un enfant d'un AUTRE club reste impossible à rattacher, `peut_marquer_galerie`
-- réserve toujours le geste au staff et au club, et `can_access_asset` exige toujours un marquage
-- valide photo par photo.
--
-- Idempotent.

drop function if exists public.media_joueurs_de_galerie(uuid);

create or replace function public.media_joueur_du_club_de_la_galerie(p_album_id uuid, p_player_id uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $f$
  -- v309 : ce sportif appartient-il au CLUB de cette galerie ? Volontairement plus large que son
  -- equipe : Fouka, 27/09/2026 — « parfois il y a un U14 qui joue en U15 ou U16, il faudrait quand
  -- meme que ca le reconnaisse ». Un enfant surclasse reste un enfant du club.
  --
  -- Cette regle borne QUI PEUT ETRE RATTACHE par un humain ou par la reconnaissance. Elle ne borne
  -- PAS ce qu'une famille peut aller lire : ca reste media_galerie_concerne_le_joueur().
  select exists (
    select 1 from media_albums al
     join player_profiles p on p.club_id = al.club_id
    where al.id = p_album_id and p.id = p_player_id
      and al.club_id is not null
      and coalesce(p.account_status,'actif') <> 'retire');
$f$;

comment on function public.media_joueur_du_club_de_la_galerie(uuid, uuid) is
  'v309 : appartenance au CLUB de la galerie, et non a son equipe — un U14 surclasse en U16 doit pouvoir etre rattache. Borne le rattachement par un humain ou par la reconnaissance, jamais la lecture par une famille.';

CREATE OR REPLACE FUNCTION public.media_rattacher_joueur(p_asset_id uuid, p_player_id uuid, p_attacher boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_album uuid; v_id uuid; v_source text;
begin
  select album_id into v_album from media_assets where id = p_asset_id;
  if v_album is null then
    raise exception 'Photo introuvable.' using errcode = '22023';
  end if;
  if not peut_marquer_galerie(v_album) then
    raise exception 'Vous ne pouvez pas marquer les photos de cette galerie.' using errcode = '42501';
  end if;
  -- v309 — LE CLUB, ET NON L'EQUIPE. Fouka : « parfois il y a un U14 qui joue en U15 ou U16, il
  -- faudrait quand meme que ca le reconnaisse ». La version precedente exigeait l'equipe de la
  -- galerie : un enfant surclasse etait donc INTROUVABLE dans la galerie du match qu'il avait joue,
  -- et ni la reconnaissance ni un humain ne pouvaient le rattacher.
  --
  -- On garde la borne qui compte : un enfant d'un AUTRE club reste impossible a rattacher. Et le
  -- geste n'est pas ouvert a tout le monde — peut_marquer_galerie() ci-dessus le reserve au staff et
  -- au club.
  if not public.media_joueur_du_club_de_la_galerie(v_album, p_player_id) then
    raise exception 'Ce joueur n''appartient pas au club de cette galerie.' using errcode = '42501';
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
end $function$
;

CREATE OR REPLACE FUNCTION public.media_galerie_concerne_le_joueur(p_album_id uuid, p_player_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_album record;
  v_equipes uuid[];
begin
  select * into v_album from media_albums where id = p_album_id;
  if not found then return false; end if;

  v_equipes := array(
    select distinct e from unnest(
      coalesce(v_album.team_ids, '{}'::uuid[])
      || case when v_album.team_id is null then '{}'::uuid[] else array[v_album.team_id] end
    ) as e where e is not null
  );

  -- UNE GALERIE SANS AUCUNE EQUIPE NE CONCERNE AUCUNE FAMILLE. Elle se vend par son lien et se
  -- consulte dans Club+, ou le club est authentifie. C'est la regle posee par la v302, et elle vaut
  -- ici aussi : sinon la liste est bornee a l'equipe de l'enfant, mais le CONTENU reste accessible a
  -- qui connait un identifiant de galerie.
  -- UNE PRESENCE DEJA ETABLIE OUVRE LA GALERIE, meme hors categorie (v309).
  --
  -- Fouka : « parfois il y aura des joueurs qui vont pas appartenir a une categorie mais qui seront
  -- dans le match en question ». Un U14 qui a joue en U16 doit pouvoir voir SES photos dans la
  -- galerie U16 — et repondre « oui c'est bien moi ».
  --
  -- CE QUI OUVRE LA PORTE EST UN MARQUAGE QUI EXISTE DEJA, pose par un humain ou par la
  -- reconnaissance : quelqu'un, ou quelque chose, a constate sa presence. La famille ne peut pas
  -- l'affirmer elle-meme — sinon n'importe quelle famille du club lirait n'importe quelle galerie du
  -- club, ce que Fouka a refuse le matin meme. Elle repond a une proposition, elle ne la cree pas.
  if exists (
    select 1 from media_player_tags t
     join media_assets x on x.id = t.media_ref_id
    where t.media_ref_type = 'media_asset' and x.album_id = p_album_id
      and t.player_id = p_player_id and t.statut in ('propose','valide'))
  then
    return true;
  end if;

  if cardinality(v_equipes) = 0 then return false; end if;

  return exists (
    select 1 from team_memberships tm
     where tm.player_id = p_player_id and tm.statut = 'active'
       and tm.team_id = any(v_equipes));
end $function$
;

CREATE OR REPLACE FUNCTION public.media_famille_marque(p_asset_id uuid, p_player_id uuid, p_cest_lui boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$
;

CREATE FUNCTION public.media_joueurs_de_galerie(p_album_id uuid)
 RETURNS TABLE(player_id uuid, prenom text, nom text, nb_photos integer, reconnaissance boolean, hors_categorie boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- v309 : TOUT LE CLUB, et non la seule equipe de la galerie. Un U14 surclasse en U16 n'apparaissait
  -- pas dans cette liste : personne ne pouvait le rattacher a la galerie du match qu'il avait joue.
  -- `hors_categorie` le signale a l'ecran, pour qu'on sache qu'on sort de l'equipe de la galerie —
  -- et l'ordre remonte l'equipe de la galerie en premier, pour ne pas allonger le geste courant.
  select p.id, p.prenom, p.nom,
         (select count(*)::int from media_player_tags t
           join media_assets a on a.id = t.media_ref_id
          where t.media_ref_type = 'media_asset' and t.player_id = p.id
            and t.statut = 'valide' and a.album_id = p_album_id),
         consentement_biometrie_actif(p.id),
         not exists (
           select 1 from team_memberships tm
            join media_albums al2 on al2.id = p_album_id
           where tm.player_id = p.id and tm.statut = 'active'
             and (tm.team_id = al2.team_id or tm.team_id = any(coalesce(al2.team_ids,'{}'::uuid[])))
         ) as hors_categorie
    from media_albums al
    join player_profiles p on p.club_id = al.club_id
   where al.id = p_album_id and peut_marquer_galerie(p_album_id)
     and coalesce(p.account_status,'actif') <> 'retire'
   order by (not exists (
              select 1 from team_memberships tm
               join media_albums al3 on al3.id = p_album_id
              where tm.player_id = p.id and tm.statut = 'active'
                and (tm.team_id = al3.team_id or tm.team_id = any(coalesce(al3.team_ids,'{}'::uuid[])))
            )), p.nom, p.prenom;
$function$
;

grant execute on function public.media_joueur_du_club_de_la_galerie(uuid, uuid) to authenticated;
grant execute on function public.media_joueurs_de_galerie(uuid) to authenticated, service_role;
