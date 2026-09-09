-- Annuaire des clubs affilies, et provider SPORTCORICO.
--
-- ── Pourquoi cette migration existe ──
-- Fouka, 09/09/2026 : « tu peux avoir leur SportCorico sans meme que je te le donne ? ». Oui, a
-- condition d'avoir un annuaire : a partir du seul nom d'un club, retrouver son identifiant chez
-- la source, puis sa fiche (numero d'affiliation FFF, ecusson, equipes engagees, calendrier).
--
-- ── Ce que cette migration NE fait PAS ──
-- Elle ne cree AUCUNE architecture de synchronisation : club_calendar_sources,
-- club_team_source_mappings et calendar_sync_runs existent depuis le Lot 0 du 04/09 et sont
-- exactement ce qu'il faut. On ajoute seulement la valeur de provider qui leur manquait et
-- l'annuaire, qui est le seul maillon absent.
--
-- ── Pourquoi SPORTCORICO et pas FFF ──
-- L'audit du 04/09 avait conclu qu'aucune API FFF n'etait ouverte aux tiers. La verification du
-- 09/09 va plus loin : tout le domaine fff.fr repond 403 depuis une machine (Akamai Bot Manager),
-- pages publiques, medias et api-dofa compris. Un connecteur FFF direct serait bloque des le
-- premier appel. SportCorico republie ces memes donnees, autorise le crawl dans son robots.txt
-- (`Allow: /`) et expose une API JSON sans authentification. Nommer le provider d'apres la source
-- reellement interrogee evite de laisser croire qu'on parle a la federation.
--
-- ── Pourquoi l'annuaire est un cache progressif ──
-- Le sitemap public de la source liste 34 586 clubs, mais ne donne que leur identifiant. Le nom
-- exact, la ville, le sport, le numero d'affiliation et l'ecusson ne s'obtiennent qu'en appelant
-- la fiche, un appel par club. Peupler l'annuaire complet couterait 34 586 appels a un service
-- tiers pour une donnee dont on n'utilisera qu'une poignee. On stocke donc tous les identifiants
-- (c'est ce qui rend la recherche possible) et on enrichit une fiche le jour ou on la consulte.

begin;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Le provider manquant sur les trois tables du socle de synchronisation
-- ═══════════════════════════════════════════════════════════════════════

alter table public.club_matches drop constraint if exists club_matches_provider_check;
alter table public.club_matches add constraint club_matches_provider_check
  check (provider in ('MANUAL','CSV','ICS','FOOTCLUBS_XLSX','PDF','FFF','SPORTCORICO','OTHER'));

alter table public.club_calendar_sources drop constraint if exists club_calendar_sources_provider_check;
alter table public.club_calendar_sources add constraint club_calendar_sources_provider_check
  check (provider in ('MANUAL','CSV','ICS','FOOTCLUBS_XLSX','PDF','FFF','SPORTCORICO','OTHER'));

alter table public.club_team_source_mappings drop constraint if exists club_team_source_mappings_provider_check;
alter table public.club_team_source_mappings add constraint club_team_source_mappings_provider_check
  check (provider in ('MANUAL','CSV','ICS','FOOTCLUBS_XLSX','PDF','FFF','SPORTCORICO','OTHER'));

-- ═══════════════════════════════════════════════════════════════════════
-- 2. L'annuaire
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.federation_clubs (
  source text not null default 'SPORTCORICO',
  slug text not null,
  -- Forme normalisee servant a la recherche : minuscules, sans accent, tirets remplaces par des
  -- espaces. Stockee plutot que calculee a chaque requete, pour que la recherche reste une
  -- comparaison de texte simple sur 34 000 lignes.
  recherche text not null,

  -- Renseignes seulement apres consultation de la fiche (cache progressif, cf. en-tete).
  nom text,
  ville text,
  code_postal text,
  departement text,
  region text,
  sport text,
  affiliation_number text,
  logo_url text,
  site_url text,
  nb_equipes integer,
  enrichi_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source, slug)
);

comment on table public.federation_clubs is
  'Annuaire des clubs affilies, importe depuis le sitemap public de la source (34 586 entrees au 09/09/2026). Sert a retrouver un club a partir de son seul nom, puis a recuperer sa fiche : numero d''affiliation FFF, ecusson, equipes engagees, calendrier. Les colonnes descriptives sont un cache progressif, remplies a la premiere consultation — jamais par un balayage de la source entiere.';

comment on column public.federation_clubs.recherche is
  'Nom normalise (minuscules, sans accent, sans tiret) sur lequel porte la recherche. Un simple index b-tree suffit : 34 000 lignes se filtrent en quelques millisecondes, pg_trgm serait une dependance de plus pour rien.';

comment on column public.federation_clubs.enrichi_at is
  'Date du dernier appel a la fiche chez la source. Nul tant que le club n''a jamais ete consulte : les colonnes descriptives sont alors vides, et seul `slug` est fiable.';

create index if not exists idx_federation_clubs_recherche on public.federation_clubs (recherche text_pattern_ops);
create index if not exists idx_federation_clubs_affiliation on public.federation_clubs (affiliation_number)
  where affiliation_number is not null;

alter table public.federation_clubs enable row level security;

-- Annuaire public de clubs sportifs : aucune donnee personnelle, aucun rattachement a un club
-- SportVision. Lisible par tout utilisateur connecte — jamais par `anon`, qui ne doit garder
-- acces qu'aux quelques tables de reference deja ouvertes.
drop policy if exists federation_clubs_lecture on public.federation_clubs;
create policy federation_clubs_lecture on public.federation_clubs
  for select to authenticated using (true);

-- Aucune policy d'ecriture : seul le service_role (l'edge function et le script de peuplement)
-- ecrit ici. Un utilisateur ne doit pas pouvoir empoisonner l'annuaire.

