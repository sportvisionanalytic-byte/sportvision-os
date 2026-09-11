# Analyse d'impact relative à la protection des données (AIPD)

## Reconnaissance faciale au service du Pass photo « mon enfant » — SportVision

> **Document de travail, rédigé le 12/09/2026. À faire relire par un juriste avant toute mise en
> service.** Il n'engage pas SportVision tant qu'il n'est pas validé et signé. Il est écrit pour
> être lu par un club, un parent ou la CNIL, pas seulement par un développeur.

---

## 1. Pourquoi cette analyse est obligatoire

Le traitement envisagé réunit trois critères qui, pris ensemble, imposent une analyse d'impact au
sens de l'article 35 du RGPD :

- il porte sur des **données biométriques** destinées à identifier une personne (article 9.1) ;
- il concerne des **personnes vulnérables** : des mineurs, souvent de moins de 13 ans ;
- il repose sur un **traitement à grande échelle et systématique** : chaque galerie photo d'un club
  serait analysée automatiquement.

L'analyse doit donc exister **avant** la première photo analysée, être datée, et être mise à jour à
chaque évolution du traitement.

---

## 2. Le traitement, décrit simplement

**Ce que SportVision veut obtenir.** Qu'un parent qui achète le Pass photo reçoive les photos de
**son** enfant, et seulement les siennes. Aujourd'hui, une galerie achetée par un parent donne accès
à toutes les photos de l'équipe : rien n'empêche de les rediffuser aux autres familles, et le
travail du photographe se vend une fois pour vingt familles.

**Comment il fonctionnerait.**

1. Le parent (ou le joueur majeur) donne son accord dans SportVision Connect et dépose **une photo
   de référence** de son enfant.
2. SportVision calcule à partir de cette photo une **empreinte numérique** du visage.
3. À chaque nouvelle galerie du club, les photos sont comparées à ces empreintes.
4. Quand la correspondance est **très sûre**, la photo est rattachée à l'enfant automatiquement.
   En dessous de ce niveau, elle **attend la validation d'un humain** à la Production.
5. Le Pass photo « mon enfant » ouvre l'accès aux seules photos rattachées à cet enfant.

**Ce qu'il ne fait pas**, et ce point est central :

- il ne sert **jamais** à surveiller, à contrôler l'accès à un lieu, ni à identifier quelqu'un qui
  n'est pas inscrit dans le dispositif ;
- il ne crée **aucune base de visages** consultable : les empreintes ne sont ni exportables, ni
  visibles dans l'application, ni utilisées à d'autres fins ;
- il ne s'applique **jamais** à un enfant dont les parents n'ont pas donné leur accord.

---

## 3. Les personnes concernées et les données traitées

| Catégorie | Données | Origine | Conservation |
|---|---|---|---|
| Enfant inscrit au dispositif | Photo de référence, empreinte du visage, identité (prénom, nom, équipe) | Fournies par le parent | Effacées au retrait du consentement, et au plus tard à la fin de la saison sportive |
| Enfant photographié, non inscrit | Image du visage sur la photo, le temps de l'analyse | Photos de la prestation | **Aucune empreinte conservée** : le calcul est fait en mémoire et détruit immédiatement |
| Parent | Identité, adresse e-mail, trace du consentement (date, version du texte) | Compte Connect | 3 ans après la fin de la relation, comme preuve du consentement |

**Le point le plus sensible, dit franchement.** Pour retrouver l'enfant A sur une photo, le système
doit d'abord détecter **tous** les visages de cette photo, y compris ceux d'enfants dont les parents
n'ont rien accepté. C'est ce point qui rend le traitement délicat. Les mesures prévues au § 6 y
répondent : rien n'est conservé pour ces visages, aucune empreinte n'est créée, et le résultat de la
comparaison n'est gardé que pour les enfants inscrits.

---

## 4. La base légale

**Consentement explicite** (articles 6.1.a et 9.2.a), donné par le titulaire de l'autorité
parentale pour un mineur, ou par le joueur lui-même s'il est majeur.

Conditions à respecter pour que ce consentement soit valable :

