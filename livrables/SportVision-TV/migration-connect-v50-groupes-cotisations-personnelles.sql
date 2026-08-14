-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v50
-- Groupes personnels ("Mes équipes") + Cotisations collectives.
--
-- Contexte : RAPPORT-MIGRATION-CONNECT-PERSONNEL.md §6 confirme qu'AUCUNE
-- table équivalente n'existe pour ces deux concepts — contrairement au
-- reste de Connect personnel qui réutilise memberships/player_profiles/etc.
-- Cette migration les crée entièrement.
--
-- Chantier le plus sensible de Connect personnel : de l'argent réel transite
-- (paiement collectif Stripe). Principes appliqués partout ci-dessous :
--   1. Aucun montant collecté n'est jamais écrit par le frontend — seul un
--      trigger serveur (recompute_group_funding_amount, déclenché par
--      stripe-webhook en service role) recalcule group_fundings.collected.
--   2. Aucun prix n'est jamais fait confiance côté client — la cible
--      (montant_cible) est calculée à la création depuis catalogue_offres
--      par la RPC create_group_funding, jamais reçue telle quelle.
--   3. Même modèle Stripe que team_project_contributions (migration-
--      clubplus-v21.sql, déjà en prod) : Edge Function pour créer la
--      session Checkout, stripe-webhook (déjà signé/idempotent via
--      stripe_events) pour confirmer — jamais le retour navigateur seul.
--   4. Pas de logique de remboursement automatique inventée ici : la seule
--      écriture liée à un remboursement est la réflexion passive d'un
--      remboursement Stripe déjà décidé côté dashboard (même principe que
--      la branche charge.refunded existante pour team_project_contributions),
--      jamais une politique métier decidée par le code.
--   5. RLS : jamais de policy self-référentielle brute sur user_group_members
--      (cause connue de récursion RLS 42P17 sur ce projet, cf. migration-
--      clubplus-v31-fix-parent-profiles-rls-recursion.sql) — passage
--      systématique par une fonction SECURITY DEFINER, comme is_club_admin/
--      is_club_member déjà en place.
--   6. Aucune policy INSERT/UPDATE sur group_fundings/funding_contributions :
--      toute écriture passe par une RPC SECURITY DEFINER ou par le service
--      role (Edge Functions, webhook), jamais un insert/update client direct
--      — même convention que team_project_contributions (§5 de v21).
-- ============================================================

-- ── 1. TABLES ──

