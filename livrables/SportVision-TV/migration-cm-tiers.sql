-- Migration : paliers Community Manager (niveau_cm) + portefeuille client
-- (clients.cm_id), et correctif d'une faille RLS préexistante.
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- Le rôle 'cm' est aujourd'hui plat : tous les Community Managers ont le
-- même accès. On introduit 7 paliers (niveau_cm), chacun avec sa propre
-- règle de visibilité sur les clients :
--   cm_junior / cm_confirme / cm_full_communication : portefeuille
--     personnel (clients.cm_id = auth.uid())
--   cm_club_plus_studio : tout client avec un contrat actif type_contrat
--     = 'club_plus' (traitement de demandes ponctuelles, pas d'affectation)
--   cm_evenement : tout client avec un contrat actif type_contrat =
--     'evenement'
--   cm_interne : aucun accès client (gère les réseaux SportVision elle-même)
--   cm_lead : tous les clients, seul palier (avec admin) autorisé à classer
--     les autres CM et à affecter cm_id
--
-- ─── Faille découverte en marge de ce travail ───────────────────────────
-- Les policies "clients_acces" (supabase-schema-v2.sql) et "contrats_acces"
-- (migration-contrats.sql) n'ont JAMAIS inclus role='cm'. Concrètement, tout
-- CM a toujours eu un accès RLS refusé (résultat vide) sur clients/contrats,
-- y compris via la page "Clubs affiliés" livrée avant cette migration. Cette
-- migration corrige ça en même temps qu'elle pose les nouvelles règles par
-- palier — c'est la même surface RLS.
--
-- ─── Ce que fait cette migration ────────────────────────────────────────
-- 1. Colonne profiles.niveau_cm (texte, NULL = non classé = aucun accès).
-- 2. Colonne clients.cm_id (CM affecté, nullable).
-- 3. Étend le trigger protect_sensitive_profile_fields (posé par
--    migration-securite-profiles-rls.sql) pour protéger aussi niveau_cm :
--    admin uniquement, sauf exception pour Lead CM qui peut classer les
--    autres CM.
-- 4. Policy UPDATE permettant à Lead CM de modifier les profils role='cm'
--    (le trigger du point 3 continue d'y interdire role/grade).
-- 5. Trigger protect_client_cm_assignment : seul admin ou Lead CM peut
--    modifier clients.cm_id.
-- 6. Remplace clients_acces/contrats_acces par une séparation lecture/
--    écriture : les rôles historiques (admin/sec/com/compta/prod) gardent
--    exactement les mêmes droits qu'avant sur une policy _write_acces
--    "for all" ; une nouvelle policy _select_acces, lecture seule, ajoute
--    cm avec sa règle par palier. Volontairement séparé en deux policies :
--    ajouter 'cm' directement dans l'ancienne policy "for all" lui aurait
--    donné INSERT/UPDATE/DELETE complets sur clients, contournant en
--    silence le garde-fou déjà présent côté app
--    (modalModifierClient : canEdit = S.role !== 'cm').
-- 7. Policy notifs_lead_cm_read : Lead CM voit les contenus
--    (notifications type=contenu) de toute l'équipe, pas seulement les
--    siens.
--
-- ─── Risque résiduel assumé ──────────────────────────────────────────────
-- contrats_cm_select_acces donne un accès SELECT ligne entière (montant_mensuel
-- inclus) à tout CM ayant un contrat visible dans son périmètre. L'app ne
-- l'affiche jamais dans l'UI CM (voir loadCmClients), mais un CM techniquement
-- averti pourrait lire ces montants par un appel direct à l'API REST. Même
-- classe de risque résiduel que la colonne xp documentée dans
-- migration-securite-profiles-rls.sql : accepté car la donnée sensible réelle
-- (marge, rentabilité) n'est de toute façon jamais stockée sur `contrats`.
--
-- Idempotente : DROP ... IF EXISTS avant chaque CREATE, peut être rejouée
-- sans effet de bord.
-- À exécuter dans Supabase → SQL Editor.

-- ─── 1. profiles.niveau_cm ───────────────────────────────────────────────
alter table profiles
  add column if not exists niveau_cm text;

alter table profiles drop constraint if exists profiles_niveau_cm_check;
alter table profiles add constraint profiles_niveau_cm_check
  check (niveau_cm is null or niveau_cm in (
    'cm_junior','cm_confirme','cm_full_communication',
    'cm_club_plus_studio','cm_evenement','cm_interne','cm_lead'
  ));

-- ─── 2. clients.cm_id ────────────────────────────────────────────────────
alter table clients
  add column if not exists cm_id uuid references profiles(id);
create index if not exists idx_clients_cm_id on clients(cm_id);

-- ─── 3. Trigger profiles : protège aussi niveau_cm ──────────────────────
create or replace function protect_sensitive_profile_fields()
returns trigger language plpgsql security definer as $$
declare
  is_admin boolean;
  is_lead_cm boolean;
begin
  select exists(
    select 1 from profiles where id = auth.uid() and role = 'admin'
  ) into is_admin;

  select exists(
    select 1 from profiles where id = auth.uid() and role = 'cm' and niveau_cm = 'cm_lead'
  ) into is_lead_cm;

  if not is_admin then
    if new.role is distinct from old.role
       or new.grade is distinct from old.grade
       or new.grade_valide_at is distinct from old.grade_valide_at
       or new.grade_valide_par is distinct from old.grade_valide_par
    then
      raise exception 'Modification non autorisée : rôle et grade sont réservés à l''administrateur.';
    end if;
    if new.niveau_cm is distinct from old.niveau_cm and not is_lead_cm then
      raise exception 'Modification non autorisée : le niveau CM est réservé à l''administrateur ou au Lead CM.';
    end if;
  end if;

  return new;
end;
$$;
-- Le trigger trg_protect_sensitive_profile_fields est déjà attaché par
-- migration-securite-profiles-rls.sql — seule la fonction est remplacée,
-- pas besoin de recréer le trigger.

-- ─── 4. Policy : Lead CM peut modifier les profils des autres CM ────────
drop policy if exists "Lead CM met à jour profils CM" on profiles;
create policy "Lead CM met à jour profils CM" on profiles
  for update using (
    role = 'cm'
    and exists (
      select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead'
    )
  );

-- ─── 5. Trigger clients : protège cm_id ──────────────────────────────────
create or replace function protect_client_cm_assignment()
returns trigger language plpgsql security definer as $$
declare
  is_privileged boolean;
begin
  if new.cm_id is distinct from old.cm_id then
    select exists(
      select 1 from profiles where id = auth.uid()
      and (role = 'admin' or (role = 'cm' and niveau_cm = 'cm_lead'))
    ) into is_privileged;
    if not is_privileged then
      raise exception 'Modification non autorisée : l''affectation du CM est réservée à l''administrateur ou au Lead CM.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_client_cm_assignment on clients;
create trigger trg_protect_client_cm_assignment
  before update on clients
  for each row execute function protect_client_cm_assignment();

-- ─── 6. Correctif RLS : clients / contrats — lecture cm par palier ──────
drop policy if exists "clients_acces" on clients;

create policy "clients_write_acces" on clients for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com','compta','prod'))
);

create policy "clients_cm_select_acces" on clients for select using (
  exists (
    select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and (
      p.niveau_cm = 'cm_lead'
      or (p.niveau_cm in ('cm_junior','cm_confirme','cm_full_communication') and clients.cm_id = auth.uid())
      or (p.niveau_cm = 'cm_club_plus_studio' and exists (
        select 1 from contrats c where c.client_id = clients.id and c.type_contrat = 'club_plus' and c.statut = 'actif'
      ))
      or (p.niveau_cm = 'cm_evenement' and exists (
        select 1 from contrats c where c.client_id = clients.id and c.type_contrat = 'evenement' and c.statut = 'actif'
      ))
      -- niveau_cm IS NULL (CM non classé) ou 'cm_interne' : aucun accès lecture
    )
  )
);

drop policy if exists "contrats_acces" on contrats;

create policy "contrats_write_acces" on contrats for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com','compta'))
);

create policy "contrats_cm_select_acces" on contrats for select using (
  exists (
    select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and (
      p.niveau_cm = 'cm_lead'
      or (p.niveau_cm in ('cm_junior','cm_confirme','cm_full_communication')
          and exists (select 1 from clients cl where cl.id = contrats.client_id and cl.cm_id = auth.uid()))
      or (p.niveau_cm = 'cm_club_plus_studio' and contrats.type_contrat = 'club_plus' and contrats.statut = 'actif')
      or (p.niveau_cm = 'cm_evenement' and contrats.type_contrat = 'evenement' and contrats.statut = 'actif')
    )
  )
);

-- ─── 7. Lead CM voit les contenus de toute l'équipe ─────────────────────
drop policy if exists "notifs_lead_cm_read" on notifications;
create policy "notifs_lead_cm_read" on notifications for select using (
  type = 'contenu'
  and exists (select 1 from profiles where id = auth.uid() and role = 'cm' and niveau_cm = 'cm_lead')
);
