-- Les candidatures : lisibles par qui les traite, et par personne d'autre.
--
-- Décision de Fouka, 10/09/2026, classée P1 confidentialité :
--   « un dossier de candidature n'a aucune raison d'être lisible par tout le staff. »
--   Candidat → recrutement opérationnel → Production.
--   Collaborateur retenu → contractualisation / dossier RH → Admin + Secrétariat.
--
--   Admin SportVision       toutes les candidatures
--   Production              candidatures d'opérateurs terrain (photographe, vidéaste, les deux)
--                           de SON pôle : CV, portfolio, contact, disponibilités, statut ;
--                           à appeler, entretien, retenir, refuser
--   Responsable de pôle     même périmètre
--   Secrétariat (et RH)     à partir de « retenu » : phase administrative et onboarding
--   CM, photographes, vidéastes, commerciaux, comptabilité : aucune
--
-- Avant cette migration, `is_staff()` ouvrait les 37 candidatures en LECTURE et en ÉCRITURE à
-- tout profil interne, photographes, CM et commerciaux compris, et le dossier `recrutement-cv`
-- du stockage de même. Fermé ici, à tous les endroits où la donnée passait :
--   • la table (lecture, modification) ;
--   • les CV stockés : la policy lit désormais la table sous l'identité de l'appelant, donc suit
--     exactement la même règle ;
--   • la vue `secretariat_documents` (catégorie recrutement) ;
--   • le journal d'activité, qui porte le nom du candidat : invisible à qui ne voit pas la
--     candidature ;
--   • `propose_candidature_direction`.
-- Et une garde de colonnes : hors administration, on ne change que le statut ; le lien vers le
-- compte collaborateur créé (`collaborateur_id`) reste à l'administration et au secrétariat.
--
-- Les candidatures sans pôle (anciennes, antérieures au choix du sport dans le formulaire) ne
-- relèvent d'aucun pôle : administration seule, jusqu'à ce qu'un pôle leur soit attribué.

begin;

