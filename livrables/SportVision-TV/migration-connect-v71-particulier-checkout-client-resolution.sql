-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v71
-- Corrige un bug bloquant trouvé par QA fonctionnelle le 15/08 : AUCUN compte Espace particulier
-- ne peut payer quoi que ce soit. create-checkout-session ne sait résoudre le client payeur que
-- pour 2 profils (client_users = club/Espace Projet, player_profiles = Espace joueur) — un compte
-- Espace particulier (self/linked/managed, migration-connect-v51) n'a ni l'un ni l'autre dans le
-- cas général, et se prend un 403 "Compte client introuvable" avant même le calcul du montant.
-- Touche TOUT paiement particulier, pas seulement Montage Compilation.
--
-- ────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE NOUVELLE FONCTION PLUTÔT QUE RÉUTILISER connect_resolve_beneficiary_client_id
-- ────────────────────────────────────────────────────────────────────────
--
-- connect_resolve_beneficiary_client_id(kind, ref_id) (migration-connect-v51) résout un client_id
-- à PARTIR d'un bénéficiaire explicite (kind/refId) — c'est ce qu'utilise connect-player-
-- prestations À LA CRÉATION de la demande, quand le wizard connaît encore le sportif sélectionné.
-- Mais au moment du PAIEMENT (create-checkout-session), le frontend ne renvoie que prestation_id
-- (voir ReservationWizardParticulier.tsx et CommandeDetailView.tsx — le paiement peut arriver bien
-- après la création, depuis "Mes commandes", sans contexte de bénéficiaire). On a donc le
-- problème inverse : on connaît déjà prestation.client_id (résolu et figé à la création), il faut
-- juste vérifier que L'APPELANT ACTUEL a le droit de payer POUR ce client_id précis — d'où
-- connect_particulier_can_pay_client(p_client_id), qui parcourt les 3 mêmes chemins que
-- connect_resolve_beneficiary_client_id (self / managed / linked) mais dans l'autre sens.
--
-- Droit vérifié pour le cas "linked" : right_payer (pas right_reserver, utilisé lui à la création
-- de la demande) — cohérent avec le fait que ce sont deux actions distinctes dans le modèle de
-- droits de connect_access_relationships (migration-connect-v51 §access), un sportif peut
-- autoriser un proche à réserver sans forcément l'autoriser à payer.
--
-- NON EXÉCUTÉE — à relire puis exécuter par Fouka dans Supabase → SQL Editor. Idempotente
-- (create or replace function).
-- ============================================================

create or replace function connect_particulier_can_pay_client(p_client_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select
    -- "self" : le compte du payeur EST le client (particulier sans club, ou joueur/sportif sans
    -- club — mêmes deux tables que la résolution symétrique dans connect_resolve_beneficiary_
    -- client_id ci-dessus, cas p_kind='self').
    exists (
      select 1 from connect_profile_settings
      where user_id = auth.uid() and client_id = p_client_id
    )
    or exists (
      select 1 from player_profiles
      where user_id = auth.uid() and client_id = p_client_id
    )
    -- "managed" : sportif géré par l'appelant (managed_athlete_profiles.owner_user_id).
    or exists (
      select 1 from managed_athlete_profiles
      where owner_user_id = auth.uid() and client_id = p_client_id
    )
    -- "linked" : sportif affilié ayant accordé le droit right_payer à l'appelant (relation
    -- acceptée). Le sportif peut avoir son client_id sur player_profiles (affilié à un club) OU
    -- sur connect_profile_settings (sportif/particulier sans club) — les deux sont couverts.
    or exists (
      select 1
      from connect_access_relationships car
      join player_profiles pp on pp.user_id = car.owner_user_id
      where car.grantee_user_id = auth.uid()
        and car.status = 'acceptee'
        and car.right_payer
        and pp.client_id = p_client_id
    )
    or exists (
      select 1
      from connect_access_relationships car
      join connect_profile_settings cps on cps.user_id = car.owner_user_id
      where car.grantee_user_id = auth.uid()
        and car.status = 'acceptee'
        and car.right_payer
        and cps.client_id = p_client_id
    );
$$;

revoke all on function connect_particulier_can_pay_client(uuid) from public;
grant execute on function connect_particulier_can_pay_client(uuid) to authenticated;

-- ============================================================
-- FIN. Câblage edge function : create-checkout-session/index.ts appelle cette fonction (via
-- userClient, jamais admin — SECURITY DEFINER + auth.uid() interne) UNIQUEMENT si ni client_users
-- ni player_profiles n'ont résolu de client_id, et UNIQUEMENT après avoir déjà chargé la
-- prestation ciblée (p_client_id = prestation.client_id, jamais une valeur transmise par le
-- client). Redéploiement manuel requis après cette migration (voir en-tête du fichier).
-- ============================================================
