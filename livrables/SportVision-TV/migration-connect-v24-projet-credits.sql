-- ============================================================
-- SPORTVISION CONNECT — Migration v24 : vrai système de crédits pour
-- l'Espace Projet (organizations.organization_type = 'projet', client
-- ponctuel indépendant, ex-Portail).
--
-- ── Contexte ──────────────────────────────────────────────────────
-- ctx.subscription.creditsRemaining pour un espace Projet est câblé en
-- dur à 0 côté Next.js (session.ts, buildProjetActiveContext), ce qui
-- bloque structurellement /requests/new pour tout client Projet — il
-- n'a jamais été dans la liste d'exemption "isGenericOrg" qui laisse
-- passer coach/académie/sponsor sans contrôle de crédits. Décision
-- explicite (2026-08-11) : donner un vrai système de crédits à ces
-- clients plutôt que de les exempter du contrôle.
--
-- Contrairement à Club+, l'Espace Projet n'a AUCUN abonnement Stripe
-- récurrent ("facturé à la commande") : pas de rechargement mensuel
-- automatique. Le crédit est accordé manuellement par le staff (admin/
-- sec), typiquement quand le client paie une prestation ou un pack —
-- geste équivalent à ce qui existe pour club.credits_balance, à ceci
-- près qu'AUCUN mécanisme de crédit manuel n'existe non plus pour un
-- club aujourd'hui (vérifié : aucune RPC ni écran OS ne touche
-- clubs.credits_balance à la hausse — seul le rechargement mensuel
-- Stripe/webhook existe pour Club+). Cette migration introduit donc le
-- premier mécanisme de crédit manuel du produit, conçu pour être repris
-- tel quel pour club le jour où ce sera nécessaire.
--
-- ── Ce qui est repris tel quel de club (clubs.credits_balance/
-- credits_reserved, migration-clubplus-v1/v4.sql) ──────────────────
-- - Formule de solde : Math.max(0, credits_balance - credits_reserved),
--   déjà utilisée par buildClubActiveContext (session.ts ~L225).
-- - Réservation à la soumission d'une demande, restitution à
--   l'annulation, débit définitif à la complétion — mêmes transitions
--   que submit_club_request / update_club_request_status.
-- - Mouvements de crédits exclusivement via fonctions SECURITY DEFINER,
--   jamais par UPDATE direct du client.
--
-- ── Différence volontaire avec club : pas de nouveau trigger de
-- protection ─────────────────────────────────────────────────────────
-- clubs a nécessité protect_sensitive_club_fields (migration-clubplus-
-- v24-protect-sensitive-fields.sql) car "clubs_admin_update" (v9)
-- autorise un admin de club à modifier N'IMPORTE QUELLE colonne de sa
-- propre fiche clubs, crédits inclus. `organizations` n'a PAS
-- d'équivalent : les seules policies actives sont "org_member_select"
-- (lecture) et "org_staff_write" (écriture, "for all", réservée aux
-- rôles admin/sec) — voir migration-connect-v2-organizations-
-- entitlements.sql. Un membre n'a donc AUCUNE policy d'écriture sur
-- organizations, avec ou sans ces 2 colonnes : RLS bloque déjà tout
-- PATCH direct par un client Projet. Un trigger de défense en
-- profondeur serait redondant ici (rien à durcir qui ne le soit déjà).
--
-- ── Table `requests` déjà générique, réutilisée telle quelle ────────
-- requests.organization_id + requests.credits_reserved existent déjà
-- (migration-connect-v3-coach-academie-requests.sql) et servent déjà
-- Coach/Académie/Sponsor (Phase 4). Cette migration modifie
-- submit_request()/update_request_status() pour qu'ils répercutent
-- réellement le mouvement de crédits sur `organizations` UNIQUEMENT
-- quand organization_type = 'projet' — Coach/Académie/Sponsor/
-- Événement/Agence CM continuent de stocker requests.credits_reserved
-- sans effet sur un solde (comportement inchangé, ils n'ont toujours
-- aucun solde suivi ni affiché : buildOrgSpaceActiveContext, hors
-- périmètre de cette migration).
--
-- ── RLS lecture ───────────────────────────────────────────────────
-- Pas de changement : "org_member_select" est une policy de LIGNE (pas
-- de restriction par colonne), un membre qui peut déjà lire sa ligne
-- organizations peut lire les 2 nouvelles colonnes.
--
-- Additive, idempotente (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE
-- FUNCTION / CREATE TABLE IF NOT EXISTS). Aucun impact sur les autres
-- types d'organisation : défaut 0, jamais lu par leur ActiveContext.
--
-- N'A JAMAIS ÉTÉ EXÉCUTÉE EN PRODUCTION. À exécuter dans Supabase →
-- SQL Editor, après relecture, après migration-connect-v3-coach-
-- academie-requests.sql (v3) et migration-connect-v23-event-live-
-- contenus-access.sql (v23, dernière migration connect en date).
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. COLONNES — organizations.credits_balance / credits_reserved
-- ═══════════════════════════════════════════════════════════════

