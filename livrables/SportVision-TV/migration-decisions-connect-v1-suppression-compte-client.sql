-- Supprimer le compte d'un client qui a des commandes : les commandes et factures restent, ses
-- données personnelles partent, le compte d'authentification part EN DERNIER.
-- Décision de Fouka, 10/09/2026.
--
-- ── Ce qui était cassé ──
-- delete-account (et admin-delete-portal-account, même code) supprimait le compte AVANT la fiche
-- client, puis tentait de supprimer la fiche. Deux défauts :
--   1. un client qui a une commande média ne pouvait pas être supprimé du tout :
--      media_orders.purchased_by_user_id et media_entitlements.purchased_by_user_id référencent
--      auth.users sans ON DELETE → « Database error deleting user », rien ne se passe ;
--   2. l'ordre était le mauvais : compte supprimé, puis fiche supprimée « si elle n'a aucun
--      historique » — test reposant sur les seules clés de prestations/devis. Or factures, avoirs
--      et paiements sont en ON DELETE SET NULL, et contrats en ON DELETE CASCADE : une fiche sans
--      prestation ni devis mais avec une facture perdait le lien de sa facture et ses contrats.
--      Et une fiche partagée avec un autre compte (autre membre du club) était supprimée aussi,
--      emportant par cascade l'accès de cet autre compte.
--
-- ── Ce que fait cette migration ──
--   • media_orders.acheteur_supprime_le : date à laquelle le compte de l'acheteur a été supprimé.
--     La contrainte « un acheteur OU une adresse invité » accepte désormais aussi une commande dont
--     l'acheteur a été supprimé : la commande est CONSERVÉE (obligation comptable, 10 ans), sans
--     plus pointer vers personne.
--   • media_entitlements.purchased_by_user_id devient facultatif : le droit d'accès du bénéficiaire
--     (l'enfant, le joueur) survit à la suppression du compte du payeur.
--   • supprimer_compte_client(p_user_id, p_anonymiser) : TOUT, dans une seule transaction — si une
--     étape échoue, rien n'a changé. Le compte d'authentification est supprimé en dernier.
--     Réservée au rôle service_role (edge functions) : jamais appelable depuis un navigateur.
--
-- ── À exécuter AVANT de déployer delete-account et admin-delete-portal-account ──
-- Les deux fonctions appellent supprimer_compte_client ; sans elle, elles répondent une erreur au
-- lieu de supprimer (aucune perte de données, mais plus aucune suppression possible).
--
-- Testée en transaction annulée (tests/suppression-compte-client.test.sql). Idempotente.

begin;

-- 1. Commandes média : l'acheteur peut disparaître, la commande reste ────────────────────────
alter table public.media_orders add column if not exists acheteur_supprime_le timestamptz;
comment on column public.media_orders.acheteur_supprime_le is
  'Date de suppression du compte de l''acheteur (supprimer_compte_client). La commande est conservée pour la comptabilité, détachée de toute personne.';

alter table public.media_orders drop constraint if exists media_orders_buyer_check;
alter table public.media_orders add constraint media_orders_buyer_check
  check (purchased_by_user_id is not null or guest_email is not null or acheteur_supprime_le is not null);

-- 2. Droits d'accès : le bénéficiaire garde son droit si le payeur supprime son compte ─────────
alter table public.media_entitlements alter column purchased_by_user_id drop not null;

-- 3. La suppression elle-même ────────────────────────────────────────────────────────────────
create or replace function public.supprimer_compte_client(p_user_id uuid, p_anonymiser boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fiche record;
  v_commandes int := 0;
  v_droits int := 0;
  v_supprimees int := 0;
  v_anonymisees int := 0;
  v_conservees int := 0;
  v_documents boolean;
begin
  if p_user_id is null then
    raise exception using errcode = 'P0001', message = 'Compte à supprimer non précisé.';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception using errcode = 'P0002', message = 'Compte introuvable.';
  end if;

  -- Hors périmètre « client ». Un compte de l'équipe SportVision se gère depuis l'OS ; un compte
  -- qui porte l'activité d'un club (souhaits de couverture, crédits) ne peut pas disparaître sans
  -- que le club perde sa trace. Refus lisible, plutôt que l'erreur de clé étrangère brute que
  -- renvoyait la suppression jusqu'ici.
  -- « Équipe SportVision » = mêmes critères que is_staff(), et pas la simple présence d'une ligne
  -- profiles : le déclencheur handle_new_user en crée une (rôle « photo » par défaut) pour TOUT
  -- compte créé par inviteUserByEmail, y compris un acheteur invité par
  -- create-guest-media-checkout. is_staff() écarte ces comptes par leurs attaches Connect ou club ;
  -- on fait de même, pour ne pas refuser la suppression à un client.
  if exists (
    select 1 from profiles p
    where p.id = p_user_id
      and p.role in ('admin','sec','prod','photo','cm','compta','com','rh')
      and not exists (select 1 from memberships m join organizations o on o.id = m.organization_id
                      where m.user_id = p.id and o.organization_type <> 'cm_agency')
      and not exists (select 1 from player_profiles pp where pp.user_id = p.id)
      and not exists (select 1 from connect_profile_settings cps where cps.user_id = p.id)
  ) then
    raise exception using errcode = 'P0001',
      message = 'Ce compte appartient à l''équipe SportVision : il se ferme depuis SportVision OS, pas depuis Connect.';
  end if;
  if exists (select 1 from coverage_wishes where requested_by_user_id = p_user_id)
     or exists (select 1 from club_credit_transactions where created_by = p_user_id) then
    raise exception using errcode = 'P0001',
      message = 'Ce compte porte l''activité d''un club (souhaits de couverture ou crédits) : sa suppression doit être faite par SportVision.';
  end if;

  -- Commandes média : conservées, détachées du compte. Si c'est la personne qui demande la
  -- suppression (p_anonymiser), ses coordonnées sur la commande partent aussi — sauf l'adresse
  -- d'une commande PAYÉE encore à expédier, sans laquelle on ne pourrait pas livrer ce qu'elle a
  -- payé.
  update media_orders set
    purchased_by_user_id = null,
    acheteur_supprime_le = now(),
    guest_email = case when p_anonymiser then null else guest_email end,
    guest_name  = case when p_anonymiser then null else guest_name end,
    shipping_name         = case when p_anonymiser and not (status = 'paid' and shipping_status = 'a_preparer') then null else shipping_name end,
    shipping_address_line = case when p_anonymiser and not (status = 'paid' and shipping_status = 'a_preparer') then null else shipping_address_line end,
    shipping_postal_code  = case when p_anonymiser and not (status = 'paid' and shipping_status = 'a_preparer') then null else shipping_postal_code end,
    shipping_city         = case when p_anonymiser and not (status = 'paid' and shipping_status = 'a_preparer') then null else shipping_city end
  where purchased_by_user_id = p_user_id;
  get diagnostics v_commandes = row_count;

  update media_entitlements set purchased_by_user_id = null where purchased_by_user_id = p_user_id;
  get diagnostics v_droits = row_count;

  -- Fiches client de ce compte : celle de l'Espace projet (client_users), de l'Espace particulier
  -- (connect_profile_settings), de la fiche joueur (player_profiles) et des profils gérés
  -- (managed_athlete_profiles, supprimés en cascade avec le compte : leur fiche, elle, restait).
  for v_fiche in
    select c.id, c.type_client
    from clients c
    where c.id in (
      select client_id from client_users where id = p_user_id
      union select client_id from connect_profile_settings where user_id = p_user_id
      union select client_id from player_profiles where user_id = p_user_id
      union select client_id from managed_athlete_profiles where owner_user_id = p_user_id
    )
  loop
    -- Fiche partagée (un autre compte, un profil géré par quelqu'un d'autre, un club) : elle n'est
    -- pas à ce seul compte, on n'y touche pas.
    if exists (select 1 from client_users where client_id = v_fiche.id and id <> p_user_id)
       or exists (select 1 from connect_profile_settings where client_id = v_fiche.id and user_id <> p_user_id)
       or exists (select 1 from player_profiles where client_id = v_fiche.id and user_id is distinct from p_user_id)
       or exists (select 1 from managed_athlete_profiles where client_id = v_fiche.id and owner_user_id <> p_user_id)
       or exists (select 1 from clubs where portail_client_id = v_fiche.id)
    then
      v_conservees := v_conservees + 1;
      continue;
    end if;

    -- Documents commerciaux et comptables : ils imposent de GARDER la fiche (10 ans). Vérifiés un à
    -- un, sans compter sur les clés étrangères — factures/avoirs/paiements y sont en SET NULL et
    -- contrats en CASCADE : les laisser faire, c'était perdre le lien ou le document.
    v_documents := exists (select 1 from prestations where client_id = v_fiche.id)
                or exists (select 1 from devis where client_id = v_fiche.id)
                or exists (select 1 from factures where client_id = v_fiche.id)
                or exists (select 1 from avoirs where client_id = v_fiche.id)
                or exists (select 1 from paiements where client_id = v_fiche.id)
                or exists (select 1 from contrats where client_id = v_fiche.id)
                or exists (select 1 from retractation_demandes where client_id = v_fiche.id);

    -- Anonymisation d'une fiche de PERSONNE (particulier) quand c'est elle qui demande la
    -- suppression. Faite AVANT une éventuelle suppression : le déclencheur
    -- sync_client_to_organization recopie le nom dans organizations, qui survit à la fiche.
    -- Les factures déjà émises (PDF, Pennylane) ne sont pas modifiées : elles restent telles
    -- qu'envoyées, c'est ce que la loi demande de conserver.
    if p_anonymiser and v_fiche.type_client = 'particulier' then
      update clients set
        nom = 'Client supprimé', prenom_contact = null, nom_contact = null, email = null, telephone = null,
        adresse = null, code_postal = null, ville = null, notes = null, siret = null, logo_url = null,
        prochaine_action = null, date_prochaine_action = null, photo_preset_notes = null, updated_at = now()
      where id = v_fiche.id;
      delete from client_contacts where client_id = v_fiche.id; -- notes de suivi sur la personne
    end if;

    if not v_documents then
      begin
        delete from clients where id = v_fiche.id;
        v_supprimees := v_supprimees + 1;
        continue;
      exception when foreign_key_violation then
        null; -- encore référencée (ex. messages) : on la garde, anonymisée si c'était demandé
      end;
    end if;

    if p_anonymiser and v_fiche.type_client = 'particulier' then
      v_anonymisees := v_anonymisees + 1;
    else
      v_conservees := v_conservees + 1;
    end if;
  end loop;

  -- En dernier : le compte d'authentification. Ses dépendances directes (profil Connect, rôles de
  -- club, préférences, profils gérés…) partent en cascade, les références d'historique passent à
  -- NULL — c'est le schéma qui le dit, table par table. Si cette suppression échoue, toute la
  -- transaction est annulée : la fiche et les commandes redeviennent ce qu'elles étaient.
  delete from auth.users where id = p_user_id;

  return jsonb_build_object(
    'deleted', true,
    'commandes_detachees', v_commandes,
    'droits_detaches', v_droits,
    'fiches_supprimees', v_supprimees,
    'fiches_anonymisees', v_anonymisees,
    'fiches_conservees', v_conservees,
    'client_deleted', v_supprimees > 0
  );
end;
$$;

comment on function public.supprimer_compte_client(uuid, boolean) is
  'Suppression d''un compte client (Connect, Espace projet). Commandes et factures conservées, données personnelles anonymisées si p_anonymiser, compte auth supprimé en dernier, tout ou rien. service_role uniquement. Décision du 10/09/2026.';

-- Jamais depuis un navigateur : révoquée de PUBLIC (et pas seulement d'anon — un droit accordé à
-- PUBLIC reste valable pour authenticated).
revoke all on function public.supprimer_compte_client(uuid, boolean) from public;
revoke all on function public.supprimer_compte_client(uuid, boolean) from anon, authenticated;
grant execute on function public.supprimer_compte_client(uuid, boolean) to service_role;

commit;
