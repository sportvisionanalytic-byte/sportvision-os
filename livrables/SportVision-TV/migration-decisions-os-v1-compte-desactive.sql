-- ============================================================================================
-- Décision du 10/09/2026 (Fouka) : un compte OS désactivé perd l'accès IMMÉDIATEMENT.
-- ============================================================================================
--
-- POURQUOI. Désactiver un collaborateur supprime ses sessions (trg_revoquer_sessions_desactive,
-- migration-comptes-os-v2) : il ne peut plus obtenir de nouveau jeton. Mais le jeton d'accès déjà
-- émis reste valable jusqu'à une heure, et pendant cette heure la base continuait de le traiter
-- en collaborateur : is_staff() et toutes les autres vérifications d'identité lisaient
-- profiles.role sans jamais lire profiles.actif. Mesuré le 10/09/2026 par PostgREST avec un vrai
-- jeton (tests/os-compte-desactive.test.mjs) : une RH désactivée, avec le même jeton, lisait
-- encore 3 clients, 3 prestations, 19 profils, les pôles, et appelait notifier_grade_valide.
--
-- Même trou pour la recrue en intégration (actif = false posé à la création) : elle ouvre une
-- session avec son lien d'invitation pour choisir son mot de passe, et cette session ne s'est
-- jamais « désactivée » — le déclencheur ne réagit qu'au passage true → false. Mesuré : une
-- recrue lisait exactement ce que lit un collaborateur de son rôle.
--
-- INVENTAIRE (mesuré sur la base de production le 10/09/2026, avant d'écrire une ligne) :
--   - 229 policies lisent le profil de l'appelant EN LIGNE (« exists (select 1 from profiles
--     where id = auth.uid() and role ...) »), sur 125 tables + storage.objects ; aucune ne lit
--     profiles.actif ;
--   - 25 fonctions d'identité (is_staff, get_my_role, is_admin_or_rh, media_*, peut_*,
--     cm_clubs_autorises, get_my_pole_ids, is_pole_responsable…) appelées par ces policies,
--     par les vues et par les RPC ;
--   - 25 RPC SECURITY DEFINER exécutables par authenticated qui décident d'un droit en lisant
--     elles-mêmes profiles.role (elles contournent la RLS : une policy ne les arrête pas) ;
--   - 1 vue sans security_invoker (secretariat_documents) qui lit le rôle en ligne.
--
-- CE QUE FAIT CETTE MIGRATION.
--   1. compte_os_desactive() : vrai seulement pour un compte qui a une ligne profiles avec
--      actif = false. Faux pour tout le monde d'autre — y compris les comptes Connect et Club+,
--      qui n'ont pas de ligne profiles, et le service_role (auth.uid() nul).
--   2. Les 25 fonctions d'identité renvoient faux (get_my_role : NULL) pour un compte désactivé :
--      « and actif » là où elles lisent déjà profiles (même ligne, lue par clé primaire : coût
--      nul, aucun index à ajouter), « not compte_os_desactive() » là où elles lisent
--      pole_affectations ou club_cm_affectations.
--   3. Les 25 RPC refusent d'entrée un compte désactivé (erreur 42501, soit 403 côté API), juste
--      après leur « begin ». Rien d'autre n'est modifié dans leur corps.
--   4. Les 229 policies en ligne ne sont PAS réécrites une par une (229 réécritures = autant
--      d'occasions de casser un compte actif). À la place, chaque table dont la RLS est active
--      reçoit une policy RESTRICTIVE « compte_os_desactive_bloque » : elle vaut vrai pour tout
--      compte non désactivé, donc ne change strictement rien pour eux (une policy restrictive
--      ne peut que retirer), et ferme la table à un compte désactivé, quelle que soit la façon
--      dont ses autres policies lisent le rôle. Évaluée une fois par requête (sous-requête
--      scalaire → InitPlan).
--   5. Table profiles : EXCLUE de la policy restrictive, volontairement. L'OS lit le profil de la
--      personne au moment de la connexion pour lui dire « compte désactivé » ou « votre accès
--      sera ouvert à la fin de votre intégration », et c'est aussi ce qui permet à la recrue de
--      choisir son mot de passe. « Lecture profil personnel » reste donc ouverte ; les quatre
--      autres policies de profiles qui accordent un droit reçoivent « actif » directement.
--
-- CE QUI N'EST PAS TOUCHÉ, ET POURQUOI.
--   - est_cm_cloisonne() et est_operateur_terrain() : ce sont des marqueurs de CLOISONNEMENT,
--     employés en négation dans des policies restrictives (« not est_cm_cloisonne() or … »).
--     Les faire répondre faux pour un compte désactivé LEVERAIT la restriction.
--   - La branche « not exists (… role in ('com','sec'…)) » de peut_planifier_presence : même
--     raison, c'est une exclusion.
--   - Les fonctions de déclencheur (protect_sensitive_*…) : elles ne s'exécutent que sur une
--     écriture qui a déjà passé la RLS, désormais fermée à un compte désactivé.
--   - Les Edge Functions qui vérifient elles-mêmes profiles.role : hors base, voir le rapport.
--
-- GARDE-FOU. Les fonctions sont recréées à partir de leur définition de production du 10/09.
-- Si l'une d'elles a changé depuis (autre chantier exécuté avant celui-ci), la migration
-- s'arrête AVANT toute modification plutôt que d'écraser la version plus récente.
--
-- Non rejouable par construction : un second passage s'arrête au garde-fou sans rien modifier.
-- Testée en transaction annulée (tests/compte-desactive.test.sql) ; à vérifier
-- après exécution par PostgREST avec un vrai jeton : tests/os-compte-desactive.test.mjs.
-- ============================================================================================


-- Verrous. Poser une policy prend un verrou exclusif sur sa table jusqu'à la fin de la
-- transaction (toute la migration dure environ 2 s, mesuré). Si une requête longue tient déjà une
-- table, mieux vaut échouer tout de suite — rien n'est modifié, on relance — que de mettre toute
-- l'API en file d'attente derrière nous.
set lock_timeout = '5s';


-- ── 0. Garde-fou : rien n'a changé depuis l'inventaire ─────────────────────────────────────
do $garde$
declare
  attendu constant jsonb := '{"public.is_staff()":"f05713b9577dcc7fae5d5bb9395f82f7","public.get_my_role()":"f0dc8c9ea668f6966b38d78e4ad107f9","public.is_admin_or_rh()":"d373a9f82970fafac2d4f3fc9cc5b5d2","public.media_commerce_staff()":"0d4772817fe214529e0e1d087da48b5a","public.media_staff_write()":"69e12516c7ffc1978659635b0566d8f5","public.media_upload_staff()":"c2f8d21d158eaecac1929fb4713fd269","public.media_pricing_staff()":"e47cc01e6d8ec75d66957d646f1cb28e","public.media_stats_access()":"1cf319354237ff09b6a7e8c6253aab56","public.media_pricing_staff_album(uuid)":"f96b4b1499714b46a96773dc25629ddb","public._media_stats_albums(boolean)":"8ea5d88dafea626e642fcd800072efc9","public.get_my_pole_ids()":"3ca10a669fc0c306889177f97f14b8d0","public.is_pole_responsable(uuid)":"8e73616435337b06f70cd62a29be393a","public.is_any_pole_responsable()":"01625e04760e1d8c52b45e8dd3d8fc37","public.peut_operer_club(uuid)":"a30e99cc42096f0e83e28420b54a6040","public.peut_planifier_presence(uuid)":"fd1994188aef7de2c4aa8c5f6278d644","public.peut_voir_candidature(text,uuid,text)":"f036deabe81a0ed945c8921ec6f340ff","public.peut_voir_couts_pole(uuid)":"9b25c2c03ddbc9afe41b657f30a86519","public.pole_finance_access_ok(uuid)":"6f3a6cbf1c42c8c3404c503eb10cca37","public.peut_basculer_saison(uuid)":"11be866fab55fa1e30006f6384ff95a8","public.is_cm_authorized_for_club(uuid,uuid)":"6f9a7d9f5b98d199c9370a8e9943ab40","public.contenus_visible_par_cm(uuid,uuid)":"258a9774284566bfb884a283c597be20","public.cm_clubs_autorises()":"67228cefc495643484d7f0422b106095","public.cm_espaces_clubs()":"f0090cea59933f2cbdceb77ea067724c","public.club_affectations_cm(uuid)":"a8a5b0c40206cc81064359ded73ad948","public.cm_mes_clubs()":"7c39640fff2b912fda5cdfce642c5971","public.claim_club_request(uuid)":"b474abd240246fcf5648a18b6ef4e534","public.club_booking_send_to_production(uuid)":"fff0bf5d5ab9c39a10fa5a7bb0abca9a","public.cm_client_logo_maj(uuid,text)":"86d68fa50b2c74b82b9cf672f385293d","public.couverture_operateurs(text)":"e105ceafd51680f4e1170f9e1f94a4a5","public.credit_organization(uuid,integer,text)":"c2e6bb02bca692cbeac63665840d8d0d","public.fin_generer_depenses_recurrentes()":"1d8eca3c428d61cb92554c1ea8fe3676","public.fin_ignorer_transaction(uuid)":"a513c4f59d6207c52ed3ec0efde3dd8e","public.fin_rapprocher_transaction(uuid,uuid,uuid)":"191e1bcf35ab852a7032ab9973dac038","public.fin_suggerer_rapprochements(uuid)":"55b60f4b2f4d731a3e362b4fe0c07200","public.generate_missions_from_plan(uuid)":"804438c06918aa748b215307c3ff15b7","public.modifier_remuneration_mission(uuid,numeric,numeric,text,text)":"ceba4f89f8e9f02a330469f1cb612fb0","public.notifier_grade_valide(uuid,integer)":"8bb7c558897cd412013d431d8e149027","public.pole_valider_remuneration_responsable(uuid,text,numeric,text)":"6238522a68f343209876edc4bd00626e","public.provisionner_club_plus_full_com(uuid,boolean)":"30900f6a321c8923bf88df652e28a6d4","public.rentabilite_clubs_mois(date)":"da95ae5b1ec0f3001d493f803a2baf3d","public.rpc_club_operational_summary(uuid)":"0478c892c6c4f29c2ccf2464783eb8cb","public.rpc_finance_consolidated_mensuel(date,date)":"48b0e455e334c3c923092c68bfe6ff03","public.rpc_get_custom_quiz(text)":"a14aa9e757d10aec5a8ecbab2ccb38ac","public.staff_update_club_request_status(uuid,text)":"02c40bbdddfb449a7e59a662ba3f9a9d","public.transformer_demande_en_contenu(uuid,text,date,text)":"e3f742cbe85627fbb6d75364414401a1","public.update_club_request_status(uuid,text)":"4b48c3f1f15160ae5046b261f2aa2adb","public.update_request_status(uuid,text)":"b71310b79d5f66077bb3ee0a10700545","public.validate_production(uuid)":"0ed98a32873d4503cd7586e37f19612b","public.rpc_ajouter_membre_equipe(uuid,uuid,text,text,time without time zone,numeric,smallint,numeric,numeric,numeric,text,text,boolean)":"ec31b761da131eb5daa892762f8f5212","public.rpc_retirer_membre_equipe(uuid)":"c47f7075c96067d362096ebde2a4ef3d"}';
  k text; h text; actuel text;
begin
  -- Second passage : les empreintes ne correspondent plus (c'est cette migration qui les a
  -- changées). On s'arrête sans rien toucher plutôt que de réécrire des fonctions qui ont pu
  -- évoluer depuis.
  if exists (select 1 from pg_proc where proname = 'compte_os_desactive'
               and pronamespace = 'public'::regnamespace) then
    raise exception 'migration-decisions-os-v1 déjà appliquée : rien n''a été modifié.';
  end if;
  for k, h in select * from jsonb_each_text(attendu) loop
    select md5(pg_get_functiondef(k::regprocedure)) into actuel;
    if actuel is distinct from h then
      raise exception 'migration-decisions-os-v1 : % a changé depuis l''inventaire du 10/09/2026. Rien n''a été modifié. Reporter la même modification (« actif » ou le refus « Compte désactivé ») sur sa NOUVELLE définition dans ce fichier, et son empreinte md5 ci-dessus, plutôt que d''écraser la version plus récente.', k;
    end if;
  end loop;
  if md5(pg_get_viewdef('public.secretariat_documents'::regclass)) is distinct from '6ad0fb778ce2ccf249185a701daca6ee' then
    raise exception 'migration-decisions-os-v1 : la vue secretariat_documents a changé depuis l''inventaire du 10/09/2026. Rien n''a été modifié.';
  end if;
end $garde$;


-- ── 1. compte_os_desactive() ────────────────────────────────────────────────────────────────
-- SECURITY DEFINER : elle doit lire profiles sans passer par ses policies (qui l'appelleraient
-- elles-mêmes). Recherche par clé primaire, résultat constant sur la requête (STABLE).
create or replace function public.compte_os_desactive()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from profiles where id = auth.uid() and not actif);
$$;

