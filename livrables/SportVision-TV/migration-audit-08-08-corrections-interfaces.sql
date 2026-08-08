-- ============================================================
-- Migration — Correctifs de l'audit complet "chaque interface, chaque
-- utilisateur" du 08/08/2026 (6 agents en parallèle sur l'intégralité
-- des écrans/rôles de SportVision OS + Connect).
--
-- Regroupe tous les correctifs SQL de cet audit. Les correctifs JS
-- correspondants (contrats, avoirs, XSS tâches, fiche collaborateur)
-- sont déjà appliqués directement dans SportVision-OS-Full.html.
--
-- Idempotent (add column if not exists / drop policy if exists + create).
-- À exécuter dans Supabase → SQL Editor.
-- ============================================================


-- ─── 1. contrats.type_abonnement — colonne manquante, bloquait TOUTE
-- création de contrat ────────────────────────────────────────────────────
-- Le formulaire "Nouveau contrat" (SportVision-OS-Full.html) a toujours eu
-- un champ "Type d'abonnement" (standard/premium/elite/sur_mesure),
-- distinct de type_contrat (abonnement_mensuel/annuel/forfait_saison/...),
-- mais la colonne correspondante n'a jamais été créée en base — aucune
-- migration ne la définissait. Conséquence : sauvegarderContrat() échouait
-- à 100%, sur les deux points d'entrée (bouton "+ Contrat" ET conversion
-- devis→contrat), avec une erreur Postgres visible à l'utilisateur.
alter table contrats add column if not exists type_abonnement text
  check (type_abonnement in ('standard','premium','elite','sur_mesure'));


-- ─── 2. Lecture finance manquante pour expert_comptable/auditeur ───────────
-- Ces deux rôles existent depuis migration-finance-lot0.sql (accès lecture
-- seule aux tables qu'elle crée : expenses, commissions, tax_reserves...)
-- mais n'ont jamais été ajoutés aux policies des tables PRÉ-EXISTANTES dont
-- dépendent la quasi-totalité de leurs écrans (Compte de résultat,
-- Rentabilité, TVA, Clôtures, Export FEC, Factures, Avoirs, Centre
-- documentaire) : prestations, clients, factures. Le même trou existe côté
-- compta sur prestations_equipe (Rémunérations, Paiements équipe toujours
-- vides pour compta — l'écran existe dans son NAV, RLS l'en empêchait).
-- v_rentabilite_missions étant security_invoker=true, elle hérite
-- directement de ce trou sur prestations.
--
-- Pattern déjà établi ailleurs dans le projet pour ce cas précis (voir
-- materiels_finance_read, migration-finance-immobilisations.sql) : une
-- policy SELECT additive dédiée, en plus de la policy "for all" existante,
-- jamais fusionnée avec elle pour ne jamais accorder l'écriture à des
-- rôles strictement lecture seule.
drop policy if exists "prestations_finance_read" on prestations;
create policy "prestations_finance_read" on prestations for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('expert_comptable','auditeur'))
);

drop policy if exists "clients_finance_read" on clients;
create policy "clients_finance_read" on clients for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('expert_comptable','auditeur'))
);

drop policy if exists "factures_finance_read" on factures;
create policy "factures_finance_read" on factures for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('expert_comptable','auditeur'))
);

drop policy if exists "equipe_finance_read" on prestations_equipe;
create policy "equipe_finance_read" on prestations_equipe for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('compta','expert_comptable','auditeur'))
);


-- ─── 3. avoirs_read trop permissive ────────────────────────────────────────
-- "for select using (exists(select 1 from profiles where id=auth.uid()))"
-- = tout utilisateur connecté, sans restriction de rôle. Un photographe ou
-- un CM pouvait lire tous les avoirs clients (montants, motifs) par simple
-- appel REST, alors que l'écran "Avoirs & remises" n'est accessible qu'à
-- admin/compta/expert_comptable/auditeur (+ sec en écriture côté RLS
-- avoirs_manage déjà en place, cf. migration-documents-v1.sql).
drop policy if exists "avoirs_read" on avoirs;
create policy "avoirs_read" on avoirs for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','sec','expert_comptable','auditeur'))
);


-- ─── 4. client_contacts ouverte en lecture ET écriture à tout le monde ────
-- clco_read/clco_write ne vérifiaient que l'authentification, sans rôle :
-- n'importe quel collaborateur connecté (photographe, CM...) pouvait lire,
-- créer, modifier ou supprimer les notes de suivi commercial de n'importe
-- quel client. Resserré aux rôles qui gèrent réellement la relation client
-- ailleurs dans l'app (clients_acces : admin/sec/com/compta/prod — ici sans
-- prod/compta, qui n'ont pas d'écran de gestion des contacts commerciaux).
drop policy if exists "clco_read" on client_contacts;
create policy "clco_read" on client_contacts for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com'))
);
drop policy if exists "clco_write" on client_contacts;
create policy "clco_write" on client_contacts for all using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','com'))
);