create or replace function public.set_updated_at_federation_clubs()
returns trigger language plpgsql as $function$
begin new.updated_at = now(); return new; end;
$function$;

drop trigger if exists trg_federation_clubs_updated_at on public.federation_clubs;
create trigger trg_federation_clubs_updated_at before update on public.federation_clubs
  for each row execute function public.set_updated_at_federation_clubs();

-- ═══════════════════════════════════════════════════════════════════════
-- 3. La recherche
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.federation_clubs_rechercher(p_q text, p_limite int default 15)
returns table (
  source text, slug text, nom text, ville text, departement text,
  sport text, affiliation_number text, logo_url text, enrichi boolean, score int
)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
  -- La colonne `recherche` est ecrite deja normalisee (minuscules, sans accent, tirets remplaces
  -- par des espaces). On applique ici EXACTEMENT la meme normalisation a la saisie, sinon
  -- « Séniors » ne trouverait jamais « seniors ». unaccent est deja installee sur ce projet.
  with terme as (
    select trim(regexp_replace(lower(unaccent(coalesce(p_q, ''))), '[^a-z0-9]+', ' ', 'g')) as q
  )
  select f.source, f.slug, f.nom, f.ville, f.departement,
         f.sport, f.affiliation_number, f.logo_url,
         f.enrichi_at is not null as enrichi,
         -- Un club dont le nom COMMENCE par la recherche passe devant celui qui la contient au
         -- milieu : « villemomble » doit remonter « villemomble sports » avant
         -- « as amis de villemomble ».
         case when f.recherche = t.q then 0
              when f.recherche like t.q || '%' then 1
              else 2 end as score
    from public.federation_clubs f, terme t
   where length(t.q) >= 3
     and f.recherche like '%' || t.q || '%'
   order by score, length(f.recherche), f.recherche
   limit greatest(1, least(coalesce(p_limite, 15), 50));
$function$;

comment on function public.federation_clubs_rechercher(text, int) is
  'Recherche un club dans l''annuaire par son nom. Trois caracteres minimum : en deca, la requete ramenerait des milliers de lignes sans rien apprendre a personne. Le classement fait remonter la correspondance exacte, puis le prefixe, puis le nom le plus court — « villemomble » doit donner « villemomble sports » avant « as amis de villemomble ».';

commit;
