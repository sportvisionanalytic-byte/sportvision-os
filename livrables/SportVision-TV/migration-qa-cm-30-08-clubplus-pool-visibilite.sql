-- Migration : corrige la visibilité RLS de la "File Club+ générale" côté CM
-- (campagne QA boutons nocturne, rôle cm, 30/08/2026).
--
-- ─── Découverte (test réel, pas juste lecture de code) ────────────────────
-- Compte de test CM créé, tutorat + club Club+ de test créé sans
-- portail_client_id (= club fraîchement inscrit en self-service, pas encore
-- lié à une fiche client — exactement le cas d'usage visé par "File Club+
-- générale" décrit dans le commentaire au-dessus de _renderDemandeRow() et
-- loadCmDemandes() : "un club sans aucune affiliation CM active est traité
-- comme pool"). Une demande a été créée sur ce club (club_requests.status
-- ='recues') puis l'écran Demandes (cm.demandes) a été ouvert en tant que
-- CM : l'écran affichait "Aucune demande reçue pour l'instant." — la
-- section "File Club+ générale" n'apparaissait même pas, alors que la
-- fonction JS loadCmDemandes() est bien câblée pour la construire.
--
-- Cause racine n°1 : la policy RLS "creq_staff_select" posée par migration-
-- cm-club-link-fix.sql exige `c.portail_client_id is not null` pour qu'un CM
-- puisse seulement LIRE une ligne club_requests. Un club pas encore lié à
-- une fiche client (portail_client_id NULL) — le cas même de "file
-- générale, personne n'est encore affecté" — est donc invisible en lecture
-- pour absolument tout CM, y compris un Responsable CM ou un membre du pool
-- Club+ général (cm_pool_clubplus_general) qui a pourtant le droit de la
-- PRENDRE EN CHARGE via claim_club_request() (qui, lui, ne filtre pas sur
-- portail_client_id — SECURITY DEFINER, RPC dédiée). Résultat : la
-- fonctionnalité "prise en charge d'une demande Club+ du pool" est morte à
-- 100% pour tout club pas encore rattaché à un client — pas un problème de
-- bouton, un trou RLS qui empêche même d'afficher la ligne à prendre.
--
-- Cause racine n°2 (piège classique RLS-sur-RLS, découvert en essayant un
-- premier correctif qui semblait correct sur le papier mais ne changeait
-- rien en réel) : une policy RLS s'exécute avec les droits de l'appelant, y
-- compris pour ses sous-requêtes. Un correctif naïf qui ajoute
-- `exists (select 1 from clubs c where c.id = ... and c.portail_client_id
-- is null)` directement dans creq_staff_select reste soumis à la policy RLS
-- de `clubs` elle-même (clubs_cm_select, qui exige EXACTEMENT la même
-- condition portail_client_id is not null) — la sous-requête sur `clubs` ne
-- voit donc jamais la ligne "pool" qu'elle cherche à vérifier, quelle que
-- soit la policy qui l'appelle. C'est précisément pour ça que
-- contenus_visible_par_cm (migration-contenus.sql) est SECURITY DEFINER :
-- une fonction SECURITY DEFINER tourne avec les droits du propriétaire de
-- la fonction, qui contourne le RLS des tables qu'il possède. Même remède
-- appliqué ici via club_request_is_pool().
--
-- Cause racine n°3, même famille : une fois une demande de pool prise en
-- charge (claim_club_request met taken_by = uid, statut -> en_traitement),
-- l'écran la fait ensuite passer côté "Mes demandes" et ses boutons "étape
-- suivante" appellent staff_update_club_request_status() — qui a EXACTEMENT
-- la même garde `c.portail_client_id is not null`. Le CM qui vient de
-- prendre en charge une demande de pool ne peut alors plus jamais la faire
-- avancer ("Accès refusé." systématique), quel que soit son niveau
-- d'autonomie. Corrigé ici en autorisant explicitement le titulaire actuel
-- (club_requests.taken_by = auth.uid()), même logique de "qui l'a prise en
-- charge en est responsable" que claim_club_request(). Cette fonction est
-- déjà SECURITY DEFINER donc pas touchée par le piège RLS-sur-RLS n°2.
--
-- ─── Portée du correctif ───────────────────────────────────────────────
-- Aucune règle métier changée : le contrôle "qui a le droit de PRENDRE EN
-- CHARGE" reste entièrement dans claim_club_request() (cm_pool_clubplus_
-- general ou responsable), inchangé. Ce correctif ne fait que : (1) rendre
-- visible en lecture, à tout CM en poste, les demandes non affiliées (pool)
-- pour qu'elles apparaissent dans la liste et puissent être prises en
-- charge ; (2) laisser le titulaire (taken_by) d'une demande déjà prise en
-- charge la faire avancer, même si le club sous-jacent n'a toujours pas de
-- fiche client liée.
--
-- Testé en réel après application : compte CM de test relit bien la
-- demande de pool (club sans portail_client_id) via REST avec son propre
-- JWT, alors qu'un premier essai de correctif (sans la fonction SECURITY
-- DEFINER) avait été appliqué puis reconfirmé cassé par le même test avant
-- d'être remplacé par celui-ci.
--
-- Idempotente : DROP ... IF EXISTS / CREATE OR REPLACE, peut être rejouée
-- sans effet de bord. À exécuter dans Supabase → SQL Editor.

