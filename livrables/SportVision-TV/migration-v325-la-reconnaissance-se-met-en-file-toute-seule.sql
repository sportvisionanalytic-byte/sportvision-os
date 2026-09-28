-- v325 — 28/09/2026 : la reconnaissance part toute seule, au lieu d'attendre un clic
--
-- DEMANDE DE FOUKA : « il faut vraiment que ce soit automatique. Quand il dépose sa photo de
-- référence, ça reconnaît automatiquement toutes les photos où il apparaît. »
--
-- CE QUI EXISTAIT. Le moteur tourne dans le navigateur de l'OS, derrière un bouton « Identifier les
-- sportifs », galerie par galerie. Une famille pouvait donc déposer sa photo et ne jamais rien voir
-- venir, parce que personne n'avait cliqué. C'est exactement ce qui vient d'arriver en test.
--
-- CE QUE CETTE MIGRATION POSE : la FILE. Deux événements y mettent du travail, et plus personne
-- n'a à y penser :
--   • une photo de référence est enregistrée   → toutes les galeries qui concernent ce sportif
--   • une galerie est publiée                  → tous les sportifs de ses équipes qui ont consenti
--
-- CE QU'ELLE NE POSE PAS, et c'est assumé : le moteur lui-même. Il a besoin d'un navigateur (les
-- modèles face-api, un canvas, WebGL), et l'endroit où il tourne est une décision à part. La file
-- est utile dans tous les cas : sans elle, quel que soit l'endroit, on ne saurait pas quoi traiter.
--
-- CE QUI NE CHANGE PAS, et qui est la décision du 14/09 : aucune empreinte de photo de GALERIE
-- n'est conservée. On calcule, on compare, on jette. Garder les gabarits de tous les visages
-- détectés rendrait le rapprochement instantané, mais on conserverait des données biométriques
-- d'enfants dont la famille n'a jamais rien accepté.
--
-- Idempotent.

create table if not exists public.reconnaissance_a_faire (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references media_albums(id) on delete cascade,
  player_id uuid not null references player_profiles(id) on delete cascade,
  demande_le timestamptz not null default now(),
  traite_le timestamptz,
  resultat text
);

comment on table public.reconnaissance_a_faire is
  'Le travail de reconnaissance qui reste a faire : un couple galerie + sportif. Rempli par trigger '
  'des qu''une photo de reference arrive ou qu''une galerie est publiee. Vide par un moteur qui '
  'tourne dans un navigateur. Aucune empreinte de galerie n''y est conservee.';

-- Un seul travail en attente par couple : reposer la meme demande ne cree pas de doublon.
create unique index if not exists reconnaissance_a_faire_en_attente
  on public.reconnaissance_a_faire (album_id, player_id) where traite_le is null;

create index if not exists reconnaissance_a_faire_ordre
  on public.reconnaissance_a_faire (demande_le) where traite_le is null;

alter table public.reconnaissance_a_faire enable row level security;

-- Le staff media voit et mene ce travail ; personne d'autre n'a rien a y faire.
drop policy if exists rf_staff on public.reconnaissance_a_faire;
create policy rf_staff on public.reconnaissance_a_faire
  for all to authenticated
  using (public.media_upload_staff()) with check (public.media_upload_staff());

-- ── Ce qu'il faut traiter pour un sportif : toutes les galeries qui le concernent ────────────────
create or replace function public.reconnaissance_mettre_en_file(p_player_id uuid)
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_n integer;
begin
  -- Sans accord, rien n'entre en file : la regle du consentement vaut aussi pour le travail qu'on
  -- programme. Inutile de mettre en attente ce qu'on n'a pas le droit de faire.
  if not consentement_biometrie_actif(p_player_id) then return 0; end if;

  insert into reconnaissance_a_faire (album_id, player_id)
  select a.id, p_player_id
    from media_albums a
   where a.status = 'published'
     and public.media_galerie_concerne_le_joueur(a.id, p_player_id)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $f$;

-- ── Une photo de référence arrive : on met en file ───────────────────────────────────────────────
create or replace function public.reconnaissance_a_la_photo_de_reference()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  perform public.reconnaissance_mettre_en_file(new.player_id);
  return new;
end $f$;

drop trigger if exists trg_reconnaissance_photo_reference on public.player_face_refs;
create trigger trg_reconnaissance_photo_reference
  after insert on public.player_face_refs
  for each row execute function public.reconnaissance_a_la_photo_de_reference();

-- ── Une galerie est publiée : on met en file tous ceux qui ont consenti ──────────────────────────
create or replace function public.reconnaissance_a_la_publication()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then
    return new;
  end if;
  insert into reconnaissance_a_faire (album_id, player_id)
  select new.id, tm.player_id
    from team_memberships tm
   where tm.statut = 'active'
     and tm.team_id = any(public.media_equipes_de_la_galerie(new.id))
     and consentement_biometrie_actif(tm.player_id)
     and exists (select 1 from player_face_refs f where f.player_id = tm.player_id)
  on conflict do nothing;
  return new;
end $f$;

drop trigger if exists trg_reconnaissance_publication on public.media_albums;
create trigger trg_reconnaissance_publication
  after insert or update of status on public.media_albums
  for each row execute function public.reconnaissance_a_la_publication();

-- ── Ce que le moteur demande, et ce qu'il rend ───────────────────────────────────────────────────
create or replace function public.reconnaissance_file(p_limite integer default 20)
returns table(id uuid, album_id uuid, titre text, player_id uuid, sportif text, demande_le timestamptz)
language sql stable security definer set search_path to 'public','pg_temp' as $f$
  select f.id, f.album_id, a.title, f.player_id,
         coalesce(nullif(btrim(p.prenom || ' ' || p.nom), ''), 'Sportif'), f.demande_le
    from reconnaissance_a_faire f
    join media_albums a on a.id = f.album_id
    join player_profiles p on p.id = f.player_id
   where f.traite_le is null
     and public.media_upload_staff()
   order by f.demande_le
   limit greatest(1, least(coalesce(p_limite, 20), 200));
$f$;

create or replace function public.reconnaissance_fait(p_id uuid, p_resultat text default null)
returns boolean language plpgsql security definer set search_path to 'public','pg_temp' as $f$
begin
  if not public.media_upload_staff() then
    raise exception 'Non autorisé.' using errcode = '42501';
  end if;
  update reconnaissance_a_faire
     set traite_le = now(), resultat = left(coalesce(p_resultat, 'fait'), 300)
   where id = p_id and traite_le is null;
  return found;
end $f$;

revoke all on function public.reconnaissance_mettre_en_file(uuid) from public, anon;
grant execute on function public.reconnaissance_file(integer) to authenticated;
grant execute on function public.reconnaissance_fait(uuid, text) to authenticated;

-- ── Le travail qui attend deja, puisque personne n'a jamais clique ──────────────────────────────
select public.reconnaissance_mettre_en_file(f.player_id) from (select distinct player_id from player_face_refs) f;
