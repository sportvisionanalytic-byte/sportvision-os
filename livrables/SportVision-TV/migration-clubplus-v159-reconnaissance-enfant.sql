-- v159 : les fondations de la reconnaissance de l'enfant (12/09/2026).
--
-- Demande de Fouka : préparer le Pass photo « mon enfant » — le parent se connecte, désigne son
-- enfant, et à chaque nouvelle galerie les photos de cet enfant lui reviennent, à lui ou au joueur
-- qui a payé le pass. Décision assumée : on le développe.
--
-- CE QUE CETTE MIGRATION POSE, ET CE QU'ELLE NE FAIT PAS.
-- Elle pose le socle, et seulement lui : le consentement, la photo de référence, le marquage par
-- joueur (humain ou suggéré) et l'historique des décisions. Elle ne branche AUCUN moteur de
-- reconnaissance et ne change AUCUN accès existant : rien n'est calculé, rien n'est comparé, rien
-- ne s'ouvre différemment tant que le reste n'est pas construit et décidé.
--
-- POURQUOI LE CONSENTEMENT EST LA PREMIÈRE PIERRE.
-- Un visage analysé pour reconnaître quelqu'un est une donnée biométrique (RGPD, article 9), et ce
-- sont des mineurs. Aucune référence de visage ne peut donc exister sans un consentement écrit,
-- daté, rattaché à la personne qui l'a donné, et révocable à tout moment. La révocation efface la
-- référence (aucune suppression différée) et les suggestions non validées qui en découlent. Les
-- marquages déjà validés par un humain restent : ce sont des étiquettes, pas de la biométrie.
--
-- CE QUI RESTE À DÉCIDER AVANT D'ALLER PLUS LOIN (voir le compte rendu du 12/09) : le moteur de
-- reconnaissance (hébergé en Europe), l'analyse d'impact (AIPD), et le texte de consentement.
-- Test : tests/reconnaissance-enfant-socle.test.sql

-- ── 1. Le consentement, par enfant, donné par un parent confirmé ou le joueur majeur ──
create table if not exists public.consentements_biometrie (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete set null,
  saison_id uuid references public.saisons(id) on delete set null,
  donne_par uuid not null,
  qualite text not null check (qualite in ('parent', 'tuteur', 'joueur_majeur')),
  texte_version text not null,
  statut text not null default 'accorde' check (statut in ('accorde', 'retire')),
  accorde_le timestamptz not null default now(),
  retire_le timestamptz,
  retire_par uuid,
  created_at timestamptz not null default now()
);
create index if not exists consentements_biometrie_player_idx on public.consentements_biometrie (player_id, statut);
alter table public.consentements_biometrie enable row level security;