- **libre** : le refus n'empêche ni l'achat des photos, ni l'accès à la galerie de l'équipe. Le
  parent qui refuse achète la galerie comme aujourd'hui ;
- **spécifique** : il porte sur la reconnaissance du visage de son enfant dans les galeries de son
  club, rien d'autre ;
- **éclairé** : le texte du § 8 est présenté avant tout dépôt de photo ;
- **révocable** : un bouton dans l'espace du parent, sans justification et sans délai. Le retrait
  efface la photo de référence et l'empreinte immédiatement.

Le consentement est enregistré avec sa date, son auteur et la version du texte accepté.

---

## 5. Les risques pour les personnes

| Risque | Ce qui peut arriver | Gravité | Probabilité |
|---|---|---|---|
| Mauvaise attribution | Une famille reçoit la photo d'un autre enfant | Élevée | Moyenne sans garde-fou |
| Détournement d'usage | Les empreintes servent à autre chose que les galeries | Élevée | Faible |
| Fuite des empreintes | Vol de la base | Élevée | Faible |
| Analyse d'un enfant non inscrit | Son visage est traité sans accord | Moyenne | Certaine sans mesure |
| Consentement mal donné | Un parent non titulaire de l'autorité parentale inscrit un enfant | Moyenne | Faible |
| Conservation trop longue | Des empreintes d'anciens joueurs subsistent | Moyenne | Moyenne sans purge |

---

## 6. Les mesures retenues

**Sur le principe**

1. **Aucune empreinte sans consentement accordé.** La base le refuse techniquement : une référence
   de visage ne peut pas être créée sans un consentement actif rattaché à l'enfant (v159).
2. **Le retrait efface tout de suite** la photo de référence, l'empreinte et les propositions non
   validées. Vérifié par un test automatique rejoué à chaque modification.
3. **Purge de fin de saison** : toutes les empreintes sont effacées, le consentement est à
   redonner pour la saison suivante.

**Sur l'exactitude**

4. **Attribution automatique seulement au-dessus d'un niveau de certitude élevé** ; en dessous, la
   proposition attend la validation d'un humain. Le seuil est réglable et journalisé.
5. **Une proposition de machine n'a aucun effet tant qu'elle n'est pas validée** : elle n'ouvre
   aucun accès, elle ne déclenche aucun envoi.
6. **Correction en un clic** : un parent qui voit une photo qui n'est pas son enfant la signale,
   la Production retire le rattachement, et l'incident est tracé.

**Sur la sécurité**

7. **Hébergement en Europe**, et, si le moteur est installé sur nos serveurs, aucune donnée
   biométrique ne sort de notre infrastructure.
8. **Aucune lecture applicative des empreintes** : ni le club, ni le coach, ni la famille, ni la
   Production n'y ont accès. Seule l'Administration peut les consulter, pour répondre à une demande
   d'accès ou de suppression.
9. **Analyse en mémoire** pour les visages non inscrits : aucune écriture, aucune conservation.
10. **Journal** de chaque décision (proposition, validation, retrait, purge), avec l'auteur et la date.

**Sur les droits des personnes**

11. Accès, rectification, effacement et retrait du consentement **depuis l'espace du parent**, sans
    passer par un formulaire ni attendre une réponse.
12. Information des clubs partenaires, pour qu'ils puissent répondre aux familles.

---

## 7. Ce qui reste à faire avant la mise en service

- [ ] Relecture de ce document et du texte de consentement par un juriste.
- [ ] Choix du moteur et, s'il est externe, contrat de sous-traitance (article 28) et hébergement UE.
- [ ] Registre des traitements mis à jour.
- [ ] Information des clubs partenaires et ajout à leur contrat.
- [ ] Test de bout en bout du retrait du consentement, preuve à l'appui.
- [ ] Décision écrite de Fouka sur le seuil d'attribution automatique retenu.

---

## 8. Position de SportVision

Le dispositif est construit pour servir les familles : payer pour les photos de son enfant, et non
pour celles de toute l'équipe. Il repose sur un accord explicite, il s'arrête au premier retrait, et
il ne conserve rien sur les enfants qui n'y sont pas inscrits. Si un club ou une famille refuse, le
service fonctionne comme avant, sans reconnaissance.
