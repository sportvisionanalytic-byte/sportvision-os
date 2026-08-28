-- ============================================================================
-- migration-production-validation-unifiee-v1.sql
-- ============================================================================
-- Refonte interface Responsable Production (spec du 28/08/2026) : UNE seule
-- action « VALIDER LA PRODUCTION » doit déclencher automatiquement toute la
-- distribution vers CM affilié / Club+ / Connect / Finance / Media Bank,
-- au lieu de l'envoi manuel actuel PAR LIVRABLE avec saisie d'email à chaque
-- fois (confirmerLivraison(), SportVision-OS-Full.html:9597, appelée depuis
-- modalPrepLivraison()). Cette migration N'AJOUTE AUCUN NOUVEAU BOUTON UI —
-- elle fournit uniquement la fonction RPC serveur ; le branchement du bouton
-- « Valider la production » sur validate_production() est une tâche séparée
-- qui touchera SportVision-OS-Full.html (hors périmètre ici, fichier non
-- modifié volontairement).
--
-- ── Ce qui existait déjà avant cette migration (vérifié par lecture directe,
--    pas supposé) ────────────────────────────────────────────────────────
--
-- 1. confirmerLivraison() (SportVision-OS-Full.html:9597) : flux manuel
--    PAR LIVRABLE. Pour chaque media_livrables au statut 'pret_a_livrer',
--    l'utilisateur (admin/prod/sec) ouvre une modale, saisit un email
--    destinataire, et le clic crée une ligne media_livraisons (traçabilité
--    de l'envoi), passe CE livrable à statut='livre', pose
--    date_expiration = +90 jours UNIQUEMENT si le client n'est pas un club
--    (type_client <> 'club') et qu'aucune expiration n'était déjà saisie à
--    la main, puis SI un cmId a été détecté (voir point 2), crée un
--    brouillon dans `contenus` et notifie ce CM. Le module `contrats`
--    (type_contrat='full_communication', statut='actif') est déjà la source
--    de vérité pour savoir si un client est en Full Communication — c'est
--    exactement la requête que modalPrepLivraison() fait déjà côté client
--    (SportVision-OS-Full.html, juste avant confirmerLivraison) et que
--    reprend cette migration côté serveur.
--
-- 2. migration-clubplus-v49-production-validee-bridge.sql : vue en lecture
--    seule `club_media_livrables`, alimentée automatiquement par
--    media_livrables (statut in 'livre','consulte') pour les clubs reliés
--    via clubs.portail_client_id = prestations.client_id. Alimentée par le
--    flux existant, écriture : aucune. PAS encore filtrée par catégorie de
--    média (rushs/travail vs final) — cette migration comble ce point précis
--    (section 1 ci-dessous).
--
-- 3. migration-contenus-prestation-link.sql : ajoute contenus.prestation_id
--    (traçabilité, FK nullable) + policies contenus_staff_insert_livraison /
--    contenus_staff_select_livraison pour que sec/prod puissent créer un
--    brouillon `contenus` POUR le CM affecté (auth.uid() du staff diffère du
--    cm_id de la ligne insérée).
--
-- 4. migration-media-bank.sql : Media Bank = 3 colonnes sur media_liens
--    (is_media_bank / media_bank_sport / media_bank_category), pas de table
--    séparée — « pas de duplication de fichier » est un principe déjà acquis
--    structurellement par ce choix de modélisation. Le tag est une action de
--    CURATION volontaire admin/prod (« pépites réutilisables »), PAS un
--    marquage automatique de tout ce qui est livré — voir section 4 pour la
--    conclusion (rien à ajouter ici).
--
-- 5. prestations_equipe.remuneration / statut_paiement (migration-
--    remuneration-paiement.sql) : le « coût opérateur » existe déjà en
--    arrière-plan dès l'AFFECTATION de l'équipe (bien avant la livraison),
--    et migration-prestations-equipe-v88-mask-remuneration-prod.sql masque
--    déjà cette colonne pour le rôle prod (vue prestations_equipe_display) —
--    l'exigence « jamais affiché dans l'interface Production » est donc déjà
--    satisfaite par le schéma existant, indépendamment de cette migration.
--    Aucun trigger existant ne fait progresser statut_paiement automatique-
--    ment (vérifié : seul le bouton "✓ Valider" de l'écran Rémunérations,
--    majStatutPaiement('validé'), le fait, un par un). Voir section 3.
--
-- ── Ce que cette migration AJOUTE ───────────────────────────────────────
--
-- 1. Filtre catégorie sur club_media_livrables (exclut rushs/versions de
--    travail — Club+ ne doit voir que des contenus prêts, jamais du brut
--    technique).
-- 2. validate_production(p_prestation_id) : fonction RPC SECURITY DEFINER,
--    UNE seule action qui (a) vérifie les droits de l'appelant, (b) fait
--    passer la prestation par la transition officielle 'livrée'→'clôturée'
--    (réutilise le trigger existant validate_prestation_statut_transition,
--    ne duplique pas sa logique de validation), (c) bascule en lot tous les
--    media_livrables 'pret_a_livrer' de cette prestation vers 'livre' (ce que
--    confirmerLivraison() faisait un par un), avec la même règle des 90 jours
--    pour un client particulier, (d) crée UN brouillon `contenus` consolidé
--    pour le CM affilié si le client est en Full Communication active,
--    (e) fait progresser le payable Finance (prestations_equipe.statut_
--    paiement 'en_attente' → 'validé' pour les membres d'équipe ayant
--    accepté la mission).
--
-- ── Gaps documentés, laissés volontairement de côté (voir en fin de
--    fichier pour le détail) ──────────────────────────────────────────
--
-- - Connect « livrable rattaché à la commande » : AUCUNE table
--   connect_orders/commande n'existe dans ce projet (vérifié : grep
--   exhaustif sur *.sql et SportVision-OS-Full.html, aucune occurrence).
--   Le rattachement réel pour un client particulier passe déjà par
--   `client_media_livrables` (migration-portail-v5.sql), une vue quasi
--   identique à club_media_livrables, indexée sur media_livrables.
--   prestation_id — donc déjà automatique dès que le statut passe à
--   'livre' (fait par cette migration, section 2c). Ce qui N'EXISTE PAS et
--   n'est PAS ajouté ici : un flag « Publier dans Connect » sur
--   media_livrables/prestations pour piloter l'album Pass Photo
--   (photo_albums, migration-connect-pass-photo-v1.sql). Inventer ce
--   comportement (quels albums publier, à quel moment) sans spec précise
--   du flag risquerait de publier prématurément un album encore en
--   curation — mieux vaut un gap documenté qu'un comportement inventé.
-- - Media Bank : aucune action nécessaire (voir point 4 ci-dessus), la
--   curation reste un geste volontaire distinct de la validation.
--
-- Idempotente de bout en bout : DROP VIEW/CREATE VIEW pour le filtre
-- Club+, CREATE OR REPLACE pour la fonction, et la fonction elle-même est
-- rejouable sans dupliquer aucune distribution (UPDATE ... WHERE statut=X
-- ne retouche que les lignes encore dans l'état de départ, contenus utilise
-- un NOT EXISTS avant insert — même style que generate_missions_from_plan,
-- migration-planning-mensuel-cm.sql).
--
-- N'exécute rien sur la base réelle — à exécuter par ailleurs (Supabase →
-- SQL Editor ou API Management) après relecture.
-- ============================================================================


