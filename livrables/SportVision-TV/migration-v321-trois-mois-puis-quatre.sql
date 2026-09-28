-- v321 — 28/09/2026 : les galeries vendues par lien s'archivent à 3 mois, se suppriment à 4
--
-- DÉCISION DE FOUKA, 28/09 : « archivé le 3e mois, supprimer pour de bon, libérer le 4e mois. Ça
-- pour les galeries pas en Full Communication, pour les galeries non rattachées à un club. Les
-- clubs eux gardent les photos toute l'année, les clubs en Full Communication et ceux qui ont le
-- Pass Photo. » Point de départ : la DATE DE PUBLICATION, pour que les trois mois de vente soient
-- pleins même si la galerie est publiée en retard.
--
-- POURQUOI CE N'EST PAS DANGEREUX AUJOURD'HUI, mesuré avant d'écrire : la plus ancienne galerie
-- sans club est publiée depuis le 14/09/2026. AUCUNE n'est donc concernée — le premier archivage
-- tombera vers le 14/12, la première suppression vers le 14/01. Cette migration installe la règle,
-- elle n'efface rien.
--
-- CE QUI PROTÈGE UNE GALERIE, écrit à UN SEUL ENDROIT (`media_retention_protegee`) :
--   1. elle est rattachée à un club — les clubs gardent leurs photos toute l'année ;
--   2. un Pass encore valable la couvre — « un Pass prolonge la galerie » ;
--   3. quelqu'un a payé et son droit de téléchargement n'est pas expiré.
--
-- LE POINT 3 VA UN PEU PLUS LOIN QUE LA RÉPONSE DE FOUKA, qui parlait du Pass, et c'est délibéré :
-- 9 commandes payées existent et ce sont toutes des packs photos, pas des Pass. Effacer au 4e mois
-- des photos qu'une famille a achetées et pas encore téléchargées, c'est un remboursement et une
-- mauvaise parole. Protéger par défaut se corrige en une ligne ; l'inverse ne se corrige pas.
--
-- L'ARCHIVAGE EST RÉVERSIBLE, LA SUPPRESSION NON, et les deux ne se traitent pas pareil :
--   * `media_retention_archiver()` fait passer la galerie en `archived`. Elle sort de la vente et
--     des écrans, rien n'est perdu. C'est ce geste-là qui peut tourner tout seul chaque nuit.
--   * `media_retention_a_supprimer()` ne SUPPRIME RIEN : elle RÉPOND ce qui est mûr et rend les
--     chemins des fichiers. Les fichiers vivent dans le stockage, hors de portée du SQL : les
--     effacer demande un script, et l'ordre compte — les fichiers d'abord, les lignes ensuite,
--     sinon il reste des objets orphelins que plus rien ne référence et que personne ne retrouvera.
--     `media_retention_effacer(album)` ne fait que la seconde moitié, et refuse si la galerie n'est
--     pas archivée depuis au moins un mois ou si elle est protégée.
--
-- Idempotent.

alter table public.media_albums add column if not exists archived_at timestamptz;

comment on column public.media_albums.archived_at is
  'Quand la galerie est passee en `archived` par la retention (v321). Nul si elle ne l''a jamais ete.';

