-- v314 — 27/09/2026 : un barème standard pour les galeries, modifiable galerie par galerie
--
-- BARÈME DICTÉ PAR FOUKA, complété par lui sur les deux tranches qu'il n'avait pas données :
--
--     0 – 19      gratuite
--     20 – 39      9,90 €    10 photos pour  5 €
--     40 – 79     19,90 €    10 photos pour  5 €
--     80 – 150    29,90 €    15 photos pour 10 €
--     151 – 299   39,90 €    15 photos pour 10 €
--     300 et +    49,90 €    15 photos pour 10 €
--
-- CE QUE ÇA RÉSOUT, et je ne l'avais pas vu avant de compter : **16 galeries publiées sur 44 n'ont
-- AUCUNE offre**. Quelqu'un ouvre le lien et n'a rien à acheter — « Villemomble plateau U6-U7 » et
-- ses 282 photos, « Rcpf U10 VS amiens » et ses 250. Et les prix posés à la main se contredisent :
-- 58 photos à 24,90 € quand 46 photos sont à 9,90 €, 261 photos à 40,00 € quand 263 sont à 39,90 €.
--
-- DÉCISION DE FOUKA SUR L'EXISTANT : on n'y touche pas. Le barème ne vaut que pour les galeries
-- publiées à partir de maintenant. Les 16 invendables le restent jusqu'à ce qu'il leur mette un prix
-- — mais le bouton « Appliquer le barème » de l'OS le fait en un clic, sans que rien ne se décide à
-- sa place.
--
-- « MODIFIABLE PAR GALERIE » EST DÉJÀ VRAI, et c'est pour ça que ce barème ne crée pas un second
-- système : les offres vivent sur le LIEN de la galerie (media_album_link_offers), avec leur propre
-- prix. Le barème ne fait que les POSER quand il n'y en a pas. Il ne réécrit jamais une offre
-- existante — une offre posée à la main est une décision, et une décision ne se corrige pas toute
-- seule pendant la nuit.
--
-- Idempotent.

create table if not exists media_bareme_galerie (
  id uuid primary key default gen_random_uuid(),
  photos_min integer not null check (photos_min >= 0),
  photos_max integer check (photos_max is null or photos_max >= photos_min),
  prix_galerie_cents integer not null check (prix_galerie_cents >= 0),
  pack_photos integer check (pack_photos is null or pack_photos >= 1),
  pack_prix_cents integer check (pack_prix_cents is null or pack_prix_cents >= 0),
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (photos_min)
);

comment on table media_bareme_galerie is
  'v314 : le bareme STANDARD des galeries, par nombre de photos. Il pose les offres d''une galerie qui n''en a pas ; il ne reecrit jamais une offre posee a la main. photos_max nul = derniere tranche.';

alter table media_bareme_galerie enable row level security;
drop policy if exists bareme_lecture on media_bareme_galerie;
create policy bareme_lecture on media_bareme_galerie for select using (auth.uid() is not null);
drop policy if exists bareme_ecriture on media_bareme_galerie;
create policy bareme_ecriture on media_bareme_galerie for all
  using (media_pricing_staff()) with check (media_pricing_staff());

insert into media_bareme_galerie (photos_min, photos_max, prix_galerie_cents, pack_photos, pack_prix_cents)
values (0,    19,   0,    null, null),
       (20,   39,   990,  10,   500),
       (40,   79,   1990, 10,   500),
       (80,   150,  2990, 15,   1000),
       (151,  299,  3990, 15,   1000),
       (300,  null, 4990, 15,   1000)
on conflict (photos_min) do update
   set photos_max = excluded.photos_max,
       prix_galerie_cents = excluded.prix_galerie_cents,
       pack_photos = excluded.pack_photos,
       pack_prix_cents = excluded.pack_prix_cents,
       updated_at = now();

create or replace function public.media_bareme_pour(p_photos integer)
returns media_bareme_galerie language sql stable security definer set search_path to 'public','pg_temp' as $f$
  select b.* from media_bareme_galerie b
   where b.actif
     and coalesce(p_photos, 0) >= b.photos_min
     and (b.photos_max is null or coalesce(p_photos, 0) <= b.photos_max)
   order by b.photos_min desc
   limit 1;
