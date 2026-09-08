-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 3a — Le CM configure son club : informations, equipes, checklist, journal
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Premier lot ou le CM ECRIT. Uniquement sur ses clubs, uniquement sur ce dont il a besoin, et
-- rien ne part : aucune invitation, aucun e-mail, aucun compte cree.
--
-- ── §6, audit fait avant d'ouvrir quoi que ce soit ───────────────────────────
-- Les factures lisent clients.nom, JAMAIS clubs.nom : verifie, aucune fonction de facturation ne
-- touche la table clubs. clubs.nom est donc un nom d'affichage, et clubs.siret la seule donnee
-- juridique de la table. Le CM peut modifier le premier, jamais le second, et n'approche pas
-- clients — c'est la que vit la raison sociale qui finit sur une facture.
--
-- ── La methode pour les informations du club ─────────────────────────────────
-- Une RLS est au niveau LIGNE, pas colonne : autoriser un CM a modifier `clubs` l'autoriserait
-- aussi a ecrire siret. On passe donc par une fonction a liste blanche explicite. Ce qui n'y
-- figure pas ne peut pas etre ecrit, et la liste se lit d'un coup d'oeil.

begin;

-- ── 1. Les equipes : archiver plutot que supprimer (§14) ─────────────────────
alter table club_teams add column if not exists archivee   boolean not null default false;
alter table club_teams add column if not exists saison_id  uuid references saisons(id);
alter table club_teams add column if not exists archivee_at timestamptz;

comment on column club_teams.archivee is
  'Une equipe qui ne joue plus. Archivee, jamais supprimee : ses coachs, ses galeries et ses saisons passees doivent rester rattaches.';

-- Ecriture pour un CM, sur ses clubs uniquement. La suppression n'est PAS accordee : on archive.
drop policy if exists ctm_cm_affecte_insert on club_teams;
create policy ctm_cm_affecte_insert on club_teams for insert
  with check (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()));

drop policy if exists ctm_cm_affecte_update on club_teams;
create policy ctm_cm_affecte_update on club_teams for update
  using (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()))
  with check (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()));

-- ── 2. Les informations du club, par liste blanche ───────────────────────────
create or replace function public.cm_club_infos_maj(
  p_club_id uuid,
  p_nom text default null, p_ville text default null, p_adresse text default null,
  p_logo_url text default null, p_couleur_primaire text default null,
  p_couleur_secondaire text default null, p_instagram text default null,
  p_discipline text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Le perimetre, comme partout : une seule definition.
  if p_club_id not in (select cm_clubs_autorises()) then
    raise exception 'Ce club n''est pas dans votre perimetre.';
  end if;

  -- LISTE BLANCHE. siret n'y est pas, et ne doit jamais y entrer : c'est une donnee juridique.
  -- La raison sociale qui apparait sur les factures vit dans clients.nom, hors d'atteinte d'ici.
  update clubs set
    nom                = coalesce(nullif(btrim(p_nom),''), nom),
    ville              = coalesce(nullif(btrim(p_ville),''), ville),
    adresse            = coalesce(nullif(btrim(p_adresse),''), adresse),
    logo_url           = coalesce(nullif(btrim(p_logo_url),''), logo_url),
    couleur_primaire   = coalesce(nullif(btrim(p_couleur_primaire),''), couleur_primaire),
    couleur_secondaire = coalesce(nullif(btrim(p_couleur_secondaire),''), couleur_secondaire),
    instagram_handle   = coalesce(nullif(btrim(p_instagram),''), instagram_handle),
    discipline         = coalesce(nullif(btrim(p_discipline),''), discipline),
    updated_at         = now()
  where id = p_club_id;

  return found;
end $function$;

comment on function public.cm_club_infos_maj is
  'Les seules informations de club qu''un CM peut modifier. Liste blanche explicite : siret n''y figure pas, et la raison sociale de facturation vit dans clients.nom, hors d''atteinte.';

-- ── 3. Les etapes manuelles de l'onboarding (§24) ────────────────────────────
-- Uniquement ce que le systeme NE PEUT PAS savoir. Le nombre d'equipes, la presence d'un logo ou
-- d'un referent se calculent : demander au CM de les cocher serait lui faire perdre son temps et
-- ouvrir la porte a une checklist qui ment.
create table if not exists club_onboarding_steps (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references clubs(id) on delete cascade,
  step_key     text not null,
  fait         boolean not null default false,
  fait_at      timestamptz,
  fait_par     uuid references profiles(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now(),
  unique (club_id, step_key)
);

comment on table club_onboarding_steps is
  'Les etapes d''onboarding que la base ne peut pas deduire : acces reseaux sociaux recuperes, planning editorial valide, contact WhatsApp etabli. Tout le reste se calcule.';

alter table club_onboarding_steps enable row level security;

drop policy if exists cos_staff_all on club_onboarding_steps;
create policy cos_staff_all on club_onboarding_steps for all
  using (exists (select 1 from profiles p where p.id=auth.uid() and p.role in ('admin','com','sec')))
  with check (exists (select 1 from profiles p where p.id=auth.uid() and p.role in ('admin','com','sec')));

drop policy if exists cos_cm_affecte_all on club_onboarding_steps;
create policy cos_cm_affecte_all on club_onboarding_steps for all
  using (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()))
  with check (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()));

