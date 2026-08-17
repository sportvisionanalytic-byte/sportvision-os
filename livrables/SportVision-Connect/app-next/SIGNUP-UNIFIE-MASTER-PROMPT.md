# MASTER PROMPT — SPORTVISION CLUB+ : PARCOURS FINAL D'OUVERTURE D'UN ESPACE CLUB+

Transmis par Fouka le 17/08/2026, en réponse au tunnel `/signup/club-request/*` existant. Décision prise le même jour avec Fouka : ce parcours en 5 étapes remplace, pour TOUS les types de structure (pas seulement club), à la fois l'ancien tunnel `/signup/club-request/*` (4 étapes, club uniquement) et l'ancien tunnel générique `/signup/type` → `/signup/done` (7 étapes, création de compte immédiate pour coach/académie/générique/tournoi — retiré par cette décision, plus aucune structure ne doit être créée sans vérification SportVision).

---

IMPORTANT :

Ce parcours n'est PAS une création immédiate de compte.

Il s'agit d'une :

DEMANDE D'OUVERTURE D'UN ESPACE CLUB+

SportVision vérifie la structure avant activation.

Aucun rôle administrateur ne doit être attribué automatiquement simplement parce qu'une personne remplit le formulaire.

Le parcours doit rester :

court
premium
rassurant
professionnel
mobile-first
cohérent avec la DA actuelle Club+.

Ne change pas la direction artistique existante.

Supprime toutes les références incorrectes à SportVision Connect dans ce parcours.

## 1. OBJECTIF FINAL

Le parcours doit permettre à une personne représentant une structure de :

1. choisir son type de structure ;
2. renseigner les informations de la structure ;
3. renseigner ses propres coordonnées ;
4. indiquer ses besoins ;
5. vérifier et envoyer sa demande.

Ensuite : SportVision examine la demande. Si elle est validée : l'utilisateur reçoit un lien sécurisé pour activer son accès Club+.

## 2. PARCOURS FINAL

Utiliser exactement 5 étapes :

1. Type de structure
2. Votre structure
3. Vous
4. Votre besoin
5. Validation

NE PAS afficher Offre / Paiement / Confirmation dans la barre de progression de cette demande initiale. Le choix d'une offre commerciale et le paiement interviennent plus tard selon le parcours réellement validé.

## 3. HEADER GLOBAL

Conserver : Logo SportVision Club+. À droite : "Déjà un compte ? Se connecter". Puis une barre de progression simple (1 Type de structure — 2 Votre structure — 3 Vous — 4 Votre besoin — 5 Validation). Étape active : violet/bleu. Étape terminée : check vert discret. Étape future : gris.

## 4. ÉCRAN 1 — TYPE DE STRUCTURE

Titre : "Quel type de structure souhaitez-vous inscrire sur Club+ ?"
Sous-titre : "Ce choix nous permet d'adapter votre demande et votre futur espace professionnel."
Ligne discrète : "L'ouverture de votre espace sera vérifiée par SportVision avant activation."

## 5. CARTES TYPE DE STRUCTURE

- CLUB — Équipes, joueurs, compétitions.
- ACADÉMIE — Sportifs, groupes, stages.
- COACH / PRÉPARATEUR — Activité individuelle ou indépendante.
- STRUCTURE DE COACHING — Plusieurs coachs, intervenants ou groupes.
- TOURNOI / ÉVÉNEMENT — Tournoi, compétition ou événement ponctuel.
- STAGE / CAMP — Stage sportif, camp ou session organisée.
- ASSOCIATION / AUTRE STRUCTURE — Association, ligue, comité ou autre organisation.

## 6. ÉTAT SÉLECTIONNÉ

Border accentuée, fond légèrement plus lumineux, petit check, léger glow, cursor pointer. Le bouton Continuer devient actif seulement après sélection.

## 7. CTA ÉCRAN 1

Bouton : "Continuer". Ne pas écrire "Créer mon espace" à ce stade.

## 8. ÉCRAN 2 — TITRE DYNAMIQUE

- Club : "Votre club"
- Académie : "Votre académie"
- Coach : "Votre activité"
- Structure de coaching : "Votre structure"
- Tournoi : "Votre organisation"
- Stage : "Votre stage ou organisation"
- Association : "Votre structure"

## 9. INTRO ÉCRAN 2

"Renseignez les informations principales afin que SportVision puisse vérifier votre structure." Ne jamais mentionner Connect ici.

## 10. CHAMPS ÉCRAN 2

