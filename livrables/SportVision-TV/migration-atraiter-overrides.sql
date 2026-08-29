-- Migration : moteur global "À traiter" — table légère de persistance des états manuels.
-- À exécuter dans Supabase → SQL Editor.
--
-- Contexte (spec §14-21, refonte "Centre global À traiter") : l'écran "À traiter" transverse
-- (VIEWS['admin.atraiter'], loadATraiter() côté JS) agrège EN LIVE des signaux déjà calculables
-- depuis les tables existantes (prestations, paiements, devis, secretariat_documents,
-- club_requests, plannings_hebdo, incidents, notifications, recruitment_applications, etc.) —
-- voir le commentaire "MOTEUR GLOBAL À TRAITER" au-dessus de computeATraiterItems() dans le HTML
-- pour le détail exact des règles et pourquoi aucune nouvelle table de faits n'a été créée
-- (principe "aucun recalcul" + refus assumé de sur-ingénierie un vrai moteur de règles pour
-- une nuit de travail — cf. Option A documentée dans la mission).
--
-- Cette table sert UNIQUEMENT à faire persister ce que le calcul live ne peut pas connaître :
-- un item marqué "En cours" / "En attente" / "Résolu" / "Ignoré" manuellement par un membre du
-- staff doit rester dans cet état après un rechargement de page, même si la condition source
-- (ex. "devis expire dans 5j") est toujours vraie en base. Dès que la condition source
-- disparaît elle-même (ex. devis accepté), l'item n'est simplement plus recalculé : la ligne
-- d'override devient orpheline (jamais nettoyée automatiquement, volontairement — coût
-- négligeable, quelques dizaines/centaines de lignes par an, pas de job de purge prévu ce soir).
--
-- item_key : identifiant déterministe calculé côté client, forme "type|source_table|source_id"
-- (ex. "commercial|devis|3f2a...", "client|club_requests|9c1b..."). Une même situation
-- métier retombe toujours sur la même clé d'une session à l'autre → l'override s'applique.
create table if not exists atraiter_overrides (
  item_key text primary key,
  type text not null,
  titre text not null,
  statut text not null check (statut in ('en_cours','en_attente','resolu','ignore')),
  note text,
  role_scope text,
  user_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_atraiter_overrides_statut on atraiter_overrides(statut);

alter table atraiter_overrides enable row level security;

drop policy if exists atraiter_overrides_staff_select on atraiter_overrides;
create policy atraiter_overrides_staff_select on atraiter_overrides
  for select using (is_staff());

drop policy if exists atraiter_overrides_staff_write on atraiter_overrides;
create policy atraiter_overrides_staff_write on atraiter_overrides
  for insert with check (is_staff());

drop policy if exists atraiter_overrides_staff_update on atraiter_overrides;
create policy atraiter_overrides_staff_update on atraiter_overrides
  for update using (is_staff()) with check (is_staff());

drop policy if exists atraiter_overrides_staff_delete on atraiter_overrides;
create policy atraiter_overrides_staff_delete on atraiter_overrides
  for delete using (is_staff());

-- updated_at automatique (même patron que les autres tables du projet)
create or replace function set_atraiter_overrides_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_atraiter_overrides_updated_at on atraiter_overrides;
create trigger trg_atraiter_overrides_updated_at
  before update on atraiter_overrides
  for each row execute procedure set_atraiter_overrides_updated_at();

-- Vérification (à exécuter manuellement après migration) :
-- select count(*) from atraiter_overrides; -- doit être 0 juste après la migration
-- select is_staff(); -- doit fonctionner sans erreur (fonction déjà existante dans le projet)
