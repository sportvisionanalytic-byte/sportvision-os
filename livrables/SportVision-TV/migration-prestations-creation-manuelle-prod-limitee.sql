-- Migration : verrou serveur sur la création manuelle de prestations par Production
-- À exécuter dans Supabase → SQL Editor.
-- EXÉCUTÉE — appliquée en base réelle le 28/08/2026 (refonte interface Responsable
-- Production, audit de gap P0 #1) : `creerPrestation()`/`modalNouvellePrestation()`
-- (SportVision-OS-Full.html:3750-3845) est un formulaire générique partagé
-- admin/sec/prod, accessible depuis prod.pre et prod.planning, qui permet
-- aujourd'hui de créer une prestation pour N'IMPORTE QUEL client existant, sans
-- distinction. Or la spec de refonte Responsable Production (§5 "Sources des
-- missions" et §6 "Création manuelle de mission") est explicite : le Responsable
-- Production ne peut créer manuellement que des missions SportVision (pas de
-- client, contenu interne) ou des missions pour un club Full Communication
-- PARTENAIRE ACTIF — jamais une prestation payante pour un particulier, ni une
-- commande Club+ non validée commercialement, ni un devis déguisé.
--
-- Cette migration n'ajoute donc AUCUNE restriction pour admin/sec/com/compta
-- (qui doivent pouvoir créer une prestation pour n'importe quel client — c'est
-- leur rôle d'intake commercial), uniquement pour le rôle 'prod'.
--
-- Exemption `auth.uid() is null` : mêmes raisons que dans
-- validate_prestation_statut_transition() / enforce_fullcom_activation_by_admin()
-- — les appels service_role (edge functions, scripts serveur) restent possibles.
--
-- Propriété : idempotente, n'écrit sur aucune ligne existante (seuls les futurs
-- INSERT sont concernés — UPDATE volontairement non couvert : modifier une
-- prestation existante ne change pas son origine).

create or replace function enforce_prod_manual_prestation_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_client_has_active_fullcom boolean;
begin
  -- Appels service_role (edge functions / scripts serveur) : exemptés.
  if auth.uid() is null then
    return new;
  end if;

  select role into v_caller_role from profiles where id = auth.uid();

  -- Seul le rôle 'prod' est concerné par cette restriction.
  if v_caller_role is distinct from 'prod' then
    return new;
  end if;

  -- Cas autorisé 1 : mission interne SportVision, sans client (contenu/coulisses/
  -- formation/production interne — creerPrestation() envoie client_id=null dans
  -- ce cas, cf. body.client_id:clientId||null).
  if new.client_id is null then
    return new;
  end if;

  -- Cas autorisé 2 : client avec un contrat Full Communication actif (partenaire).
  select exists(
    select 1 from contrats
     where client_id = new.client_id
       and type_contrat = 'full_communication'
       and statut = 'actif'
  ) into v_client_has_active_fullcom;

  if v_client_has_active_fullcom then
    return new;
  end if;

  raise exception
    'Le Responsable Production ne peut créer manuellement qu''une mission interne SportVision (sans client) ou une mission pour un club Full Communication partenaire actif. Pour un client ponctuel ou Club+, la demande doit passer par le flux commercial (Secrétaire/Devis).'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_enforce_prod_manual_prestation_scope on prestations;
create trigger trg_enforce_prod_manual_prestation_scope
  before insert on prestations
  for each row execute procedure enforce_prod_manual_prestation_scope();

-- Vérification (à exécuter manuellement après migration) :
-- select count(*) from prestations; -- doit être inchangé par cette migration