alter table organizations
  add column if not exists credits_balance integer not null default 0;

alter table organizations
  add column if not exists credits_reserved integer not null default 0;

comment on column organizations.credits_balance is
  'Solde de crédits accordé manuellement par le staff SportVision (admin/sec), via credit_organization(). '
  'Uniquement significatif pour organization_type = ''projet'' (pas de rechargement automatique, contrairement '
  'à clubs.credits_balance côté Club+/Stripe). 0 par défaut et jamais alimenté pour les autres types.';

comment on column organizations.credits_reserved is
  'Crédits réservés par des requests.status non terminales (recues/info_manquante/en_traitement/'
  'prete_a_creer). Mouvement géré exclusivement par submit_request()/update_request_status(), jamais '
  'par UPDATE direct — voir org_staff_write, la seule policy d''écriture sur organizations, staff-only.';


-- ═══════════════════════════════════════════════════════════════
-- 2. HISTORIQUE DES CRÉDITS — organization_credit_transactions
--    Même rôle que club_credit_transactions (migration-clubplus-v1.sql,
--    §3) : table d'audit, pas encore lue par une UI (ni club_credit_
--    transactions ne l'est aujourd'hui) — écrite à chaque mouvement de
--    solde réel (crédit manuel, débit à la complétion d'une demande),
--    jamais à une simple réservation/restitution qui laisse le solde
--    inchangé.
-- ═══════════════════════════════════════════════════════════════

create table if not exists organization_credit_transactions (
  id uuid default gen_random_uuid() primary key,
  organization_id uuid references organizations(id) on delete cascade not null,
  label text not null,
  amount integer not null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_oct_org on organization_credit_transactions(organization_id, created_at desc);

alter table organization_credit_transactions enable row level security;

drop policy if exists "oct_member_select" on organization_credit_transactions;
create policy "oct_member_select" on organization_credit_transactions for select using (
  is_org_member(organization_id) or is_staff()
);

drop policy if exists "oct_staff_all" on organization_credit_transactions;
create policy "oct_staff_all" on organization_credit_transactions for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec'))
);


-- ═══════════════════════════════════════════════════════════════
-- 3. CRÉDIT MANUEL — geste staff (fiche client Projet, SportVision OS)
-- ═══════════════════════════════════════════════════════════════

create or replace function credit_organization(p_organization_id uuid, p_amount integer, p_label text default null)
returns organizations
language plpgsql security definer as $$
declare
  v_row organizations;
  v_is_staff boolean;
begin
  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','sec')
  ) into v_is_staff;
  if not v_is_staff then
    raise exception 'Accès refusé : seul le staff SportVision peut créditer une organisation.';
  end if;

  if coalesce(p_amount, 0) = 0 then
    raise exception 'Le montant doit être différent de 0.';
  end if;

  select * into v_row from organizations where id = p_organization_id;
  if v_row.id is null then
    raise exception 'Organisation introuvable.';
  end if;
  if v_row.organization_type <> 'projet' then
    raise exception 'Cette organisation n''a pas de système de crédits (réservé aux espaces Projet).';
  end if;

  update organizations set
    credits_balance = greatest(0, credits_balance + p_amount),
    updated_at = now()
    where id = p_organization_id
    returning * into v_row;

  insert into organization_credit_transactions (organization_id, label, amount, created_by)
    values (p_organization_id, coalesce(nullif(trim(p_label), ''), 'Crédit manuel SportVision'), p_amount, auth.uid());

  return v_row;
end;
$$;

comment on function credit_organization is
  'Geste staff (admin/sec) : ajuste organizations.credits_balance d''un espace Projet — jamais de PATCH '
  'direct côté client (org_staff_write est la seule policy d''écriture, déjà staff-only, cette RPC ajoute '
  'la restriction organization_type=''projet'' + la trace organization_credit_transactions). p_amount peut '
  'être négatif (correction) ; le solde ne descend jamais sous 0.';


