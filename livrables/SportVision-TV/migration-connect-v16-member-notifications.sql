-- ============================================================
-- Migration v16 — notifications in-app pour les comptes Connect (club,
-- coach, académie, sponsor, joueur, parent, projet).
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- `notifications` (schéma d'origine) a un FK strict destinataire_id →
-- profiles(id) — profiles est réservé au staff SportVision, un compte
-- Connect n'y a jamais de ligne (migration-clubplus-v1.sql). Aucune table
-- de notifications in-app n'existe donc aujourd'hui pour un compte Connect
-- réel. `notification_preferences`/`notification_quiet_hours` (déjà
-- utilisées par /notifications/preferences, réel et fonctionnel) sont
-- keyed directement sur auth.uid() — même patron repris ici.
--
-- Table neuve, générique à tout type de compte (pas de variante par
-- organization_type). Pas de policy INSERT pour authenticated : un compte
-- Connect ne peut jamais s'auto-fabriquer une notification, seul le staff
-- (for all) et les triggers ci-dessous (security definer, contournent la
-- RLS) écrivent dedans.
--
-- Alimentation initiale : deux triggers, sur factures (passage à
-- en_retard/payee) et contenus (passage à a_valider_client). Fanout vers
-- tout club_member actif du club lié (club_member_has_client_access) ET
-- vers le client_users direct s'il existe — mêmes deux chemins d'accès que
-- messages_client/contenus (v33/v34). Étendu au cas par cas plus tard.
--
-- Additive, idempotente (create table if not exists, create or replace
-- function, drop trigger if exists).
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- table member_notifications, policies mn_owner_select/mn_owner_update/
-- mn_staff_all et fonctions notify_client_members/trg_notify_facture_statut/
-- trg_notify_contenu_a_valider existent déjà en base. Cet en-tête disait à
-- tort "NON EXÉCUTÉE".
-- ============================================================

create table if not exists member_notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  category text not null check (category in ('content','requests','payments','contracts','services','calendar','users','system')),
  title text not null,
  body text,
  target_href text,
  is_pinned boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table member_notifications enable row level security;
create index if not exists idx_member_notifications_user on member_notifications(user_id, created_at desc);

drop policy if exists "mn_owner_select" on member_notifications;
create policy "mn_owner_select" on member_notifications for select using (user_id = auth.uid());

drop policy if exists "mn_owner_update" on member_notifications;
create policy "mn_owner_update" on member_notifications for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "mn_staff_all" on member_notifications;
create policy "mn_staff_all" on member_notifications for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com','prod'))
);

-- ─── Fanout — résout tous les destinataires réels d'un client_id donné ────
-- (le client_users direct s'il existe, plus tout club_member actif du club
-- lié) — factorisé pour être réutilisé par les deux triggers ci-dessous.
create or replace function notify_client_members(
  p_client_id uuid, p_category text, p_title text, p_body text, p_target_href text
)
returns void language plpgsql security definer as $$
begin
  insert into member_notifications (user_id, category, title, body, target_href)
  select cu.id, p_category, p_title, p_body, p_target_href
  from client_users cu where cu.client_id = p_client_id;

  insert into member_notifications (user_id, category, title, body, target_href)
  select cm.user_id, p_category, p_title, p_body, p_target_href
  from club_members cm
  join clubs c on c.id = cm.club_id
  where c.portail_client_id = p_client_id and cm.status = 'actif';
end;
$$;

-- ─── Trigger factures — passage à en_retard/payee ─────────────────────────
create or replace function trg_notify_facture_statut()
returns trigger language plpgsql security definer as $$
begin
  if new.statut is distinct from old.statut and new.statut in ('en_retard', 'payee') then
    perform notify_client_members(
      new.client_id,
      'payments',
      case when new.statut = 'en_retard' then 'Facture en retard' else 'Facture payée' end,
      'Facture ' || coalesce(new.numero, '') || ' — ' || coalesce(new.montant_ttc::text, '?') || ' € TTC.',
      '/billing'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_facture_statut on factures;
create trigger notify_facture_statut after update on factures
  for each row execute function trg_notify_facture_statut();

-- ─── Trigger contenus — passage à a_valider_client ─────────────────────────
create or replace function trg_notify_contenu_a_valider()
returns trigger language plpgsql security definer as $$
begin
  if new.statut is distinct from old.statut and new.statut = 'a_valider_client' and new.client_id is not null then
    perform notify_client_members(
      new.client_id,
      'content',
      'Contenu à valider',
      coalesce(new.titre, 'Un contenu') || ' attend votre validation.',
      '/validations'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_contenu_a_valider on contenus;
create trigger notify_contenu_a_valider after update on contenus
  for each row execute function trg_notify_contenu_a_valider();