comment on function public.compte_os_desactive() is
  'Vrai si l''appelant est un compte OS désactivé (profiles.actif = false). Faux pour tout autre compte, y compris sans profil. migration-decisions-os-v1.';


-- ── 2 et 3. Fonctions d'identité et RPC (définitions de production + « actif ») ───────────
CREATE OR REPLACE FUNCTION public.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.actif
      and p.role in ('admin','sec','prod','photo','cm','compta','com','rh')
      and not exists (
        select 1 from memberships m
        join organizations o on o.id = m.organization_id
        where m.user_id = p.id and o.organization_type <> 'cm_agency'
      )
      and not exists (select 1 from player_profiles pp where pp.user_id = p.id)
      and not exists (select 1 from connect_profile_settings cps where cps.user_id = p.id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role FROM profiles WHERE id = auth.uid() AND actif;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin_or_rh()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from profiles where id = auth.uid() and actif and role in ('admin','rh'));
$function$;

CREATE OR REPLACE FUNCTION public.media_commerce_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from profiles where id = auth.uid() and actif and role in ('admin', 'sec', 'compta'));
$function$;

CREATE OR REPLACE FUNCTION public.media_staff_write()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from profiles where id = auth.uid() and actif and role in ('admin','sec'));
$function$;

CREATE OR REPLACE FUNCTION public.media_upload_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.actif and p.role in ('admin','sec','prod','photo')
  );
$function$;

CREATE OR REPLACE FUNCTION public.media_pricing_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.actif and p.role in ('admin','prod','sec')
  )
  or exists (
    select 1 from pole_affectations pa
    where pa.user_id = auth.uid() and pa.role_pole = 'responsable' and pa.actif
      and not public.compte_os_desactive()
  );
$function$;

CREATE OR REPLACE FUNCTION public.media_stats_access()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.actif and p.role in ('admin','prod','sec','compta')
  )
  or exists (
    select 1 from pole_affectations pa
    where pa.user_id = auth.uid() and pa.role_pole = 'responsable' and pa.actif
      and not public.compte_os_desactive()
  );
$function$;

CREATE OR REPLACE FUNCTION public.media_pricing_staff_album(p_album_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.actif and p.role in ('admin','prod','sec')
  )
  or exists (
    -- Le pôle de l'album d'abord, celui de sa mission ensuite. `coalesce` et non `or` : un album
    -- explicitement rattaché à Basket ne doit pas rester accessible au responsable Football parce
    -- que sa mission était encore rangée là.
    select 1
    from media_albums a
    left join prestations pr on pr.id = a.mission_id
    join pole_affectations pa on pa.pole_id = coalesce(a.pole_id, pr.pole_id)
    where a.id = p_album_id
      and coalesce(a.pole_id, pr.pole_id) is not null
      and pa.user_id = auth.uid()
      and pa.role_pole = 'responsable'
      and pa.actif
      and not public.compte_os_desactive()
  );
$function$;