-- ─── 1. Fonction SECURITY DEFINER : le club référencé est-il "pool" ? ─────
-- (pas encore lié à une fiche client, ou lié à une fiche client sans CM
-- assigné) — même définition que isPoolCandidate() côté JS (loadCmDemandes).
-- Contourne volontairement le RLS de `clubs`/`clients` (cf. cause racine
-- n°2 ci-dessus) : ne renvoie qu'un booléen, aucune donnée sensible exposée.
create or replace function public.club_request_is_pool(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from clubs c where c.id = p_club_id and (
      c.portail_client_id is null
      or not exists (select 1 from clients cl where cl.id = c.portail_client_id and cl.cm_id is not null)
    )
  );
$$;

-- ─── 2. club_requests : lecture staff — ajoute le cas "pool" ────────────
drop policy if exists "creq_staff_select" on club_requests;
create policy "creq_staff_select" on club_requests for select using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  or exists (
    select 1 from clubs c where c.id = club_requests.club_id and c.portail_client_id is not null and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
      or contenus_visible_par_cm(c.portail_client_id, auth.uid())
    )
  )
  or (
    club_request_is_pool(club_requests.club_id)
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm')
  )
);

-- ─── 3. clubs : lecture CM — ajoute le cas "pool" ────────────────────────
-- Sans ce complément, club_requests_is_pool() rend bien la LIGNE
-- club_requests visible (étape 2 ci-dessus), mais l'embed PostgREST
-- `clubs(nom,...)` de loadCmDemandes() reste vide (clubs_cm_select filtre
-- toujours le club lui-même) : la "File Club+ générale" afficherait des
-- lignes avec un nom de club à blanc. Complète la policy avec la même
-- notion de pool, réutilise club_request_is_pool() (SECURITY DEFINER) pour
-- éviter exactement le même piège RLS-sur-RLS que ci-dessus.
drop policy if exists "clubs_cm_select" on clubs;
create policy "clubs_cm_select" on clubs for select using (
  (portail_client_id is not null and (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
    or contenus_visible_par_cm(portail_client_id, auth.uid())
  ))
  or (
    club_request_is_pool(id)
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm')
  )
);

-- ─── 4. staff_update_club_request_status : le titulaire (taken_by) peut ──
-- toujours faire avancer sa propre demande, même sans portail_client_id.
-- Déjà SECURITY DEFINER, pas concernée par le piège RLS-sur-RLS n°2.
create or replace function staff_update_club_request_status(p_request_id uuid, p_status text)
returns club_requests
language plpgsql security definer as $$
declare
  v_row club_requests;
  v_old_status text;
  v_credits integer;
  v_authorized boolean;
begin
  select * into v_row from club_requests where id = p_request_id;
  if v_row.id is null then
    raise exception 'Demande introuvable.';
  end if;

  select exists(
    select 1 from clubs c
    where c.id = v_row.club_id and (
      exists (select 1 from profiles where id = auth.uid() and role = 'admin')
      or (c.portail_client_id is not null and exists (
        select 1 from profiles p where p.id = auth.uid() and p.role = 'cm'
          and (p.niveau_cm = 'cm_lead' or contenus_visible_par_cm(c.portail_client_id, auth.uid()))
      ))
      or v_row.taken_by = auth.uid()
    )
  ) into v_authorized;
  if not v_authorized then
    raise exception 'Accès refusé.';
  end if;

  v_old_status := v_row.status;
  v_credits := coalesce(v_row.credits_reserved, 0);

  update club_requests set
    status = p_status,
    credits_reserved = case when p_status in ('terminee','refusee') then 0 else credits_reserved end
    where id = p_request_id
    returning * into v_row;

  if v_credits > 0 and p_status = 'terminee' and v_old_status <> 'terminee' then
    update clubs set
      credits_balance = greatest(0, credits_balance - v_credits),
      credits_reserved = greatest(0, credits_reserved - v_credits)
      where id = v_row.club_id;
    insert into club_credit_transactions (club_id, label, amount, created_by)
      values (v_row.club_id, coalesce(v_row.type,'Demande') || coalesce(' — ' || v_row.team, ''), -v_credits, auth.uid());
  elsif v_credits > 0 and p_status = 'refusee' and v_old_status <> 'refusee' then
    update clubs set credits_reserved = greatest(0, credits_reserved - v_credits) where id = v_row.club_id;
  end if;

  return v_row;
end;
$$;
