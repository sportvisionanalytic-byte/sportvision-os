-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 1 — Affectation des CM et cloisonnement par club
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Aujourd'hui, un CM est rattache a un CLIENT par une colonne, clients.cm_id : un seul CM, aucune
-- date, aucun historique, aucune desaffectation propre. Et surtout, le role `cm` fait partie de
-- is_staff(), la fonction qui garde 82 policies : un CM lit donc les equipes, les affiliations,
-- les demandes d'adhesion et les joueurs declares de TOUS les clubs.
--
-- Ce lot pose le perimetre. Il ne donne AUCUN pouvoir nouveau : il en retire.
--
-- ── La methode : des policies RESTRICTIVE ────────────────────────────────────
-- Les policies normales s'additionnent (OR) : en ajouter une n'aurait rien resserre. Une policy
-- RESTRICTIVE se combine en ET avec toutes les autres, et ne peut donc que retirer de l'acces.
-- Elle est ecrite pour n'avoir d'effet QUE sur les CM : pour tout autre role, sa condition est
-- vraie et elle ne change rien. C'est ce qui permet de cloisonner sans toucher aux 82 policies
-- existantes ni a is_staff(), et sans risquer de casser l'ecran d'un comptable ou d'un photographe.
--
-- ── DETTE P1 TRANSITOIRE, a fermer ───────────────────────────────────────────
-- Le role `cm` reste dans is_staff(). Les tables listees plus bas sont desormais cloisonnees,
-- mais toutes les autres surfaces gardees par is_staff() restent ouvertes a tous les clubs. La
-- liste exacte est produite par media_cm_surfaces_heritees() ci-dessous : elle sert a fermer cet
-- heritage ecran par ecran, pas d'un coup un vendredi soir.

begin;

-- ── 1. L'affectation ─────────────────────────────────────────────────────────
create table if not exists club_cm_affectations (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references clubs(id)    on delete cascade,
  cm_id       uuid not null references profiles(id) on delete cascade,
  role        text not null default 'principal' check (role in ('principal','secondaire')),
  date_debut  date not null default current_date,
  date_fin    date,
  actif       boolean not null default true,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint cca_dates_coherentes check (date_fin is null or date_fin >= date_debut)
);

comment on table club_cm_affectations is
  'Qui, chez SportVision, est reference d''un club. Remplace clients.cm_id, qui ne gerait ni plusieurs CM, ni historique, ni desaffectation. C''est cette table qui gouverne le perimetre de lecture d''un CM (voir cm_clubs_autorises).';

-- Un seul CM principal actif par club a la fois. Les secondaires ne sont pas limites.
create unique index if not exists cca_un_seul_principal_actif
  on club_cm_affectations (club_id)
  where role = 'principal' and actif;

create index if not exists cca_par_cm   on club_cm_affectations (cm_id) where actif;
create index if not exists cca_par_club on club_cm_affectations (club_id) where actif;

-- ── 2. La fonction de perimetre ──────────────────────────────────────────────
-- UNE seule definition de « quels clubs cette personne peut-elle toucher ». Ecrite ici et nulle
-- part ailleurs : quarante policies portant chacune leur propre `cm_id = auth.uid()` finiraient
-- par diverger, et la premiere oubliee serait la fuite.
create or replace function public.cm_clubs_autorises()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  -- La direction et les fonctions transverses gardent leur vue globale.
  select c.id from clubs c
  where exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role in ('admin','com','sec','prod','compta','rh')
  )
  union
  -- Un CM : uniquement ses affectations, actives et dans leur fenetre de dates. La desactivation
  -- retire donc l'acces au prochain acces, sans aucune tache de nettoyage.
  select a.club_id
  from club_cm_affectations a
  where a.cm_id = auth.uid()
    and a.actif
    and a.date_debut <= current_date
    and (a.date_fin is null or a.date_fin >= current_date);
$function$;

comment on function public.cm_clubs_autorises() is
  'Les clubs que l''utilisateur courant peut toucher. Source unique du cloisonnement CM : toute policy qui restreint un CM doit passer par elle.';

-- Vrai uniquement pour un CM : les policies restrictives ci-dessous ne mordent que sur lui.
create or replace function public.est_cm_cloisonne()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm');
$function$;

revoke all on function public.cm_clubs_autorises()  from public;
revoke all on function public.est_cm_cloisonne()    from public;
grant execute on function public.cm_clubs_autorises() to authenticated;
grant execute on function public.est_cm_cloisonne()   to authenticated;

-- ── 3. Compatibilite : clients.cm_id reste, alimente par la nouvelle relation ─
-- Aucun ecran existant n'est casse. La colonne devient un reflet, plus une source.
create or replace function public.cca_refleter_clients_cm()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_club uuid; v_cm uuid;
begin
  v_club := coalesce(new.club_id, old.club_id);
  -- Le CM principal actif du club, s'il y en a un.
  select a.cm_id into v_cm
  from club_cm_affectations a
  where a.club_id = v_club and a.role = 'principal' and a.actif
    and a.date_debut <= current_date
    and (a.date_fin is null or a.date_fin >= current_date)
  limit 1;

  update clients c set cm_id = v_cm
  where c.id = v_club or c.id in (select legacy_client_id from organizations where id = v_club);
  return null;
end $function$;

drop trigger if exists trg_cca_refleter on club_cm_affectations;
create trigger trg_cca_refleter
  after insert or update or delete on club_cm_affectations
  for each row execute function public.cca_refleter_clients_cm();

-- ── 4. Qui peut affecter un CM ───────────────────────────────────────────────
alter table club_cm_affectations enable row level security;

drop policy if exists cca_direction_all on club_cm_affectations;
create policy cca_direction_all on club_cm_affectations for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','com')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','com')));

-- Un CM voit ses propres affectations, et rien d'autre. Il ne se les accorde pas.
drop policy if exists cca_cm_self_select on club_cm_affectations;
create policy cca_cm_self_select on club_cm_affectations for select
  using (cm_id = auth.uid());

commit;
