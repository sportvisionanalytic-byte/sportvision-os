-- ============================================================================
-- migration-fullcom-provisioning-auto.sql
-- ============================================================================
-- Provisioning automatique du workspace Club+ à la création d'un client Full
-- Communication (ou à l'activation de son contrat), SANS supprimer le verrou
-- de sécurité existant (le lien d'activation cliqué par le dirigeant du club
-- reste le geste de prise de possession — décision Fouka, 28/08/2026).
--
-- Contexte vérifié dans la base réelle avant d'écrire cette migration (elle a
-- beaucoup bougé depuis l'audit du soir) :
--
-- (a) Le trigger `trg_sync_club_to_organization` (AFTER INSERT OR UPDATE ON
--     clubs, fonction `sync_club_to_organization()`) EXISTE DÉJÀ en prod et
--     couvre entièrement le risque "clubs sans organizations correspondante"
--     décrit dans l'audit du soir (il n'était pas encore en place à ce
--     moment-là — introduit entre-temps, cf. migration-connect-v5-membership-
--     invite.sql / migration-crm-v91-statut-split.sql / migration-connect-v8-
--     fix-organizations-statut-default.sql / migration-securite-v98-search-
--     path-hardening.sql). Cette migration ne le recrée donc PAS : tout INSERT
--     dans `clubs` (y compris depuis la fonction ci-dessous) fait apparaître
--     sa ligne `organizations` correspondante automatiquement, avant même la
--     fin de l'instruction INSERT (trigger AFTER ROW, même transaction).
--
-- (b) Ce qui manque réellement : rien ne crée le club/organization/
--     entitlements AVANT le clic du dirigeant. `lancerCascadeFullCom()` se
--     contente d'envoyer un lien d'activation ; `activer_entitlements_full_
--     communication()` (trigger sur `contrats`) cherche un club via
--     portail_client_id au moment où le contrat passe à 'actif', mais ce club
--     n'existe pas encore à cet instant (il n'est créé que dans l'edge
--     function clubplus-activate, au clic) — donc `v_club_id is not null` est
--     faux et rien ne se passe. C'est exactement le bug déjà corrigé à la
--     main pour V340 SC (migration-clubplus-fullcomm-auto-entitlements.sql).
--     Cette migration ajoute `provisionner_club_plus_full_com()`, appelée
--     depuis `lancerCascadeFullCom()` (voir SportVision-OS-Full.html), qui
--     crée le club/organization à l'avance et lui accorde immédiatement les
--     entitlements Full Communication, sans attendre le clic.
--
-- (c) La logique d'octroi des 7 entitlements (equipes, match_center,
--     newsroom, demandes_visuels, bibliotheque_contenus, sponsors,
--     presences) est extraite dans une fonction partagée
--     `grant_entitlements_full_communication(p_club_id, p_source_contrat_id)`,
--     appelée à la fois par le trigger existant (comportement inchangé pour
--     le cas où un club existait déjà avant l'activation du contrat) et par
--     la nouvelle fonction de provisioning. Fonction interne, jamais destinée
--     à être appelée directement par un client → `revoke execute` pour
--     public/anon/authenticated, même convention que notify_staff_by_role /
--     enqueue_notification (migration-securite-notify-staff-by-role.sql,
--     migration-securite-enqueue-notification.sql).
--
-- Idempotente de bout en bout : rejouable sans effet de bord, sans dupliquer
-- de club ni d'entitlement.
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. clubs.club_plus_source — traçabilité "d'où vient ce workspace"
-- ═══════════════════════════════════════════════════════════════
-- Défaut 'clubplus_subscription' : couvre tel quel l'historique existant
-- (self-service gratuit, abonnement payant, lien d'activation staff hors
-- Full Com) sans réécrire aucune ligne existante — Postgres applique le
-- défaut aux lignes déjà présentes sans les toucher une à une (ADD COLUMN ...
-- DEFAULT, fast default depuis PG11). Le club Full Communication réel déjà en
-- prod (Villeneuve 340 Sporting Club) hérite donc de 'clubplus_subscription'
-- par ce mécanisme — volontairement pas de correction ciblée de sa ligne ici,
-- conformément à la consigne de ne jamais écrire sur ses données réelles.

alter table clubs add column if not exists club_plus_source text default 'clubplus_subscription';

alter table clubs drop constraint if exists clubs_club_plus_source_check;
alter table clubs add constraint clubs_club_plus_source_check
  check (club_plus_source in ('clubplus_subscription', 'full_com_included', 'manual'));


-- ═══════════════════════════════════════════════════════════════
-- 2. Fonction interne partagée : octroi des entitlements Full Com
-- ═══════════════════════════════════════════════════════════════

create or replace function grant_entitlements_full_communication(p_club_id uuid, p_source_contrat_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into organization_entitlements (organization_id, module_key, actif, priorite, source_contrat_id)
  select p_club_id, m.module_key, true, 'prioritaire', p_source_contrat_id
  from (values
    ('equipes'), ('match_center'), ('newsroom'),
    ('demandes_visuels'), ('bibliotheque_contenus'), ('sponsors'), ('presences')
  ) as m(module_key)
  on conflict (organization_id, module_key)
  do update set
    actif = true,
    priorite = 'prioritaire',
    source_contrat_id = coalesce(excluded.source_contrat_id, organization_entitlements.source_contrat_id);
end;
$$;

comment on function grant_entitlements_full_communication(uuid, uuid) is
  'Interne uniquement — appelée par activer_entitlements_full_communication() (trigger contrats) '
  'et provisionner_club_plus_full_com(). Jamais exposée en RPC direct (revoke execute ci-dessous).';

revoke execute on function grant_entitlements_full_communication(uuid, uuid) from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 3. Trigger existant `activer_entitlements_full_communication` — refactor
--    pour déléguer à la fonction partagée, comportement inchangé quand un
--    club existe déjà au moment où le contrat passe à 'actif'.
-- ═══════════════════════════════════════════════════════════════

create or replace function activer_entitlements_full_communication()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
begin
  if new.type_contrat = 'full_communication' and new.statut = 'actif' then
    select id into v_club_id from clubs where portail_client_id = new.client_id;
    if v_club_id is not null then
      perform grant_entitlements_full_communication(v_club_id, new.id);
    end if;
  end if;
  return new;
end;
$$;

-- Trigger déjà en place (drop/create pour rejouabilité, définition inchangée).
drop trigger if exists trg_activer_entitlements_full_communication on contrats;
create trigger trg_activer_entitlements_full_communication
  after insert or update on contrats
  for each row execute function activer_entitlements_full_communication();


-- ═══════════════════════════════════════════════════════════════
-- 4. provisionner_club_plus_full_com(p_client_id) — le nouveau provisioning
-- ═══════════════════════════════════════════════════════════════
-- Appelée par lancerCascadeFullCom() (SportVision-OS-Full.html) AVANT
-- l'envoi du lien d'activation. Idempotente : si un club existe déjà pour ce
-- client (quel que soit le chemin par lequel il a été créé), ne fait rien et
-- retourne son id. Staff-only (admin/sec), même garde que credit_organization
-- — jamais confiance dans le paramètre, vérifié via auth.uid()/profiles.role.
--
-- credits_monthly/credits_balance posés à 0 explicitement (comme le fait déjà
-- clubplus-activate pour plan='free', CREDITS_BY_PLAN.free = 0) : le défaut
-- de colonne (5) ne s'applique qu'aux clubs qui ne le précisent pas. Sans
-- incidence fonctionnelle de toute façon pour un club Full Com — le solde de
-- crédits Club+ est bypassé pour ces clubs par submit_club_request() (voir
-- migration-clubplus-fullcomm-credits-bypass.sql), qui vérifie en direct
-- l'existence d'un contrat Full Communication actif, pas ce solde.

create or replace function provisionner_club_plus_full_com(p_client_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_staff boolean;
  v_club_id uuid;
  v_client_nom text;
  v_contrat_id uuid;
begin
  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'sec')
  ) into v_is_staff;
  if not v_is_staff then
    raise exception 'Accès refusé : seul le staff SportVision peut provisionner un espace Club+.';
  end if;

  -- Idempotent : un club existe déjà pour ce client (provisionné ici, créé via
  -- un lien d'activation manuel, ou tout autre chemin passé) → ne rien recréer.
  select id into v_club_id from clubs where portail_client_id = p_client_id limit 1;
  if v_club_id is not null then
    return v_club_id;
  end if;

  select nom into v_client_nom from clients where id = p_client_id;
  if v_client_nom is null then
    raise exception 'Client introuvable.';
  end if;

  insert into clubs (nom, portail_client_id, plan, pilot_mode, credits_monthly, credits_balance, club_plus_source)
  values (v_client_nom, p_client_id, 'free', true, 0, 0, 'full_com_included')
  returning id into v_club_id;
  -- trg_sync_club_to_organization (AFTER INSERT ON clubs, déjà en place) crée
  -- automatiquement la ligne organizations correspondante à ce point, dans la
  -- même transaction, avant la suite de cette fonction.

  -- Best-effort : rattache l'entitlement à un contrat Full Com actif déjà
  -- existant pour ce client, s'il y en a un (cas le plus fréquent : le contrat
  -- est déjà 'actif' quand lancerCascadeFullCom() est déclenchée). Sinon NULL
  -- — grant_entitlements_full_communication() l'accepte, et le trigger sur
  -- contrats mettra à jour source_contrat_id plus tard si besoin.
  select id into v_contrat_id from contrats
    where client_id = p_client_id and type_contrat = 'full_communication' and statut = 'actif'
    order by created_at desc
    limit 1;

  perform grant_entitlements_full_communication(v_club_id, v_contrat_id);

  return v_club_id;
end;
$$;

comment on function provisionner_club_plus_full_com(uuid) is
  'Provisioning anticipé du workspace Club+ pour un client Full Communication : crée clubs '
  '(+ organizations via trigger + entitlements), SANS créer de compte ni de club_members — '
  'le clic du dirigeant sur le lien d''activation (clubplus-activate) reste le seul geste qui '
  'rattache un compte réel à ce club. Staff-only (admin/sec), idempotente.';
