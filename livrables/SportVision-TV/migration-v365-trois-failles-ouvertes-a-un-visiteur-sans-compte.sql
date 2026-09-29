-- v365 — TROIS FAILLES EXPLOITABLES SANS AUCUN COMPTE (30/09/2026)
--
-- Trouvées par un audit de la base, et VÉRIFIÉES une par une avec la seule clé publique du site,
-- sans session. Les trois relèvent du même défaut, payé pour la troisième fois en deux jours : en
-- PostgreSQL, `create function` accorde EXECUTE à PUBLIC. Une fonction SECURITY DEFINER créée sans
-- `revoke` explicite est ouverte à `anon`, et sa seule protection est sa garde interne — quand elle
-- en a une.
--
-- ══ P0-1 · CONTOURNEMENT DE PAIEMENT ════════════════════════════════════════════════════════════
-- `media_activer_commande` passe une commande à « payée » et crée les droits médias. Elle n'est
-- appelée que par l'Edge Function `iap-valider`, qui tourne en service_role. Elle était ouverte à
-- `anon`, sans garde. Mesuré : réponse 200 `{"ok": true}` sans aucun compte.
-- Le scénario tient debout : j'ouvre un achat de Pass, j'abandonne le paiement, la commande reste
-- `pending` et son identifiant est dans mon navigateur ; j'appelle ce RPC, et j'ai le Pass. C'est la
-- même classe de faille que le contournement de paiement Club+ du 19/08.
--
-- ══ P0-2 · EFFACEMENT DES EMPREINTES D'UN ENFANT ════════════════════════════════════════════════
-- `purger_visages_du_joueur` : deux `delete`, zéro garde. Fonction interne, appelée seulement par
-- `effacer_biometrie_au_retrait` et par le retrait d'accord. Mesuré : exécutée sans compte.
-- Ses deux voisines du même chantier sont correctement révoquées ; celle-ci avait été oubliée.
--
-- ══ P0-3 · UN JOUEUR FANTÔME INSCRIT DANS UNE ÉQUIPE RÉELLE ═════════════════════════════════════
-- `request_team_membership_as_player` LIT `auth.uid()` mais ne l'EXIGE jamais : avec `auth.uid()`
-- nul, elle part dans la branche « première demande » et crée une fiche. Le mot `auth.uid()` était
-- présent dans le corps, ce n'était pas une garde — et un audit automatique qui cherche la chaîne
-- « auth.uid() » conclut à tort que la fonction est protégée. Mesuré par l'audit : inscription
-- anonyme acceptée, fiche créée, adhésion auto-validée, appartenance d'équipe ACTIVE, et douze
-- autorisations parentales fabriquées au passage.
--
-- ══ CE QUE CETTE MIGRATION FAIT, ET CE QU'ELLE NE FAIT PAS ══════════════════════════════════════
-- Elle ferme le droit d'appel. C'est ce qui arrête l'exploitation tout de suite, et ça ne casse
-- rien : chaque appelant légitime a été cherché AVANT, dans l'OS, dans Connect, dans Club+, dans
-- l'application mobile et dans les Edge Functions. C'est la leçon de la nuit dernière, où j'ai fermé
-- une fonction que l'OS appelait et vidé un écran (v351, réparée par v354).
--
--   purger_visages_du_joueur      aucun appelant applicatif        → service_role seul
--   media_activer_commande        1 Edge Function (service_role)   → service_role seul
--   creer_galeries_mission_auto   aucun (déclencheur seulement)    → service_role seul
--   cm_clubs_autorises_de         1 Edge Function (service_role)   → service_role seul
--   galerie_rattachements         l'OS, en authenticated           → `anon` retiré, authenticated gardé
--   request_team_membership_*     une famille connectée            → `anon` retiré, authenticated gardé
--
-- Les gardes internes manquantes viennent en v366 : une protection à deux couches vaut mieux, mais
-- refermer la porte passe d'abord.
--
-- `marquer_invitation_ouverte` N'EST PAS FERMÉE, ET C'EST VOULU. Elle est appelée quand une recrue
-- OUVRE son lien d'invitation, donc souvent avant qu'elle n'ait un compte. La fermer ferait échouer
-- ce marquage en silence. Son jeton fait 64 caractères hexadécimaux, et elle n'écrit qu'une date
-- d'ouverture : le gain ne vaut pas le risque de casser l'arrivée d'une recrue.

-- ── Réservées au moteur et aux Edge Functions ───────────────────────────────────────────────────
revoke all on function public.purger_visages_du_joueur(uuid) from public, anon, authenticated;
grant execute on function public.purger_visages_du_joueur(uuid) to service_role;

revoke all on function public.media_activer_commande(uuid) from public, anon, authenticated;
grant execute on function public.media_activer_commande(uuid) to service_role;

revoke all on function public.creer_galeries_mission_auto(uuid) from public, anon, authenticated;
grant execute on function public.creer_galeries_mission_auto(uuid) to service_role;

revoke all on function public.cm_clubs_autorises_de(uuid) from public, anon, authenticated;
grant execute on function public.cm_clubs_autorises_de(uuid) to service_role;

-- ── Ouvertes aux personnes CONNECTÉES, fermées aux anonymes ─────────────────────────────────────
--
-- `p_team_ids` est un uuid[] : l'identite de la fonction l'ecrit « uuid » au singulier dans
-- `pg_get_function_identity_arguments`, ce qui fait echouer un revoke recopie tel quel. Premier
-- essai refuse avec « function public.galerie_rattachements(uuid) does not exist ».
revoke all on function public.galerie_rattachements(uuid, integer, uuid[]) from public, anon;
grant execute on function public.galerie_rattachements(uuid, integer, uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';