create or replace function public.peut_voir_candidature(p_poste text, p_pole_id uuid, p_statut text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
      or (p_poste in ('photographe', 'videaste', 'les_deux') and p_pole_id is not null
          and ((exists (select 1 from profiles where id = auth.uid() and role = 'prod')
                and coalesce(pole_scope_ok(p_pole_id), false))
               or coalesce(is_pole_responsable(p_pole_id), false)))
      or (p_statut = 'retenu'
          and exists (select 1 from profiles where id = auth.uid() and role in ('sec', 'rh')));
$$;
revoke execute on function public.peut_voir_candidature(text, uuid, text) from public, anon;
grant execute on function public.peut_voir_candidature(text, uuid, text) to authenticated;

-- ── La table ──
drop policy if exists recrutapp_staff_select on public.recruitment_applications;
drop policy if exists recrutapp_staff_update on public.recruitment_applications;
drop policy if exists recrutapp_select on public.recruitment_applications;
drop policy if exists recrutapp_update on public.recruitment_applications;
create policy recrutapp_select on public.recruitment_applications for select
  using (peut_voir_candidature(poste, pole_id, statut));
create policy recrutapp_update on public.recruitment_applications for update
  using (peut_voir_candidature(poste, pole_id, statut))
  with check (peut_voir_candidature(poste, pole_id, statut));

create or replace function public.proteger_candidature()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_role text;
begin
  if auth.uid() is null then
    return new;   -- le formulaire public et les fonctions serveur (clé de service)
  end if;
  select role into v_role from profiles where id = auth.uid();
  if v_role = 'admin' then
    return new;
  end if;
  if (to_jsonb(new) - 'statut' - 'collaborateur_id') is distinct from (to_jsonb(old) - 'statut' - 'collaborateur_id') then
    raise exception 'Seul le statut d''une candidature se modifie ici.' using errcode = '42501';
  end if;
  if new.collaborateur_id is distinct from old.collaborateur_id and coalesce(v_role, '') not in ('sec', 'rh') then
    raise exception 'Le compte collaborateur se crée par l''administration ou le secrétariat.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_proteger_candidature on public.recruitment_applications;
create trigger trg_proteger_candidature before update on public.recruitment_applications
  for each row execute function proteger_candidature();

-- ── Les CV stockés ──
drop policy if exists sv_media_prive_recrutement_select on storage.objects;
create policy sv_media_prive_recrutement_select on storage.objects for select using (
  bucket_id = 'sportvision-media-prive'
  and (storage.foldername(name))[1] = 'recrutement-cv'
  and exists (select 1 from public.recruitment_applications ra where ra.cv_path = objects.name)
);

-- ── Le journal d'activité : le nom du candidat suit la candidature ──
drop policy if exists actlog_recrutement_cloisonne on public.activity_log;
create policy actlog_recrutement_cloisonne on public.activity_log as restrictive for select using (
  entity_type is distinct from 'recruitment_application'
  or exists (select 1 from public.recruitment_applications ra where ra.id = activity_log.entity_id)
);

-- ── La vue des documents du secrétariat ──
create or replace view public.secretariat_documents as
WITH base AS (
         SELECT 'rh'::text AS categorie,
            cd.id,
            cd.type AS sous_type,
            cd.collaborateur_id AS proprietaire_id,
            COALESCE(NULLIF(TRIM(BOTH FROM (COALESCE(p.prenom, ''::text) || ' '::text) || COALESCE(p.nom, ''::text)), ''::text), 'Collaborateur'::text) AS proprietaire_label,
            NULL::uuid AS client_id,
            NULL::boolean AS est_club,
            cd.nom,
            cd.statut,
            cd.date_echeance,
            cd.storage_path,
            cd.created_at,
            cd.updated_at
           FROM collaborateur_documents cd
             LEFT JOIN profiles p ON p.id = cd.collaborateur_id
          WHERE (EXISTS ( SELECT 1
                   FROM profiles
                  WHERE profiles.id = auth.uid() AND (profiles.role = ANY (ARRAY['admin'::text, 'compta'::text])))) OR cd.collaborateur_id = auth.uid()
        UNION ALL
         SELECT
                CASE
                    WHEN cd.type = 'avenant'::text THEN 'avenant'::text
                    WHEN (EXISTS ( SELECT 1
                       FROM clubs c2
                      WHERE c2.portail_client_id = cd.client_id)) THEN 'club_plus'::text
                    ELSE 'client'::text
                END AS categorie,
            cd.id,
            cd.type AS sous_type,
            cd.client_id AS proprietaire_id,
            COALESCE(cl.nom, 'Client'::text) AS proprietaire_label,
            cd.client_id,
            (EXISTS ( SELECT 1
                   FROM clubs c3
                  WHERE c3.portail_client_id = cd.client_id)) AS est_club,
            cd.nom,
            cd.statut,
            cd.date_echeance,
            cd.storage_path,
            cd.created_at,
            cd.updated_at
           FROM client_documents cd
             JOIN clients cl ON cl.id = cd.client_id
          WHERE (EXISTS ( SELECT 1
                   FROM profiles
                  WHERE profiles.id = auth.uid() AND (profiles.role = ANY (ARRAY['admin'::text, 'sec'::text, 'com'::text, 'compta'::text]))))
        UNION ALL
         SELECT 'contrat_full_com'::text AS categorie,
            c.id,
            c.type_contrat AS sous_type,
            c.client_id AS proprietaire_id,
            COALESCE(cl.nom, 'Client'::text) AS proprietaire_label,
            c.client_id,
            (EXISTS ( SELECT 1
                   FROM clubs c3
                  WHERE c3.portail_client_id = c.client_id)) AS est_club,
            'Contrat Full Communication'::text AS nom,
                CASE
                    WHEN c.signature_statut = 'signee'::text THEN 'valide'::text
                    WHEN c.signature_statut = 'demandee'::text THEN 'a_valider'::text
                    ELSE 'manquant'::text
                END AS statut,
            c.date_fin AS date_echeance,
            NULL::text AS storage_path,
            c.created_at,
            c.updated_at
           FROM contrats c
             JOIN clients cl ON cl.id = c.client_id
          WHERE c.type_contrat = 'full_communication'::text AND (EXISTS ( SELECT 1
                   FROM profiles
                  WHERE profiles.id = auth.uid() AND (profiles.role = ANY (ARRAY['admin'::text, 'sec'::text, 'com'::text, 'compta'::text]))))
        UNION ALL
         SELECT 'recrutement_onboarding'::text AS categorie,
            ra.id,
            'cv'::text AS sous_type,
            ra.collaborateur_id AS proprietaire_id,
            COALESCE(NULLIF(TRIM(BOTH FROM (COALESCE(ra.prenom, ''::text) || ' '::text) || COALESCE(ra.nom, ''::text)), ''::text), 'Candidat'::text) AS proprietaire_label,
            NULL::uuid AS client_id,
            NULL::boolean AS est_club,
            'CV de candidature'::text AS nom,
                CASE
                    WHEN ra.cv_path IS NULL THEN 'manquant'::text
                    ELSE 'valide'::text
                END AS statut,
            NULL::date AS date_echeance,
            ra.cv_path AS storage_path,
            ra.created_at,
            ra.created_at AS updated_at
           FROM recruitment_applications ra
          WHERE peut_voir_candidature(ra.poste, ra.pole_id, ra.statut)
        )
 SELECT categorie,
    id,
    sous_type,
    proprietaire_id,
    proprietaire_label,
    client_id,
    est_club,
    nom,
    statut,
    date_echeance,
    storage_path,
    created_at,
    updated_at,
        CASE
            WHEN statut = 'valide'::text AND date_echeance IS NOT NULL AND date_echeance <= (CURRENT_DATE + 30) THEN 'expire_bientot'::text
            ELSE statut
        END AS statut_affichage
   FROM base;

-- ── Proposer à la Direction : seulement ce qu'on a le droit de voir ──
CREATE OR REPLACE FUNCTION public.propose_candidature_direction(p_candidature_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pole_id uuid;
  v_nom text;
  v_prenom text;
  v_poste text;
  v_ok boolean;
begin
  select pole_id, nom, prenom, poste into v_pole_id, v_nom, v_prenom, v_poste
    from recruitment_applications where id = p_candidature_id;
  if not found then
    raise exception 'Candidature introuvable.';
  end if;

  v_ok := peut_voir_candidature(v_poste, v_pole_id, (select statut from recruitment_applications where id = p_candidature_id));
  if not v_ok then
    raise exception 'Accès refusé à cette candidature.';
  end if;

  insert into notifications (type, titre, message, destinataire_id, lue, priorite, created_at)
  select 'systeme',
    'Candidature proposée par un Responsable de pôle',
    coalesce(v_prenom,'') || ' ' || coalesce(v_nom,'') || ' (' || coalesce(v_poste,'poste') || ') a été proposé(e) par le Responsable de pôle pour finalisation.',
    pr.id, false, 'normale', now()
  from profiles pr
  where pr.role in ('admin','sec','rh')
    and (v_pole_id is null or pr.role in ('admin','rh') or exists (
      select 1 from pole_affectations pa where pa.user_id = pr.id and pa.pole_id = v_pole_id
    ));
end;
$function$;

commit;
