-- ============================================================
-- SPORTVISION CLUB+ — Migration v29
-- Suite de migration-clubplus-v1 à v28.sql. Idempotente.
--
-- Portée : heures calmes du centre de préférences de notification,
-- décrites dans le dossier de référence de design SportVision Connect
-- (context/import/SportVision-Connect-Design/ACTIONS.md §17) mais pas
-- encore reprises côté Club+ lors de la migration v28 (qui n'a livré
-- que les bascules par catégorie). Trois réglages par utilisateur :
--   - not_before / not_after : plage horaire d'envoi des e-mails non
--     critiques (défaut 08:00–21:00)
--   - sunday_urgent_only : le dimanche, seules les catégories toujours
--     envoyées (SECURITY/LEGAL/BILLING ou template mandatory=true,
--     cf. migration-clubplus-v28) passent — défaut activé
--
-- Comme pour notification_preferences (v28), les notifications
-- critiques ignorent ce réglage : c'est dispatch-notifications/index.ts
-- qui applique la règle à la lecture, jamais un blocage à l'écriture
-- ici.
--
-- Une ligne par utilisateur (pas par catégorie, contrairement à
-- notification_preferences) : les heures calmes sont un réglage global
-- de l'utilisateur, pas par type de notification.
-- ============================================================

create table if not exists notification_quiet_hours (
  user_id uuid references auth.users on delete cascade primary key,
  not_before time not null default '08:00',
  not_after time not null default '21:00',
  sunday_urgent_only boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

drop trigger if exists trg_notification_quiet_hours_updated_at on notification_quiet_hours;
create or replace function set_notification_quiet_hours_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger trg_notification_quiet_hours_updated_at before update on notification_quiet_hours
  for each row execute procedure set_notification_quiet_hours_updated_at();

alter table notification_quiet_hours enable row level security;
drop policy if exists "nqh_owner_all" on notification_quiet_hours;
create policy "nqh_owner_all" on notification_quiet_hours for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