-- ── 1. Club+ : filtre catégorie sur club_media_livrables ───────────────────
-- media_liens.categorie (migration-medias.sql) distingue déjà 'depot' et
-- 'rushs'/'travail' (matière brute / versions non finalisées) de
-- 'previsualisation'/'final'/'livraison'/'bibliotheque' (états montrables).
-- 'depot' est inclus dans l'exclusion au même titre que 'rushs' : les deux
-- désignent du contenu brut/pré-sélection technique, jamais destiné à un
-- club — 'previsualisation' reste volontairement autorisée (un aperçu validé
-- en interne peut légitimement être montré). Un media_livrable sans lien_id
-- (mlien.categorie null, ex. livrable purement instructif) n'est PAS exclu :
-- seule une catégorie explicitement technique bloque l'affichage.
drop view if exists club_media_livrables;
create view club_media_livrables as
select
  ml.id, cl.id as club_id, ml.prestation_id, ml.nom, ml.type_livrable, ml.format,
  ml.duree, ml.nb_fichiers, ml.date_validation, ml.date_expiration, ml.instructions,
  ml.statut, ml.created_at, mlien.url as lien_url
from media_livrables ml
join prestations p on p.id = ml.prestation_id
join clubs cl on cl.portail_client_id = p.client_id
left join media_liens mlien on mlien.id = ml.lien_id
where ml.statut in ('livre', 'consulte')
  and (mlien.categorie is null or mlien.categorie not in ('rushs', 'travail', 'depot'))
  and is_club_member(cl.id);

revoke insert, update, delete, truncate on club_media_livrables from authenticated, anon;
grant select on club_media_livrables to authenticated;