drop policy if exists cm_perim_onboarding_steps on club_onboarding_steps;
create policy cm_perim_onboarding_steps on club_onboarding_steps as restrictive for all to authenticated
  using (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()));

-- ── 4. Le journal (§44) ──────────────────────────────────────────────────────
create table if not exists club_onboarding_events (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references clubs(id) on delete cascade,
  auteur_id  uuid references profiles(id) on delete set null,
  action     text not null,
  detail     text,
  created_at timestamptz not null default now()
);

comment on table club_onboarding_events is
  'Journal leger de la mise en place d''un club : qui a fait quoi, quand. Aucun jeton, aucune donnee sensible n''y est ecrit.';

create index if not exists coe_par_club on club_onboarding_events (club_id, created_at desc);

alter table club_onboarding_events enable row level security;

drop policy if exists coe_staff_select on club_onboarding_events;
create policy coe_staff_select on club_onboarding_events for select
  using (exists (select 1 from profiles p where p.id=auth.uid() and p.role in ('admin','com','sec')));

drop policy if exists coe_cm_affecte_all on club_onboarding_events;
create policy coe_cm_affecte_all on club_onboarding_events for all
  using (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()))
  with check (est_cm_cloisonne() and club_id in (select cm_clubs_autorises()));

drop policy if exists cm_perim_onboarding_events on club_onboarding_events;
create policy cm_perim_onboarding_events on club_onboarding_events as restrictive for all to authenticated
  using (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or club_id in (select cm_clubs_autorises()));

-- ── 5. La preparation d'un club, calculee (§23, §25) ─────────────────────────
-- Chaque ligne dit un etat REEL, lu depuis les donnees. Aucun pourcentage global : additionner
-- des sections qui n'ont pas le meme poids donne un chiffre qui a l'air precis et ne veut rien
-- dire. Un etat par section se lit mieux et ne ment pas.
create or replace function public.club_preparation(p_club_id uuid)
returns table(section text, etat text, detail text, calcule boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with autorise as (select p_club_id as id where p_club_id in (select cm_clubs_autorises())),
  c as (select * from clubs where id = (select id from autorise)),
  eq as (select count(*)::int n from club_teams t where t.club_id = (select id from autorise) and not t.archivee),
  co as (select count(*)::int n from club_members m where m.club_id = (select id from autorise) and m.role = 'coach'),
  pr as (select count(*)::int n from client_organigramme o
         join clubs cl on cl.portail_client_id = o.client_id
         where cl.id = (select id from autorise) and o.role ilike '%pr%sident%')
  select 'Informations du club',
         case when (select nom from c) is not null and (select ville from c) is not null then 'complet' else 'a_completer' end,
         concat_ws(' · ', (select nom from c), (select ville from c)), true
  from c
  union all
  select 'Logo',
         case when coalesce((select logo_url from c),(select ecusson_url from c)) is not null then 'complet' else 'manquant' end,
         null, true from c
  union all
  select 'Équipes',
         case when (select n from eq) > 0 then 'complet' else 'manquant' end,
         (select n from eq)||' équipe'||case when (select n from eq)>1 then 's' else '' end, true
  union all
  select 'Coachs',
         case when (select n from co) > 0 then 'complet' else 'manquant' end,
         (select n from co)||' coach'||case when (select n from co)>1 then 's' else '' end, true
  union all
  select 'Contact président',
         case when (select n from pr) > 0 then 'complet' else 'manquant' end,
         null, true from c
  union all
  select s.step_key, case when s.fait then 'complet' else 'a_faire' end, s.note, false
  from club_onboarding_steps s where s.club_id = (select id from autorise);
$function$;

revoke all on function public.cm_club_infos_maj(uuid,text,text,text,text,text,text,text,text) from public;
revoke all on function public.club_preparation(uuid) from public;
grant execute on function public.cm_club_infos_maj(uuid,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.club_preparation(uuid) to authenticated;

commit;
