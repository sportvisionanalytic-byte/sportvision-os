-- v305 — 27/09/2026 : « à ce match-là, j'étais le numéro 7 »
--
-- DEMANDE DE FOUKA, et elle résout le défaut qui condamnait l'idée du dossard : « il faudrait qu'à
-- chaque match, les joueurs puissent mettre : j'étais le numéro 7 à ce match-là. Comme ça ça détecte
-- aussi les photos de dos, et ça lui ajoute des photos en plus des photos de son visage. »
--
-- POURQUOI C'EST LA BONNE FORME. J'avais objecté qu'en jeunes le numéro change d'un match à l'autre,
-- et qu'un numéro de saison dans `player_profiles` serait faux une fois sur trois — or un faux numéro
-- attribue la photo d'un enfant à un autre, la faute la plus grave de tout ce système. Déclarer le
-- numéro PAR MATCH supprime l'objection : c'est le joueur qui sait, et il le dit là où il le sait.
--
-- ET C'EST LA MOITIÉ QU'AUCUN MODÈLE NE PEUT DEVINER. Un modèle peut lire « 7 » sur un maillot ; il
-- ne peut pas savoir QUI portait le 7 ce jour-là. La déclaration apporte exactement cette moitié. Le
-- travail se répartit alors proprement :
--
--     sur la photo   « on voit le 7 »        lisible sans connaître personne
--     par la famille « j'étais le 7 »        connu d'elle seule
--     la jointure    la photo est la sienne  automatique
--
-- CE QUE CETTE MIGRATION NE FAIT PAS, et il faut le dire : elle ne LIT pas les numéros sur les
-- photos. `numeros_visibles` est renseigné à la main depuis l'OS — un chiffre à taper, bien plus
-- rapide que choisir un nom dans une liste de vingt. Le jour où un modèle lira les dossards, il
-- écrira dans cette même colonne et tout se joindra sans rien changer d'autre.
--
-- RIEN N'EST JAMAIS VALIDÉ AUTOMATIQUEMENT. Une déclaration n'est pas vérifiable : l'enfant peut se
-- tromper, deux enfants peuvent avoir échangé de maillot. La jointure produit donc des SUGGESTIONS
-- (source 'suggestion', statut 'propose'), c'est-à-dire exactement ce que l'écran « oui c'est bien
-- moi » affiche déjà. La famille tranche, comme aujourd'hui.
--
-- ET SI DEUX JOUEURS DÉCLARENT LE MÊME NUMÉRO sur le même match, aucune suggestion n'est produite
-- pour l'un ni pour l'autre. Deviner entre deux enfants serait pire que ne rien proposer.
--
-- Idempotent.

-- ── 1. CE QU'ON VOIT SUR LA PHOTO ──────────────────────────────────────────────────────────────
alter table media_assets
  add column if not exists numeros_visibles smallint[] not null default '{}';

comment on column media_assets.numeros_visibles is
  'v305 : les numeros de maillot lisibles sur cette photo, sans savoir a qui ils appartiennent. Renseignes a la main depuis l''OS ; un modele de lecture de dossards ecrirait ici.';

create index if not exists idx_media_assets_numeros
  on media_assets using gin (numeros_visibles) where cardinality(numeros_visibles) > 0;

-- ── 2. CE QUE LA FAMILLE DÉCLARE, MATCH PAR MATCH ──────────────────────────────────────────────
create table if not exists media_numeros_de_match (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references media_albums(id) on delete cascade,
  player_id uuid not null references player_profiles(id) on delete cascade,
  numero smallint not null check (numero between 1 and 99),
  declare_par uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un enfant ne porte qu'un numero par match.
  unique (album_id, player_id)
);

comment on table media_numeros_de_match is
  'v305 : le numero que ce sportif declare avoir porte a CE match. Par match et non par saison : en jeunes le numero change souvent, et un numero de saison serait faux une fois sur trois.';

alter table media_numeros_de_match enable row level security;

drop policy if exists mnm_famille_lit on media_numeros_de_match;
create policy mnm_famille_lit on media_numeros_de_match for select
  using (
    is_own_player(player_id) or is_confirmed_parent_of(player_id)
    or is_staff()
    or (select club_id from media_albums where id = album_id) in (select cm_clubs_autorises())
    or is_club_member((select club_id from media_albums where id = album_id))
  );

drop policy if exists mnm_famille_ecrit on media_numeros_de_match;
create policy mnm_famille_ecrit on media_numeros_de_match for all
  using (
    (is_own_player(player_id) or is_confirmed_parent_of(player_id))
    and public.media_galerie_concerne_le_joueur(album_id, player_id)
  )
  with check (
    (is_own_player(player_id) or is_confirmed_parent_of(player_id))
    and public.media_galerie_concerne_le_joueur(album_id, player_id)
  );