-- ── 2. validate_production() ────────────────────────────────────────────
-- SECURITY DEFINER, appelable en RPC (POST /rest/v1/rpc/validate_production).
-- Ne fait jamais confiance à un paramètre pour les droits : revérifie
-- systématiquement le rôle de auth.uid() (même principe que
-- generate_missions_from_plan / enforce_prod_manual_prestation_scope).
--
-- Périmètre du rôle 'prod' : vérifié avant d'écrire cette fonction que ce
-- rôle n'est PAS scopé par prestation/client ailleurs dans ce projet (voir
-- enforce_prod_manual_prestation_scope, migration-prestations-creation-
-- manuelle-prod-limitee.sql, et le pattern is_staff() de media_liens) — prod
-- est un rôle staff à accès large, comme admin, sans notion de « ses »
-- prestations. Aucune restriction de périmètre supplémentaire n'est donc
-- ajoutée ici, cohérent avec le reste du schéma existant.
create or replace function validate_production(p_prestation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller_role text;
  v_prestation prestations%rowtype;
  v_client clients%rowtype;
  v_has_fullcom boolean := false;
  v_media_livres_count int := 0;
  v_expiration_posee_count int := 0;
  v_cm_draft_cree boolean := false;
  v_payables_valides_count int := 0;
  v_deja_clôturee boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;

  select role into v_caller_role from profiles where id = auth.uid();
  if v_caller_role is distinct from 'admin' and v_caller_role is distinct from 'prod' then
    raise exception 'Seuls les rôles admin et prod peuvent valider une production.' using errcode = '42501';
  end if;

  select * into v_prestation from prestations where id = p_prestation_id;
  if not found then
    raise exception 'Prestation introuvable : %.', p_prestation_id;
  end if;

  -- Transition officielle : seule 'livrée' → 'clôturée' est autorisée par
  -- validate_prestation_statut_transition() (migration-prestations-refus-
  -- reattribution.sql, version en vigueur au 28/08/2026 — inclut toutes les
  -- arêtes de migration-prestations-v87-decouple-statut-financier.sql qui a
  -- introduit cette transition finale directe, INC-021). On laisse le
  -- trigger existant faire l'unique source de vérité sur ce qui est une
  -- transition légale plutôt que de dupliquer sa liste ici.
  if v_prestation.statut = 'clôturée' then
    -- Rejeu idempotent : la prestation a déjà été validée. On ne retente pas
    -- la transition (elle échouerait de toute façon, clôturée→clôturée n'est
    -- pas dans la table de transitions) mais on rejoue quand même toute
    -- l'orchestration ci-dessous, qui est elle-même idempotente — utile si
    -- une validation précédente avait échoué à mi-chemin (ex. distribution CM
    -- en erreur après la transition de statut).
    v_deja_clôturee := true;
  elsif v_prestation.statut = 'livrée' then
    update prestations set statut = 'clôturée' where id = p_prestation_id;
    select * into v_prestation from prestations where id = p_prestation_id;
  else
    raise exception 'Impossible de valider la production : la prestation est au statut "%", alors que seule "livrée" peut être validée (transition livrée → clôturée).', v_prestation.statut
      using errcode = '22023';
  end if;

  -- (a)/(c) media_livrables « prêts à livrer » de cette prestation → 'livre',
  -- en lot (remplace l'action manuelle par-livrable de confirmerLivraison()).
  -- Idempotent par construction : ne retouche que ce qui est encore
  -- 'pret_a_livrer' ; un rejeu ne touche plus rien une fois tout basculé.
  update media_livrables
  set statut = 'livre'
  where prestation_id = p_prestation_id
    and statut = 'pret_a_livrer';
  get diagnostics v_media_livres_count = row_count;

  -- Règle des 90 jours (Connect, client particulier) : identique à
  -- confirmerLivraison() — seulement si le client n'est pas un club (un club
  -- Full Com passe par le CM, pas par cette rétention individuelle) et
  -- seulement si aucune expiration n'a déjà été saisie à la main (jamais
  -- écraser un choix explicite).
  select * into v_client from clients where id = v_prestation.client_id;

  if v_client.id is not null and v_client.type_client is distinct from 'club' then
    update media_livrables
    set date_expiration = now() + interval '90 days'
    where prestation_id = p_prestation_id
      and statut in ('livre', 'consulte')
      and date_expiration is null;
    get diagnostics v_expiration_posee_count = row_count;
  end if;

  -- (b) Pont CM Full Communication : UN brouillon `contenus` consolidé pour
  -- toute la prestation (et non un par livrable comme l'ancien flux) — plus
  -- cohérent avec « une seule action » et rend l'idempotence triviale : on
  -- vérifie juste qu'aucun brouillon n'existe déjà pour (prestation, CM)
  -- avant d'insérer, comme generate_missions_from_plan le fait pour les
  -- présences déjà transformées en mission.
  if v_client.id is not null then
    select exists(
      select 1 from contrats c
      where c.client_id = v_client.id
        and c.type_contrat = 'full_communication'
        and c.statut = 'actif'
    ) into v_has_fullcom;

    if v_has_fullcom and v_client.cm_id is not null
       and exists (select 1 from media_livrables where prestation_id = p_prestation_id and statut in ('livre', 'consulte'))
       and not exists (select 1 from contenus where prestation_id = p_prestation_id and cm_id = v_client.cm_id)
    then
      insert into contenus (client_id, cm_id, prestation_id, titre, statut)
      values (
        v_client.id, v_client.cm_id, p_prestation_id,
        'Contenu livré — ' || coalesce(v_prestation.type_prestation, v_prestation.reference, 'prestation'),
        'brouillon'
      );
      v_cm_draft_cree := true;
    end if;
  end if;

  -- (c bis) Club+ : rien à faire ici — club_media_livrables (section 1
  -- ci-dessus) lit déjà en direct media_livrables au statut livre/consulte,
  -- filtré par catégorie. La mise à jour de statut faite au point (a)
  -- suffit à rendre les livrables visibles.

  -- (d) Finance : le coût opérateur (prestations_equipe.remuneration) existe
  -- déjà en arrière-plan depuis l'affectation de l'équipe, masqué de l'UI
  -- Production (migration-prestations-equipe-v88-mask-remuneration-prod.sql)
  -- — rien à « générer ». Choix assumé de cette migration : la validation de
  -- production fait progresser le payable de 'en_attente' à 'validé' pour
  -- les membres d'équipe ayant accepté la mission, au lieu de rester
  -- suspendu jusqu'à un clic manuel supplémentaire (le bouton "✓ Valider" de
  -- l'écran Rémunérations, majStatutPaiement('validé')) — c'est exactement
  -- la même écriture, déclenchée automatiquement puisque « produire validée »
  -- signifie que le travail a bien eu lieu. Les étapes suivantes
  -- (transmis_compta / payé) restent des actions humaines volontaires,
  -- non automatisées ici. Idempotent : ne retouche que 'en_attente'/null.
  update prestations_equipe
  set statut_paiement = 'validé'
  where prestation_id = p_prestation_id
    and statut = 'acceptée'
    and (statut_paiement is null or statut_paiement = 'en_attente');
  get diagnostics v_payables_valides_count = row_count;

  -- (e) Media Bank : aucune action automatique — is_media_bank est une
  -- curation volontaire admin/prod (migration-media-bank.sql), indépendante
  -- de la validation de production. « Pas de duplication de fichier » est
  -- déjà garanti structurellement par ce modèle (3 colonnes sur media_liens,
  -- pas de table séparée).

  -- (f) Connect « commande » / Pass Photo : GAP documenté en tête de fichier
  -- — aucune table connect_orders n'existe, aucun flag « Publier dans
  -- Connect » n'existe sur media_livrables/prestations. Le rattachement
  -- particulier (client_media_livrables, migration-portail-v5.sql) est déjà
  -- automatique via le point (a)/(c) ci-dessus.

  return jsonb_build_object(
    'prestation_id', p_prestation_id,
    'statut', 'clôturée',
    'deja_clôturee_avant_appel', v_deja_clôturee,
    'media_livrables_marques_livres', v_media_livres_count,
    'expirations_90j_posees', v_expiration_posee_count,
    'brouillon_cm_cree', v_cm_draft_cree,
    'payables_operateur_valides', v_payables_valides_count
  );
end;
$$;

revoke all on function validate_production(uuid) from public, anon;
grant execute on function validate_production(uuid) to authenticated;

-- ── Vérification / test manuel (à exécuter après migration, avec un compte
--    de test jetable role=prod ou role=admin, PAS en tant que service_role) :
--
-- 1. Repérer une prestation réelle au statut 'livrée' avec au moins un
--    media_livrables au statut 'pret_a_livrer' :
--      select id, statut, client_id from prestations where statut = 'livrée' limit 5;
--
-- 2. Appeler la fonction via RPC (REST) :
--      POST /rest/v1/rpc/validate_production
--      { "p_prestation_id": "<uuid ci-dessus>" }
--    ou depuis SQL Editor :
--      select validate_production('<uuid ci-dessus>'::uuid);
--
-- 3. Vérifier le retour jsonb (compteurs) puis en base :
--      select statut from prestations where id = '<uuid>';                        -- doit être 'clôturée'
--      select statut, date_expiration from media_livrables where prestation_id='<uuid>'; -- 'livre', +90j si particulier
--      select * from contenus where prestation_id = '<uuid>';                      -- brouillon si Full Com
--      select statut_paiement from prestations_equipe where prestation_id='<uuid>'; -- 'validé' pour les accéptées
--
-- 4. Rejouer l'appel une seconde fois sur la MÊME prestation : le jsonb
--    retourné doit montrer des compteurs à 0 (rien de dupliqué), avec
--    deja_clôturee_avant_appel=true.
--
-- 5. Vérifier le rejet pour un rôle non autorisé (ex. compte 'cm' ou 'photo')
--    → erreur 42501, et pour une prestation dans un mauvais statut (ex.
--    'planifiée') → erreur 22023.
-- ============================================================================