create table if not exists user_groups (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text,
  created_by uuid references auth.users on delete set null not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_ug_upd on user_groups;
create trigger trg_ug_upd before update on user_groups
  for each row execute procedure update_updated_at_generic();

create table if not exists user_group_members (
  id uuid default gen_random_uuid() primary key,
  group_id uuid references user_groups(id) on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  role text check (role in ('createur', 'membre')) not null default 'membre',
  joined_at timestamptz default now(),
  unique (group_id, user_id)
);

create index if not exists idx_ugm_group on user_group_members(group_id);
create index if not exists idx_ugm_user on user_group_members(user_id);

-- group_id nullable : une cotisation peut être créée "en partage libre" sans
-- groupe préexistant (design § Cotisations, étape 2 — repartition_mode="libre"
-- reste distinct de ce choix, on peut cotiser à parts égales SANS groupe).
create table if not exists group_fundings (
  id uuid default gen_random_uuid() primary key,
  group_id uuid references user_groups(id) on delete set null,
  created_by uuid references auth.users on delete set null not null,
  catalogue_offre_id uuid references catalogue_offres(id) not null,
  titre text not null,
  contexte text,
  montant_cible numeric(10,2) not null check (montant_cible > 0),
  montant_collecte numeric(10,2) not null default 0,
  repartition_mode text check (repartition_mode in ('egale', 'libre')) not null default 'egale',
  nb_participants_prevu integer check (nb_participants_prevu is null or nb_participants_prevu >= 2),
  date_limite date,
  statut text check (statut in ('ouverte', 'objectif_atteint', 'expiree', 'annulee')) not null default 'ouverte',
  -- Token de partage public (page "Connect Cotisation Publique" — participation
  -- sans compte). 32 caractères hex, non prédictible (master doc §6.1).
  share_token text unique not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_gf_upd on group_fundings;
create trigger trg_gf_upd before update on group_fundings
  for each row execute procedure update_updated_at_generic();

create index if not exists idx_gf_group on group_fundings(group_id, statut);
create index if not exists idx_gf_created_by on group_fundings(created_by);
create index if not exists idx_gf_share_token on group_fundings(share_token);

-- contributor_user_id NULL = participation invitée (page publique, sans compte).
create table if not exists funding_contributions (
  id uuid default gen_random_uuid() primary key,
  funding_id uuid references group_fundings(id) on delete cascade not null,
  contributor_user_id uuid references auth.users on delete set null,
  guest_prenom text,
  guest_email text,
  montant numeric(10,2) not null check (montant > 0),
  statut text check (statut in ('en_attente', 'paye', 'rembourse', 'echoue')) not null default 'en_attente',
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz default now(),
  constraint funding_contributions_contributor_check check (
    contributor_user_id is not null or (guest_prenom is not null and guest_email is not null)
  )
);

create index if not exists idx_fc_funding on funding_contributions(funding_id, statut);
create index if not exists idx_fc_contributor on funding_contributions(contributor_user_id);
create index if not exists idx_fc_stripe_intent on funding_contributions(stripe_payment_intent_id);

-- ── 2. FONCTIONS DE SÉCURITÉ (SECURITY DEFINER — casse tout risque de
--    récursion RLS, même schéma que is_club_admin/is_club_member/
--    is_team_educateur/parent_visible_to_club_admin déjà en place) ──

create or replace function is_member_of_user_group(p_group_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from user_group_members
    where group_id = p_group_id and user_id = auth.uid()
  );
$$;

-- Grant explicite (au lieu de compter sur le défaut PUBLIC de Postgres) :
-- cette fonction est aussi appelée directement depuis une Edge Function via
-- le client utilisateur (create-funding-contribution-checkout), pas
-- seulement depuis les policies RLS ci-dessous.
grant execute on function is_member_of_user_group(uuid) to authenticated;

-- Un funding est visible par : son créateur, un membre du groupe auquel il est
-- rattaché (si rattaché à un groupe), ou quiconque y a une contribution
-- (payée ou non — un participant "en partage libre" sans groupe doit pouvoir
-- suivre sa propre participation même sans lien de groupe).
create or replace function can_view_group_funding(p_funding_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from group_fundings gf
    where gf.id = p_funding_id
      and (
        gf.created_by = auth.uid()
        or (gf.group_id is not null and is_member_of_user_group(gf.group_id))
        or exists (
          select 1 from funding_contributions fc
          where fc.funding_id = gf.id and fc.contributor_user_id = auth.uid()
        )
      )
  );
$$;

-- Appelée directement depuis create-funding-contribution-checkout (via le
-- client utilisateur, pour revérifier l'accès avant de créer une session
-- Stripe) — grant explicite pour la même raison que ci-dessus.
grant execute on function can_view_group_funding(uuid) to authenticated;

-- ── 3. RECALCUL AUTOMATIQUE DU MONTANT COLLECTÉ ──
-- Même principe que recompute_team_project_amount() (migration-clubplus-v21).
-- Se déclenche uniquement quand une contribution change de statut (fait par
-- stripe-webhook en service role, donc jamais bloqué par RLS) : recompte la
-- somme des contributions payées et bascule 'ouverte' -> 'objectif_atteint'
-- si la cible est atteinte. Ne fait jamais régresser un statut déjà avancé
-- (annulee reste annulee).

create or replace function recompute_group_funding_amount()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_funding_id uuid := coalesce(new.funding_id, old.funding_id);
  v_total numeric(10,2);
  v_target numeric(10,2);
  v_statut text;
begin
  select coalesce(sum(montant), 0) into v_total from funding_contributions where funding_id = v_funding_id and statut = 'paye';
  select montant_cible, statut into v_target, v_statut from group_fundings where id = v_funding_id;

  update group_fundings
  set montant_collecte = v_total,
      statut = case
        when v_statut = 'ouverte' and v_target is not null and v_total >= v_target then 'objectif_atteint'
        when v_statut = 'objectif_atteint' and v_target is not null and v_total < v_target then 'ouverte'
        else v_statut
      end
  where id = v_funding_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_fc_recompute on funding_contributions;
create trigger trg_fc_recompute after insert or update or delete on funding_contributions
  for each row execute procedure recompute_group_funding_amount();

-- ── 4. RLS ──

alter table user_groups enable row level security;
alter table user_group_members enable row level security;
alter table group_fundings enable row level security;
alter table funding_contributions enable row level security;

drop policy if exists "ug_member_select" on user_groups;
create policy "ug_member_select" on user_groups for select using (
  created_by = auth.uid() or is_member_of_user_group(id)
);

-- Création : seule la RPC create_user_group() écrit ici en pratique (elle
-- insère aussi la ligne créateur dans user_group_members de façon atomique),
-- mais la policy reste nécessaire car la RPC s'exécute avec les droits de
-- l'appelant sur cette table précise (SECURITY DEFINER ne dispense pas des
-- CHECK constraints applicatives volontairement laissées ici en filet).
drop policy if exists "ug_creator_insert" on user_groups;
create policy "ug_creator_insert" on user_groups for insert with check (created_by = auth.uid());

drop policy if exists "ug_creator_update" on user_groups;
create policy "ug_creator_update" on user_groups for update using (created_by = auth.uid());

-- user_group_members : voir la liste passe par is_member_of_user_group (pas
-- de sous-requête brute sur la même table — cf. note de tête sur la
-- récursion RLS). Rejoindre un groupe par lien est un insert direct
-- volontairement permis (design § Mes équipes : "Toute personne avec ce lien
-- peut rejoindre le groupe.") — pas de RPC nécessaire, la seule donnée
-- mutée est l'appartenance de l'appelant lui-même.
drop policy if exists "ugm_member_select" on user_group_members;
create policy "ugm_member_select" on user_group_members for select using (
  is_member_of_user_group(group_id)
);

drop policy if exists "ugm_self_insert" on user_group_members;
create policy "ugm_self_insert" on user_group_members for insert with check (
  user_id = auth.uid() and exists (select 1 from user_groups g where g.id = group_id)
);

-- group_fundings : lecture large (créateur, membre du groupe, contributeur —
-- via can_view_group_funding), AUCUNE policy insert/update — toute écriture
-- passe par create_group_funding() (RPC) ou par stripe-webhook (service
-- role, bypass RLS), jamais un insert/update client direct sur les montants.
drop policy if exists "gf_visible_select" on group_fundings;
create policy "gf_visible_select" on group_fundings for select using (
  can_view_group_funding(id)
);

-- funding_contributions : le contributeur voit sa propre ligne, toute
-- personne autorisée à voir le funding voit la liste des participants
-- (design § Détail cotisation → "Participants"). AUCUNE policy insert/update
-- — toute écriture passe par les Edge Functions de paiement (service role)
-- ou par stripe-webhook, jamais un insert/update client direct sur un
-- montant ou un statut de paiement.
drop policy if exists "fc_visible_select" on funding_contributions;
create policy "fc_visible_select" on funding_contributions for select using (
  contributor_user_id = auth.uid() or can_view_group_funding(funding_id)
);

-- ── 5. RPCs DE LECTURE (SECURITY DEFINER — contrôle explicite de ce qui est
--    exposé, jamais un simple select brut ouvert aux jointures libres) ──

-- Liste des groupes de l'appelant, avec compteur de membres et un aperçu de
-- 4 avatars (initiales) pour l'affichage en carte (design § Mes équipes).
create or replace function list_my_groups()
returns table (
  id uuid,
  name text,
  description text,
  created_by uuid,
  is_creator boolean,
  member_count bigint,
  member_previews jsonb,
  has_active_funding boolean
) language sql security definer stable set search_path = public as $$
  select
    g.id, g.name, g.description, g.created_by,
    g.created_by = auth.uid() as is_creator,
    (select count(*) from user_group_members m where m.group_id = g.id) as member_count,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'initial', upper(left(coalesce(pp.prenom, split_part(u.email, '@', 1), '?'), 1))
      )), '[]'::jsonb)
      from (
        select m2.user_id from user_group_members m2 where m2.group_id = g.id order by m2.joined_at asc limit 4
      ) m
      left join player_profiles pp on pp.user_id = m.user_id
      left join auth.users u on u.id = m.user_id
    ) as member_previews,
    exists (
      select 1 from group_fundings gf
      where gf.group_id = g.id and gf.statut in ('ouverte', 'objectif_atteint')
    ) as has_active_funding
  from user_groups g
  where is_member_of_user_group(g.id)
  order by g.created_at desc;
