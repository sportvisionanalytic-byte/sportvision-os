-- Migration : retire à un CM le droit de supprimer un message client dans
-- messages_client (audit nocturne 09/08 → 10/08, point 1 : "un CM peut
-- supprimer le message où le client demande une correction").
--
-- ─── Constat vérifié ───────────────────────────────────────────────────────
-- Il n'existe PAS de table dédiée aux corrections/retours client sur un
-- contenu (grep sur `corrections`/`commentaire_client`/`feedback` dans
-- migration-cm-*.sql et migration-contenus.sql : rien). Le retour du client
-- transite en réalité par `messages_client` (migration-portail-v1.sql),
-- table générique client↔staff créée à l'origine pour les échanges liés à
-- une prestation (colonne `prestation_id`).
--
-- Cette même table sert aussi, depuis migration-connect-validation-contenus.sql
-- (RPC `client_valider_contenu`, reprise inchangée sur ce point par
-- migration-clubplus-v34-club-messages-contenus-access.sql), à journaliser la
-- décision du client sur un contenu : quand il demande des corrections, une
-- ligne est insérée avec auteur_type='client' et
-- contenu = 'Corrections demandées sur « <titre> » : <commentaire>'.
-- Aucune colonne ne relie cette ligne à `contenus.id` (ni `contenu_id`, ni
-- équivalent) — elle n'est identifiable que par son texte libre. Confirmé :
-- pas de deuxième table séparée, `messages_client` porte bien les deux
-- usages (messages généraux ET retours de validation contenu) dans les
-- mêmes lignes.
--
-- migration-cm-messages.sql a donné au CM un accès "for all" à
-- messages_client sur son portefeuille (policy mc_cm_acces), pour lui
-- permettre de lire et répondre aux messages clients depuis l'OS. "for all"
-- inclut DELETE : un CM peut donc aujourd'hui supprimer n'importe quelle
-- ligne de messages_client sur un client de son portefeuille — y compris la
-- ligne où le client vient de demander une correction, effaçant la preuve
-- du désaccord.
--
-- Vérification côté usage réel (SportVision-OS-Full.html, section "CM —
-- Messages clients", loadMsgClients()/sendMsgClient()) : le CM ne fait que
-- SELECT (lister) et INSERT (répondre). Aucun bouton, aucun appel DELETE ou
-- UPDATE sur messages_client nulle part dans l'écran msgclients, pour aucun
-- rôle. Le "for all" de mc_cm_acces n'a donc jamais correspondu à un besoin
-- fonctionnel réel — c'est une reprise trop large du pattern "for all" utilisé
-- ailleurs, pas une capacité voulue.
--
-- ─── Correctif ───────────────────────────────────────────────────────────
-- Remplace mc_cm_acces (for all) par deux policies scindées, SELECT et
-- INSERT uniquement, avec exactement la même condition de périmètre qu'avant
-- (portefeuille via contenus_visible_par_cm(), ou Lead CM) — reprise à
-- l'identique, aucun nouveau champ contraint sur l'INSERT (auteur_type/
-- auteur_staff_id restent aussi permissifs qu'avant ce correctif ; les
-- durcir serait traiter une question distincte — la forgerie d'auteur, pas
-- la suppression de preuve — hors du point signalé par l'audit). Un CM peut
-- donc toujours tout lire et répondre sur son portefeuille (aucune
-- régression : c'est exactement ce que fait l'écran msgclients), mais ne
-- peut plus ni supprimer ni modifier une ligne existante — y compris les
-- siennes. Ceci couvre le message de correction client par construction,
-- sans avoir besoin de le distinguer d'un message générique (il n'y a pas
-- de colonne pour le faire de toute façon) : aucun message client, de
-- quelque nature qu'il soit, n'est plus supprimable par un CM.
--
-- Hors périmètre volontairement : mc_staff_all (admin/sec/com/prod, "for
-- all" depuis migration-portail-v1.sql) n'est pas touchée. Cette policy sert
-- une autre zone (Secrétariat/Réservations notamment) et une éventuelle
-- restriction du droit de suppression pour ces rôles est un choix distinct,
-- hors du périmètre CM/Contenus de cet audit.
--
-- Additive, idempotente (drop policy if exists avant chaque create). Ne
-- touche à rien d'autre. À exécuter après migration-cm-messages.sql.
--
-- NON EXÉCUTÉE PAR L'AGENT. À exécuter par Fouka dans Supabase → SQL Editor
-- après relecture.

drop policy if exists "mc_cm_acces" on messages_client;

drop policy if exists "mc_cm_select" on messages_client;
create policy "mc_cm_select" on messages_client for select using (
  contenus_visible_par_cm(client_id, auth.uid())
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
);

drop policy if exists "mc_cm_insert" on messages_client;
create policy "mc_cm_insert" on messages_client for insert with check (
  contenus_visible_par_cm(client_id, auth.uid())
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
);
