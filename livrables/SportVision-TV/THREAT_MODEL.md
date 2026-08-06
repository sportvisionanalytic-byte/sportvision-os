# Modèle de menace — SportVision OS & Connect

Reprend la structure du cahier des charges sécurité, annotée avec l'état réel constaté par audit (2026-08-06). Voir `SECURITY_ARCHITECTURE.md` pour le détail technique.

| Acteur / risque | Objectif probable | État constaté |
|---|---|---|
| Utilisateur d'un autre club | Lire/modifier les données d'un club concurrent | **Corrigé cette session** — `club_members.role`/`club_id`/`status` étaient auto-modifiables par le membre lui-même (`cm_self_update` sans restriction de colonne), permettant une auto-promotion admin. Trigger de protection ajouté (`migration-securite-club-members-client-users-rls.sql`). RLS `is_club_member`/`is_club_admin` couvre le reste, non ré-audité en entier hors du module joueur/famille (déjà revu en phase 13). |
| Client Portail | Lire/modifier les données d'un autre client | **Corrigé cette session** — même défaut sur `client_users.client_id`, qui est la clé de cloisonnement de tout le Portail (prestations, devis, contrats, avis). Trigger de protection ajouté. |
| Collaborateur interne trop privilégié | Consulter finances/contrats/exports sans besoin | RLS par rôle en place sur les tables sensibles (`clients`, `prestations`, `devis`, `contrats`, `frais`). Pas de double validation sur les actions sensibles (remboursement, suppression de club, changement de RIB) — **non couvert**, voir feuille de route. |
| Compte administrateur compromis | Prendre le contrôle de l'OS | **Non couvert** — pas de MFA du tout, tokens de session en `localStorage` (vol possible via XSS), pas de ré-authentification avant action sensible. |
| Bot ou attaquant externe | Brute force, scraping, spam, déni de service | **Non couvert** — pas de Cloudflare/WAF/rate limiting constaté, pas de Turnstile. |
| Secret exposé | Créer paiements/signatures ou accéder à la base | Clés client-side vérifiées saines (clé publishable Supabase uniquement, aucun secret trouvé dans les 4 HTML ni codé en dur dans les Edge Functions). **Mais** : token GitHub personnel exposé en clair dans `.git/config` — à révoquer par Fouka en priorité. Pas de gestionnaire de secrets centralisé, pas de scan Git automatique. |
| Fichier malveillant | Exécuter du code ou infecter un poste | **Non couvert** — pas de validation MIME/antivirus constatée sur les buckets Storage. |
| Erreur de webhook (rejeu, doublon) | Double activation, statut incohérent | Stripe : couvert (`stripe_events`). Youtrust : **corrigé cette session** (`youtrust_events`). |
| Erreur humaine | Suppression, mauvais rôle, mauvais environnement | Pas de séparation d'environnement (un seul projet Supabase, une seule paire de clés Stripe) — un test malencontreux touche directement la production. |
| Montant de paiement falsifié par le client | Payer moins que ce qui est dû | `create-checkout-session` (Portail) : couvert, montant recalculé serveur depuis le catalogue/contrat. `create-team-contribution-checkout` (projets d'équipe Club-Plus) : **corrigé cette session** — le montant était fourni tel quel par le client sans plafond ; borné désormais entre `contribution_min` et le reste à collecter. |
| Document sensible exposé (autorisation parentale, pièce d'identité) | Accès à un document confidentiel sans authentification | **Non couvert** — les deux buckets Storage (`clubplus-media`, `portail-media`) sont publics, aucune URL signée. Nécessite un inventaire des types de fichiers avant remédiation (voir décision ouverte). |
| Journal d'audit falsifié | Attribuer une action à quelqu'un d'autre, ou effacer une trace | **Corrigé cette session** — `audit_logs` permettait d'insérer n'importe quel `acteur_id` ; resserré à `acteur_id = auth.uid()`. `UPDATE`/`DELETE` explicitement révoqués sur `audit_logs` et `communication_audit_logs`. |
| Ancien prestataire conservant des accès | Accès résiduel après fin de mission | Pas de procédure formalisée constatée dans le code (c'est un processus, pas une donnée d'audit technique) — à documenter côté organisationnel. |

## Résumé

7 lignes corrigées ou renforcées cette session (auto-promotion club, fuite inter-tenant Portail, montant de contribution non borné, rejeu Youtrust, falsification du journal d'audit). Les risques les plus sérieux qui restent ouverts, par ordre de gravité : absence de MFA partout, tokens de session en `localStorage` sans cookie `httpOnly`, stockage de fichiers entièrement public, absence de séparation d'environnement, absence de WAF/rate limiting, absence de CI/CD et de scan de secrets automatique.