$$;

grant execute on function list_my_groups() to authenticated;

-- Détail d'un groupe (membres résolus + éventuelle cotisation active) —
-- retourne NULL si l'appelant n'en est pas membre (le frontend traite NULL
-- comme "introuvable/non autorisé", jamais d'exception exposée au client).
create or replace function get_group_detail(p_group_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  v_group user_groups;
  v_result jsonb;
begin
  if not is_member_of_user_group(p_group_id) then
    return null;
  end if;

  select * into v_group from user_groups where id = p_group_id;
  if not found then return null; end if;

  select jsonb_build_object(
    'id', v_group.id,
    'name', v_group.name,
    'description', v_group.description,
    'created_by', v_group.created_by,
    'created_at', v_group.created_at,
    'member_count', (select count(*) from user_group_members where group_id = v_group.id),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'role', m.role,
        'name', coalesce(nullif(trim(concat(pp.prenom, ' ', pp.nom)), ''), split_part(u.email, '@', 1), 'Membre'),
        'initial', upper(left(coalesce(pp.prenom, split_part(u.email, '@', 1), '?'), 1))
      ) order by m.joined_at asc), '[]'::jsonb)
      from user_group_members m
      left join player_profiles pp on pp.user_id = m.user_id
      left join auth.users u on u.id = m.user_id
      where m.group_id = v_group.id
    ),
    'active_funding', (
      select jsonb_build_object(
        'id', gf.id, 'titre', gf.titre, 'montant_cible', gf.montant_cible,
        'montant_collecte', gf.montant_collecte, 'statut', gf.statut
      )
      from group_fundings gf
      where gf.group_id = v_group.id and gf.statut in ('ouverte', 'objectif_atteint')
      order by gf.created_at desc limit 1
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function get_group_detail(uuid) to authenticated;

-- Liste des cotisations visibles par l'appelant (créateur, membre du groupe,
-- ou contributeur), pour alimenter les 4 onglets de la page Cotisations —
-- le filtrage par onglet se fait côté frontend sur ce jeu de résultats.
-- date_limite dépassée => statut affiché dérivé en 'expiree' SANS écrire en
-- base (pas de cron dans ce chantier pour faire la transition automatique —
-- voir rapport final) : reste honnête sans inventer d'automatisme absent.
create or replace function list_my_fundings()
returns table (
  id uuid,
  group_id uuid,
  group_name text,
  titre text,
  contexte text,
  catalogue_offre_nom text,
  montant_cible numeric,
  montant_collecte numeric,
  repartition_mode text,
  nb_participants_prevu integer,
  date_limite date,
  statut text,
  is_creator boolean,
  participants_count bigint,
  my_contribution_amount numeric,
  created_at timestamptz
) language sql security definer stable set search_path = public as $$
  select
    gf.id, gf.group_id, ug.name as group_name, gf.titre, gf.contexte, co.nom as catalogue_offre_nom,
    gf.montant_cible, gf.montant_collecte, gf.repartition_mode, gf.nb_participants_prevu, gf.date_limite,
    case
      when gf.statut = 'ouverte' and gf.date_limite is not null and gf.date_limite < current_date then 'expiree'
      else gf.statut
    end as statut,
    gf.created_by = auth.uid() as is_creator,
    (select count(*) from funding_contributions fc where fc.funding_id = gf.id and fc.statut = 'paye') as participants_count,
    (select sum(fc.montant) from funding_contributions fc where fc.funding_id = gf.id and fc.contributor_user_id = auth.uid() and fc.statut = 'paye') as my_contribution_amount,
    gf.created_at
  from group_fundings gf
  left join user_groups ug on ug.id = gf.group_id
  left join catalogue_offres co on co.id = gf.catalogue_offre_id
  where gf.created_by = auth.uid()
     or (gf.group_id is not null and is_member_of_user_group(gf.group_id))
     or exists (select 1 from funding_contributions fc where fc.funding_id = gf.id and fc.contributor_user_id = auth.uid())
  order by gf.created_at desc;
