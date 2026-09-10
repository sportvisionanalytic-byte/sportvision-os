# Première mission réelle : protocole d'observation

> Décision de Fouka, 10/09/2026. Le circuit mission, rémunération et rentabilité est **gelé**.
> On arrête de simuler la production : la première vraie prestation teste SportVision.
> Elle sert de **test UX**, pas de nouveau test technique.

## Règles pendant la mission

- On ne développe rien sur le circuit.
- On relève uniquement les bugs **P0/P1** et les **vraies frictions** des utilisateurs.
- Aucune remarque isolée ne devient une fonctionnalité avant la fin de la mission.
- Une étape n'est « faite » que si l'état réel a changé (colonne « Preuve » ci-dessous), pas parce
  qu'un écran a affiché « succès ». Si l'écran dit oui et la preuve dit non : c'est un P1.

## Les 10 étapes observées

| # | Étape | Qui | Preuve que c'est vraiment fait |
|---|---|---|---|
| 1 | Affectation | Responsable Production | L'opérateur apparaît sur la fiche mission, avec sa rémunération ; motif renseigné si l'écart avec la grille dépasse 15 % |
| 2 | Acceptation | Opérateur | Affectation « Confirmé » côté Production ; la mission passe « équipe affectée » |
| 3 | Jour J | Opérateur | Statuts successifs jusqu'à « production terminée », à l'heure réelle |
| 4 | Sauvegarde réelle des fichiers | Opérateur | Fichiers présents à l'endroit prévu, sauvegarde déclarée dans le suivi de mission ; cartes vidées seulement après |
| 5 | Livraison photo/vidéo | Opérateur, Production | Livraison créée et visible par le club, fichiers ouverts depuis le compte club |
| 6 | Validation ou correction | Responsable Production | Livraison validée, ou correction demandée puis traitée et revalidée |
| 7 | Transmission compta | Responsable Production | Rémunération « Validé prod » puis « Transmis compta » |
| 8 | Règlement | Comptabilité ou Secrétariat | Rémunération « Payé » avec une date ; l'opérateur voit « Payé » de son côté |
| 9 | Clôture mission | Responsable Production | Mission « clôturée » ; si refusé, noter ce que l'OS dit manquer |
| 10 | Matériel | Opérateur, Production | Kit rendu ou conservé, contrôle enregistré, aucun incident ouvert oublié |

Pour chaque étape, noter l'heure de début et de fin : c'est ce qui mesure le temps perdu.

## Les 5 questions (Responsable Production et opérateur)

À noter au fil de la mission, en une ligne chacune, sans chercher la solution :

1. Qu'est-ce qui n'était pas clair ?
2. Qu'est-ce que vous avez cherché ?
3. Qu'est-ce que vous avez oublié ?
4. Qu'est-ce qui vous a pris trop de temps ?
5. À quel moment avez-vous cru avoir terminé alors que le processus ne l'était pas ?

## Débrief (à la fin de la mission)

- **Étapes réussies** : lesquelles, sans aide.
- **Étapes ambiguës** : où l'utilisateur a hésité, et pourquoi.
- **Erreurs** : message, écran, heure ; P0 / P1 / autre.
- **Temps perdu** : étape, durée, cause.
- **Oublis** : ce qui n'a pas été fait, et ce qui aurait dû le rappeler.
- **Corrections indispensables V1.0.1** : uniquement ce qui empêche la prochaine mission de se dérouler.
- **Améliorations V1.1** : tout le reste, sans engagement.
