-- ============================================================
-- SPORTVISION CLUB+ — Migration v4
-- Suite de migration-clubplus-v1/v2/v3.sql. Idempotente.
--
-- Portée : Demandes de création (club_requests) avec la vraie logique de
-- réservation de crédits, et Calendrier (club_calendar_events).
--
-- Les mouvements de crédits (réserver à la création, débiter si acceptée,
-- restituer si refusée) passent par deux fonctions SECURITY DEFINER
-- (submit_club_request / update_club_request_status) plutôt que par des
-- UPDATE directs sur clubs.credits_* depuis le client : ça évite les
-- incohérences en cas d'écritures concurrentes (deux demandes envoyées au
-- même instant) et ça évite d'ouvrir une policy UPDATE générale sur `clubs`
-- à tous les membres (qui pourraient alors modifier n'importe quel champ,
-- pas seulement les crédits).
-- ============================================================

-- ── 1. CLUB_REQUESTS ──

create table if not exists club_requests (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  team text,
  type text not null,
  requester_id uuid references auth.users on delete set null,
  requester_name text,
  status text check (status in (
    'recues','info_manquante','en_traitement','prete_a_creer','terminee','refusee'
  )) not null default 'recues',
  urgency text check (urgency in ('normale','haute')) default 'normale',
  detail text,
  missing jsonb default '[]',
  comments jsonb default '[]',
  credits_reserved integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_creq_upd on club_requests;
create trigger trg_creq_upd before update on club_requests
  for each row execute procedure update_updated_at_generic();

alter table club_requests enable row level security;

drop policy if exists "creq_member_select" on club_requests;
create policy "creq_member_select" on club_requests for select using (is_club_member(club_id));

-- Pas de policy INSERT/UPDATE générale ici par choix : la création et les
-- changements de statut passent exclusivement par les fonctions ci-dessous
-- (SECURITY DEFINER), pour que les mouvements de crédits restent toujours
-- synchronisés avec la ligne clubs correspondante. Seul l'ajout de
-- commentaires (champ jsonb, sans impact crédits) est ouvert en UPDATE direct.

drop policy if exists "creq_member_comment" on club_requests;
create policy "creq_member_comment" on club_requests for update using (is_club_member(club_id));
-- Note : cette policy autorise techniquement une mise à jour de n'importe quelle
-- colonne (RLS ne filtre pas par colonne). Le client n'utilise ce chemin que
-- pour `comments` ; `status` et `credits_reserved` ne doivent être modifiés
-- que via update_club_request_status(). À durcir avec un trigger si besoin
-- (hors scope de cette v4).

create index if not exists idx_creq_club on club_requests(club_id, status);

-- ── 2. Soumission d'une demande (insertion + réservation de crédits) ──

create or replace function submit_club_request(
  p_club_id uuid, p_team text, p_type text, p_urgency text, p_detail text, p_credits integer
) returns club_requests
language plpgsql security definer as $$
declare
  v_row club_requests;
  v_name text;
begin
  if not is_club_member(p_club_id) then
    raise exception 'Accès refusé : vous n''êtes pas membre actif de ce club.';
  end if;

  select trim(coalesce(prenom,'') || ' ' || coalesce(nom,'')) into v_name
    from club_members where user_id = auth.uid() and club_id = p_club_id limit 1;

  insert into club_requests (club_id, team, type, requester_id, requester_name, status, urgency, detail, credits_reserved)
  values (p_club_id, p_team, p_type, auth.uid(), nullif(v_name, ''), 'recues', coalesce(p_urgency,'normale'), p_detail, coalesce(p_credits, 0))
  returning * into v_row;

  if coalesce(p_credits, 0) > 0 then
    update clubs set credits_reserved = credits_reserved + p_credits where id = p_club_id;
  end if;

  return v_row;
end;
$$;

-- ── 3. Changement de statut (débite ou restitue les crédits réservés) ──

create or replace function update_club_request_status(p_request_id uuid, p_status text)
returns club_requests
language plpgsql security definer as $$
declare
  v_row club_requests;
  v_old_status text;
  v_credits integer;
begin
  select * into v_row from club_requests where id = p_request_id;
  if v_row.id is null then
    raise exception 'Demande introuvable.';
  end if;
  if not is_club_member(v_row.club_id) then
    raise exception 'Accès refusé.';
  end if;

  v_old_status := v_row.status;
  v_credits := coalesce(v_row.credits_reserved, 0);

  update club_requests set
    status = p_status,
    credits_reserved = case when p_status in ('terminee','refusee') then 0 else credits_reserved end
    where id = p_request_id
    returning * into v_row;

  if v_credits > 0 and p_status = 'terminee' and v_old_status <> 'terminee' then
    update clubs set
      credits_balance = greatest(0, credits_balance - v_credits),
      credits_reserved = greatest(0, credits_reserved - v_credits)
      where id = v_row.club_id;
    insert into club_credit_transactions (club_id, label, amount, created_by)
      values (v_row.club_id, coalesce(v_row.type,'Demande') || coalesce(' — ' || v_row.team, ''), -v_credits, auth.uid());
  elsif v_credits > 0 and p_status = 'refusee' and v_old_status <> 'refusee' then
    update clubs set credits_reserved = greatest(0, credits_reserved - v_credits) where id = v_row.club_id;
  end if;

  return v_row;
end;
$$;

-- ── 4. CALENDRIER ──

create table if not exists club_calendar_events (
  id uuid default gen_random_uuid() primary key,
  club_id uuid references clubs(id) on delete cascade not null,
  event_date date not null,
  type text check (type in ('match','entrainement','tournoi','contenu','sponsor','prestation')) not null default 'contenu',
  title text not null,
  team text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

alter table club_calendar_events enable row level security;

drop policy if exists "ccal_member_select" on club_calendar_events;
create policy "ccal_member_select" on club_calendar_events for select using (is_club_member(club_id));

drop policy if exists "ccal_member_insert" on club_calendar_events;
create policy "ccal_member_insert" on club_calendar_events for insert with check (is_club_member(club_id));

drop policy if exists "ccal_admin_delete" on club_calendar_events;
create policy "ccal_admin_delete" on club_calendar_events for delete using (is_club_admin(club_id));

create index if not exists idx_ccal_club on club_calendar_events(club_id, event_date);
