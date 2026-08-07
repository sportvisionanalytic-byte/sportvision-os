-- ============================================================
-- Fix : trg_protect_sensitive_formation_inscription_fields bloquait
-- TOUTE complétion de formation par un collaborateur rôle 'photo'.
--
-- Contexte : migration-connect-v1b-securite-hardening-backlog.sql
-- (item 12, 2026-08-06) a ajouté un trigger qui bloque toute
-- modification de formation_inscriptions.xp_gagnes par un
-- collaborateur non admin/prod, pour l'empêcher de s'auto-déclarer
-- un montant d'XP arbitraire.
--
-- Problème : la fonction bloquait le changement dès que
-- `new.xp_gagnes is distinct from old.xp_gagnes`, sans distinguer
-- la complétion légitime (xp_gagnes part de 0 par défaut, colonne
-- migration-formation-v1.sql) d'une falsification a posteriori.
-- Résultat : toggleFormLesson() envoie toujours xp_gagnes dans le
-- même PATCH que statut='terminee' — le trigger rejetait l'écriture
-- entière (statut + progression_pct inclus), donc AUCUN collaborateur
-- 'photo' ne pouvait plus jamais terminer une formation depuis le
-- 2026-08-06, quelle que soit la formation. Découvert le 2026-08-08 :
-- 10 inscriptions de 2 collaborateurs (Lynkone Montantin, Antoine Blin)
-- bloquées à 'en_cours' malgré 100% des leçons cochées ; corrigées
-- manuellement en base pour ces 10 lignes avant ce fix.
--
-- Correctif : ne bloquer que la RE-modification d'un xp_gagnes déjà
-- crédité (non nul). La transition initiale 0 → valeur, qui a lieu au
-- moment de la complétion normale en self-service, reste autorisée.
-- Risque résiduel inchangé par rapport à l'intention d'origine de
-- v1b : le montant fixé à la complétion initiale reste fourni par le
-- client JS, pas calculé côté serveur (même limite déjà documentée
-- pour xp_events dans migration-connect-v1-securite-hardening.sql,
-- item 5). Fermer complètement ce risque demande la RPC dédiée déjà
-- évoquée dans v1b — hors scope de ce fix, qui ne fait que restaurer
-- le fonctionnement normal du Centre de formation.
-- ============================================================

create or replace function protect_sensitive_formation_inscription_fields()
returns trigger language plpgsql security definer as $$
declare
  is_privileged boolean;
begin
  select exists(select 1 from profiles where id = auth.uid() and role in ('admin','prod')) into is_privileged;
  if is_privileged then
    return new;
  end if;
  if old.xp_gagnes is distinct from 0 and new.xp_gagnes is distinct from old.xp_gagnes then
    raise exception 'Modification non autorisée : les XP gagnés sont attribués par SportVision, pas déclarés par le collaborateur.';
  end if;
  return new;
end;
$$;

-- Le trigger existant réutilise cette fonction (create or replace
-- suffit, pas besoin de recréer le trigger lui-même).