$f$;

-- ── POSER LES OFFRES D'UNE GALERIE QUI N'EN A PAS ──────────────────────────────────────────────
create or replace function public.media_appliquer_bareme(p_album_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare
  v_album media_albums; v_b media_bareme_galerie; v_lien record; v_poses integer := 0; v_sautes integer := 0;
begin
  select * into v_album from media_albums where id = p_album_id;
  if v_album.id is null then raise exception 'Galerie introuvable.' using errcode = 'P0002'; end if;
  if not media_pricing_staff() then
    raise exception 'Les tarifs d''une galerie se posent par SportVision.' using errcode = '42501';
  end if;

  select * into v_b from media_bareme_pour(v_album.photo_count);
  if v_b.id is null then
    return jsonb_build_object('applique', false, 'raison', 'aucune tranche pour ' || coalesce(v_album.photo_count,0) || ' photos');
  end if;
  -- Une galerie de moins de vingt photos est gratuite : il n'y a rien a vendre, donc rien a poser.
  if v_b.prix_galerie_cents = 0 then
    return jsonb_build_object('applique', false, 'raison', 'galerie gratuite (' || coalesce(v_album.photo_count,0) || ' photos)',
                              'tranche', v_b.photos_min || '-' || coalesce(v_b.photos_max::text,'+'));
  end if;

  for v_lien in select l.id from media_album_links l where l.album_id = p_album_id loop
    -- ON NE REECRIT JAMAIS UNE OFFRE EXISTANTE. Une offre posee a la main est une decision, et une
    -- decision ne se corrige pas toute seule. Le lien qui en a deja est simplement saute.
    if exists (select 1 from media_album_link_offers o where o.link_id = v_lien.id) then
      v_sautes := v_sautes + 1;
      continue;
    end if;
    insert into media_album_link_offers (link_id, offer_type, price_override_cents, photos_allowance,
                                         label, display_order, is_featured, created_by)
    values (v_lien.id, 'album_complet', v_b.prix_galerie_cents, null,
            'Toute la galerie', 1, true, auth.uid());
    if v_b.pack_photos is not null then
      insert into media_album_link_offers (link_id, offer_type, price_override_cents, photos_allowance,
                                           label, display_order, is_featured, created_by)
      values (v_lien.id, 'pack', v_b.pack_prix_cents, v_b.pack_photos,
              v_b.pack_photos || ' photos', 0, false, auth.uid());
    end if;
    v_poses := v_poses + 1;
  end loop;

  return jsonb_build_object(
    'applique', v_poses > 0,
    'liens_servis', v_poses, 'liens_sautes', v_sautes,
    'photos', v_album.photo_count,
    'tranche', v_b.photos_min || '-' || coalesce(v_b.photos_max::text,'+'),
    'prix_galerie', v_b.prix_galerie_cents / 100.0,
    'pack', case when v_b.pack_photos is null then null
                 else v_b.pack_photos || ' photos pour ' || (v_b.pack_prix_cents/100.0) || ' EUR' end);
end $f$;

-- ── LES NOUVELLES GALERIES LE RECOIVENT SEULES ─────────────────────────────────────────────────
-- Decision de Fouka : le bareme ne vaut que pour les galeries publiees a partir de maintenant.
-- La publication est le bon moment : c'est la que les photos sont la, donc que le nombre est connu.
create or replace function public.bareme_a_la_publication()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if new.status = 'published' and coalesce(old.status,'') <> 'published' then
    -- Jamais bloquant : une galerie se publie meme si le bareme ne trouve pas sa tranche.
    begin
      perform public.media_appliquer_bareme(new.id);
    exception when others then null;
    end;
  end if;
  return new;
end $f$;

drop trigger if exists trg_bareme_a_la_publication on media_albums;
create trigger trg_bareme_a_la_publication after update on media_albums
  for each row execute function bareme_a_la_publication();

grant execute on function public.media_bareme_pour(integer) to authenticated;
grant execute on function public.media_appliquer_bareme(uuid) to authenticated;
grant select on media_bareme_galerie to authenticated;