drop policy if exists mnm_staff_ecrit on media_numeros_de_match;
create policy mnm_staff_ecrit on media_numeros_de_match for all
  using (media_staff_write()) with check (media_staff_write());

drop trigger if exists trg_mnm_upd on media_numeros_de_match;
create trigger trg_mnm_upd before update on media_numeros_de_match
  for each row execute function update_updated_at_generic();

-- ── 3. LA JOINTURE, QUI NE PRODUIT QUE DES SUGGESTIONS ─────────────────────────────────────────
create or replace function public.media_suggerer_par_numero(p_album_id uuid)
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_posees integer := 0;
begin
  -- Les numeros revendiques par DEUX sportifs ou plus sur ce match : on ne propose rien.
  -- Deviner entre deux enfants serait pire que ne rien proposer.
  with litigieux as (
    select numero from media_numeros_de_match
     where album_id = p_album_id group by numero having count(distinct player_id) > 1
  ), a_poser as (
    select distinct x.id as asset_id, d.player_id
      from media_numeros_de_match d
      join media_assets x on x.album_id = p_album_id and x.status = 'ready'
       and d.numero = any(x.numeros_visibles)
     where d.album_id = p_album_id
       and d.numero not in (select numero from litigieux)
       -- On ne repasse jamais par-dessus une decision deja prise : ni un marquage valide, ni un
       -- refus. Une famille qui a dit « ce n'est pas moi » ne doit pas se le voir represente.
       and not exists (
         select 1 from media_player_tags t
          where t.media_ref_type = 'media_asset' and t.media_ref_id = x.id
            and t.player_id = d.player_id and t.statut in ('valide','rejete'))
  )
  insert into media_player_tags (media_ref_type, media_ref_id, player_id, source, statut)
  select 'media_asset', asset_id, player_id, 'suggestion', 'propose' from a_poser
  on conflict do nothing;
  v_posees := (select count(*) from media_player_tags t
                where t.media_ref_type='media_asset' and t.statut='propose' and t.source='suggestion'
                  and t.media_ref_id in (select id from media_assets where album_id = p_album_id));
  return v_posees;
end $f$;

comment on function public.media_suggerer_par_numero(uuid) is
  'v305 : joint « on voit le 7 sur cette photo » et « j''etais le 7 a ce match » pour PROPOSER des photos a une famille. Ne valide jamais : la famille tranche dans l''ecran « oui c''est bien moi ».';

-- ── 4. LE GESTE DE LA FAMILLE ──────────────────────────────────────────────────────────────────
create or replace function public.media_declarer_mon_numero(
  p_album_id uuid, p_player_id uuid, p_numero smallint)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_suggerees integer; v_conflit boolean;
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

  v_suggerees := public.media_suggerer_par_numero(p_album_id);

  return jsonb_build_object(
    'numero', p_numero,
    'conflit', v_conflit,
    'photos_proposees', (select count(*) from media_player_tags t
                          join media_assets x on x.id = t.media_ref_id
                         where x.album_id = p_album_id and t.player_id = p_player_id
                           and t.media_ref_type='media_asset' and t.statut = 'propose'),
    'photos_avec_ce_numero', (select count(*) from media_assets x
                               where x.album_id = p_album_id and x.status='ready'
                                 and p_numero = any(x.numeros_visibles)));
end $f$;

-- ── 5. LE GESTE DE CELUI QUI A LES PHOTOS ──────────────────────────────────────────────────────
create or replace function public.media_numeros_de_la_photo(
  p_asset_id uuid, p_numeros smallint[])
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_album uuid; v_nettoyes smallint[];
begin
  select album_id into v_album from media_assets where id = p_asset_id;
  if v_album is null then raise exception 'Photo introuvable.' using errcode = '22023'; end if;
  if not peut_marquer_galerie(v_album) then
    raise exception 'Vous ne pouvez pas annoter les photos de cette galerie.' using errcode = '42501';
  end if;
  v_nettoyes := array(select distinct n from unnest(coalesce(p_numeros,'{}'::smallint[])) n
                       where n between 1 and 99 order by n);
  update media_assets set numeros_visibles = v_nettoyes, updated_at = now() where id = p_asset_id;
  return public.media_suggerer_par_numero(v_album);
end $f$;

grant execute on function public.media_declarer_mon_numero(uuid, uuid, smallint) to authenticated;
grant execute on function public.media_numeros_de_la_photo(uuid, smallint[]) to authenticated;
grant execute on function public.media_suggerer_par_numero(uuid) to authenticated, service_role;
grant select, insert, update, delete on media_numeros_de_match to authenticated;