-- Le lit : la famille de l'enfant, et l'Administration (contrôle, réponse à une demande RGPD).
drop policy if exists cb_lecture on public.consentements_biometrie;
create policy cb_lecture on public.consentements_biometrie for select to authenticated
  using (is_confirmed_parent_of(player_id)
         or exists (select 1 from player_profiles p where p.id = player_id and p.user_id = auth.uid())
         or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin'));
-- Le donne : seulement pour son propre enfant (ou soi-même, majeur), et jamais au nom d'un autre.
drop policy if exists cb_donner on public.consentements_biometrie;
create policy cb_donner on public.consentements_biometrie for insert to authenticated
  with check (donne_par = auth.uid() and statut = 'accorde'
              and (is_confirmed_parent_of(player_id)
                   or exists (select 1 from player_profiles p where p.id = player_id and p.user_id = auth.uid())));
-- Le retire : la même famille, ou l'Administration. Rien d'autre ne se modifie.
drop policy if exists cb_retirer on public.consentements_biometrie;
create policy cb_retirer on public.consentements_biometrie for update to authenticated
  using (is_confirmed_parent_of(player_id)
         or exists (select 1 from player_profiles p where p.id = player_id and p.user_id = auth.uid())
         or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin'))
  with check (statut = 'retire');
revoke all on public.consentements_biometrie from anon;

create or replace function public.consentement_biometrie_actif(p_player_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from consentements_biometrie c
                  where c.player_id = p_player_id and c.statut = 'accorde');
$$;
revoke execute on function public.consentement_biometrie_actif(uuid) from public, anon;
grant execute on function public.consentement_biometrie_actif(uuid) to authenticated;

-- ── 2. La photo de référence : jamais sans consentement, effacée avec lui ──
-- On ne stocke pas de gabarit biométrique nous-mêmes : seulement la référence rendue par le moteur
-- (à choisir, hébergé en Europe) et le chemin de la photo fournie par la famille.
create table if not exists public.player_face_refs (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles(id) on delete cascade,
  consentement_id uuid not null references public.consentements_biometrie(id) on delete cascade,
  moteur text not null,
  reference_externe text,
  storage_bucket text,
  storage_path text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists player_face_refs_player_idx on public.player_face_refs (player_id);
alter table public.player_face_refs enable row level security;
-- Personne ne lit ces lignes depuis une application : ni le club, ni la famille, ni la Production.
-- Seule l'Administration, pour répondre à une demande d'accès ou de suppression.
drop policy if exists pfr_admin on public.player_face_refs;
create policy pfr_admin on public.player_face_refs for all to authenticated
  using (exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin'))
  with check (exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin'));
revoke all on public.player_face_refs from anon;

-- Une référence ne peut exister que sous un consentement accordé.
create or replace function public.verifier_consentement_face_ref()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from consentements_biometrie c
                  where c.id = new.consentement_id and c.player_id = new.player_id and c.statut = 'accorde') then
    raise exception 'Aucun consentement accordé pour cet enfant : aucune référence de visage ne peut être enregistrée.'
      using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_verifier_consentement_face_ref on public.player_face_refs;
create trigger trg_verifier_consentement_face_ref before insert or update on public.player_face_refs
  for each row execute function public.verifier_consentement_face_ref();

-- Retirer le consentement efface la référence et les suggestions non validées, tout de suite.
create or replace function public.effacer_biometrie_au_retrait()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.statut = 'retire' and coalesce(old.statut, '') <> 'retire' then
    new.retire_le := coalesce(new.retire_le, now());
    new.retire_par := coalesce(new.retire_par, auth.uid());
    delete from player_face_refs r where r.consentement_id = new.id;
    delete from media_player_tags t where t.player_id = new.player_id and t.statut = 'propose';
  end if;
  return new;
end $$;
drop trigger if exists trg_effacer_biometrie_au_retrait on public.consentements_biometrie;
create trigger trg_effacer_biometrie_au_retrait before update on public.consentements_biometrie
  for each row execute function public.effacer_biometrie_au_retrait();

-- ── 3. Le marquage par joueur : d'où il vient, et qui l'a validé ──
-- Le marquage ne connaissait que les médias du module club (club_media, club_creations) : il doit
-- porter aussi les photos d'une galerie, qui sont ce que les familles achètent.
alter table public.media_player_tags drop constraint if exists media_player_tags_media_ref_type_check;
alter table public.media_player_tags add constraint media_player_tags_media_ref_type_check
  check (media_ref_type in ('club_media', 'club_creations', 'media_asset'));

alter table public.media_player_tags add column if not exists source text not null default 'humain';
alter table public.media_player_tags drop constraint if exists media_player_tags_source_check;
alter table public.media_player_tags add constraint media_player_tags_source_check
  check (source in ('humain', 'suggestion', 'famille'));
alter table public.media_player_tags add column if not exists statut text not null default 'valide';
alter table public.media_player_tags drop constraint if exists media_player_tags_statut_check;
alter table public.media_player_tags add constraint media_player_tags_statut_check
  check (statut in ('propose', 'valide', 'rejete'));
alter table public.media_player_tags add column if not exists score numeric;
alter table public.media_player_tags add column if not exists valide_par uuid;
alter table public.media_player_tags add column if not exists valide_le timestamptz;
alter table public.media_player_tags add column if not exists moteur text;

-- Une suggestion de machine n'a jamais d'effet tant qu'un humain ne l'a pas validée.
create or replace function public.photos_taggees_du_joueur(p_player_id uuid)
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select t.media_ref_id from media_player_tags t
   where t.player_id = p_player_id and t.media_ref_type = 'media_asset' and t.statut = 'valide';
$$;
revoke execute on function public.photos_taggees_du_joueur(uuid) from public, anon;
grant execute on function public.photos_taggees_du_joueur(uuid) to authenticated;
