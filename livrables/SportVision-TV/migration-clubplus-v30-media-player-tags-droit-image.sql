-- ============================================================
-- SPORTVISION CLUB+ / CONNECT — Migration v30
-- Blocage précis par enfant du droit à l'image (décidé le 2026-08-07,
-- suite à la recette de sécurité de l'espace Joueur & Famille de
-- Connect : jusqu'ici, le droit à l'image (parental_authorizations,
-- authorization_types.code = 'droit_image') n'était qu'un mécanisme de
-- confiance manuel — aucune policy ne bloquait la diffusion d'un média
-- si l'autorisation d'un enfant qui y figure n'était pas valide).
--
-- Ce blocage n'était techniquement pas possible avant cette migration :
-- un média (club_media/club_creations) était rattaché à une équipe
-- entière (media_access_rules.team_id), pas aux enfants qui y
-- apparaissent précisément. Cette migration ajoute cette précision.
--
-- ── Ce que ça protège, et ce que ça ne protège PAS ──────────────────
-- Le tag est VOLONTAIRE, saisi par le club à la création/gestion du
-- média (UI à construire séparément côté Club+ et Connect). Un média
-- JAMAIS tagué n'est pas bloqué : on ne peut pas déduire automatiquement
-- qui apparaît sur une photo, donc l'absence de tag ne peut PAS être
-- traitée comme "personne dessus" ni comme "tout le monde dessus" —
-- elle laisse le comportement d'avant cette migration (confiance
-- manuelle côté club). La protection n'est donc réelle que pour les
-- médias que le club prend la peine de taguer. Documenté explicitement
-- pour ne jamais être présenté comme une garantie totale.
--
-- Le seul type d'autorisation vérifié ici est 'droit_image' (le droit
-- de base). D'autres types plus fins existent déjà (diffusion_reseaux,
-- diffusion_sportvision, diffusion_interne, telechargement...) mais ne
-- sont pas croisés ici — hors périmètre de cette migration, à faire
-- évoluer si un jour la diffusion doit être différenciée par canal.
--
-- Idempotente. À exécuter après migration-clubplus-v18.sql (définit
-- media_access_rules/is_media_visible_to_family) et
-- migration-clubplus-v15.sql (définit parental_authorizations/
-- authorization_types).
-- ============================================================

create table if not exists media_player_tags (
  id uuid default gen_random_uuid() primary key,
  media_ref_type text check (media_ref_type in ('club_media','club_creations')) not null,
  media_ref_id uuid not null,
  player_id uuid references player_profiles(id) on delete cascade not null,
  tagged_by uuid references auth.users on delete set null,
  created_at timestamptz default now(),
  unique (media_ref_type, media_ref_id, player_id)
);

create index if not exists idx_mpt_media on media_player_tags(media_ref_type, media_ref_id);
create index if not exists idx_mpt_player on media_player_tags(player_id);

alter table media_player_tags enable row level security;

-- Même périmètre que la gestion de media_access_rules (v18) : admin du
-- club, ou éducateur de l'équipe concernée. On résout le club_id du
-- média référencé (club_media.club_id ou club_creations.club_id) pour
-- que la vérification reste valable même si aucune media_access_rules
-- n'a encore été créée pour ce média.
create or replace function media_ref_club_id(p_media_ref_type text, p_media_ref_id uuid)
returns uuid language sql security definer stable as $$
  select case p_media_ref_type
    when 'club_media' then (select club_id from club_media where id = p_media_ref_id)
    when 'club_creations' then (select club_id from club_creations where id = p_media_ref_id)
    else null
  end;
$$;

drop policy if exists "mpt_member_select" on media_player_tags;
create policy "mpt_member_select" on media_player_tags for select using (
  is_club_member(media_ref_club_id(media_ref_type, media_ref_id))
);

drop policy if exists "mpt_manager_insert" on media_player_tags;
create policy "mpt_manager_insert" on media_player_tags for insert with check (
  is_club_admin(media_ref_club_id(media_ref_type, media_ref_id))
  or exists (
    select 1 from team_memberships tm
    where tm.player_id = media_player_tags.player_id and tm.statut = 'active'
      and is_team_educateur(tm.team_id)
  )
);

drop policy if exists "mpt_manager_delete" on media_player_tags;
create policy "mpt_manager_delete" on media_player_tags for delete using (
  is_club_admin(media_ref_club_id(media_ref_type, media_ref_id))
  or exists (
    select 1 from team_memberships tm
    where tm.player_id = media_player_tags.player_id and tm.statut = 'active'
      and is_team_educateur(tm.team_id)
  )
);
-- Pas de policy UPDATE : un tag se retire et se recrée, il ne se modifie pas
-- (les seules colonnes sont l'identité du lien média/joueur, rien à corriger
-- après coup qui ne soit pas "ce n'était pas le bon joueur, je le retire").

-- ── Fonction de blocage ──────────────────────────────────────────────
-- Vrai si AU MOINS UN joueur tagué sur ce média n'a pas d'autorisation
-- droit_image valide et non expirée. Vide (aucun tag) → faux (voir note
-- ci-dessus : pas de tag = pas de blocage, comportement inchangé).
create or replace function media_has_unauthorized_tagged_player(p_media_ref_type text, p_media_ref_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from media_player_tags mpt
    where mpt.media_ref_type = p_media_ref_type and mpt.media_ref_id = p_media_ref_id
      and not exists (
        select 1 from parental_authorizations pa
        join authorization_types t on t.id = pa.authorization_type_id
        where pa.player_id = mpt.player_id
          and t.code = 'droit_image'
          and pa.statut = 'valide'
          and (pa.date_expiration is null or pa.date_expiration >= current_date)
      )
  );
$$;

-- ── Branchement dans le point de contrôle existant ───────────────────
-- is_media_visible_to_family (v18) reste l'unique fonction qui gate la
-- visibilité Joueur/Famille de club_media/club_creations (cmd_family_select/
-- ccr_family_select en dépendent déjà) : on y ajoute la nouvelle condition
-- plutôt que de dupliquer la logique de visibilité ailleurs.
create or replace function is_media_visible_to_family(p_media_ref_type text, p_media_ref_id uuid)
returns boolean language sql security definer stable as $$
  select (not media_has_unauthorized_tagged_player(p_media_ref_type, p_media_ref_id))
     and exists (
    select 1 from media_access_rules r
    join team_memberships tm on tm.team_id = r.team_id and tm.statut = 'active'
    join player_profiles p on p.id = tm.player_id
    where r.media_ref_type = p_media_ref_type and r.media_ref_id = p_media_ref_id
      and (r.expire_at is null or r.expire_at > now())
      and (
        (p.user_id = auth.uid() and r.visible_joueur)
        or (is_confirmed_parent_of(p.id) and r.visible_parent)
      )
  );
$$;
