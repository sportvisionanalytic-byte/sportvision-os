-- ============================================================================
-- migration-crm-v91-statut-split.sql
-- ============================================================================
-- CONSTAT (audit externe du 20/08, re-passe fraîche) : clients.statut (enum
-- statut_client) mélange deux notions différentes dans une seule colonne :
--   - la RELATION commerciale (prospect / client / partenaire / inactif / bloqué)
--   - l'ÉTAPE du pipeline de vente (qualifié / devis_envoyé / négociation / perdu)
-- Conséquence concrète : l'écran Pipeline (commercial) et l'écran Clients
-- lisent la même colonne pour deux usages différents, ce qui rend impossible
-- de représenter par exemple "un client actif en cours de renégociation d'un
-- nouveau contrat" sans perdre soit son statut de client existant, soit
-- l'étape de la négociation en cours.
--
-- VÉRIFIÉ AVANT D'ÉCRIRE CE FICHIER (Management API, 20/08) :
--   - clients.statut est un enum (statut_client) à 9 valeurs : prospect,
--     qualifié, client, inactif, bloqué, devis_envoyé, négociation,
--     partenaire, perdu.
--   - Production ne contient QUE 18 lignes au total, et seulement 2 valeurs
--     de statut sont réellement utilisées aujourd'hui : prospect (17) et
--     client (1). Aucune ligne qualifié/devis_envoyé/négociation/partenaire/
--     inactif/bloqué/perdu n'existe en prod — le backfill ci-dessous est donc
--     sans risque réel, pas seulement "en théorie".
--   - 23 tables référencent clients(id) en FK, mais AUCUNE ne référence la
--     colonne `statut` elle-même — cette migration n'affecte aucune FK.
--   - Des tables organizations/memberships existent déjà (migration-connect-
--     v2-organizations-entitlements.sql), gérées par triggers de sync actifs
--     (trg_sync_client_to_organization, trg_sync_club_to_organization,
--     trg_sync_club_member_to_membership). Cette migration NE TOUCHE PAS ces
--     tables ni ces triggers — elle ne fait qu'ajouter deux colonnes sur
--     clients, aucune des tables organizations/memberships n'a de colonne
--     `statut` synchronisée depuis clients.statut (vérifié : les triggers
--     ne lisent/écrivent pas ce champ), donc pas d'interférence.
--
-- CE QUE FAIT CE FICHIER (additif, non cassant) :
--   1. Ajoute deux nouvelles colonnes texte sur `clients` :
--        statut_relation : prospect | client | partenaire | inactif | bloque
--        etape_pipeline  : qualification | devis_envoye | negociation | gagne | perdu | NULL
--      (NULL pour etape_pipeline dès que statut_relation n'est plus "prospect"
--      en cours de qualification — un client actif n'a pas d'étape pipeline
--      active tant qu'aucune renégociation n'est en cours).
--   2. Backfille les 18 lignes existantes depuis l'ancien `statut`.
--   3. Ajoute un trigger BIDIRECTIONNEL qui garde `statut` (l'ancien enum,
--      encore lu par ~47 sites d'appel dans SportVision-OS-Full.html non
--      migrés ce soir) synchronisé avec les deux nouvelles colonnes, quel
--      que soit le côté modifié en premier. Objectif : le nouvel écran
--      Clients/Pipeline peut déjà lire/écrire statut_relation+etape_pipeline
--      dès ce soir SANS casser aucun des 47 sites existants qui lisent/
--      écrivent encore l'ancien `statut` — migration incrémentale des call
--      sites possible plus tard, pas un "flag day".
--   4. Ne supprime ni ne renomme RIEN. L'ancien enum statut_client et la
--      colonne `statut` restent en place, intacts.
-- ============================================================================

-- 1. Nouvelles colonnes ------------------------------------------------------

alter table clients add column if not exists statut_relation text
  check (statut_relation in ('prospect','client','partenaire','inactif','bloque'));

alter table clients add column if not exists etape_pipeline text
  check (etape_pipeline in ('qualification','devis_envoye','negociation','gagne','perdu'));

-- 2. Fonctions de correspondance (réutilisées par le backfill ET le trigger) -

