-- ============================================================
-- SPORTVISION CONNECT — Migration v32 : neutralise la RPC
-- `client_sign_contrat`, qui permet à un client Connect de marquer
-- LUI-MÊME un contrat comme signé (« signature simulée »), en contradiction
-- directe avec la décision déjà prise et appliquée côté OS le 10/08/2026.
--
-- ── Découverte (audit bout-en-bout Parties E+H, flux 5 — contrat +
--    signature électronique, nuit du 11/08) ─────────────────────────────
--
-- supabase/functions/youtrust-webhook/index.ts documente explicitement :
-- « un passage manuel hors Youtrust [...] a été retiré le 10/08/2026 »
-- côté OS — SportVision-OS-Full.html confirme (lignes ~9693-9709) que le
-- bouton "✓ Signé" a été supprimé de l'UI et que la fonction
-- `confirmerSignatureDoc` est neutralisée avec un message explicite :
-- "Confirmation manuelle désactivée. La signature est confirmée
-- automatiquement par Youtrust (webhook sécurisé)."
--
-- Or la RPC Postgres `client_sign_contrat(p_contrat_id, p_signataire_nom)`
-- (migration-portail-v8.sql, security definer) reste active et accordée à
-- `authenticated` :
--   revoke all on function client_sign_contrat(uuid, text) from public;
--   grant execute on function client_sign_contrat(uuid, text) to authenticated;
-- Elle pose directement `signature_statut = 'signee'` +
-- `signature_confirmee_at = now()` sur le contrat, sans AUCUNE vérification
-- Youtrust — le commentaire dans son propre corps l'appelle lui-même
-- "signature simulée" (INSERT dans document_events). C'est EXACTEMENT le
-- contournement que la suppression du bouton OS visait à éliminer, sauf
-- qu'il reste ouvert côté client.
--
-- Le front-end Connect app-next (src/lib/data/projet/billing.ts,
-- fonction `signContract`) définit bien un wrapper vers cette RPC, mais il
-- n'est appelé PAR AUCUN composant UI (vérifié : recherche exhaustive de
-- `signContract` dans app-next/src, un seul résultat = sa propre
-- définition) — donc aucun bouton ne l'expose aujourd'hui. Mais la RPC
-- reste directement appelable par n'importe quel `client_users` authentifié
-- via REST direct (POST /rest/v1/rpc/client_sign_contrat), sans passer par
-- l'UI — non testé en direct sur un contrat réel ce soir pour ne pas polluer
-- un contrat existant, mais le code de la fonction (relu ligne par ligne
-- ci-dessus) ne laisse aucune ambiguïté sur ce qu'elle fait.
--
-- Impact : un club/client de mauvaise foi (ou juste confus) pourrait faire
-- passer son propre contrat en "signé" côté SportVision (`contractStatus()`
-- côté Connect, billing.ts ligne 185-189, l'affiche alors "signe") sans
-- jamais avoir réellement signé sur Youtrust — aucune preuve légale de
-- consentement, alors que le statut affiché prétend le contraire. Joue
-- contre SportVision en cas de litige (aucune valeur probante), pas pour
-- le client.
--
-- ── Correctif ──────────────────────────────────────────────────────────
-- Neutralise la RPC (même pattern que confirmerSignatureDoc côté OS :
-- garder la fonction pour ne rien casser si un appelant existant y
-- pointe encore, mais lui faire lever une exception au lieu d'agir).
-- Alternative plus radicale (DROP FUNCTION) volontairement écartée ici :
-- DROP casserait bruyamment tout appelant existant avec une erreur
-- "function does not exist" plutôt qu'un message clair — moins sûr à
-- exécuter à l'aveugle la veille d'un lancement.
--
-- PRÉPARÉE, PAS EXÉCUTÉE — à relire et exécuter manuellement par Fouka.
-- ============================================================

create or replace function client_sign_contrat(p_contrat_id uuid, p_signataire_nom text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Confirmation manuelle désactivée. La signature d''un contrat est confirmée automatiquement par Youtrust (webhook sécurisé) dès que le client signe via le lien reçu par e-mail. Aucune confirmation manuelle n''est possible depuis Connect.';
end;
$$;

-- Le GRANT existant (authenticated) est laissé tel quel : la fonction
-- neutralisée est sans danger à exécuter (elle ne fait que lever une
-- exception), pas besoin de toucher aux privilèges.