Nom de la structure * — label dynamique : "Nom du club" / "Nom de l'académie" / "Nom de votre activité" / "Nom de la structure" / "Nom de l'organisation" / "Nom du stage / camp".
Ville *
Code postal
Site internet ou Instagram — "Facultatif"

## 11. NE PAS REDONNER LE TYPE

Ne PAS afficher un select "Type de structure" (déjà choisi à l'étape 1). Afficher éventuellement un petit badge ("Club", "Académie"...) en haut de la page, jamais un champ à re-remplir.

## 12. CHAMPS CONDITIONNELS — COACH / PRÉPARATEUR

Ajouter : "Type d'activité *" — Coach indépendant / Préparateur physique / Personal trainer / Coach personnel / Autre (champ texte si Autre). Ajouter éventuellement une checkbox "J'exerce sous mon propre nom" (si cochée, le nom de l'activité peut être prérempli avec prénom + nom plus tard).

## 13. POUR TOURNOI / ÉVÉNEMENT

Ajouter si utile "Nom de l'organisation" et éventuellement "Nom de l'événement principal", sans surcharger. Ne pas construire ici une fiche événement complète.

## 14. TEXTE DE CONFIANCE ÉCRAN 2

"Ces informations nous permettent de vérifier l'existence et le contexte de votre structure." (discret)

## 15. CTA ÉCRAN 2

Retour / Continuer

## 16. ÉCRAN 3 — VOUS

Titre : "Vous". Sous-titre : "Indiquez les coordonnées de la personne que SportVision pourra contacter au sujet de cette demande."

## 17. CHAMPS ÉCRAN 3

Prénom *, Nom *, Adresse e-mail professionnelle *, Téléphone *, Fonction dans la structure *

## 18. MICROCOPY EMAIL

"Utilisez de préférence une adresse liée à votre structure." Ne pas rendre obligatoire un domaine professionnel (un coach indépendant peut utiliser Gmail).

## 19. FONCTION — OPTIONS

Président(e), Vice-président(e), Directeur/Directrice, Secrétaire, Trésorier/Trésorière, Responsable communication, Community Manager, Directeur sportif, Responsable sportif, Responsable administratif, Coach, Éducateur, Préparateur physique, Responsable d'équipe, Responsable partenariat/sponsoring, Propriétaire/Gérant, Bénévole, Membre du bureau, Autre (champ texte si Autre).

## 20. FONCTION ≠ RÔLE CLUB+

Encadré informatif : "Votre fonction est déclarative. Elle nous aide à vérifier votre demande, mais ne détermine pas automatiquement vos droits dans Club+. SportVision confirme séparément les accès accordés lors de l'activation." Ne jamais écrire "rôle technique dans Connect".

## 21. CTA ÉCRAN 3

Retour / Continuer

## 22. ÉCRAN 4 — VOTRE BESOIN

Titre : "Que souhaitez-vous faire avec SportVision ?" Sous-titre : "Vous pouvez sélectionner plusieurs besoins."

## 23-26. STRUCTURER LES BESOINS EN 3 BLOCS

Ne pas mélanger tout dans une seule grille.

**Bloc A — Espace & accompagnement** : Découvrir Club+ / Full Communication / Communication de ma structure / Création de visuels.
**Bloc B — Prestations** : Photo/vidéo / Couverture de matchs / Captation Veo/Drone / Tournoi/stage/événement / Création de contenus.
**Bloc C — Autre besoin** : "Je souhaite simplement découvrir SportVision" / Autre (textarea si Autre : "Précisez votre besoin").

## 27-28. ÉVITER LE DOUBLON CLUB+

L'utilisateur est déjà dans une demande d'ouverture Club+ — NE PAS proposer "Club+" comme choix de besoin (redondant). Version recommandée des choix : PHOTO/VIDÉO, COMMUNICATION DE MA STRUCTURE, CRÉATION DE VISUELS, FULL COMMUNICATION, COUVERTURE DE MATCHS, CAPTATION VEO/DRONE, TOURNOI/STAGE/ÉVÉNEMENT, DÉCOUVRIR LES SERVICES SPORTVISION, AUTRE.

## 29. CARDS BESOINS

Toute la card cliquable, checkbox à gauche. Selected : border violet/bleu + fond accent léger.

## 30. CTA ÉCRAN 4

Continuer uniquement si au moins un besoin sélectionné. Retour / Continuer.

## 31. ÉCRAN 5 — VALIDATION

Titre : "Vérifiez votre demande". Sous-titre : "Relisez les informations avant de transmettre votre demande à SportVision."

## 32-34. RÉCAP (3 cards, chacune avec un lien "Modifier")

- **Votre structure** : Type, Nom, Ville, Code postal, Site/Instagram.
- **Vous** : Nom complet, E-mail, Téléphone, Fonction déclarée.
- **Votre besoin** : chips des besoins sélectionnés.

## 35. ENCADRÉ "QUE SE PASSE-T-IL ENSUITE ?"

1. Votre demande est transmise à l'équipe SportVision.
2. Nous vérifions les informations de votre structure.
3. Si votre demande est validée, vous recevez un e-mail sécurisé.
4. Vous pourrez ensuite activer votre accès Club+.

## 36. NE PAS PROMETTRE 24/72H

Pas de délai précis tant qu'aucun SLA officiel n'est validé. Utiliser : "SportVision reviendra vers vous après vérification de votre demande." ou "Nous vous informerons par e-mail dès que votre demande aura été examinée."

## 37. ENCADRÉ CRÉATION DE COMPTE

"Votre demande n'entraîne pas encore la création d'un accès Club+. Si elle est validée, SportVision vous enverra un lien sécurisé pour activer votre espace."

## 38. CERTIFICATION

Checkbox : "Je certifie être autorisé(e) à effectuer cette demande au nom de cette structure. *" — conserver.

## 39. OPTIONNEL — RGPD

Pas de checkbox marketing obligatoire. Texte discret si nécessaire : "Les informations transmises sont utilisées par SportVision pour traiter votre demande. En savoir plus." (lien Politique de confidentialité).

## 40. CTA FINAL

Primary : "Envoyer ma demande". Secondary : "Retour". Disabled tant que certification non cochée ou champs obligatoires invalides.

## 41. ÉTAT LOADING

"Envoyer ma demande" → "Envoi en cours…", désactiver double clic.

## 42-45. ÉCRAN DE SUCCÈS

Icône check. Titre : "Demande envoyée ✓". Texte : "Votre demande d'ouverture Club+ a bien été transmise à SportVision." Référence si disponible ("Référence : REQ-CLUB-XXXX", pas obligatoire si backend non prêt). Sous-bloc "Que se passe-t-il maintenant ?" : SportVision va vérifier les informations transmises / Vous recevrez un e-mail lorsque votre demande aura été examinée / Si elle est validée, un lien sécurisé vous permettra d'activer votre accès Club+. CTA : "Retour au site SportVision", secondaire "Se connecter" si l'utilisateur possède déjà un compte.

## 46. CAS UTILISATEUR DÉJÀ CONNECTÉ

Si un utilisateur SportVision existant remplit la demande : ne pas créer un nouveau compte, associer la demande à son identité existante.

## 47. CAS DEMANDE DÉJÀ EXISTANTE

Si même utilisateur + même structure a déjà une demande pending : ne pas dupliquer. Afficher "Une demande est déjà en cours pour cette structure." CTA "Voir le statut" ou "Contacter SportVision".

## 48. CAS STRUCTURE EXISTANTE CLUB+

Si la structure existe déjà : ne pas permettre une seconde organisation officielle. Afficher "Cette structure utilise déjà SportVision Club+." CTA "Demander à rejoindre la structure" ou "Contacter un administrateur" selon le système réel.

## 49. CAS EMAIL CORRESPONDANT À UNE INVITATION

Si une invitation Club+ existe déjà pour cet email : "Vous avez déjà une invitation en attente pour cette structure." CTA "Voir l'invitation".

## 50. VALIDATION SERVEUR

Ne jamais faire confiance uniquement au frontend. Vérifier côté serveur : type structure, champs obligatoires, email, téléphone, doublon demande, doublon structure, utilisateur existant, invitation existante.

## 51. PAS DE RÔLE ADMIN AUTOMATIQUE

La fonction déclarée (Président(e), Directeur, Trésorier, Coach...) ne donne JAMAIS automatiquement organization_admin=true. SportVision ou un admin existant attribue les droits séparément.

## 52-54. MOBILE

Tester 375/390/430px. Progress bar simplifiée ("Étape 2 sur 5 — Votre structure"). Type de structure : une card par ligne. Besoin : une card par ligne ou 2 si largeur suffisante. CTA pleine largeur, sticky en bas si utile (Retour toujours accessible).

## 55-57. DESKTOP / SPACING / INPUTS

Largeur contenu actuelle globalement bonne, max-width cohérent. Spacing : 4/8/12/16/24/32/48/64. Inputs normalisés (height/border/focus/error/disabled), focus border violet/bleu sans glow excessif.

## 58-59. ERREURS

Sous le champ ("Veuillez renseigner le nom de votre club.", "Veuillez saisir une adresse e-mail valide.", "Veuillez sélectionner votre fonction."). Erreur serveur : "Nous n'avons pas pu transmettre votre demande. Vos informations ont été conservées." CTA "Réessayer" — ne jamais perdre le formulaire.

## 60-62. PERSISTANCE

Conserver les valeurs entre étapes (retour, refresh raisonnable). Si refresh en étape 4 casse l'état, retourner proprement étape 1 avec message plutôt que planter.

## 63. SÉCURITÉ

Aucune donnée sensible dans l'URL / query params.

## 64. ACCESSIBILITÉ

Cards sélectionnables au clavier, checkboxes avec labels associés, focus visible, inputs avec labels réels, erreurs avec aria-describedby.

## 65. DESIGN

Conserver exactement l'ambiance actuelle (dark navy, violet/bleu, premium sport-tech). Ne pas ajouter d'illustrations IA, photos stock, animations lourdes.

## 66-71. TEXTES FINAUX EXACTS

Voir sections 4, 8-9, 16-20, 22, 31, 35-38, 42-45 ci-dessus — chaque titre/sous-titre/encadré y est donné mot pour mot.

## 72. À SUPPRIMER DU FLOW ACTUEL

Toute mention Connect ; "rôle technique dans Connect" ; "créer votre espace Connect" ; étapes Offre/Paiement dans la demande initiale ; champ Type de structure redondant ; copy "Quel type de structure créez-vous ?" ; toute promesse d'activation immédiate ; toute attribution automatique de rôle.

## 73. DEFINITION OF DONE

5 étapes maximum ; Club+ seul produit cité ; type sélectionné une seule fois ; wording dynamique selon structure ; fonction déclarative clairement séparée des permissions ; besoins correctement structurés ; récap modifiable ; prochaine étape expliquée ; validation SportVision expliquée ; aucun paiement dans ce flow ; écran succès complet ; mobile terminé ; erreurs terminées ; doublons gérés ; sécurité backend documentée.

## 74. ORDRE DE TRAVAIL (donné par Fouka)

1. Supprimer toutes les mentions Connect. 2. Uniformiser le parcours en 5 étapes. 3. Refaire étape Type de structure. 4. Supprimer Type de structure redondant. 5. Adapter étape Structure. 6. Corriger étape Vous. 7. Refaire organisation de Votre besoin. 8. Refaire récap Validation. 9. Ajouter prochaines étapes. 10. Ajouter écran succès. 11. Ajouter états erreurs. 12. Ajouter cas structure existante/demande existante. 13. Tester mobile. 14. Tester keyboard/accessibilité. 15. Produire handoff développeur.

Ne pas refaire la DA. Améliorer seulement la logique, la microcopy et la fluidité.

---

## Décision d'architecture prise avec Fouka le 17/08/2026 (complète ce master prompt)

Ce parcours unifié remplace, pour LES 7 TYPES listés en §5, à la fois :
- L'ancien tunnel `/signup/club-request/*` (4 étapes, club uniquement, table `connect_club_signup_requests`).
- L'ancien tunnel générique `/signup/type` → `/signup/account` → `/signup/org` → `/signup/needs` → `/signup/plan` → `/signup/checkout` → `/signup/done` (7 étapes) — qui créait un compte + une organisation ACTIVE immédiatement pour coach/académie (edge function `connect-org-signup`) et generic/tournament_organizer (edge function `portal-onboarding`), SANS validation SportVision. Ce comportement est explicitement ce que Fouka veut éliminer ("aucune structure ne doit être créée sans vérification").

Fouka a validé de tout faire en une fois, y compris la généralisation du backend (table de demandes + edge functions + écran de validation staff dans `SportVision-OS-Full.html`), plutôt que de scinder en plusieurs sessions.

**Contrainte non négociable** : le chemin CLUB existant (table `connect_club_signup_requests`, edge functions `connect-club-signup-request`/`connect-club-signup-review`, `clubplus-generate-activation`/`clubplus-activate`, écran OS `modalDemandesClubConnect`) doit continuer à fonctionner à l'identique pour le type club après ce chantier — étendre, ne jamais casser ce qui existe déjà et qui a des demandes réelles en base.
