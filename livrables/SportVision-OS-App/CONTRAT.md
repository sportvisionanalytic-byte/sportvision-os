# Le contrat de SportVision OS

Ce fichier existe parce que plusieurs personnes — et plusieurs agents — écrivent dans cette
application en même temps. Tout ce qui suit a été payé au moins une fois par un défaut en
production. Ce ne sont pas des préférences de style.

## 1. La direction artistique n'est pas à décider

`src/theme/couleurs.ts` et `src/theme/polices.ts` sont les fichiers de l'application des familles,
copiés sans une valeur changée. On importe `C`, `E`, `R`, `TOUCHE`, `P`. **On n'écrit jamais une
couleur en dur, jamais une taille de police en dur, jamais un espacement en dur.**

Les briques communes sont dans `src/ui/` : `Ecran`, `Section`, `Probleme`, `Vide`, `Bouton`,
`Champ`, `Erreur`, `Pastille`, `Ecusson`. On les utilise. On n'en crée une nouvelle que si aucune
ne convient, et on la met dans `src/ui/` pour que les autres s'en servent.

Deux palettes proches mais pas identiques, c'est exactement ce qui donne l'impression de deux
applications recollées. C'est le reproche numéro un de Fouka, trois fois répété.

## 2. Aucune vue web, nulle part

Fouka, 30/09 : « je ne veux pas une vue web, justement. Je veux vraiment une application de l'OS. »
Un écran que l'application ne sait pas dessiner n'y est pas. Pas d'onglet qui ouvre un site dans un
cadre, pas de `WebView`, pas de `Linking.openURL` vers l'OS.

## 3. On ne réécrit jamais une règle que la base tient déjà

Le 30/09, un filtre par périmètre ajouté côté écran, sur les galeries, s'est révélé **redondant et
faux** : la base cloisonnait déjà, et mieux — elle regardait un champ que l'écran ignorait.

Donc : avant d'écrire un filtre, **mesurer** ce que la base rend avec le jeton d'une vraie personne.
Si elle borne déjà, l'écran ne borne pas une seconde fois. Si un droit doit être demandé, on
appelle la fonction de la base (`peut_operer_club`, `is_team_educateur`, `is_staff`…), on ne
recopie pas sa logique.

## 4. Jamais de faux succès

`update` et `delete` via PostgREST rendent **zéro ligne et zéro erreur** quand la RLS refuse.
Toute écriture se termine donc par `.select("id")`, et on lève si le tableau est vide.

    const { data, error } = await supabase.from("x").update(m).eq("id", id).select("id");
    if (error) throw new Error(error.message);
    if (!data || !data.length) throw new Error("…refusé : …");

Règle posée le 10/09 après le « ça n'enregistre pas » de Villemomble.

## 5. Un bouton qui mène à un refus est une promesse cassée

Avant de proposer une action, demander le droit à la base. En cas de doute, on n'affiche pas le
bouton et on dit à qui s'adresser. Un formulaire qu'on ne peut pas envoyer est pire que son absence.

## 6. On mesure avant d'écrire une ligne d'interface

Les colonnes, les valeurs réelles, les taux de remplissage. Le 30/09 : `club_teams.members` vaut 0
sur les 55 équipes, `couleur` est NULL partout — un écran fidèle au premier jet aurait affiché
« Effectif non renseigné » vingt-six fois de suite.

L'API Management s'exécute en `postgres` et répond oui à tout. Pour mesurer un droit, il faut le
jeton d'une vraie personne, ou `set local role authenticated` avec ses claims dans une transaction
annulée.

## 7. Ce qui manque se dit

Un écran vide explique **pourquoi** il est vide et **ce qu'il faut faire**. « Aucune donnée » tout
court fait téléphoner. Une panne de chargement ne se confond jamais avec un état vide : `Probleme`
d'un côté, `Vide` de l'autre.

## 8. Le téléphone, debout, en 4G

Les cibles font au moins `TOUCHE` (44 points). On pagine tout ce qui peut dépasser la cinquantaine
de lignes. On n'attend jamais un écran blanc : `useDonnees` (`src/lib/cache.ts`) affiche la dernière
réponse connue pendant qu'il relit.

## 9. Le français, et le vocabulaire de l'OS

Noms de variables, de fonctions et de fichiers en français. Les libellés à l'écran sont **ceux de
l'OS**, mot pour mot : une personne qui passe de l'ordinateur au téléphone doit retrouver les mêmes
mots au même endroit. Pas de tirets longs.

## 10. Les commentaires disent POURQUOI

Pas ce que fait la ligne — ça se lit. Ce qu'on a mesuré, ce qu'on a essayé et qui ne marchait pas,
la décision et sa raison. Un en-tête décrit une intention, un corps décrit un comportement : le
30/09, avoir cru l'en-tête d'une fonction sans lire son corps m'a fait affirmer le contraire de la
vérité à Fouka.