$$;

grant execute on function list_my_fundings() to authenticated;

-- Détail d'une cotisation + liste des participations payées. NULL si
-- l'appelant n'y a pas accès (mêmes conventions que get_group_detail).
create or replace function get_funding_detail(p_funding_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  v_funding group_fundings;
  v_offre catalogue_offres;
  v_result jsonb;
  v_display_statut text;
begin
  if not can_view_group_funding(p_funding_id) then
    return null;
  end if;

  select * into v_funding from group_fundings where id = p_funding_id;
  if not found then return null; end if;

  select * into v_offre from catalogue_offres where id = v_funding.catalogue_offre_id;

  v_display_statut := case
    when v_funding.statut = 'ouverte' and v_funding.date_limite is not null and v_funding.date_limite < current_date then 'expiree'
    else v_funding.statut
  end;

  select jsonb_build_object(
    'id', v_funding.id,
    'group_id', v_funding.group_id,
    'group_name', (select name from user_groups where id = v_funding.group_id),
    'created_by', v_funding.created_by,
    'is_creator', v_funding.created_by = auth.uid(),
    'titre', v_funding.titre,
    'contexte', v_funding.contexte,
    'catalogue_offre_nom', v_offre.nom,
    'montant_cible', v_funding.montant_cible,
    'montant_collecte', v_funding.montant_collecte,
    'repartition_mode', v_funding.repartition_mode,
    'nb_participants_prevu', v_funding.nb_participants_prevu,
    'date_limite', v_funding.date_limite,
    'statut', v_display_statut,
    'share_token', v_funding.share_token,
    'created_at', v_funding.created_at,
    'my_contribution_amount', (
      select sum(fc.montant) from funding_contributions fc
      where fc.funding_id = v_funding.id and fc.contributor_user_id = auth.uid() and fc.statut = 'paye'
    ),
    'contributions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', fc.id,
        'name', coalesce(
          nullif(trim(concat(pp.prenom, ' ', pp.nom)), ''),
          fc.guest_prenom,
          split_part(u.email, '@', 1),
          'Participant'
        ),
        'is_guest', fc.contributor_user_id is null,
        'montant', fc.montant,
        'created_at', fc.created_at
      ) order by fc.created_at desc), '[]'::jsonb)
      from funding_contributions fc
      left join player_profiles pp on pp.user_id = fc.contributor_user_id
      left join auth.users u on u.id = fc.contributor_user_id
      where fc.funding_id = v_funding.id and fc.statut = 'paye'
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function get_funding_detail(uuid) to authenticated;