-- ─── 5. club_sponsors/club_creations/club_newsroom_items : pas de
-- cloisonnement par portefeuille CM ─────────────────────────────────────────
-- csp_staff_select/ccr_staff_select/cni_staff_select (migration-audit-08-08-
-- visibilite-staff-clubs.sql) et ccr_staff_update/cni_staff_update
-- (migration-audit-08-08-workflow-demandes-clubs.sql) autorisent tout
-- utilisateur role in ('admin','cm','com','sec') sans aucune restriction —
-- contrairement à TOUTES les autres tables du module CM (contenus,
-- messages_client, club_requests via clubs_cm_select...), qui scopent
-- strictement un CM non-lead à son propre portefeuille via
-- contenus_visible_par_cm(). Un CM Junior affecté à un seul club pouvait
-- lire ET faire avancer le statut des demandes de tous les autres clubs.
--
-- Correctif : même pattern que clubs_cm_select/creq_staff_select
-- (migration-cm-club-link-fix.sql), via clubs.portail_client_id. admin/com/
-- sec gardent un accès non scopé (rôles non-portefeuille ailleurs dans
-- l'app) ; seul 'cm' est désormais borné à son portefeuille (cm_lead
-- excepté, qui voit tout comme partout ailleurs dans le module CM).

drop policy if exists "csp_staff_select" on club_sponsors;
create policy "csp_staff_select" on club_sponsors for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','com','sec'))
  or exists (
    select 1 from clubs c where c.id = club_sponsors.club_id and c.portail_client_id is not null and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
      or contenus_visible_par_cm(c.portail_client_id, auth.uid())
    )
  )
);

drop policy if exists "ccr_staff_select" on club_creations;
create policy "ccr_staff_select" on club_creations for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','com','sec'))
  or exists (
    select 1 from clubs c where c.id = club_creations.club_id and c.portail_client_id is not null and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
      or contenus_visible_par_cm(c.portail_client_id, auth.uid())
    )
  )
);

drop policy if exists "cni_staff_select" on club_newsroom_items;
create policy "cni_staff_select" on club_newsroom_items for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','com','sec'))
  or exists (
    select 1 from clubs c where c.id = club_newsroom_items.club_id and c.portail_client_id is not null and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
      or contenus_visible_par_cm(c.portail_client_id, auth.uid())
    )
  )
);

drop policy if exists "ccr_staff_update" on club_creations;
create policy "ccr_staff_update" on club_creations for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','com','sec'))
  or exists (
    select 1 from clubs c where c.id = club_creations.club_id and c.portail_client_id is not null and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
      or contenus_visible_par_cm(c.portail_client_id, auth.uid())
    )
  )
);

drop policy if exists "cni_staff_update" on club_newsroom_items;
create policy "cni_staff_update" on club_newsroom_items for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','com','sec'))
  or exists (
    select 1 from clubs c where c.id = club_newsroom_items.club_id and c.portail_client_id is not null and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
      or contenus_visible_par_cm(c.portail_client_id, auth.uid())
    )
  )
);


-- ─── 6. "Mes commissions" (com) : Mission/Client toujours "—" ─────────────
-- loadMyCommissions embarque prestations(reference,date_prestation), mais
-- prestations_acces (migration-cm-briefs.sql) n'a jamais inclus 'com' —
-- les colonnes embarquées reviennent systématiquement nulles pour ce rôle
-- (le montant de la commission, lui, est correct : commissions_read_own
-- couvre déjà commercial_id = auth.uid()). Accès scopé, strictement limité
-- aux prestations liées à une commission du commercial concerné — jamais
-- un accès large aux prestations de l'entreprise.
drop policy if exists "prestations_com_commissions_read" on prestations;
create policy "prestations_com_commissions_read" on prestations for select using (
  exists (
    select 1 from commissions c
    where c.prestation_id = prestations.id and c.commercial_id = auth.uid()
  )
);


-- ─── 7. Bloque un devis "accepté"/contrat "actif" sans signature Youtrust
-- réelle (décision explicite de Fouka, 08/08/2026) ─────────────────────────
-- sauvegarderDevis()/mettreAJourContrat()/sauvegarderContrat() laissaient
-- passer statut='accepté'/'actif' depuis un simple <select>, sans aucun
-- lien avec signature_statut — un commercial pressé pouvait "conclure" un
-- devis ou activer un contrat sans qu'aucun client n'ait rien signé. Le
-- vrai flux (demanderSignatureDoc → email Youtrust → confirmerSignatureDoc)
-- pose déjà signature_statut='signee' ET statut='accepté'/'actif' dans le
-- MÊME appel PATCH (SportVision-OS-Full.html:9172-9174) : le trigger ne
-- gêne donc jamais ce flux normal, seulement le contournement manuel.
--
-- Assumé en connaissance de cause : ceci bloque aussi tout passage manuel
-- légitime (ex : contrat signé papier hors Youtrust) — il faudra d'abord
-- passer signature_statut à 'signee' par un autre moyen (SQL Editor) pour
-- ces cas-là, plutôt qu'un simple changement de statut dans l'UI.
create or replace function check_signature_avant_acceptation()
returns trigger language plpgsql as $$
begin
  if new.statut = 'accepté' and coalesce(new.signature_statut,'non_demandee') <> 'signee' then
    raise exception 'Ce devis ne peut pas passer à "accepté" sans signature Youtrust confirmée (signature_statut = signee).';
  end if;
  return new;
end; $$;

drop trigger if exists trg_devis_signature_check on devis;
create trigger trg_devis_signature_check before insert or update on devis
  for each row execute procedure check_signature_avant_acceptation();

create or replace function check_signature_avant_activation()
returns trigger language plpgsql as $$
begin
  if new.statut = 'actif' and coalesce(new.signature_statut,'non_demandee') <> 'signee' then
    raise exception 'Ce contrat ne peut pas passer à "actif" sans signature Youtrust confirmée (signature_statut = signee).';
  end if;
  return new;
end; $$;

drop trigger if exists trg_contrats_signature_check on contrats;
create trigger trg_contrats_signature_check before insert or update on contrats
  for each row execute procedure check_signature_avant_activation();