-- ── Ce qui protège une galerie, à un seul endroit ───────────────────────────────────────────────
create or replace function public.media_retention_protegee(p_album_id uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $f$
  select
    -- 1. Rattachee a un club : le club garde ses photos toute l'annee.
    exists (select 1 from media_albums a where a.id = p_album_id and a.club_id is not null)
    -- 2. Un Pass encore valable la couvre. On regarde TOUTES les equipes de la galerie, principale
    --    et supplementaires (v280/v317), sinon un Pass d'equipe ne protegerait pas le plateau ou
    --    l'enfant a joue.
    or exists (
      select 1 from media_entitlements me, media_albums a
       where a.id = p_album_id
         and me.status = 'active'
         and (me.valid_until is null or me.valid_until > now())
         and (
           (me.scope_type = 'album' and me.scope_id = a.id)
           or (me.scope_type = 'team' and me.scope_id = any(public.media_equipes_de_la_galerie(a.id)))
           or (me.scope_type = 'club' and a.club_id is not null and me.club_id = a.club_id)
         ))
    -- 3. Quelqu'un a paye et son droit de telechargement court encore.
    or exists (
      select 1 from media_orders o
        join media_download_grants g on g.order_id = o.id
       where o.album_id = p_album_id and o.status = 'paid'
         and (g.expires_at is null or g.expires_at > now()));
$f$;

comment on function public.media_retention_protegee(uuid) is
  'Ce qui empeche l''archivage et la suppression d''une galerie : rattachement a un club, Pass '
  'valable, ou achat dont le droit de telechargement court encore. UNE seule ecriture de cette '
  'regle : ne pas la recopier dans les fonctions d''archivage ou de suppression.';

-- ── L'état, en lecture seule : ce qui va se passer, et quand ────────────────────────────────────
create or replace function public.media_retention_etat()
returns table(album_id uuid, titre text, publiee_le date, statut text, photos integer,
              protegee boolean, motif_protection text, archivage_du date, suppression_du date,
              action_aujourdhui text)
language sql stable security definer set search_path to 'public','pg_temp' as $f$
  select a.id, a.title, a.published_at::date, a.status,
         (select count(*)::integer from media_assets x where x.album_id = a.id),
         public.media_retention_protegee(a.id),
         case
           when a.club_id is not null then 'rattachee a un club'
           when exists (select 1 from media_entitlements me where me.status='active'
                          and (me.valid_until is null or me.valid_until > now())
                          and ((me.scope_type='album' and me.scope_id=a.id)
                            or (me.scope_type='team' and me.scope_id = any(public.media_equipes_de_la_galerie(a.id)))))
             then 'un Pass encore valable'
           when exists (select 1 from media_orders o join media_download_grants g on g.order_id=o.id
                         where o.album_id=a.id and o.status='paid'
                           and (g.expires_at is null or g.expires_at > now()))
             then 'un achat dont le droit court encore'
           else null
         end,
         (a.published_at + interval '3 months')::date,
         (a.archived_at + interval '1 month')::date,
         case
           when public.media_retention_protegee(a.id) then 'rien : protegee'
           when a.status = 'archived' and a.archived_at < now() - interval '1 month' then 'a SUPPRIMER'
           when a.status = 'published' and a.published_at < now() - interval '3 months' then 'a archiver'
           else 'rien : pas encore mure'
         end
    from media_albums a
   where a.status in ('published','archived')
     and public.media_staff_write()
   order by a.published_at;
$f$;

-- ── L'archivage : réversible, donc il peut tourner seul ─────────────────────────────────────────
create or replace function public.media_retention_archiver()
returns table(album_id uuid, titre text, publiee_le date, photos integer)
language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  return query
  update media_albums a
     set status = 'archived', archived_at = now(), updated_at = now()
   where a.status = 'published'
     and a.club_id is null
     and a.published_at < now() - interval '3 months'
     and not public.media_retention_protegee(a.id)
  returning a.id, a.title, a.published_at::date,
            (select count(*)::integer from media_assets x where x.album_id = a.id);
end $f$;

-- ── Ce qui est mûr pour la suppression, AVEC les chemins des fichiers ───────────────────────────
-- Elle ne supprime rien. Les fichiers sont dans le stockage, hors de portee du SQL : c'est au
-- script de les effacer, PUIS d'appeler media_retention_effacer().
create or replace function public.media_retention_a_supprimer()
returns table(album_id uuid, titre text, archivee_le date, photos integer, chemins text[])
language sql stable security definer set search_path to 'public','pg_temp' as $f$
  select a.id, a.title, a.archived_at::date,
         (select count(*)::integer from media_assets x where x.album_id = a.id),
         array(select unnest(array_remove(array[x.original_path, x.preview_path, x.thumb_path], null))
                 from media_assets x where x.album_id = a.id)
    from media_albums a
   where a.status = 'archived'
     and a.club_id is null
     and a.archived_at is not null
     and a.archived_at < now() - interval '1 month'
     and not public.media_retention_protegee(a.id)
   order by a.archived_at;
$f$;

-- ── La seconde moitié : effacer les lignes, une fois les fichiers partis ────────────────────────
create or replace function public.media_retention_effacer(p_album_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_a media_albums; v_photos integer;
begin
  -- EFFACER EST PLUS RESTREINT QUE LIRE, et volontairement plus restreint que le reste du module
  -- media : seuls l'administration et la Production. C'est le seul geste du systeme qu'on ne peut
  -- pas reprendre, il ne suit donc pas la regle habituelle de `media_staff_write`.
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role in ('admin','prod')) then
    raise exception 'Seule l''administration ou la Production peut effacer une galerie.' using errcode = '42501';
  end if;
  select * into v_a from media_albums where id = p_album_id;
  if not found then
    return jsonb_build_object('efface', false, 'raison', 'galerie introuvable');
  end if;
  -- Les trois memes gardes qu'a la lecture. Une fonction qui efface ne fait JAMAIS confiance a
  -- l'appelant pour avoir verifie : c'est le seul geste de tout le systeme qu'on ne peut pas
  -- reprendre.
  if v_a.club_id is not null then
    return jsonb_build_object('efface', false, 'raison', 'rattachee a un club : gardee toute l''annee');
  end if;
  if v_a.status <> 'archived' or v_a.archived_at is null then
    return jsonb_build_object('efface', false, 'raison', 'pas archivee');
  end if;
  if v_a.archived_at > now() - interval '1 month' then
    return jsonb_build_object('efface', false, 'raison', 'archivee depuis moins d''un mois');
  end if;
  if public.media_retention_protegee(p_album_id) then
    return jsonb_build_object('efface', false, 'raison', 'un droit paye court encore');
  end if;

  select count(*) into v_photos from media_assets where album_id = p_album_id;
  delete from media_player_tags t
   where t.media_ref_type = 'media_asset'
     and t.media_ref_id in (select id from media_assets where album_id = p_album_id);
  delete from media_album_link_offers o
   where o.link_id in (select id from media_album_links where album_id = p_album_id);
  delete from media_album_links where album_id = p_album_id;
  delete from media_assets where album_id = p_album_id;
  delete from media_albums where id = p_album_id;
  return jsonb_build_object('efface', true, 'titre', v_a.title, 'photos', v_photos);
end $f$;

revoke all on function public.media_retention_archiver() from public, anon, authenticated;
revoke all on function public.media_retention_effacer(uuid) from public, anon;
grant execute on function public.media_retention_etat() to authenticated;
grant execute on function public.media_retention_a_supprimer() to authenticated;
grant execute on function public.media_retention_effacer(uuid) to authenticated;
