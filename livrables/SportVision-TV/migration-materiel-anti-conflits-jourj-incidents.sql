-- ============================================================================
-- Migration : anti-conflits backend kit_reservations + lien Jour J → materiel_incidents
-- Date : 29/08 (nuit)
-- Contexte : suite de l'audit Matériel & Kits (agent précédent, non commité).
--   3 trous confirmés côté backend :
--   1. Aucun trigger anti-chevauchement de dates sur kit_reservations.
--   2. Aucun trigger empêchant l'attribution d'un kit endommagé/en_maintenance/
--      indisponible/en_contrôle (l'UI filtre côté client, rien ne bloque un
--      INSERT direct qui contournerait l'UI).
--   3. Le signalement d'incident depuis le Mode Jour J (submitIncidentJJ)
--      écrit uniquement dans `incidents` (texte libre), jamais dans
--      `materiel_incidents` (table dédiée qui fait basculer le statut du
--      matériel/kit), contrairement au flux du module Kits.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Trigger anti-chevauchement sur kit_reservations
--
-- Les deux flux d'attribution existants utilisent des paires de colonnes
-- DIFFÉRENTES pour les dates :
--   - attribuerKitPrestation (fiche mission) : date_sortie seul (pas de
--     date_retour_prevue, pas de heure_*).
--   - kitsAttribuerSubmit (module Kits)      : heure_sortie / heure_retour_prevue
--     (pas de date_sortie / date_retour_prevue).
-- Le trigger doit donc couvrir les deux paires de colonnes via COALESCE,
-- sinon il protège un flux et laisse l'autre passer.
-- Statuts considérés "actifs" (occupent réellement le kit) : réservé,
-- pré_réservé, sorti, en_prestation, à_récupérer, à_retourner.
-- Si aucune date de retour n'est renseignée, la période est traitée comme
-- une journée entière à partir de la date/heure de sortie.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_kit_reservation_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_conflict record;
  active_statuts text[] := array['réservé','pré_réservé','sorti','en_prestation','à_récupérer','à_retourner'];
begin
  -- Ne vérifie que si la ligne entrante occupe réellement le kit
  if new.statut is null or not (new.statut::text = any(active_statuts)) then
    return new;
  end if;
  if new.kit_id is null then
    return new;
  end if;

  v_start := coalesce(new.heure_sortie, new.date_sortie);
  if v_start is null then
    return new; -- rien de comparable, on ne bloque pas
  end if;
  v_end := coalesce(new.heure_retour_prevue, new.date_retour_prevue, v_start + interval '1 day');

  select kr.id, kr.prestation_id, p.reference
  into v_conflict
  from kit_reservations kr
  left join prestations p on p.id = kr.prestation_id
  where kr.kit_id = new.kit_id
    and kr.id is distinct from new.id
    and kr.statut::text = any(active_statuts)
    and coalesce(kr.heure_sortie, kr.date_sortie) < v_end
    and v_start < coalesce(
          kr.heure_retour_prevue,
          kr.date_retour_prevue,
          coalesce(kr.heure_sortie, kr.date_sortie) + interval '1 day'
        )
  limit 1;

  if found then
    raise exception 'Ce kit est déjà réservé sur cette période (réservation existante % — prestation %).',
      v_conflict.id, coalesce(v_conflict.reference, 'sans référence')
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_check_kit_reservation_overlap ON kit_reservations;
CREATE TRIGGER trg_check_kit_reservation_overlap
BEFORE INSERT OR UPDATE ON kit_reservations
FOR EACH ROW EXECUTE FUNCTION check_kit_reservation_overlap();

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Trigger empêchant l'attribution d'un kit non disponible
--
-- L'UI filtre déjà côté client (statut=eq.disponible pour attribuerKitPrestation,
-- pas de filtre du tout côté kitsAttribuerSubmit qui liste tous les kits) mais
-- rien n'empêchait un INSERT direct de contourner ce filtre. On bloque à la
-- création de la réservation si le kit ciblé est endommagé, en maintenance,
-- indisponible ou déjà en contrôle.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_kit_reservation_kit_available()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_kit_statut text;
begin
  if new.kit_id is null then
    return new;
  end if;
  select statut::text into v_kit_statut from kits where id = new.kit_id;
  if v_kit_statut in ('endommagé','en_maintenance','indisponible','en_contrôle') then
    raise exception 'Ce kit n''est pas disponible pour une réservation (statut actuel : %).', v_kit_statut
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_check_kit_reservation_kit_available ON kit_reservations;
CREATE TRIGGER trg_check_kit_reservation_kit_available
BEFORE INSERT ON kit_reservations
FOR EACH ROW EXECUTE FUNCTION check_kit_reservation_kit_available();

