-- Migration : verrou serveur sur l'activation d'un contrat Full Communication
-- À exécuter dans Supabase → SQL Editor.
-- EXÉCUTÉE — appliquée en base réelle le 28/08/2026 (refonte interface Secrétaire,
-- audit de gap #1) : la Secrétaire avait aujourd'hui exactement les mêmes droits
-- qu'Admin sur `contrats` (policy `contrats_acces`, for all, admin/sec/com/compta
-- sans distinction) et `creerClient()` (SportVision-OS-Full.html:4058-4079) laisse
-- n'importe lequel de ces rôles cocher "déjà signé" pour créer directement un
-- contrat `type_contrat='full_communication'` avec `statut='actif'`, ce qui
-- déclenche immédiatement lancerCascadeFullCom() (provisioning Club+, octroi des
-- entitlements, email d'activation envoyé au club) — sans aucune validation
-- Admin/Direction, alors que c'est explicitement exigé par la spec de refonte
-- Secrétaire (§16 "Création/préparation d'un Full Com" : la secrétaire prépare en
-- BROUILLON, seule la Direction valide l'activation).
--
-- Masquer le bouton côté UI ne suffit pas (cf. spec §33 "Données sensibles et RLS :
-- masquer un bouton ne suffit pas, les permissions doivent être imposées côté
-- base/backend"). Cette migration ajoute donc un verrou trigger, indépendant de
-- toute modification frontend à venir : quel que soit l'appelant (formulaire de
-- création, édition de contrat, appel API direct), un contrat
-- `type_contrat='full_communication'` ne peut passer/être créé à `statut='actif'`
-- que si l'utilisateur authentifié a `profiles.role='admin'`. Pour tout autre rôle
-- (dont 'sec'), la tentative est bloquée avec un message explicite plutôt que
-- silencieusement rétrogradée, pour que l'UI puisse afficher une erreur claire.
--
-- Exemption `auth.uid() is null` : mêmes raisons que dans
-- validate_prestation_statut_transition() (migration-prestations-refus-reattribution.sql)
-- — les appels service_role (edge functions, scripts d'administration serveur) ne
-- passent pas par un utilisateur authentifié Supabase et doivent rester possibles.
--
-- Propriété : idempotente (ré-exécutable sans erreur), n'écrit sur aucune ligne
-- existante (pas d'UPDATE de rattrapage — seuls les futurs INSERT/UPDATE sont
-- concernés).

create or replace function enforce_fullcom_activation_by_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_was_active boolean;
begin
  -- Ne concerne que les contrats Full Communication demandant le statut 'actif'.
  if new.type_contrat is distinct from 'full_communication' or new.statut is distinct from 'actif' then
    return new;
  end if;

  -- Appels service_role (edge functions / scripts serveur) : pas d'auth.uid(), exemptés.
  if auth.uid() is null then
    return new;
  end if;

  v_was_active := (tg_op = 'UPDATE' and old.statut = 'actif');
  if v_was_active then
    -- Le contrat était déjà actif (ex: mise à jour d'un autre champ) : pas une
    -- nouvelle activation, rien à bloquer.
    return new;
  end if;

  select role into v_caller_role from profiles where id = auth.uid();

  if v_caller_role is distinct from 'admin' then
    raise exception
      'Seul un administrateur peut activer un contrat Full Communication. Créez-le/laissez-le en brouillon, un administrateur validera l''activation.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_fullcom_activation_by_admin on contrats;
create trigger trg_enforce_fullcom_activation_by_admin
  before insert or update on contrats
  for each row execute procedure enforce_fullcom_activation_by_admin();

-- Vérification (à exécuter manuellement après migration) :
-- select count(*) from contrats where type_contrat='full_communication' and statut='actif';
-- (doit être inchangé par cette migration : aucune ligne existante n'est modifiée)