-- Version publique (page "Connect Cotisation Publique", sans authentification)
-- — champs strictement limités à ce qui est déjà montré dans le prototype de
-- référence (jamais d'e-mail/nom de contributeur, jamais d'identifiant
-- interne au-delà du strict nécessaire à l'affichage et au paiement invité).
create or replace function get_public_funding(p_token text)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  v_funding group_fundings;
  v_offre catalogue_offres;
  v_display_statut text;
begin
  select * into v_funding from group_fundings where share_token = p_token;
  if not found then return null; end if;

  select * into v_offre from catalogue_offres where id = v_funding.catalogue_offre_id;

  v_display_statut := case
    when v_funding.statut = 'ouverte' and v_funding.date_limite is not null and v_funding.date_limite < current_date then 'expiree'
    else v_funding.statut
  end;

  return jsonb_build_object(
    'titre', v_funding.titre,
    'contexte', v_funding.contexte,
    'catalogue_offre_nom', v_offre.nom,
    'montant_cible', v_funding.montant_cible,
    'montant_collecte', v_funding.montant_collecte,
    'repartition_mode', v_funding.repartition_mode,
    'nb_participants_prevu', v_funding.nb_participants_prevu,
    'date_limite', v_funding.date_limite,
    'statut', v_display_statut,
    'participants_count', (select count(*) from funding_contributions where funding_id = v_funding.id and statut = 'paye')
  );
end;
$$;

grant execute on function get_public_funding(text) to anon, authenticated;

-- ── 6. RPCs D'ÉCRITURE (jamais de montant/solde confié au client) ──

create or replace function create_user_group(p_name text, p_description text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_name text := trim(coalesce(p_name, ''));
begin
  if v_name = '' then
    raise exception 'Le nom du groupe est obligatoire.';
  end if;

  insert into user_groups (name, description, created_by)
  values (v_name, nullif(trim(coalesce(p_description, '')), ''), auth.uid())
  returning id into v_id;

  insert into user_group_members (group_id, user_id, role) values (v_id, auth.uid(), 'createur');

  return v_id;
end;
$$;

grant execute on function create_user_group(text, text) to authenticated;

-- Rejoindre un groupe depuis le lien d'invitation. Idempotent : rejoindre un
-- groupe dont on est déjà membre ne fait rien et n'est pas une erreur.
create or replace function join_user_group(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_already boolean;
begin
  select name into v_name from user_groups where id = p_group_id;
  if not found then
    raise exception 'Ce lien de groupe n''est plus valide.';
  end if;

  select exists(select 1 from user_group_members where group_id = p_group_id and user_id = auth.uid()) into v_already;

  if not v_already then
    insert into user_group_members (group_id, user_id, role) values (p_group_id, auth.uid(), 'membre');
  end if;

  return jsonb_build_object('ok', true, 'group_name', v_name, 'already_member', v_already);
end;
$$;

grant execute on function join_user_group(uuid) to authenticated;

-- Création d'une cotisation. Le montant cible n'est JAMAIS reçu du client :
-- calculé ici depuis catalogue_offres (prix_ht * (1 + tva_pct/100), même
-- calcul que create-guest-payment-checkout côté Edge Functions) — un tarif
-- "sur devis" ne peut pas être utilisé en paiement collectif (pas de prix
-- fixe à répartir), rejeté explicitement.
create or replace function create_group_funding(
  p_group_id uuid,
  p_catalogue_offre_id uuid,
  p_contexte text,
  p_repartition_mode text,
  p_nb_participants integer,
  p_date_limite date
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offre catalogue_offres;
  v_montant numeric(10,2);
  v_id uuid;
  v_token text;
begin
  if p_group_id is not null and not is_member_of_user_group(p_group_id) then
    raise exception 'Vous n''êtes pas membre de ce groupe.';
  end if;

  if p_repartition_mode not in ('egale', 'libre') then
    raise exception 'Mode de répartition invalide.';
  end if;

  if p_repartition_mode = 'egale' and (p_nb_participants is null or p_nb_participants < 2) then
    raise exception 'Indiquez au moins 2 participants pour une répartition à parts égales.';
  end if;

  if p_date_limite is null or p_date_limite < current_date then
    raise exception 'La date limite doit être une date future.';
  end if;

  select * into v_offre from catalogue_offres where id = p_catalogue_offre_id and actif = true;
  if not found then
    raise exception 'Prestation introuvable ou indisponible.';
  end if;
  if v_offre.tarif_type <> 'fixe' or v_offre.prix_ht is null then
    raise exception 'Cette prestation est sur devis : elle ne peut pas être financée par cotisation.';
  end if;

  v_montant := round(v_offre.prix_ht * (1 + coalesce(v_offre.tva_pct, 20) / 100), 2);

  insert into group_fundings (
    group_id, created_by, catalogue_offre_id, titre, contexte,
    montant_cible, repartition_mode, nb_participants_prevu, date_limite
  ) values (
    p_group_id, auth.uid(), p_catalogue_offre_id, v_offre.nom, nullif(trim(coalesce(p_contexte, '')), ''),
    v_montant, p_repartition_mode, case when p_repartition_mode = 'egale' then p_nb_participants else null end, p_date_limite
  )
  returning id, share_token into v_id, v_token;

  return jsonb_build_object('id', v_id, 'share_token', v_token, 'montant_cible', v_montant);
end;
$$;

grant execute on function create_group_funding(uuid, uuid, text, text, integer, date) to authenticated;