CREATE OR REPLACE FUNCTION public._media_stats_albums(p_inclure_exclus boolean DEFAULT false)
 RETURNS TABLE(album_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select a.id
  from media_albums a
  where (coalesce(p_inclure_exclus, false) or not a.analytics_excluded)
    and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role in ('admin','prod','sec','compta'))
      or (
        coalesce(a.pole_id, (select pr.pole_id from prestations pr where pr.id = a.mission_id)) is not null
        and exists (
          select 1 from pole_affectations pa
          where pa.user_id = auth.uid()
            and pa.role_pole = 'responsable'
            and pa.actif
            and not public.compte_os_desactive()
            and pa.pole_id = coalesce(a.pole_id, (select pr.pole_id from prestations pr where pr.id = a.mission_id))
        )
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_my_pole_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(array_agg(pole_id), '{}'::uuid[])
  from pole_affectations
  where user_id = auth.uid() and actif = true
    and not public.compte_os_desactive();
$function$;

CREATE OR REPLACE FUNCTION public.is_pole_responsable(p_pole_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from pole_affectations
    where pole_id = p_pole_id and user_id = auth.uid() and role_pole = 'responsable' and actif = true
      and not public.compte_os_desactive()
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_any_pole_responsable()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from pole_affectations
    where user_id = auth.uid() and role_pole = 'responsable' and actif = true
      and not public.compte_os_desactive()
  );
$function$;

CREATE OR REPLACE FUNCTION public.peut_operer_club(p_club_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- `coalesce` : sur un `p_club_id` nul, l'expression rendrait NULL, et un NULL dans un
  -- `if not (...)` ne déclenche pas la branche de refus — le garde-fou s'ouvrirait au lieu de se
  -- fermer. C'est le défaut déjà trouvé sur `peut_preparer_club(null)`.
  select p_club_id is not null
     and coalesce(
           is_club_admin(p_club_id)
             or (
               exists (
                 select 1 from profiles p
                  where p.id = auth.uid()
                    and p.actif
                    and p.role in ('admin', 'com', 'sec', 'cm')
               )
               and p_club_id in (select public.cm_clubs_autorises())
             ),
           false);
$function$;

CREATE OR REPLACE FUNCTION public.peut_planifier_presence(p_club_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p_club_id is not null and coalesce(
    exists (select 1 from profiles where id = auth.uid() and actif and role = 'admin')
    or (p_club_id in (select cm_clubs_autorises())
        -- cm_clubs_autorises() ouvre TOUS les clubs aux fonctions transverses : elles lisent,
        -- elles ne décident pas d'une présence.
        and not exists (select 1 from profiles where id = auth.uid()
                         and role in ('com', 'sec', 'prod', 'compta', 'rh', 'photo', 'expert_comptable', 'auditeur'))),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.peut_voir_candidature(p_poste text, p_pole_id uuid, p_statut text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Compte OS désactivé : plus aucune candidature (définition de production du 11/09, reprise :
  -- la branche Production y est devenue is_pole_responsable, elle-même gardée par cette migration).
  select exists (select 1 from profiles where id = auth.uid() and actif and role = 'admin')
      or (p_poste in ('photographe', 'videaste', 'les_deux') and p_pole_id is not null
          and coalesce(is_pole_responsable(p_pole_id), false))
      or (p_statut = 'retenu'
          and exists (select 1 from profiles where id = auth.uid() and actif and role in ('sec', 'rh')));
$function$;

CREATE OR REPLACE FUNCTION public.peut_voir_couts_pole(p_pole_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (select 1 from profiles where id = auth.uid() and actif
                  and role in ('admin', 'compta', 'expert_comptable', 'auditeur'))
      or (exists (select 1 from profiles where id = auth.uid() and actif and role in ('prod', 'sec'))
          and coalesce(pole_scope_ok(p_pole_id), false));
$function$;

CREATE OR REPLACE FUNCTION public.pole_finance_access_ok(p_pole_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from profiles where id = auth.uid() and actif and role = 'admin')
    or is_pole_responsable(p_pole_id);
$function$;

CREATE OR REPLACE FUNCTION public.peut_basculer_saison(p_club_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.club_members
     where club_id = p_club_id and user_id = auth.uid()
       and role in ('admin', 'president') and status = 'actif'
  )
  or exists (select 1 from public.profiles where id = auth.uid() and actif and role = 'admin');
$function$;

CREATE OR REPLACE FUNCTION public.is_cm_authorized_for_club(target_club_id uuid, target_portail_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    (target_portail_client_id is not null and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role = 'cm' and p.niveau_cm = 'cm_lead')
      or contenus_visible_par_cm(target_portail_client_id, auth.uid())
    ))
    or (
      club_request_is_pool(target_club_id)
      and exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role = 'cm')
    );
$function$;

CREATE OR REPLACE FUNCTION public.contenus_visible_par_cm(p_client_id uuid, p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p_client_id is not null
    -- Un compte OS desactive ne voit plus aucun contenu (migration-decisions-os-v1).
    and not exists (select 1 from profiles d where d.id = p_uid and not d.actif)
    and (
    -- Responsable CM : vue globale, inchangee.
    exists (
      select 1 from profiles p
      where p.id = p_uid and p.role = 'cm' and p.cm_niveau_autonomie = 'responsable'
    )
    -- Affiliation explicite, modele historique, inchangee.
    or exists (
      select 1 from client_affiliations a, profiles p
      where a.client_id = p_client_id and a.user_id = p_uid and p.id = p_uid and p.role = 'cm'
        and a.role_on_client in ('cm_principal','cm_secondaire','cm_junior','lead_cm')
        and a.status = 'actif'
        and (a.end_date is null or a.end_date >= current_date)
    )
    -- NOUVEAU : designe comme CM de ce client. Sans condition de niveau.
    or exists (
      select 1 from clients cl, profiles p
      where cl.id = p_client_id and cl.cm_id = p_uid and p.id = p_uid and p.role = 'cm'
    )
    -- NOUVEAU : accompagne le club rattache a ce client (modele club_cm_affectations).
    or exists (
      select 1 from clubs c
      where c.portail_client_id = p_client_id
        and c.id in (select cm_clubs_autorises_de(p_uid))
    )
    -- Niveaux CM, modele historique, inchange.
    or exists (
      select 1 from profiles p, clients cl
      where p.id = p_uid and cl.id = p_client_id and p.role = 'cm' and (
        (p.niveau_cm in ('cm_junior','cm_confirme','cm_full_communication') and cl.cm_id = p_uid)
        or (p.niveau_cm = 'cm_club_plus_studio' and exists (
              select 1 from contrats c where c.client_id = cl.id
                and c.type_contrat = 'club_plus' and c.statut = 'actif'))
        or (p.niveau_cm = 'cm_evenement' and exists (
              select 1 from contrats c where c.client_id = cl.id
                and c.type_contrat = 'evenement' and c.statut = 'actif'))
      )
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.cm_clubs_autorises()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Un compte OS desactive n'a plus aucun club, quelle que soit la branche qui les lui ouvrait
  -- (migration-decisions-os-v1). L'union d'origine est inchangee, simplement enveloppee.
  select autorises.id from (
  -- La direction et les fonctions transverses gardent leur vue globale.
  select c.id from clubs c
  where exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role in ('admin','com','sec','prod','compta','rh')
  )

  union

  -- (3) Affectation nominative : le modele de la phase 1. Active, et dans sa fenetre de dates —
  -- desactiver une affectation retire donc l'acces au prochain acces, sans tache de nettoyage.
  select a.club_id
  from club_cm_affectations a
  where a.cm_id = auth.uid()
    and a.actif
    and a.date_debut <= current_date
    and (a.date_fin is null or a.date_fin >= current_date)

  union

  -- (1) Delegation a une agence CM dont l'utilisateur est membre actif. Une delegation expiree
  -- n'ouvre rien : du point de vue de l'utilisateur, elle n'a jamais existe.
  select d.club_id
  from cm_agency_club_access d
  join memberships m on m.organization_id = d.cm_agency_org_id
  join organizations o on o.id = d.cm_agency_org_id
  where m.user_id = auth.uid()
    and m.status = 'actif'
    and o.organization_type = 'cm_agency'
    -- `allowed` et `denied` sont des listes de MODULES, pas des drapeaux : la delegation par
    -- module affine ce que l'agence peut faire dans le club, elle ne conditionne pas l'acces au
    -- club lui-meme. L'existence de la ligne suffit donc, comme dans getSpaces cote Club+.
    and (d.expires_at is null or d.expires_at >= current_date)

  union

  -- (2) « CM responsable » : membre actif d'une agence CM avec cm_super_access, il voit tous les
  -- clubs. Regle metier posee le 22/08, conservee telle quelle.
  select c.id from clubs c
  where exists (
    select 1 from memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = auth.uid() and m.status = 'actif'
      and o.organization_type = 'cm_agency' and coalesce(m.cm_super_access, false)
  )
  ) autorises(id)
  where not public.compte_os_desactive();
$function$;

CREATE OR REPLACE FUNCTION public.cm_espaces_clubs()
 RETURNS TABLE(club_id uuid, nom text, logo_url text, origine text, role_affectation text, full_com boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select c.id, c.nom, coalesce(c.logo_url, c.ecusson_url),
         case
           when a.id is not null then 'affectation'
           when d.id is not null then 'delegation_agence'
           else 'cm_responsable'
         end,
         a.role,
         c.club_plus_source = 'full_com_included'
  from clubs c
  join (select cm_clubs_autorises() as id) autorises on autorises.id = c.id
  left join club_cm_affectations a
    on a.club_id = c.id and a.cm_id = auth.uid() and a.actif
   and a.date_debut <= current_date and (a.date_fin is null or a.date_fin >= current_date)
  left join cm_agency_club_access d
    on d.club_id = c.id
   and exists (select 1 from memberships m where m.user_id = auth.uid()
                 and m.organization_id = d.cm_agency_org_id and m.status = 'actif')
  -- Un administrateur n'est pas un CM : cette liste est celle d'un gestionnaire de clubs.
  where exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role = 'cm')
  order by c.nom;
$function$;

CREATE OR REPLACE FUNCTION public.club_affectations_cm(p_club_id uuid)
 RETURNS TABLE(id uuid, cm_id uuid, prenom text, nom text, role text, date_debut date, date_fin date, actif boolean, en_cours boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select a.id, a.cm_id, p.prenom, p.nom, a.role, a.date_debut, a.date_fin, a.actif,
         (a.actif and a.date_debut <= current_date
          and (a.date_fin is null or a.date_fin >= current_date)) as en_cours
  from club_cm_affectations a
  join profiles p on p.id = a.cm_id
  where a.club_id = p_club_id
    and (
      -- La direction voit tout l'historique du club.
      exists (select 1 from profiles me where me.id = auth.uid() and me.actif and me.role in ('admin','com'))
      -- Un CM ne voit que les affectations d'un club qui est dans son perimetre.
      or p_club_id in (select cm_clubs_autorises())
    )
  order by a.actif desc, a.date_debut desc;
$function$;

CREATE OR REPLACE FUNCTION public.cm_mes_clubs()
 RETURNS TABLE(club_id uuid, nom text, logo_url text, full_com boolean, role_affectation text, date_debut date, date_fin date, onboarding_statut text, onboarding_debut timestamp with time zone, derniere_activite timestamp with time zone, equipes integer, membres integer, coachs integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select c.id, c.nom, c.logo_url,
         c.club_plus_source = 'full_com_included',
         a.role, a.date_debut, a.date_fin,
         o.statut, o.started_at, o.last_activity_at,
         (select count(*)::integer from club_teams   t where t.club_id = c.id),
         (select count(*)::integer from club_members m where m.club_id = c.id),
         (select count(*)::integer from club_members m where m.club_id = c.id and m.role = 'coach')
  from club_cm_affectations a
  join clubs c on c.id = a.club_id
  left join club_onboarding_progress o on o.club_id = c.id
  where a.cm_id = auth.uid()
    and not public.compte_os_desactive()
    and a.actif
    and a.date_debut <= current_date
    and (a.date_fin is null or a.date_fin >= current_date)
  order by c.nom;
$function$;

CREATE OR REPLACE FUNCTION public.claim_club_request(p_request_id uuid)
 RETURNS club_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row club_requests;
  v_authorized boolean;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select exists(
    select 1 from profiles where id = auth.uid()
    and (role = 'admin' or (role = 'cm' and (cm_niveau_autonomie = 'responsable' or cm_pool_clubplus_general = true)))
  ) into v_authorized;
  if not v_authorized then
    raise exception 'Seuls les membres du pool Club+ general ou le Responsable CM peuvent prendre en charge cette demande.';
  end if;

  update club_requests set taken_by = auth.uid(), status = case when status = 'recues' then 'en_traitement' else status end
    where id = p_request_id and taken_by is null
    returning * into v_row;

  if v_row.id is null then
    raise exception 'Demande introuvable ou deja prise en charge.';
  end if;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.club_booking_send_to_production(p_booking_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_booking club_bookings%rowtype;
  v_club_client_id uuid;
  v_type_prestation text;
  v_heure time;
  v_prestation_id uuid;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from profiles where id = auth.uid() and role = any(array['admin','com','sec'])
  ) then
    raise exception 'Accès réservé au staff (admin/commercial/secrétariat).';
  end if;

  select * into v_booking from club_bookings where id = p_booking_id;
  if not found then
    raise exception 'Réservation introuvable.';
  end if;
  if v_booking.status <> 'confirmee' then
    raise exception 'Cette réservation doit être au statut "Confirmée" avant d''être envoyée en Production.';
  end if;
  if v_booking.prestation_id is not null then
    -- Idempotent : déjà envoyée (double-clic, ou deux membres du staff en
    -- parallèle) — renvoie la prestation existante plutôt que d'échouer ou
    -- d'en créer une seconde.
    return v_booking.prestation_id;
  end if;

  select portail_client_id into v_club_client_id from clubs where id = v_booking.club_id;
  if v_club_client_id is null then
    raise exception 'Ce club n''a pas encore de fiche client Portail associée (clubs.portail_client_id manquant) — impossible de créer la prestation sans client. Vérifiez le rattachement du club côté Documents/Portail avant de réessayer.';
  end if;

  -- Mapping best-effort du libellé de service vers le domaine fixe de
  -- type_prestation déjà utilisé partout ailleurs dans l'OS (même liste que
  -- OFFRE_SLUG_TO_TYPE_PRESTATION côté create-guest-request) — reste sur
  -- 'autre' si aucune correspondance évidente, jamais une valeur inventée.
  v_type_prestation := case
    when v_booking.service_label ilike '%match%' then 'match'
    when v_booking.service_label ilike '%tournoi%' then 'tournoi'
    when v_booking.service_label ilike '%entraînement%' or v_booking.service_label ilike '%entrainement%' or v_booking.service_label ilike '%stage%' then 'entraînement'
    when v_booking.service_label ilike '%portrait%' or v_booking.service_label ilike '%shooting%' then 'portrait'
    when v_booking.service_label ilike '%événement%' or v_booking.service_label ilike '%evenement%' then 'événement'
    else 'autre'
  end;

  -- club_bookings.heure est un text libre (pas garanti au format HH:MM) —
  -- conversion best-effort, jamais bloquante : une valeur non parsable laisse
  -- heure_debut à NULL plutôt que de faire échouer tout l'envoi en Production.
  begin
    v_heure := v_booking.heure::time;
  exception when others then
    v_heure := null;
  end;

  insert into prestations (
    client_id, date_prestation, heure_debut, lieu, adresse_complete, equipes,
    type_prestation, statut, source, notes_internes
  ) values (
    v_club_client_id, v_booking.event_date, v_heure, v_booking.adresse, v_booking.adresse, v_booking.team,
    v_type_prestation, 'confirmée', 'clubplus',
    'Générée automatiquement depuis une réservation Club+ (' || v_booking.service_label || ', réservation ' || v_booking.id || ').'
      || case when v_booking.objectif is not null then E'\nObjectif : ' || v_booking.objectif else '' end
  )
  returning id into v_prestation_id;

  update club_bookings set prestation_id = v_prestation_id where id = p_booking_id;

  return v_prestation_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cm_client_logo_maj(p_client_id uuid, p_logo_url text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  -- PAS is_staff() : le role `cm` en fait encore partie (dette P1), donc n'IMPORTE quel CM aurait
  -- pu changer le logo de n'importe quel client. Constate en le testant, 09/09/2026. On nomme
  -- explicitement les roles qui ont autorite sur la fiche client.
  if not (
    contenus_visible_par_cm(p_client_id, auth.uid())
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','sec'))
  ) then
    raise exception 'Ce client ne vous est pas confié.' using errcode = '42501';
  end if;
  update clients set logo_url = nullif(btrim(coalesce(p_logo_url,'')), '') where id = p_client_id;
  return found;
end $function$;

CREATE OR REPLACE FUNCTION public.couverture_operateurs(p_ref text)
 RETURNS TABLE(prenom text, nom text, fonction text, responsable boolean, reponse text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_genre text;
  v_club uuid;
  v_prestation uuid;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  -- ── Le rôle, avant tout le reste ──
  -- `is_staff()` inclut encore le rôle `cm` (dette connue) : on nomme donc explicitement les rôles
  -- autorisés plutôt que de s'y fier, comme on l'a fait pour cm_client_logo_maj.
  if not exists (
    select 1 from profiles p
     where p.id = auth.uid() and p.role in ('admin','com','sec','cm','prod')
  ) then
    -- Pas une erreur : un président de club appellera peut-être cette fonction par le même écran.
    -- On ne lui dit pas « interdit », on ne lui dit rien — l'interface affichera l'état générique.
    return;
  end if;

  v_genre := split_part(p_ref, ':', 1);

  if v_genre = 'match' then
    select m.club_id into v_club from club_matches m
     where m.id = nullif(split_part(p_ref, ':', 2), '')::uuid;
  elsif v_genre = 'entrainement' then
    select t.club_id into v_club
      from club_team_training_slots s join club_teams t on t.id = s.team_id
     where s.id = nullif(split_part(p_ref, ':', 2), '')::uuid;
  elsif v_genre = 'evenement' then
    select e.club_id into v_club from club_calendar_events e
     where e.id = nullif(split_part(p_ref, ':', 2), '')::uuid;
  else
    return;
  end if;

  if v_club is null then return; end if;

  -- Un CM ne voit que les clubs qui lui sont confiés, ici comme partout ailleurs.
  if not (v_club in (select cm_clubs_autorises()) or exists (
    select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','com','sec','prod')
  )) then
    return;
  end if;

  -- La présence porte la prestation créée quand la mission a été montée. Tant qu'elle est nulle,
  -- la couverture est décidée mais personne n'est encore affecté : l'appel ne renvoie aucune
  -- ligne, et l'écran dit « opérateur en cours d'affectation ».
  select pp.created_prestation_id into v_prestation
    from planned_presences pp
   where (pp.occurrence_ref = p_ref
          or (v_genre = 'match' and pp.match_id = nullif(split_part(p_ref, ':', 2), '')::uuid))
     and coalesce(pp.statut, 'prevu') <> 'annule'
   limit 1;

  if v_prestation is null then return; end if;

  return query
    -- `pe.statut` est un enum (statut_affectation), pas du texte : sans ce cast, la fonction
    -- echouait des qu'elle avait une ligne a rendre — invisible tant que les essais renvoyaient
    -- zero ligne, trouve en montant un vrai jeu de donnees.
    select pr.prenom, pr.nom, pe.fonction, coalesce(pe.est_responsable, false), pe.statut::text
      from prestations_equipe pe
      join profiles pr on pr.id = pe.collaborateur_id
     where pe.prestation_id = v_prestation
       -- Un refus, un remplacement ou une annulation ne sont PAS des affectations : les afficher
       -- ferait croire que quelqu'un vient. Les valeurs sont celles de l'enum statut_affectation
       -- (invitation_envoyée, en_attente, acceptée, refusée, remplacée, annulée) — je les avais
       -- d'abord écrites au jugé (« refuse »), et le test a montré qu'un refus passait.
       and coalesce(pe.statut::text, 'en_attente') not in ('refusée', 'remplacée', 'annulée')
     order by coalesce(pe.est_responsable, false) desc, pr.prenom;
end
$function$;

CREATE OR REPLACE FUNCTION public.credit_organization(p_organization_id uuid, p_amount integer, p_label text DEFAULT NULL::text)
 RETURNS organizations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row organizations;
  v_is_staff boolean;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.fin_generer_depenses_recurrentes()
 RETURNS TABLE(nouvelle_depense_id uuid, source_id uuid, periode date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_periode date;
  v_new_id uuid;
  v_iter int;
  v_next date;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta')) then
    raise exception 'Accès refusé : réservé à l''administration/comptabilité.';
  end if;

  for r in
    select * from expenses
    where recurrence in ('mensuelle','trimestrielle','annuelle')
      and date_prochaine_echeance is not null
      and date_prochaine_echeance <= current_date
  loop
    v_iter := 0;
    v_next := r.date_prochaine_echeance;
    while v_next <= current_date and v_iter < 36 loop
      v_periode := v_next;
      v_new_id := null;

      insert into expenses(
        vendor_id, prestation_id, categorie, libelle, montant_ht, tva_pct, montant_ttc,
        recurrence, date_depense, date_prochaine_echeance, statut, justificatif_url,
        created_by, source_expense_id, periode_recurrence
      ) values (
        r.vendor_id, r.prestation_id, r.categorie, r.libelle, r.montant_ht, r.tva_pct, r.montant_ttc,
        'ponctuelle', v_periode, null, 'prevue', null,
        r.created_by, r.id, v_periode
      )
      on conflict (source_expense_id, periode_recurrence) where source_expense_id is not null do nothing
      returning id into v_new_id;

      if v_new_id is not null then
        nouvelle_depense_id := v_new_id;
        source_id := r.id;
        periode := v_periode;
        return next;
      end if;

      v_next := case r.recurrence
        when 'mensuelle' then v_next + interval '1 month'
        when 'trimestrielle' then v_next + interval '3 months'
        when 'annuelle' then v_next + interval '1 year'
      end::date;
      v_iter := v_iter + 1;
    end loop;

    update expenses set date_prochaine_echeance = v_next where id = r.id and date_prochaine_echeance is distinct from v_next;
  end loop;
  return;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fin_ignorer_transaction(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta')) then
    raise exception 'Accès refusé : réservé à l''administration/comptabilité.';
  end if;

  update bank_transactions set status='ignoree', reconciled_at=now(), reconciled_by=auth.uid()
    where id = p_transaction_id and status = 'a_traiter';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'introuvable_ou_deja_traitee');
  end if;
  return jsonb_build_object('ok', true, 'transaction_id', p_transaction_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fin_rapprocher_transaction(p_transaction_id uuid, p_facture_id uuid DEFAULT NULL::uuid, p_expense_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tx bank_transactions;
  v_facture factures;
  v_new_montant_paye numeric;
  v_new_statut text;
  v_paiement_id uuid;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta')) then
    raise exception 'Accès refusé : réservé à l''administration/comptabilité.';
  end if;

  if p_facture_id is null and p_expense_id is null then
    raise exception 'Aucune cible de rapprochement fournie (facture ou dépense).';
  end if;
  if p_facture_id is not null and p_expense_id is not null then
    raise exception 'Une seule cible à la fois (facture OU dépense).';
  end if;

  select * into v_tx from bank_transactions where id = p_transaction_id for update;
  if not found then raise exception 'Transaction introuvable'; end if;

  if v_tx.status = 'rapprochee' then
    return jsonb_build_object('already_reconciled', true, 'transaction_id', v_tx.id);
  end if;

  if p_facture_id is not null then
    select * into v_facture from factures where id = p_facture_id for update;
    if not found then raise exception 'Facture introuvable'; end if;

    v_new_montant_paye := coalesce(v_facture.montant_paye,0) + v_tx.amount;
    v_new_statut := case when v_new_montant_paye >= v_facture.montant_ttc then 'payee' else 'partiellement_payee' end;

    insert into paiements(facture_id, client_id, prestation_id, devis_id, type_paiement, montant, devise, statut, stripe_payment_intent_id, recu_url)
    values (v_facture.id, v_facture.client_id, v_facture.prestation_id, v_facture.devis_id, 'totalite', v_tx.amount, v_tx.currency, 'reussi', 'bank_reconciliation:'||v_tx.id::text, null)
    returning id into v_paiement_id;

    update factures set montant_paye = v_new_montant_paye, statut = v_new_statut where id = p_facture_id;

    update bank_transactions set status='rapprochee', matched_facture_id=p_facture_id, matched_paiement_id=v_paiement_id,
      match_method='manuel', reconciled_at=now(), reconciled_by=auth.uid() where id=p_transaction_id;

    insert into financial_audit_log(acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
    values (auth.uid(), 'rapprochement_bancaire', 'factures', p_facture_id, coalesce(v_facture.montant_paye,0), v_new_montant_paye,
      jsonb_build_object('bank_transaction_id', p_transaction_id, 'paiement_id', v_paiement_id, 'montant', v_tx.amount));

    return jsonb_build_object('ok', true, 'transaction_id', p_transaction_id, 'facture_id', p_facture_id, 'paiement_id', v_paiement_id, 'nouveau_statut', v_new_statut);
  else
    update expenses set statut = 'payee' where id = p_expense_id;
    if not found then raise exception 'Dépense introuvable'; end if;

    update bank_transactions set status='rapprochee', matched_expense_id=p_expense_id,
      match_method='manuel', reconciled_at=now(), reconciled_by=auth.uid() where id=p_transaction_id;

    insert into financial_audit_log(acteur_id, action, table_cible, ligne_id, details)
    values (auth.uid(), 'rapprochement_bancaire', 'expenses', p_expense_id,
      jsonb_build_object('bank_transaction_id', p_transaction_id, 'montant', v_tx.amount));

    return jsonb_build_object('ok', true, 'transaction_id', p_transaction_id, 'expense_id', p_expense_id);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fin_suggerer_rapprochements(p_transaction_id uuid)
 RETURNS TABLE(cible_type text, cible_id uuid, libelle text, montant numeric, score numeric, raison text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tx bank_transactions;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = auth.uid() and role in ('admin','compta','expert_comptable','auditeur')) then
    raise exception 'Accès refusé : réservé à l''administration/comptabilité.';
  end if;

  select * into v_tx from bank_transactions where id = p_transaction_id;
  if not found then raise exception 'Transaction introuvable'; end if;

  if v_tx.amount >= 0 then
    return query
    select
      'facture'::text,
      f.id,
      coalesce(f.numero,'Facture')||' — '||coalesce(c.nom,'Client inconnu'),
      (f.montant_ttc - coalesce(f.montant_paye,0)),
      (
        (case when abs((f.montant_ttc - coalesce(f.montant_paye,0)) - v_tx.amount) < 0.01 then 50
              when abs((f.montant_ttc - coalesce(f.montant_paye,0)) - v_tx.amount) <= greatest(v_tx.amount*0.02, 1) then 30
              else 0 end)
        + (case when f.numero is not null and v_tx.description ilike '%'||f.numero||'%' then 30 else 0 end)
        + (case when c.nom is not null and (v_tx.description ilike '%'||c.nom||'%' or v_tx.counterparty ilike '%'||c.nom||'%') then 20 else 0 end)
        + (case when abs(f.date_echeance - v_tx.booking_date) <= 3 then 10
                when abs(f.date_echeance - v_tx.booking_date) <= 15 then 5
                else 0 end)
      )::numeric as score,
      trim(
        (case when abs((f.montant_ttc - coalesce(f.montant_paye,0)) - v_tx.amount) < 0.01 then 'montant exact ' else '' end) ||
        (case when f.numero is not null and v_tx.description ilike '%'||f.numero||'%' then 'référence trouvée ' else '' end) ||
        (case when c.nom is not null and (v_tx.description ilike '%'||c.nom||'%' or v_tx.counterparty ilike '%'||c.nom||'%') then 'client trouvé ' else '' end)
      )
    from factures f
    left join clients c on c.id = f.client_id
    where f.statut in ('emise','partiellement_payee','en_retard')
      and (f.montant_ttc - coalesce(f.montant_paye,0)) > 0
      and f.date_emission >= v_tx.booking_date - interval '90 days'
    order by 5 desc
    limit 5;
  else
    return query
    select
      'depense'::text,
      e.id,
      coalesce(e.libelle,'Dépense')||' — '||coalesce(v.nom,'Fournisseur inconnu'),
      e.montant_ttc,
      (
        (case when abs(e.montant_ttc - abs(v_tx.amount)) < 0.01 then 50
              when abs(e.montant_ttc - abs(v_tx.amount)) <= greatest(abs(v_tx.amount)*0.02, 1) then 30
              else 0 end)
        + (case when v.nom is not null and (v_tx.description ilike '%'||v.nom||'%' or v_tx.counterparty ilike '%'||v.nom||'%') then 30 else 0 end)
        + (case when abs(coalesce(e.date_prochaine_echeance, e.date_depense) - v_tx.booking_date) <= 3 then 10
                when abs(coalesce(e.date_prochaine_echeance, e.date_depense) - v_tx.booking_date) <= 15 then 5
                else 0 end)
      )::numeric as score,
      trim(
        (case when abs(e.montant_ttc - abs(v_tx.amount)) < 0.01 then 'montant exact ' else '' end) ||
        (case when v.nom is not null and (v_tx.description ilike '%'||v.nom||'%' or v_tx.counterparty ilike '%'||v.nom||'%') then 'fournisseur trouvé ' else '' end)
      )
    from expenses e
    left join vendors v on v.id = e.vendor_id
    where e.statut in ('prevue','engagee')
      and e.date_depense >= v_tx.booking_date - interval '90 days'
    order by 5 desc
    limit 5;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.generate_missions_from_plan(p_plan_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan monthly_production_plans%rowtype;
  v_is_admin boolean;
  v_presence record;
  v_prestation_id uuid;
  v_created_count int := 0;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select * into v_plan from monthly_production_plans where id = p_plan_id;
  if not found then
    raise exception 'Plan de production introuvable.';
  end if;

  select exists(select 1 from profiles where id = auth.uid() and role = 'admin') into v_is_admin;

  if not (v_is_admin or auth.uid() = v_plan.cm_id) then
    raise exception 'Seul le CM créateur du plan (ou un administrateur) peut envoyer ce planning à la production.';
  end if;

  for v_presence in
    select * from planned_presences
    where plan_id = p_plan_id
      and statut = 'prevu'
      and created_prestation_id is null
  loop
    insert into prestations (
      client_id, date_prestation, heure_debut, lieu, equipes,
      type_prestation, statut, source, planned_presence_id, match_id, notes_internes
    ) values (
      v_plan.client_id, v_presence.date_presence, v_presence.heure_debut,
      v_presence.lieu, v_presence.equipe,
      'match', 'planifiée', 'planning_mensuel_cm', v_presence.id, v_presence.match_id,
      'Générée automatiquement depuis le planning mensuel CM ('
        || to_char(v_plan.mois, 'MM/YYYY') || ', plan ' || v_plan.id || ').'
    )
    returning id into v_prestation_id;

    update planned_presences
    set statut = 'mission_creee', created_prestation_id = v_prestation_id
    where id = v_presence.id;

    v_created_count := v_created_count + 1;
  end loop;

  if v_plan.statut <> 'envoyé' then
    update monthly_production_plans
    set statut = 'envoyé', envoye_at = now()
    where id = p_plan_id;
  end if;

  return v_created_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.modifier_remuneration_mission(p_equipe_id uuid, p_montant numeric, p_montant_recommande numeric DEFAULT NULL::numeric, p_motif text DEFAULT NULL::text, p_motif_detail text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pe prestations_equipe;
  v_ref text;
  v_nouvelle_proposition boolean := false;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select * into v_pe from prestations_equipe where id = p_equipe_id;
  if v_pe.id is null then raise exception 'Affectation introuvable.'; end if;
  if not (exists (select 1 from profiles where id = auth.uid() and role = 'admin')
          or (exists (select 1 from profiles where id = auth.uid() and role = 'prod')
              and prestation_pole_scope_ok(v_pe.prestation_id))
          or is_pole_responsable_of_prestation(v_pe.prestation_id)) then
    raise exception 'La rémunération d''une mission se fixe par la Production.' using errcode = '42501';
  end if;
  if p_montant is not null and p_montant < 0 then raise exception 'Montant invalide.'; end if;

  -- Baisser un montant accepté = nouvelle proposition : l'opérateur la reçoit et répond.
  v_nouvelle_proposition := v_pe.statut = 'acceptée' and coalesce(p_montant, 0) < coalesce(v_pe.remuneration, 0);

  update prestations_equipe
     set remuneration = p_montant,
         montant_recommande = coalesce(p_montant_recommande, montant_recommande),
         motif_ajustement = p_motif,
         override_reason = nullif(btrim(p_motif_detail), ''),
         statut = case when v_nouvelle_proposition then 'invitation_envoyée'::statut_affectation else statut end,
         date_reponse = case when v_nouvelle_proposition then null else date_reponse end
   where id = p_equipe_id;

  select reference into v_ref from prestations where id = v_pe.prestation_id;
  if v_pe.statut = 'acceptée' or v_nouvelle_proposition then
    insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                               source_type, source_id, lien_prestation_id, expediteur_id)
    values (v_pe.collaborateur_id,
            case when v_nouvelle_proposition then 'invitation' else 'remuneration_modifiee' end,
            case when v_nouvelle_proposition then 'Nouvelle proposition — ' || coalesce(v_ref, 'mission')
                 else 'Rémunération augmentée — ' || coalesce(v_ref, 'mission') end,
            case when v_nouvelle_proposition
                 then 'La Production te propose ' || p_montant || ' € (au lieu de ' || v_pe.remuneration || ' € acceptés). Accepte ou refuse depuis ton tableau de bord.'
                 else 'Ta rémunération pour cette mission passe de ' || coalesce(v_pe.remuneration, 0) || ' € à ' || p_montant || ' €.' end,
            v_pe.prestation_id, 'haute', 'prestation', v_pe.prestation_id, v_pe.prestation_id, auth.uid());
  end if;

  return jsonb_build_object('ok', true, 'nouvelle_proposition', v_nouvelle_proposition);
end;
$function$;

CREATE OR REPLACE FUNCTION public.notifier_grade_valide(p_collaborateur_id uuid, p_grade integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prenom text; v_email text; v_nom text; v_grade text; v_etoiles text; v_desc text;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  -- Définition reprise le 11/09 de la production (v137 : lien de l'e-mail vers l'OS).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  -- Seuls admin et RH valident un grade : la meme regle que l'ecran, mais appliquee ici, ou
  -- personne ne peut la contourner.
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin','rh')) then
    raise exception 'Seule la direction peut notifier une validation de grade.';
  end if;

  if p_grade is null then
    raise exception 'Aucun grade a notifier.';
  end if;

  select p.prenom, p.nom, p.email into v_prenom, v_nom, v_email
  from profiles p where p.id = p_collaborateur_id;

  if v_email is null or v_email = '' then
    -- Pas d'adresse : on le dit, plutot que de faire croire a un envoi.
    return false;
  end if;

  -- Les libelles vivent ici pour que l'e-mail dise la meme chose quel que soit l'appelant.
  select nom, etoiles, description into v_grade, v_etoiles, v_desc from (values
    (0,'Debutant','',            'Vous decouvrez SportVision et etes accompagne sur chaque prestation.'),
    (1,'Confirme','*',           'Vous connaissez les regles essentielles et participez aux prestations simples.'),
    (2,'Senior','**',            'Vous travaillez en autonomie et pouvez gerer une prestation simple en solo.'),
    (3,'Expert','***',           'Vous realisez des prestations complexes et pouvez etre responsable de prestation.'),
    (4,'Elite','****',           'Vous accompagnez les equipes, formez les nouveaux et participez aux validations.'),
    (5,'Maitre','*****',         'Vous representez les standards SportVision au plus haut niveau et encadrez plusieurs equipes.')
  ) as g(rang,nom,etoiles,description) where g.rang = p_grade;

  if v_grade is null then
    raise exception 'Grade % inconnu.', p_grade;
  end if;

  perform enqueue_notification(
    'equipe.grade_valide','equipe.grade_valide','EMAIL',
    -- Une seule felicitation par personne et par grade, meme si la validation est rejouee.
    'grade-'||p_collaborateur_id::text||'-'||p_grade::text,
    v_email, null, p_collaborateur_id, null,
    'profiles', p_collaborateur_id,
    jsonb_build_object(
      'prenom', coalesce(nullif(trim(v_prenom),''),'et bravo'),
      'grade', v_grade,
      'etoiles', repeat('⭐', p_grade),
      'description', v_desc,
      'lien', 'https://bc6m3cgdz.sportvision-an.fr/sportvision-os-full'
    )
  );
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.pole_valider_remuneration_responsable(p_calcul_id uuid, p_statut text DEFAULT NULL::text, p_ajustement_montant numeric DEFAULT NULL::numeric, p_ajustement_motif text DEFAULT NULL::text)
 RETURNS pole_remuneration_calculs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row pole_remuneration_calculs;
  v_statut_final text;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'seule la Direction (admin) peut valider une rémunération de responsable' using errcode = '42501';
  end if;
  if p_statut is not null and p_statut not in ('a_valider','valide','paye') then
    raise exception 'statut invalide: %', p_statut;
  end if;

  -- p_statut NULL = on ne change PAS le statut (utilisé par l'action "Ajuster le montant" seule,
  -- pour ne jamais faire régresser un calcul déjà validé/payé vers "à valider" par effet de bord).
  update pole_remuneration_calculs set
    statut = coalesce(p_statut, statut),
    ajustement_montant = coalesce(p_ajustement_montant, ajustement_montant),
    ajustement_motif = coalesce(p_ajustement_motif, ajustement_motif),
    valide_par = case when p_statut in ('valide','paye') then auth.uid() else valide_par end,
    valide_le = case when p_statut in ('valide','paye') and valide_le is null then now() else valide_le end,
    paye_le = case when p_statut = 'paye' then now() else paye_le end,
    updated_at = now()
  where id = p_calcul_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'calcul de rémunération introuvable: %', p_calcul_id;
  end if;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.provisionner_club_plus_full_com(p_client_id uuid, p_confirm_create boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_staff boolean;
  v_club_id uuid;
  v_client_nom text;
  v_client_siret text;
  v_contrat_id uuid;
  v_dup record;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
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

  select nom, siret into v_client_nom, v_client_siret from clients where id = p_client_id;
  if v_client_nom is null then
    raise exception 'Client introuvable.';
  end if;

  select * into v_dup from find_duplicate_club_candidates(v_client_siret, v_client_nom, p_client_id)
    order by (match_strength = 'forte') desc limit 1;

  if v_dup.club_id is not null and v_dup.match_strength = 'forte' then
    -- Correspondance forte : réutilise le club existant, ne crée jamais de doublon.
    update clubs set portail_client_id = p_client_id, club_plus_source = 'full_com_included'
      where id = v_dup.club_id;
    v_club_id := v_dup.club_id;
  elsif v_dup.club_id is not null and v_dup.match_strength = 'possible' and not p_confirm_create then
    raise exception 'club_duplicate_possible: % (club_id=%)', v_dup.club_nom, v_dup.club_id;
  else
    insert into clubs (nom, portail_client_id, plan, pilot_mode, credits_monthly, credits_balance, club_plus_source)
    values (v_client_nom, p_client_id, 'free', true, 0, 0, 'full_com_included')
    returning id into v_club_id;
    -- trg_sync_club_to_organization (AFTER INSERT ON clubs, déjà en place) crée
    -- automatiquement la ligne organizations correspondante à ce point, dans la
    -- même transaction, avant la suite de cette fonction.
  end if;

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
$function$;

CREATE OR REPLACE FUNCTION public.rentabilite_clubs_mois(p_mois date)
 RETURNS TABLE(club_id uuid, club_nom text, detail jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = auth.uid()
                  and role in ('admin', 'prod', 'compta', 'sec', 'expert_comptable', 'auditeur')) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select c.id, c.nom, rentabilite_club_mois(c.id, p_mois)
    from clubs c
   where c.portail_client_id is not null and peut_voir_couts_client(c.portail_client_id)
   order by c.nom;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_club_operational_summary(p_client_id uuid)
 RETURNS TABLE(club_id uuid, nom text, saison text, logo_url text, ecusson_url text, couleur_primaire text, couleur_secondaire text, offre_label text, statut_service text, club_plus_actif boolean, communication_active boolean, action_administrative_requise boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club clubs%rowtype;
  v_is_full_staff boolean;
  v_is_cm boolean;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select exists(select 1 from profiles where id = auth.uid() and role in ('admin','sec','compta'))
    into v_is_full_staff;
  select exists(select 1 from profiles where id = auth.uid() and role = 'cm')
    into v_is_cm;

  select * into v_club from clubs where portail_client_id = p_client_id limit 1;
  if v_club.id is null then
    return;
  end if;

  if not (
    v_is_full_staff
    or (v_is_cm and is_cm_authorized_for_club(v_club.id, v_club.portail_client_id))
    or is_club_member(v_club.id)
  ) then
    return;
  end if;

  return query select
    v_club.id,
    v_club.nom,
    v_club.saison,
    v_club.logo_url,
    v_club.ecusson_url,
    v_club.couleur_primaire,
    v_club.couleur_secondaire,
    case
      when v_club.club_plus_source = 'full_com_included' then 'Full Communication'
      when v_club.plan = 'performance' then 'Club+ Performance'
      when v_club.plan = 'club' then 'Club+ Classique'
      else 'Gratuit'
    end,
    case
      when v_club.subscription_status = 'actif' then 'actif'
      when v_club.subscription_status = 'impaye' then 'action_requise'
      when v_club.subscription_status = 'annule' then 'inactif'
      else 'actif'
    end,
    (v_club.plan is not null and v_club.plan <> 'free'),
    (
      v_club.club_plus_source = 'full_com_included'
      or exists(
        select 1 from contrats co
        where co.client_id = p_client_id and co.type_contrat = 'full_communication' and co.statut = 'actif'
      )
    ),
    coalesce(v_club.subscription_status = 'impaye', false),
    v_club.created_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_finance_consolidated_mensuel(p_mois_debut date DEFAULT NULL::date, p_mois_fin date DEFAULT NULL::date)
 RETURNS TABLE(mois date, ca_facture_ht numeric, encaisse numeric, a_encaisser numeric, rembourse numeric, charges numeric, cout_equipe numeric, resultat_estime_encaisse numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_debut date := coalesce(p_mois_debut, date_trunc('month', now() - interval '11 months')::date);
  v_fin date := coalesce(p_mois_fin, date_trunc('month', now())::date);
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  if auth.uid() is not null and not exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'sec', 'compta')
  ) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  return query
  with mois_serie as (
    select generate_series(v_debut, v_fin, interval '1 month')::date as mois
  ),
  fact as (
    select date_trunc('month', f.date_emission)::date as mois,
      sum(f.montant_ht) filter (where f.statut not in ('annulee', 'brouillon')) as ca_facture_ht,
      sum(f.montant_paye) as encaisse_factures,
      sum(f.montant_ht) filter (where f.statut = 'remboursee') as rembourse_factures
    from factures f
    group by 1
  ),
  media as (
    select date_trunc('month', mo.paid_at)::date as mois,
      sum(mo.amount_cents) filter (where mo.status = 'paid') / 100.0 as encaisse_media,
      sum(mo.amount_cents) filter (where mo.status = 'refunded') / 100.0 as rembourse_media
    from media_orders mo
    where mo.paid_at is not null
    group by 1
  ),
  cout as (
    select date_trunc('month', p.date_prestation)::date as mois,
      sum(pe.remuneration) as cout_equipe
    from prestations_equipe pe
    join prestations p on p.id = pe.prestation_id
    where pe.statut = 'acceptée'
    group by 1
  ),
  ch as (
    select date_trunc('month', e.date_depense)::date as mois,
      sum(e.montant_ht) filter (where e.statut in ('engagee', 'payee', 'comptabilisee')) as charges
    from expenses e
    group by 1
  )
  select
    m.mois,
    coalesce(fact.ca_facture_ht, 0),
    coalesce(fact.encaisse_factures, 0) + coalesce(media.encaisse_media, 0),
    coalesce(fact.ca_facture_ht, 0) - coalesce(fact.encaisse_factures, 0),
    coalesce(fact.rembourse_factures, 0) + coalesce(media.rembourse_media, 0),
    coalesce(ch.charges, 0),
    coalesce(cout.cout_equipe, 0),
    (coalesce(fact.encaisse_factures, 0) + coalesce(media.encaisse_media, 0)) - coalesce(ch.charges, 0) - coalesce(cout.cout_equipe, 0)
  from mois_serie m
  left join fact on fact.mois = m.mois
  left join media on media.mois = m.mois
  left join cout on cout.mois = m.mois
  left join ch on ch.mois = m.mois
  order by m.mois desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_get_custom_quiz(p_formation_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_authorized boolean;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  select
    exists (select 1 from profiles where id = v_uid and role in ('admin','prod'))
    or exists (select 1 from formation_inscriptions where formation_id = p_formation_id and collaborateur_id = v_uid)
  into v_authorized;

  if not v_authorized then
    raise exception 'Non autorisé : inscription requise pour accéder à ce quiz.';
  end if;

  return coalesce(
    (select jsonb_agg(jsonb_build_object('question', question, 'options', options) order by ordre)
     from formations_quiz_custom
     where formation_id = p_formation_id),
    '[]'::jsonb
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.staff_update_club_request_status(p_request_id uuid, p_status text)
 RETURNS club_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row club_requests;
  v_old_status text;
  v_credits integer;
  v_authorized boolean;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
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
      -- Le CM affilie a ce club, modele actuel. Sans cette ligne, « Prendre en charge » lui est
      -- refuse sur ses propres clubs.
      or c.id in (select cm_clubs_autorises())
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
end $function$;

CREATE OR REPLACE FUNCTION public.transformer_demande_en_contenu(p_request_id uuid, p_titre text DEFAULT NULL::text, p_date_prevue date DEFAULT NULL::date, p_plateforme text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_req club_requests;
  v_client uuid;
  v_cm uuid;
  v_id uuid;
  v_titre text;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select * into v_req from club_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'Demande introuvable.';
  end if;
  if not peut_operer_club(v_req.club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  if v_req.status = 'refusee' then
    raise exception 'Cette demande a été refusée : elle ne devient pas un contenu.';
  end if;

  select id into v_id from contenus
   where request_id = p_request_id and statut <> 'archive'
   order by created_at limit 1;
  if v_id is not null then
    return v_id;   -- déjà transformée : on rend le contenu existant, jamais un doublon
  end if;

  select c.portail_client_id, cl.cm_id into v_client, v_cm
    from clubs c left join clients cl on cl.id = c.portail_client_id
   where c.id = v_req.club_id;
  if v_client is null then
    raise exception 'Ce club n''est pas encore relié à sa fiche SportVision : aucun contenu ne peut lui être rattaché.';
  end if;
  -- Le contenu appartient à un CM (`cm_id` obligatoire) : celui qui transforme s'il est de
  -- l'équipe SportVision, sinon le CM référent du club.
  if exists (select 1 from profiles where id = auth.uid() and role in ('cm', 'com', 'admin')) then
    v_cm := auth.uid();
  end if;
  if v_cm is null then
    raise exception 'Aucun Community Manager n''est rattaché à ce club pour porter ce contenu.';
  end if;

  v_titre := coalesce(nullif(btrim(p_titre), ''),
                      initcap(replace(coalesce(v_req.type, 'Contenu'), '_', ' '))
                      || coalesce(' — ' || nullif(v_req.team, ''), ''));

  insert into contenus (client_id, cm_id, titre, description, statut, request_id, date_prevue, plateforme)
  values (v_client, v_cm, v_titre, v_req.detail, 'brouillon', p_request_id, p_date_prevue, nullif(btrim(p_plateforme), ''))
  returning id into v_id;

  update club_requests
     set status = case when status in ('recues', 'info_manquante') then 'en_traitement' else status end,
         taken_by = coalesce(taken_by, auth.uid()),
         updated_at = now()
   where id = p_request_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_club_request_status(p_request_id uuid, p_status text)
 RETURNS club_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row club_requests;
  v_old_status text;
  v_credits integer;
  v_is_staff boolean;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select * into v_row from club_requests where id = p_request_id for update;
  if v_row.id is null then
    raise exception 'Demande introuvable.';
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','cm','sec','prod')
  ) into v_is_staff;

  if v_is_staff then
    null;
  elsif is_club_member(v_row.club_id) then
    if p_status <> 'refusee' or v_row.status <> 'recues' then
      raise exception 'Vous ne pouvez annuler qu''une demande non encore prise en charge par SportVision.';
    end if;
  else
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
    perform set_config('app.trusted_credit_op', 'true', true);
    update clubs set
      credits_balance = greatest(0, credits_balance - v_credits),
      credits_reserved = greatest(0, credits_reserved - v_credits)
      where id = v_row.club_id;
    insert into club_credit_transactions (club_id, label, amount, created_by)
      values (v_row.club_id, coalesce(v_row.type,'Demande') || coalesce(' — ' || v_row.team, ''), -v_credits, auth.uid());
  elsif v_credits > 0 and p_status = 'refusee' and v_old_status <> 'refusee' then
    perform set_config('app.trusted_credit_op', 'true', true);
    update clubs set credits_reserved = greatest(0, credits_reserved - v_credits) where id = v_row.club_id;
  end if;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_request_status(p_request_id uuid, p_status text)
 RETURNS requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row requests;
  v_old_status text;
  v_credits integer;
  v_org_type text;
  v_is_staff boolean;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select * into v_row from requests where id = p_request_id for update;
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
$function$;

CREATE OR REPLACE FUNCTION public.validate_production(p_prestation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
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
$function$;

CREATE OR REPLACE FUNCTION public.rpc_ajouter_membre_equipe(p_prestation_id uuid, p_collaborateur_id uuid, p_fonction text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_heure_rdv time without time zone DEFAULT NULL::time without time zone, p_remuneration numeric DEFAULT NULL::numeric, p_niveau_snapshot smallint DEFAULT NULL::smallint, p_base_rate_snapshot numeric DEFAULT NULL::numeric, p_multiplier_snapshot numeric DEFAULT NULL::numeric, p_montant_recommande numeric DEFAULT NULL::numeric, p_motif_ajustement text DEFAULT NULL::text, p_motif_detail text DEFAULT NULL::text, p_envoyer boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role text; v_id uuid;
begin
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  -- Définition reprise le 10/09 à 22h de la production (v134-v136 lui ont ajouté p_envoyer).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin', 'prod', 'sec') then
    raise exception 'Non autorise.' using errcode = '42501';
  end if;
  if v_role <> 'admin' and not coalesce(prestation_pole_scope_ok(p_prestation_id), false) then
    raise exception 'Cette mission n''est pas dans votre pôle.' using errcode = '42501';
  end if;
  insert into prestations_equipe (prestation_id, collaborateur_id, fonction, notes, statut, heure_rdv, remuneration,
                                  niveau_snapshot, base_rate_snapshot, multiplier_snapshot,
                                  montant_recommande, motif_ajustement, override_reason)
  -- p_envoyer = false : l'opérateur est PRÉVU, pas encore invité. La proposition part quand la
  -- Production valide la mission (envoyer_propositions_mission, v136).
  values (p_prestation_id, p_collaborateur_id, nullif(p_fonction, ''), nullif(p_notes, ''),
          case when p_envoyer then 'invitation_envoyée' else 'a_envoyer' end::statut_affectation,
          p_heure_rdv, p_remuneration, p_niveau_snapshot, p_base_rate_snapshot, p_multiplier_snapshot,
          p_montant_recommande, p_motif_ajustement, nullif(btrim(p_motif_detail), ''))
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_retirer_membre_equipe(p_equipe_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_role text; v_collaborateur_id uuid; v_prestation_id uuid; begin if public.compte_os_desactive() then raise exception 'Compte désactivé.' using errcode = '42501'; end if; select role into v_role from profiles where id = auth.uid(); if v_role is null or v_role not in ('admin','prod','sec') then raise exception 'Non autorise.' using errcode = '42501'; end if; delete from prestations_equipe where id = p_equipe_id returning collaborateur_id, prestation_id into v_collaborateur_id, v_prestation_id; if v_collaborateur_id is null then raise exception 'Affectation introuvable.' using errcode = 'P0002'; end if; return jsonb_build_object('collaborateur_id', v_collaborateur_id, 'prestation_id', v_prestation_id); end; $function$;


-- ── 4. Vue secretariat_documents ─────────────────────────────────────────────────────────────
-- Sans security_invoker, elle contourne la RLS des tables qu'elle lit : la policy restrictive ne
-- l'atteint pas. Le rôle lu en ligne reçoit « actif » ; la branche « mes propres documents » est
-- fermée elle aussi à un compte désactivé.
create or replace view public.secretariat_documents as
 WITH base AS (
         SELECT 'rh'::text AS categorie,
            cd.id,
            cd.type AS sous_type,
            cd.collaborateur_id AS proprietaire_id,
            COALESCE(NULLIF(TRIM(BOTH FROM ((COALESCE(p.prenom, ''::text) || ' '::text) || COALESCE(p.nom, ''::text))), ''::text), 'Collaborateur'::text) AS proprietaire_label,
            NULL::uuid AS client_id,
            NULL::boolean AS est_club,
            cd.nom,
            cd.statut,
            cd.date_echeance,
            cd.storage_path,
            cd.created_at,
            cd.updated_at
           FROM (collaborateur_documents cd
             LEFT JOIN profiles p ON ((p.id = cd.collaborateur_id)))
          WHERE ((EXISTS ( SELECT 1
                   FROM profiles
                  WHERE ((profiles.id = auth.uid()) AND profiles.actif AND (profiles.role = ANY (ARRAY['admin'::text, 'compta'::text]))))) OR ((cd.collaborateur_id = auth.uid()) AND (NOT compte_os_desactive())))
        UNION ALL
         SELECT
                CASE
                    WHEN (cd.type = 'avenant'::text) THEN 'avenant'::text
                    WHEN (EXISTS ( SELECT 1
                       FROM clubs c2
                      WHERE (c2.portail_client_id = cd.client_id))) THEN 'club_plus'::text
                    ELSE 'client'::text
                END AS categorie,
            cd.id,
            cd.type AS sous_type,
            cd.client_id AS proprietaire_id,
            COALESCE(cl.nom, 'Client'::text) AS proprietaire_label,
            cd.client_id,
            (EXISTS ( SELECT 1
                   FROM clubs c3
                  WHERE (c3.portail_client_id = cd.client_id))) AS est_club,
            cd.nom,
            cd.statut,
            cd.date_echeance,
            cd.storage_path,
            cd.created_at,
            cd.updated_at
           FROM (client_documents cd
             JOIN clients cl ON ((cl.id = cd.client_id)))
          WHERE (EXISTS ( SELECT 1
                   FROM profiles
                  WHERE ((profiles.id = auth.uid()) AND profiles.actif AND (profiles.role = ANY (ARRAY['admin'::text, 'sec'::text, 'com'::text, 'compta'::text])))))
        UNION ALL
         SELECT 'contrat_full_com'::text AS categorie,
            c.id,
            c.type_contrat AS sous_type,
            c.client_id AS proprietaire_id,
            COALESCE(cl.nom, 'Client'::text) AS proprietaire_label,
            c.client_id,
            (EXISTS ( SELECT 1
                   FROM clubs c3
                  WHERE (c3.portail_client_id = c.client_id))) AS est_club,
            'Contrat Full Communication'::text AS nom,
                CASE
                    WHEN (c.signature_statut = 'signee'::text) THEN 'valide'::text
                    WHEN (c.signature_statut = 'demandee'::text) THEN 'a_valider'::text
                    ELSE 'manquant'::text
                END AS statut,
            c.date_fin AS date_echeance,
            NULL::text AS storage_path,
            c.created_at,
            c.updated_at
           FROM (contrats c
             JOIN clients cl ON ((cl.id = c.client_id)))
          WHERE ((c.type_contrat = 'full_communication'::text) AND (EXISTS ( SELECT 1
                   FROM profiles
                  WHERE ((profiles.id = auth.uid()) AND profiles.actif AND (profiles.role = ANY (ARRAY['admin'::text, 'sec'::text, 'com'::text, 'compta'::text]))))))
        UNION ALL
         SELECT 'recrutement_onboarding'::text AS categorie,
            ra.id,
            'cv'::text AS sous_type,
            ra.collaborateur_id AS proprietaire_id,
            COALESCE(NULLIF(TRIM(BOTH FROM ((COALESCE(ra.prenom, ''::text) || ' '::text) || COALESCE(ra.nom, ''::text))), ''::text), 'Candidat'::text) AS proprietaire_label,
            NULL::uuid AS client_id,
            NULL::boolean AS est_club,
            'CV de candidature'::text AS nom,
                CASE
                    WHEN (ra.cv_path IS NULL) THEN 'manquant'::text
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
            WHEN ((statut = 'valide'::text) AND (date_echeance IS NOT NULL) AND (date_echeance <= (CURRENT_DATE + 30))) THEN 'expire_bientot'::text
            ELSE statut
        END AS statut_affichage
   FROM base;

-- ── 5. Table profiles : les policies qui ACCORDENT un droit lisent actif ───────────────────
-- « Lecture profil personnel » reste ouverte (voir l'en-tête, point 5).
alter policy "Admin met à jour tous profils" on public.profiles
  using (exists (select 1 from profiles profiles_1
                  where profiles_1.id = auth.uid() and profiles_1.actif and profiles_1.role = 'admin'));
alter policy "Admin supprime un profil" on public.profiles
  using (exists (select 1 from profiles profiles_1
                  where profiles_1.id = auth.uid() and profiles_1.actif and profiles_1.role = 'admin'));
alter policy "Lead CM met à jour profils CM" on public.profiles
  using ((role = 'cm') and exists (select 1 from profiles p
                  where p.id = auth.uid() and p.actif and p.role = 'cm' and p.niveau_cm = 'cm_lead'));
-- Un compte désactivé ne modifie plus son propre profil. Le déclencheur
-- protect_sensitive_profile_fields l'empêchait déjà de toucher à rôle/actif/grade ; ceci ferme
-- le reste (nom, téléphone…) pendant l'heure où le jeton vit encore.
alter policy "Mise à jour profil personnel" on public.profiles
  using ((auth.uid() = id) and actif);


-- ── 6. Policy restrictive sur toutes les tables à RLS active (sauf profiles) + storage ──────
do $restrictive$
declare
  t record;
begin
  for t in
    select n.nspname as schema, c.relname as nom
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relrowsecurity
       and c.relname <> 'profiles'
    union all
    select 'storage', 'objects'
  loop
    execute format('drop policy if exists compte_os_desactive_bloque on %I.%I', t.schema, t.nom);
    execute format(
      'create policy compte_os_desactive_bloque on %I.%I as restrictive for all to authenticated '
      'using (not (select public.compte_os_desactive())) '
      'with check (not (select public.compte_os_desactive()))', t.schema, t.nom);
  end loop;
end $restrictive$;


-- ── 7. Contrôle final : la migration a fait ce qu'elle annonce ─────────────────────────────
do $controle$
declare
  n_tables int; n_pol int;
begin
  select count(*) into n_tables
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity and c.relname <> 'profiles';
  select count(*) into n_pol from pg_policies
   where policyname = 'compte_os_desactive_bloque' and permissive = 'RESTRICTIVE' and schemaname = 'public';
  if n_pol <> n_tables then
    raise exception 'policy restrictive posée sur % tables sur %', n_pol, n_tables;
  end if;
  if pg_get_functiondef('public.is_staff()'::regprocedure) !~ 'p\.actif' then
    raise exception 'is_staff() ne lit pas actif';
  end if;
end $controle$;

reset lock_timeout;