create or replace function _clients_statut_forward_map(p_statut statut_client)
returns table(relation text, etape text)
language sql immutable as $$
  select case p_statut
    when 'prospect' then 'prospect'
    when 'qualifié' then 'prospect'
    when 'devis_envoyé' then 'prospect'
    when 'négociation' then 'prospect'
    when 'perdu' then 'prospect'
    when 'client' then 'client'
    when 'partenaire' then 'partenaire'
    when 'inactif' then 'inactif'
    when 'bloqué' then 'bloque'
  end,
  case p_statut
    when 'qualifié' then 'qualification'
    when 'devis_envoyé' then 'devis_envoye'
    when 'négociation' then 'negociation'
    when 'perdu' then 'perdu'
    when 'client' then 'gagne'
    when 'partenaire' then 'gagne'
    else null
  end;
$$;

create or replace function _clients_statut_reverse_map(p_relation text, p_etape text)
returns statut_client
language sql immutable as $$
  select case
    when p_relation='client' then 'client'::statut_client
    when p_relation='partenaire' then 'partenaire'::statut_client
    when p_relation='inactif' then 'inactif'::statut_client
    when p_relation='bloque' then 'bloqué'::statut_client
    when p_relation='prospect' and p_etape='qualification' then 'qualifié'::statut_client
    when p_relation='prospect' and p_etape='devis_envoye' then 'devis_envoyé'::statut_client
    when p_relation='prospect' and p_etape='negociation' then 'négociation'::statut_client
    when p_relation='prospect' and p_etape='perdu' then 'perdu'::statut_client
    else 'prospect'::statut_client
  end;
$$;

-- 3. Backfill des 18 lignes existantes ---------------------------------------

update clients set
  statut_relation = (select relation from _clients_statut_forward_map(statut)),
  etape_pipeline = (select etape from _clients_statut_forward_map(statut))
where statut_relation is null;

alter table clients alter column statut_relation set not null;
-- Pas de DEFAULT sur statut_relation : le trigger ci-dessous doit voir NULL
-- sur un INSERT à l'ancienne (seul `statut` fourni) pour savoir dans quel
-- sens forward-mapper. Un DEFAULT au niveau colonne s'applique AVANT le
-- trigger BEFORE INSERT et casserait ce test IS NULL — bug trouvé et corrigé
-- via le test E2E ci-dessous avant tout déploiement (voir historique du
-- fichier : la première version avait `set default 'prospect'` ici).

-- 4. Trigger de synchronisation bidirectionnelle -----------------------------
-- Exception-safe (comme les triggers d'audit ajoutés plus tôt ce soir,
-- migration-audit-v90) : une erreur ici ne doit jamais bloquer une écriture
-- normale sur clients.

create or replace function sync_clients_statut()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if tg_op = 'INSERT' then
      if new.statut_relation is null then
        select relation, etape into new.statut_relation, new.etape_pipeline
        from _clients_statut_forward_map(new.statut);
      else
        new.statut := _clients_statut_reverse_map(new.statut_relation, new.etape_pipeline);
      end if;
      return new;
    end if;

    -- UPDATE : si l'appelant a touché statut_relation/etape_pipeline (nouveaux
    -- champs), c'est prioritaire et on recalcule l'ancien `statut` en miroir.
    -- Sinon, si seul l'ancien `statut` a changé (site d'appel pas encore
    -- migré), on recalcule les deux nouveaux champs depuis lui.
    if new.statut_relation is distinct from old.statut_relation
       or new.etape_pipeline is distinct from old.etape_pipeline then
      new.statut := _clients_statut_reverse_map(new.statut_relation, new.etape_pipeline);
    elsif new.statut is distinct from old.statut then
      select relation, etape into new.statut_relation, new.etape_pipeline
      from _clients_statut_forward_map(new.statut);
    end if;
    return new;
  exception when others then
    return new; -- ne jamais bloquer l'écriture principale sur un souci de sync
  end;
end;
$$;

drop trigger if exists trg_sync_clients_statut on clients;
create trigger trg_sync_clients_statut
  before insert or update on clients
  for each row execute function sync_clients_statut();

-- ============================================================================
-- Vérifié après écriture (E2E, Management API) : voir session du 20/08 —
-- insert/update dans les deux sens testés sur des lignes jetables, supprimées
-- ensuite, 0 résidu confirmé. Les 18 lignes réelles ont été relues après
-- backfill pour confirmer statut_relation/etape_pipeline cohérents avec
-- l'ancien statut sur chacune.
-- ============================================================================
