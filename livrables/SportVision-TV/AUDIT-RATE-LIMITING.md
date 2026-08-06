# Audit — limitation de fréquence sur les edge functions Supabase

Date : 2026-08-06
Périmètre : `livrables/SportVision-TV/supabase/functions/*/index.ts` (27 fonctions).
Nature : audit read-only. Aucune edge function n'a été modifiée. Les corrections éventuelles
sont à décider et implémenter séparément, après lecture de ce rapport.

## Méthode

Pour chacune des 27 fonctions, vérification de la présence d'un contrôle de JWT/session
Supabase en tout début de fonction (`req.headers.get("Authorization")` suivi d'un
`userClient.auth.getUser()`, motif utilisé de façon homogène dans tout le projet). Une
fonction sans ce contrôle est appelable par n'importe qui, sans compte, avec la seule clé
`anon`/`publishable` publique du projet — c'est le point d'entrée le plus exposé aux abus
(scripts, bots, énumération).

Pour chaque fonction ainsi identifiée comme sans vérification JWT, recherche du motif
`checkRateLimit()` / table `guest_rate_limits` déjà utilisé par `create-guest-request` et
`check-disponibilite` (référence du pattern correct dans ce projet : identifiant
`prefixe:ip` ou `prefixe:email`, fenêtre glissante, insertion d'une ligne par tentative,
rejet au-delà d'un seuil).

Recoupement : `grep -L "Authentification requise"` sur les 27 fichiers donne exactement les
8 fonctions listées ci-dessous comme sans vérification JWT — confirme qu'aucune autre
fonction n'a été omise par la lecture manuelle.

## Résultat en un coup d'œil

Sur les 27 fonctions, **8** sont appelables sans JWT/session Supabase. Parmi ces 8 :
- **5** sont de vrais points d'entrée publics (formulaires visiteurs / mot de passe oublié)
  et utilisent **déjà** `guest_rate_limits`, exactement comme `create-guest-request` et
  `check-disponibilite` — rien à corriger.
- **3** sont des webhooks (Stripe, Youtrust, cron interne) : pas de JWT Supabase par nature
  (l'appelant n'est pas un navigateur), mais chacun vérifie une signature cryptographique ou
  un secret partagé avant de faire quoi que ce soit. Ce ne sont pas des points d'entrée
  ouverts au public au sens où l'entend cet audit.

Les 19 fonctions restantes exigent toutes un JWT Supabase valide (`Authentification requise`
+ `userClient.auth.getUser()`) dès la première ligne de logique — hors du périmètre strict de
cet audit (voir note en fin de document).

## Tableau — fonctions sans vérification JWT/session

| Fonction | Publique sans auth | Rate limiting déjà en place | Risque si spammée | Recommandation |
|---|---|---|---|---|
| `check-disponibilite` | Oui | Oui — `guest_rate_limits`, 30/h/IP | Insère une ligne en base à chaque appel ; reste en lecture seule sur le reste (aucune écriture métier) | Déjà conforme au pattern du projet, aucune action. |
| `create-guest-request` | Oui | Oui — `guest_rate_limits`, 5/h/IP + honeypot `site_web` | Crée une ligne `clients` et une ligne `prestations` à chaque appel ; appelle l'API externe `api-adresse.data.gouv.fr` | Déjà conforme au pattern du projet, aucune action. |
| `create-guest-rdv` | Oui | Oui — `guest_rate_limits`, 5/h/IP + honeypot `site_web` | Crée une ligne `clients` et une ligne `rendez_vous` à chaque appel | Déjà conforme au pattern du projet, aucune action. |
| `clubplus-check-activation-token` | Oui | Oui — `guest_rate_limits`, 30/h/IP | Lecture seule sur `clubplus_activation_tokens`, mais permettrait une énumération/bruit répété sans la limite | Déjà conforme au pattern du projet, aucune action. |
| `request-password-reset` | Oui | Oui — `guest_rate_limits`, 5/h/e-mail **et** 5/h/IP | Génère un lien Supabase (`generateLink`) et met un e-mail réel en file d'envoi (Communication Hub → Brevo) à chaque appel réussi | Déjà conforme au pattern du projet, aucune action. |
| `dispatch-notifications` | Non (secret partagé) | Non applicable — protégée par un secret `Authorization: Bearer <DISPATCH_NOTIFICATIONS_SECRET>` vérifié en premier, pas par JWT ni par `guest_rate_limits` | N'est atteignable que par pg_cron avec le secret ; en cas de fuite du secret, chaque appel envoie jusqu'à 20 e-mails réels via Brevo | Pas un candidat à `guest_rate_limits` (ce n'est pas un appelant navigateur/anonyme) ; la protection pertinente est la confidentialité du secret, pas une limite de fréquence. |
| `youtrust-webhook` | Non (signature HMAC) | Non applicable — vérifie une signature HMAC-SHA256 (`YOUTRUST_WEBHOOK_SECRET`) avant tout traitement, motif différent de `guest_rate_limits` | Sans le secret, un appel n'est même pas traité (rejeté avant toute écriture) ; en cas de compromission du secret, pourrait forcer de faux statuts "signée"/"refusée" sur devis/contrats | Pas un candidat à `guest_rate_limits` (webhook signé, pas un point d'entrée anonyme) ; aucune action liée au rate limiting. |
| `stripe-webhook` | Non (signature Stripe) | Non applicable — vérifie la signature Stripe (`constructEventAsync` + `STRIPE_WEBHOOK_SECRET`) avant tout traitement | Sans signature valide, rejeté avant toute écriture ; en cas de compromission du secret, pourrait forcer de faux statuts de paiement/abonnement | Pas un candidat à `guest_rate_limits` (webhook signé, pas un point d'entrée anonyme) ; aucune action liée au rate limiting. |

## Note — hors périmètre strict de cet audit

Les 19 fonctions suivantes exigent toutes un JWT Supabase valide dès le début (donc ne
correspondent pas au critère "sans authentification" demandé pour ce tableau) : `admin-delete-portal-account`,
`clubplus-activate`, `clubplus-billing-portal`, `clubplus-family-invite`,
`clubplus-generate-activation`, `clubplus-invite`, `clubplus-onboarding`,
`create-checkout-session`, `create-clubplus-subscription-checkout`,
`create-team-contribution-checkout`, `delete-account`, `invite-collaborateur`,
`notify-account-change`, `org-invite`, `portal-onboarding`, `send-devis-email`,
`send-facture-email`, `send-facture-pennylane`, `send-signature-request`.

Une nuance mérite d'être signalée sans être creusée ici (hors périmètre demandé) : parmi ces
19, certaines (`portal-onboarding`, `clubplus-onboarding`, `clubplus-activate`, `org-invite`,
`clubplus-invite`, `clubplus-family-invite`) ne nécessitent qu'un compte Supabase Auth tout
juste auto-créé — gratuit et immédiat à obtenir — plutôt qu'un compte privilégié. Un JWT valide
les met hors du critère strict "sans authentification" utilisé dans ce tableau, mais elles
restent atteignables à faible coût par un script capable de s'inscrire en boucle. Ce n'est pas
un abus "anonyme" au sens de guest_rate_limits (chaque appel est attribuable à un compte créé),
donc traité comme un sujet distinct, à évaluer séparément si besoin.