-- ═══════════════════════════════════════════════════════════════
-- 4. SOUMISSION D'UNE DEMANDE — réservation réelle pour un espace Projet
--    (create or replace : submit_request existe déjà depuis v3, même
--    signature, seul le corps change)
-- ═══════════════════════════════════════════════════════════════

create or replace function submit_request(
  p_organization_id uuid, p_type text, p_urgency text, p_detail text, p_credits integer
) returns requests
language plpgsql security definer as $$
declare
  v_row requests;
  v_org_type text;
begin
  if not is_org_member(p_organization_id) then
    raise exception 'Accès refusé : vous n''êtes pas membre de cette organisation.';
  end if;

  insert into requests (organization_id, type, requester_id, status, urgency, detail, credits_reserved)
  values (p_organization_id, p_type, auth.uid(), 'recues', coalesce(p_urgency,'normale'), p_detail, coalesce(p_credits, 0))
  returning * into v_row;

  -- Seul un espace Projet a un solde réel suivi (organizations.credits_balance, cette migration).
  -- Coach/Académie/Sponsor/Événement/Agence CM gardent requests.credits_reserved comme aujourd'hui
  -- (valeur informative sur la ligne, sans effet sur un solde qui n'existe pas pour eux) —
  -- comportement inchangé, voir la note en tête de fichier.
  if coalesce(p_credits, 0) > 0 then
    select organization_type into v_org_type from organizations where id = p_organization_id;
    if v_org_type = 'projet' then
      update organizations set credits_reserved = credits_reserved + p_credits where id = p_organization_id;
    end if;
  end if;

  return v_row;
end;
$$;


-- ═══════════════════════════════════════════════════════════════
-- 5. CHANGEMENT DE STATUT — débite ou restitue les crédits réservés
--    pour un espace Projet (create or replace : update_request_status
--    existe déjà depuis v3, même signature, seul le corps change)
-- ═══════════════════════════════════════════════════════════════

create or replace function update_request_status(p_request_id uuid, p_status text)
returns requests
language plpgsql security definer as $$
declare
  v_row requests;
  v_old_status text;
  v_credits integer;
  v_org_type text;
  v_is_staff boolean;
begin
  select * into v_row from requests where id = p_request_id;
  if v_row.id is null then
    raise exception 'Demande introuvable.';
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','cm','sec','prod')
  ) into v_is_staff;

  if v_is_staff then
    null;
  elsif is_org_member(v_row.organization_id) then
    if p_status <> 'refusee' or v_row.status <> 'recues' then
      raise exception 'Vous ne pouvez annuler qu''une demande non encore prise en charge par SportVision.';
    end if;
  else
    raise exception 'Accès refusé.';
  end if;

  v_old_status := v_row.status;
  v_credits := coalesce(v_row.credits_reserved, 0);

  update requests set
    status = p_status,
    credits_reserved = case when p_status in ('terminee','refusee') then 0 else credits_reserved end
    where id = p_request_id
    returning * into v_row;

  if v_credits > 0 then
    select organization_type into v_org_type from organizations where id = v_row.organization_id;
    if v_org_type = 'projet' then
      if p_status = 'terminee' and v_old_status <> 'terminee' then
        update organizations set
          credits_balance = greatest(0, credits_balance - v_credits),
          credits_reserved = greatest(0, credits_reserved - v_credits)
          where id = v_row.organization_id;
        insert into organization_credit_transactions (organization_id, label, amount, created_by)
          values (v_row.organization_id, coalesce(v_row.type, 'Demande'), -v_credits, auth.uid());
      elsif p_status = 'refusee' and v_old_status <> 'refusee' then
        update organizations set credits_reserved = greatest(0, credits_reserved - v_credits) where id = v_row.organization_id;
      end if;
    end if;
  end if;

  return v_row;
end;
$$;


-- ============================================================
-- NOTE — vérification recommandée après exécution
--
-- select id, nom, credits_balance, credits_reserved from organizations
--   where organization_type = 'projet' limit 5;
-- -- attendu : les 2 colonnes à 0 pour tout client Projet jamais crédité
-- -- (aucune valeur ne doit être NULL, le default 0 s'applique aux
-- -- lignes existantes comme aux nouvelles).
--
-- Aucune ligne existante n'est modifiée par cette migration (ADD COLUMN
-- ... DEFAULT 0 seul). Rien à rattraper.
-- ============================================================
