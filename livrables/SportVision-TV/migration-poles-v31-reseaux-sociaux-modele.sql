-- ============================================================================
-- migration-poles-v31-reseaux-sociaux-modele.sql
-- Master prompt multi-pôles, §15 (01/09/2026) : "Au départ, la communication
-- reste centralisée sur SportVision. Mais prévoir dans l'architecture :
-- SportVision Football, SportVision Basket [...]. Ne crée pas forcément une
-- grosse interface sociale maintenant. Prépare simplement correctement le
-- modèle de données."
--
-- Pas d'écran dédié ce soir (hors périmètre explicite) — juste une table
-- simple, pole_id nullable : NULL = compte partagé SportVision (état actuel,
-- réel), non-NULL = compte dédié à un pôle (état futur, quand un pôle
-- atteint le seuil ~5000 abonnés évoqué dans le master prompt). Même
-- convention que kits/materiels (pole_id NULL = "commun").
-- ============================================================================

create table if not exists public.reseaux_sociaux_comptes (
  id uuid primary key default gen_random_uuid(),
  pole_id uuid references public.poles(id) on delete cascade,
  plateforme text not null check (plateforme in ('instagram','tiktok','facebook','youtube','autre')),
  nom_compte text not null,
  url text,
  statut text not null default 'actif' check (statut in ('actif','planifie')),
  nb_abonnes integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.reseaux_sociaux_comptes is 'Comptes réseaux sociaux SportVision, scopés par pôle (master prompt multi-pôles §15, 01/09/2026). pole_id NULL = compte partagé/centralisé (situation actuelle) ; non-NULL = compte dédié à ce pôle une fois la séparation déclenchée. nb_abonnes est un instantané saisi manuellement, aucune synchronisation automatique prévue.';
comment on column public.reseaux_sociaux_comptes.statut is '''actif'' = compte réellement utilisé aujourd''hui ; ''planifie'' = compte prévu mais pas encore créé (utile pour lister "SportVision Basket" comme cible avant sa création réelle).';

create index if not exists idx_reseaux_sociaux_comptes_pole on public.reseaux_sociaux_comptes(pole_id);

alter table public.reseaux_sociaux_comptes enable row level security;

-- Lecture : tout membre du staff (données publiques par nature — des handles/URLs de comptes
-- sociaux affichés sur la vitrine, rien de confidentiel). Écriture : admin uniquement pour l'instant,
-- aucune UI ne l'expose encore à un Responsable de pôle — se resserrera/s'ouvrira naturellement le
-- jour où un écran dédié sera construit, sans changement de schéma nécessaire à ce moment-là.
create policy reseaux_sociaux_comptes_select_staff on public.reseaux_sociaux_comptes
  for select using (is_staff());
create policy reseaux_sociaux_comptes_admin_all on public.reseaux_sociaux_comptes
  for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Trigger updated_at, même patron que le reste des tables multi-pôles (ex. poles.updated_at).
create or replace function public.set_updated_at_reseaux_sociaux_comptes()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
drop trigger if exists trg_reseaux_sociaux_comptes_updated_at on public.reseaux_sociaux_comptes;
create trigger trg_reseaux_sociaux_comptes_updated_at
  before update on public.reseaux_sociaux_comptes
  for each row execute function public.set_updated_at_reseaux_sociaux_comptes();

-- Compte SportVision partagé réel, déjà en ligne sur la vitrine (footer + header de toutes les
-- pages publiques) : seul compte existant aujourd'hui, sert de première ligne réelle plutôt que de
-- laisser la table vide. nb_abonnes volontairement laissé NULL (donnée non connue avec certitude,
-- jamais devinée).
insert into public.reseaux_sociaux_comptes (pole_id, plateforme, nom_compte, url, statut)
select null, 'instagram', '@Sportvision_an', 'https://www.instagram.com/Sportvision_an/', 'actif'
where not exists (
  select 1 from public.reseaux_sociaux_comptes where pole_id is null and plateforme = 'instagram'
);

-- ROLLBACK :
-- drop trigger if exists trg_reseaux_sociaux_comptes_updated_at on public.reseaux_sociaux_comptes;
-- drop function if exists public.set_updated_at_reseaux_sociaux_comptes();
-- drop table if exists public.reseaux_sociaux_comptes;