-- ────────────────────────────────────────────────────────────────────────────
-- 3) RPC report_materiel_incident : lien Jour J → materiel_incidents
--
-- Le flux existant (kitsIncidentSubmit, module Kits) écrivait directement
-- dans materiel_incidents via POST + PATCH materiels — mais la RLS de
-- materiel_incidents (materiel_incidents_access) n'autorise que admin/prod en
-- écriture. Le Mode Jour J est utilisé par des rôles de terrain (photo, cm,
-- com...) qui n'ont pas ce droit : un INSERT direct depuis Jour J échouerait
-- silencieusement sous RLS réelle.
--
-- Cette RPC SECURITY DEFINER centralise la logique (insert incident + bascule
-- automatique du statut matériel/kit) et est appelable par tout utilisateur
-- authentifié : collaborateur_id est toujours forcé à auth.uid() (impossible
-- de déclarer un incident au nom de quelqu'un d'autre), le statut est
-- toujours 'ouvert' (impossible de créer un incident déjà résolu).
-- Les deux points d'entrée JS (module Kits ET Mode Jour J) appellent
-- désormais cette même RPC plutôt que de dupliquer la logique.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.report_materiel_incident(
  p_materiel_id uuid DEFAULT NULL,
  p_kit_id uuid DEFAULT NULL,
  p_prestation_id uuid DEFAULT NULL,
  p_kit_reservation_id uuid DEFAULT NULL,
  p_type_incident text DEFAULT 'autre',
  p_description text DEFAULT NULL,
  p_gravite text DEFAULT 'mineur',
  p_impact_prestation text DEFAULT NULL,
  p_action_immediate text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
  v_kit_id uuid := p_kit_id;
begin
  if p_description is null or btrim(p_description) = '' then
    raise exception 'La description de l''incident est obligatoire.';
  end if;
  if v_uid is null then
    raise exception 'Authentification requise pour signaler un incident.';
  end if;

  if v_kit_id is null and p_materiel_id is not null then
    select kit_id into v_kit_id from materiels where id = p_materiel_id;
  end if;

  insert into materiel_incidents (
    materiel_id, kit_id, prestation_id, kit_reservation_id, collaborateur_id,
    type_incident, description, gravite, statut, impact_prestation, action_immediate
  ) values (
    p_materiel_id, v_kit_id, p_prestation_id, p_kit_reservation_id, v_uid,
    coalesce(p_type_incident, 'autre'), p_description, coalesce(p_gravite, 'mineur'),
    'ouvert', p_impact_prestation, p_action_immediate
  ) returning id into v_id;

  if p_materiel_id is not null then
    -- Bascule le matériel précis (mêmes valeurs que l'ancien code JS
    -- kitsIncidentSubmit : 'endommage'/'fonctionnel_reserve', sans accent,
    -- car materiels.statut est un champ texte libre, pas un enum).
    update materiels
    set statut = case when coalesce(p_gravite, 'mineur') = 'critique' then 'endommage' else 'fonctionnel_reserve' end
    where id = p_materiel_id;
  elsif v_kit_id is not null and coalesce(p_gravite, 'mineur') = 'critique' then
    -- Pas de matériel précis identifié (cas Jour J où seul le kit est
    -- sélectionné) : on ne bloque le kit entier que si l'incident est
    -- critique — un incident mineur/important sur un kit reste à trier
    -- manuellement plutôt que d'immobiliser tout le kit automatiquement.
    update kits set statut = 'endommagé' where id = v_kit_id;
  end if;

  return v_id;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.report_materiel_incident(uuid,uuid,uuid,uuid,text,text,text,text,text) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Accès admin à Documents (pièces RH) — VIEWS['admin.docrh']
--
-- Changement côté OS uniquement (voir SportVision-OS-Full.html) : la vue
-- secretariat_documents (derrière VIEWS['sec.docrh']/loadDocRh) autorise déjà
-- explicitement 'admin' dans CHACUNE de ses branches UNION (rh, client,
-- contrat_full_com, recrutement_onboarding — vérifié via pg_get_viewdef),
-- donc aucune migration RLS n'était nécessaire ici. On expose simplement
-- VIEWS['admin.docrh']=VIEWS['sec.docrh'] + un lien NAV admin + le dispatch
-- loadViewData, sur le même patron que admin.cmagency/sec.cmagency et
-- admin.connectcomptes/sec.connectcomptes déjà présents dans le fichier.
-- Rien à exécuter ici côté SQL — section notée pour traçabilité.
-- ────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────
-- 5) Cron quotidien : échéances de documents RH → Agenda Secrétaire
--
-- secretariat_agenda_events a déjà 'echeance_document' dans sa contrainte
-- CHECK sur `type`, et une colonne `document_id` avec FK explicite vers
-- collaborateur_documents(id) — mais aucune fonction ne l'alimentait (à la
-- différence de check_contrats_renouvellement_proche et
-- check_devis_expiration_proche, déjà en cron quotidien). Cette fonction
-- reprend exactement le même patron (boucle + idempotence via NOT EXISTS +
-- notify_staff_by_role) et est planifiée en cron comme les deux autres.
--
-- Scope volontairement limité à collaborateur_documents : c'est la SEULE des
-- 4 sources UNION de secretariat_documents que document_id peut référencer
-- (client_documents/contrats/recruitment_applications n'ont pas de colonne
-- dédiée dans secretariat_agenda_events). Étendre l'agenda aux 3 autres
-- sources est un chantier séparé (ajout de colonnes FK), pas un correctif de
-- ce soir.
--
-- Seuil : 30 jours avant date_echeance, aligné sur le seuil déjà utilisé par
-- la vue secretariat_documents elle-même pour calculer statut_affichage=
-- 'expire_bientot' (date_echeance <= current_date + 30).
--
-- Testé en réel le 29/08 : document de test (collaborateur_documents,
-- date_echeance = aujourd'hui + 30, statut='valide') → ligne
-- secretariat_agenda_events créée (type='echeance_document', document_id
-- correct) + 2 notifications (admin/sec) ; deuxième exécution de la fonction
-- confirmée idempotente (pas de doublon d'agenda) ; toutes les données de
-- test supprimées après vérification.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_echeances_documents_rh()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_doc record;
begin
  for v_doc in
    select id, collaborateur_id, type, nom, date_echeance
    from collaborateur_documents
    where statut = 'valide'
      and date_echeance is not null
      and date_echeance - current_date = 30
  loop
    if not exists (
      select 1 from secretariat_agenda_events
      where document_id = v_doc.id and type = 'echeance_document' and statut != 'termine'
    ) then
      insert into secretariat_agenda_events (
        type, titre, description, date_heure, statut, document_id
      ) values (
        'echeance_document',
        'Document ' || coalesce(v_doc.nom, v_doc.type, '') || ' — échéance dans 30 jours',
        'Pièce collaborateur arrivant à expiration : vérifier et relancer le renouvellement.',
        v_doc.date_echeance::timestamptz,
        'a_faire',
        v_doc.id
      );
    end if;

    perform notify_staff_by_role(
      array['admin','sec'],
      'Document RH — échéance dans 30 jours',
      coalesce(v_doc.nom, v_doc.type, 'Document') || ' expire bientôt. Un rappel a été ajouté à l''Agenda Secrétaire.',
      'normale',
      null,
      null
    );
  end loop;
end;
$function$;

SELECT cron.schedule('sportvision-check-echeances-documents-rh', '50 7 * * *', 'select check_echeances_documents_rh();');

-- ────────────────────────────────────────────────────────────────────────────
-- 6) Note : client_documents / client_contrats (audit point B.3)
--
-- Confirmé le 29/08 (COUNT + dépendances pg_depend) :
--   - client_contrats  : 0 ligne, ZÉRO vue/fonction dépendante, ZÉRO usage JS.
--     Table entièrement morte.
--   - client_documents : 0 ligne, ZÉRO usage JS (aucun POST/PATCH/SELECT dans
--     SportVision-OS-Full.html), mais EST lue par la vue secretariat_documents
--     (une des 4 branches UNION, catégorie 'client'/'avenant'/'club_plus').
--     Donc pas totalement "morte" au niveau SQL, juste jamais alimentée par
--     aucun flux applicatif actuel.
-- Décision : ne pas construire d'écran dessus ce soir (hors scope de cette
-- session, cf. consigne). Chantier séparé si Fouka veut un jour brancher un
-- flux d'upload de documents clients dessus.
-- ────────────────────────────────────────────────────────────────────────────
