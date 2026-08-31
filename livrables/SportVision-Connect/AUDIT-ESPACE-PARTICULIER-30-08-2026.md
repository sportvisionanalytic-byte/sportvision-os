# Audit Espace Particulier — SportVision Connect (30-31/08/2026)

Périmètre : `src/app/particulier/**` (profil, sportifs, reserver, abonnement, calendrier,
commandes, factures, cotisations, contenus, messages). Méthodologie : compte de test réel créé
via API Admin Supabase, Playwright avec vrais clics/saisies clavier, vérification SQL directe
après chaque action, nettoyage complet en fin de mission.

## Bugs trouvés, corrigés et vérifiés en réel

### 1. Messages — 400 systématique à l'ouverture d'un fil non lu (CRITIQUE)
`client_mark_message_read()` n'autorisait que deux chemins d'accès (`client_users`,
`player_has_client_access`), tous deux absents pour un compte particulier — self, sportif lié ou
profil géré. Résultat : toute ouverture de `/particulier/messages` avec un message non lu
échouait en boucle (400 "Non autorise"), le badge non-lu restant coincé indéfiniment.
Corrigé (migration v88) en alignant l'autorisation sur la RLS `mc_client_select` déjà en place
(ajout de `connect_owner_client_id`, `connect_access_relationships`, `managed_athlete_profiles`,
`club_member_has_client_access`). Vérifié : `lu=true` en base après rechargement, plus aucune
erreur 400, y compris en réel sur `connect.sportvision-an.fr`.

### 2. Réservation — mauvais libellé interne "Espace joueur" pour une résa particulier
La description interne visible par le staff (`description_besoin`) affichait "Connect — Espace
joueur" pour toute réservation "pour moi" (kind="self"), y compris venant de l'Espace
particulier — alors que le bon discriminant (`beneficiary` présent ou non) était déjà utilisé
ailleurs dans la même fonction. Corrigé dans l'edge function `connect-player-prestations`,
redéployée. Vérifié en base : deux réservations identiques avant/après le fix montrent bien
"Espace joueur" puis "Espace particulier".

### 3. Mes sportifs — bannière de plafond figée sur "sportifs suivis" pour un parent
`AthletesListView.tsx` affichait toujours "X / 3 sportifs suivis" (vocabulaire Agent), y compris
pour un compte parent/tuteur dont le titre de la page dit "Mes enfants". Corrigé : "X / 3
enfants" pour parent/tuteur, "sportifs suivis" conservé pour "autre".

### 4. Mon profil — "Gérer mes sportifs" / "Aucun sportif ajouté" figés
Même incohérence que #3 sur `/particulier/profil` : bouton et texte d'état vide ne suivaient pas
`profilParticulier`, contrairement à l'Accueil qui applique déjà la bonne bascule. Corrigé.

### 5. Fiche sportif géré — faux badge "✓ Affilié" sur un club non vérifié
Le "club" d'un profil géré vient d'un champ libre facultatif saisi par le parent
(`managed_athlete_profiles.club_declare`, jamais vérifié, `club_id` toujours null). La fiche
sportif affichait pourtant ce nom avec un pictogramme logo et un badge "✓ Affilié" identique en
tout point à une vraie affiliation club vérifiée (sportif "linked"). Corrigé : distinction sur
`club_id` — bloc "Club déclaré" sans badge, avec mention explicite "non vérifié par
SportVision" pour un profil géré.

### 6. Calendrier — export .ics absent côté particulier
Contrairement à l'Espace joueur, aucun moyen d'exporter un événement vers son propre calendrier
(pas de clic possible sur les lignes, aucun bouton). Fonctionnalité explicitement listée dans le
périmètre de mission. Ajoutée (modal de détail + "Ajouter à mon calendrier", réutilise
`lib/ics.ts` déjà utilisé côté joueur). Testé de bout en bout : fichier .ics téléchargé et
contenu vérifié valide (`DTSTART`/`DTEND` corrects).

## Testé et fonctionnel, aucun bug trouvé

- Accueil particulier (cartes sportifs, prochaine prestation, contenus, événement, cotisation)
- Profil géré : création complète, écriture vérifiée en base
- Réservation de bout en bout (paiement espèces) : commande créée, statut, montant vérifiés
- Commandes : liste + détail
- Cotisations : création complète (offre → répartition → lien de partage), écriture vérifiée
- Factures, Contenus : états vides corrects
- Invitation d'un sportif lié (création de la demande, `connect_access_relationships` vérifiée)
- Messagerie : envoi vérifié (une seule ligne en base, pas de doublon en usage normal)
- Abonnement Agent : accessible par URL directe pour tout compte particulier (comportement
  documenté et volontaire, pas un bug)
- Mobile (390px) : aucun débordement horizontal sur Accueil/Sportifs/Prestations/Messages/Profil

## Note pour Fouka (hors périmètre, non corrigé)

La CSP globale (`next.config.js`, `connect-src`) ne liste pas `wss://` — la connexion Realtime
Supabase (badge de notifications live) est bloquée par le navigateur sur toutes les pages
`/particulier/**` (et probablement `/joueur/**`). Sans conséquence bloquante (repli sur le
fetch initial au chargement), mais le badge ne se met jamais à jour en temps réel. Fichier
partagé avec d'autres chantiers en cours, volontairement non modifié ici.

## Vérifications finales
- `npm run typecheck` : OK
- `npm run build` : OK
- Toutes les données de test (comptes, prestations, cotisation, profil géré, invitation,
  messages) supprimées et absence vérifiée en base
- Commit local uniquement, aucun push
