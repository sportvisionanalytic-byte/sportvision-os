-- ============================================================
-- SPORTVISION CONNECT — Migration v36 : corrige un bug introduit par
-- migration-connect-v35-fix-handle-user-invited-role.sql, qui casse
-- ENTIÈREMENT le flux d'invitation (pire que le problème que v35 corrigeait :
-- avant v35, une invitation créait un compte role='photo' au lieu du rôle
-- voulu ; avec v35 tel quel, une invitation échoue purement et simplement,
-- HTTP 500 "unexpected_failure").
--
-- ── Découverte (11/08/2026, en revérifiant v35 après exécution) ──────────
-- Reproduit en direct : POST /auth/v1/admin/generate_link {"type":"invite", ...}
-- renvoie systématiquement {"code":500,"error_code":"unexpected_failure"}
-- depuis l'exécution de v35. Isolé : POST /auth/v1/admin/users (création de
-- compte SANS invited_at) continue de fonctionner normalement — le problème
-- est bien spécifique à la transition invited_at (donc au nouveau trigger
-- on_auth_user_invited de v35).
--
-- Cause : handle_user_invited() (v35) fait un UPDATE sur public.profiles
-- pour poser le rôle — mais profiles a DÉJÀ un trigger BEFORE UPDATE,
-- protect_sensitive_profile_fields() (migration-audit-08-08-desactivation-
-- compte.sql), qui bloque toute modification de la colonne `role` dès que
-- l'appelant n'est pas identifié comme admin via auth.uid(). Or l'UPDATE de
-- v35 s'exécute dans le contexte interne de Supabase Auth (l'appel qui pose
-- invited_at sur auth.users), où auth.uid() est NULL — exactement le même
-- symptôme que la tentative service_role de vérification de ce soir, qui
-- avait déjà buté sur ce même trigger avec le même message d'erreur
-- ("Modification non autorisée : rôle, grade et statut du compte sont
-- réservés à l'administrateur."). Cette exception, levée à l'intérieur du
-- trigger AFTER UPDATE de v35, remonte et fait échouer toute la transaction
-- Supabase Auth — d'où le 500 côté API, pas juste un rôle mal posé.
--
-- ── Correctif ──────────────────────────────────────────────────────────
-- Neutralise les AUTRES triggers de `profiles` (dont protect_sensitive_
-- profile_fields) le temps de cette seule UPDATE ciblée, via
-- `session_replication_role`. Sans risque : le rôle appliqué reste filtré
-- par la même liste blanche des 7 valeurs déjà en place dans v35 (aucune
-- valeur arbitraire ne peut passer), cette fonction ne fait rien d'autre
-- que ce qu'elle faisait déjà.
--
-- Idempotente. PRÉPARÉE, PAS EXÉCUTÉE — à exécuter par Fouka en PRIORITÉ
-- ABSOLUE : tant que ce correctif n'est pas passé, AUCUNE invitation de
-- nouveau collaborateur ne peut aboutir (échec HTTP 500 systématique).
-- ============================================================

create or replace function handle_user_invited()
returns trigger language plpgsql security definer as $$
begin
  if old.invited_at is null and new.invited_at is not null then
    set local session_replication_role = replica;
    update public.profiles
    set
      role = case
        when new.raw_user_meta_data->>'role' in ('admin','sec','prod','photo','cm','compta','com')
          then new.raw_user_meta_data->>'role'
        else role
      end,
      prenom = coalesce(nullif(new.raw_user_meta_data->>'prenom', ''), prenom),
      nom = coalesce(nullif(new.raw_user_meta_data->>'nom', ''), nom)
    where id = new.id;
    set local session_replication_role = default;
  end if;
  return new;
end;
$$;

-- ─── Vérification recommandée après exécution ─────────────────────────
-- Rejouer exactement le test qui a révélé le bug :
--   POST /auth/v1/admin/generate_link {"type":"invite","email":"...",
--     "data":{"role":"sec","prenom":"Test","nom":"Test"}}
-- Doit renvoyer un lien valide (pas de 500), et profiles.role doit valoir
-- "sec" pour ce compte juste après. Nettoyer le compte de test ensuite.
