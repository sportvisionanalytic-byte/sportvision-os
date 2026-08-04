-- ============================================================
-- SPORTVISION CLUB+ — Migration v19
-- Suite de migration-clubplus-v1 à v18.sql. Idempotente.
--
-- Portée : Phase 9 du module « Espace Joueur & Famille »
-- (cf. CLUBPLUS_PLAYER_FAMILY_ARCHITECTURE.md) — signalement d'un média
-- par un joueur/parent, et masquage effectif pendant l'examen (pas
-- juste un statut affiché, la visibilité famille est réellement coupée).
-- ============================================================

create table if not exists media_reports (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  media_ref_type text check (media_ref_type in ('club_media','club_creations')) not null,
  media_ref_id uuid not null,
  reported_by uuid references auth.users on delete set null,
  player_concerned_id uuid references player_profiles(id) on delete set null,
  motif text check (motif in (
    'joueur_present_retrait','enfant_present','mauvaise_equipe','contenu_inapproprie','droit_image','erreur','autre'
  )) not null,
  message text,
  statut text check (statut in (
    'recu','a_verifier','media_masque','infos_demandees','retrait_accepte','retrait_refuse','termine'
  )) not null default 'recu',
  refus_motif text,
  handled_by uuid references auth.users on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_mrp_upd on media_reports;
create trigger trg_mrp_upd before update on media_reports
  for each row execute procedure update_updated_at_generic();

create index if not exists idx_mrp_club on media_reports(club_id, statut);
create index if not exists idx_mrp_media on media_reports(media_ref_type, media_ref_id);

alter table media_reports enable row level security;

-- Lecture : l'auteur du signalement, ou tout dirigeant du club (même
-- convention que club_requests, v4 : un signalement famille est une
-- information club, pas réservée au seul admin).
drop policy if exists "mrp_reporter_select" on media_reports;
create policy "mrp_reporter_select" on media_reports for select using (reported_by = auth.uid());

drop policy if exists "mrp_member_select" on media_reports;
create policy "mrp_member_select" on media_reports for select using (is_club_member(club_id));

-- Création : un dirigeant, ou un joueur/parent qui peut déjà voir ce média
-- (is_media_visible_to_family, v18) — on ne peut signaler que ce qu'on voit.
drop policy if exists "mrp_insert" on media_reports;
create policy "mrp_insert" on media_reports for insert with check (
  is_club_member(club_id) or is_media_visible_to_family(media_ref_type, media_ref_id)
);

-- Traitement (changement de statut) : réservé à l'admin, même logique que
-- verify_parental_authorization (v15) — un signalement famille touche à des
-- décisions sensibles (droit à l'image, retrait), pas une simple gestion
-- courante déléguée à tout éducateur.
drop policy if exists "mrp_admin_update" on media_reports;
create policy "mrp_admin_update" on media_reports for update using (is_club_admin(club_id));

-- Masquage effectif : redéfinit is_media_visible_to_family (v18) pour exclure
-- tout média sous statut 'media_masque' ou 'retrait_accepte' — la coupure
-- s'applique à TOUTE la famille, pas seulement à l'auteur du signalement,
-- et reste dirigeants-visible (is_club_member n'est pas concerné par cette
-- fonction, seules les policies additives cmd_family_select/ccr_family_select
-- l'utilisent) le temps que le club instruise le signalement.
create or replace function is_media_visible_to_family(p_media_ref_type text, p_media_ref_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from media_access_rules r
    join team_memberships tm on tm.team_id = r.team_id and tm.statut = 'active'
    join player_profiles p on p.id = tm.player_id
    where r.media_ref_type = p_media_ref_type and r.media_ref_id = p_media_ref_id
      and (r.expire_at is null or r.expire_at > now())
      and (
        (p.user_id = auth.uid() and r.visible_joueur)
        or (is_confirmed_parent_of(p.id) and r.visible_parent)
      )
  )
  and not exists (
    select 1 from media_reports mr
    where mr.media_ref_type = p_media_ref_type and mr.media_ref_id = p_media_ref_id
      and mr.statut in ('media_masque', 'retrait_accepte')
  );
$$;
