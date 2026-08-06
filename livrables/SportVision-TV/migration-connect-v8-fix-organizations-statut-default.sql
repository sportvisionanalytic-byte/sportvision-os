-- ============================================================
-- SPORTVISION CONNECT — v8 : corrige le défaut invalide de organizations.statut
--
-- Bug trouvé le 2026-08-06 en testant en réel le nouveau parcours d'achat
-- de la vitrine (v7) : la colonne organizations.statut, définie en v2, a
-- pour valeur par défaut 'actif' —
--
--   statut text not null default 'actif' check (statut in (
--     'actif_premium','actif_standard','limite_fin_contrat',
--     'suspendu_impaye','archive','desactive'
--   ))
--
-- — mais 'actif' ne fait PAS partie des valeurs autorisées par sa propre
-- contrainte CHECK. Toute insertion dans organizations qui laisse le
-- défaut jouer (donc TOUTE création d'un nouveau club ou d'un nouveau
-- client, via sync_club_to_organization / sync_client_to_organization
-- de la v5) échoue avec :
--   "new row for relation organizations violates check constraint
--    organizations_statut_check"
--
-- Ce bug est indépendant de la v7 (qui n'insère jamais dans organizations
-- elle-même) — il préexistait dès l'activation des triggers de la v5,
-- silencieusement, tant que personne n'avait déclenché la création d'un
-- club ou d'un client réellement nouveau depuis.
--
-- Correctif en deux temps : le défaut de la colonne (pour toute insertion
-- future qui s'appuierait dessus) ET les deux fonctions trigger, rendues
-- explicites plutôt que dépendantes du défaut.
-- ============================================================

alter table organizations
  alter column statut set default 'actif_standard';

-- Rattrape les lignes déjà en base qui auraient été insérées avec l'ancien
-- défaut invalide avant l'activation de la contrainte (peu probable vu
-- l'échec systématique, mais sans risque si aucune ligne n'est concernée).
update organizations set statut = 'actif_standard' where statut = 'actif';

create or replace function sync_club_to_organization()
returns trigger language plpgsql security definer as $$
begin
  insert into organizations (id, organization_type, nom, ville, legacy_club_id, legacy_client_id, statut)
  values (new.id, 'club', new.nom, new.ville, new.id, new.portail_client_id, 'actif_standard')
  on conflict (id) do update set
    nom = excluded.nom,
    ville = excluded.ville,
    legacy_client_id = excluded.legacy_client_id,
    updated_at = now();
  return new;
end;
$$;

create or replace function sync_client_to_organization()
returns trigger language plpgsql security definer as $$
begin
  if exists (select 1 from clubs c where c.portail_client_id = new.id) then
    return new;
  end if;
  insert into organizations (id, organization_type, nom, ville, legacy_client_id, legacy_type_client, statut)
  values (new.id, 'projet', new.nom, new.ville, new.id, new.type_client, 'actif_standard')
  on conflict (id) do update set
    nom = excluded.nom,
    ville = excluded.ville,
    updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- NOTE — vérification recommandée après exécution
--
-- select conname, pg_get_constraintdef(oid) from pg_constraint
-- where conrelid = 'organizations'::regclass and conname = 'organizations_statut_check';
-- (doit toujours lister actif_premium/actif_standard/limite_fin_contrat/
-- suspendu_impaye/archive/desactive — cette migration ne touche pas la
-- contrainte elle-même, seulement le défaut et les triggers)
--
-- Test manuel : insérer un nouveau client (email jamais vu) via
-- create-guest-request doit maintenant réussir (HTTP 200, reference
-- renvoyée) au lieu d'échouer en 500.
-- ============================================================
