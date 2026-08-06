# Workspace History

> Journal chronologique de toutes les sessions et décisions importantes.
> Le plus récent en haut. Mis à jour automatiquement par Claude.
>
> **Comment ça marche :** Quand je lance la commande `/update` après une session importante, ou quand je raconte un changement significatif, Claude ajoute une entrée ici automatiquement. Je n'ai pas à écrire ce fichier manuellement.

---

## 2026-08-06

### Décision stratégique : retrait du Portail au profit de SportVision Connect

- Le Portail (espace client historique) sera abandonné comme produit séparé. Tout le suivi client (devis, contrats, factures, livrables, messagerie, RDV) doit à terme se passer sur SportVision Connect, un chantier de refonte déjà entamé dans une session précédente (coque commune + espaces Club/Coach/Académie/Projet/Sponsor/Joueur/Famille), mais qui n'avait jamais été testé avec de vrais utilisateurs ni de vraies données
- Bascule progressive décidée, mais avec une marge de manœuvre large : aucun client réel n'est encore sur le Portail à ce jour, tout était en phase de test, donc l'architecture peut encore être librement modifiée sans risque de casser un accès client existant
- Priorités actées avant tout onboarding réel de clients sur Connect : (1) corriger le backlog de sécurité déjà documenté côté Connect (colonnes non protégées sur sponsors/newsroom, 11 occurrences), (2) recette fonctionnelle complète de l'espace "Projet" (le module qui remplace le Portail), (3) finaliser les éléments techniques manquants (icônes PWA, déploiement de l'edge function `org-invite`)
- Le site vitrine public (`livrables/SportVision/`, catalogue/offres, sans compte) n'est pas concerné par ce changement, il reste séparé de la zone authentifiée

---

## 2026-08-03

### Lancement officiel de SportVision Portail fixé à mi-septembre 2026

- Le Portail (site public + espace client) est en développement avancé : catalogue, paiements Stripe, messagerie, signature électronique (Youtrust) et facturation électronique conforme (Pennylane) déjà intégrés et déployés
- L'app mobile (iOS/Android) et l'achat du domaine personnalisé (`portail.sportvision.fr`) sont volontairement repoussés à fin août, pour arriver prêts pile pour le lancement de mi-septembre plutôt que d'être faits dans la précipitation maintenant

---

## 2026-06-27

### Installation initiale du Jarvis

- Workspace personnalisé pour Fouka, basé à Villeneuve-la-Guyard
- Profil principal : Entrepreneur
- Activité : SportVision, captation vidéo/photo d'événements sportifs et création de contenus, avec développement de SportVision TV en cours
- Objectifs court terme identifiés : signer 5 clubs partenaires, automatiser l'écosystème SportVision
- Vision long terme : devenir la référence du sport amateur en France, lancer SportVision TV nationalement, activité en autonomie
- Projets actifs au démarrage : structuration et automatisation de l'écosystème SportVision, amélioration du modèle économique, développement clients, communication
- Domaines d'aide prioritaires : stratégie business, communication professionnelle, développement et organisation
- Style de communication choisi : mélange selon le contexte
