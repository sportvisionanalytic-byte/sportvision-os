// LES ONGLETS DE L'OS (30/09/2026).
//
// CINQ ONGLETS, JAMAIS SIX, ET LE DEUXIÈME CHANGE DE MÉTIER. L'application sert deux populations
// très différentes : dix opérateurs terrain, qui viennent voir LEURS missions, et deux responsables
// de production, qui viennent voir CELLES DE TOUS. Le même emplacement, deux écrans — plutôt que
// dix onglets dont huit seraient vides pour chacun.
//
// POURQUOI CINQ ET PAS DIX. L'application compte dix écrans. Une barre à dix entrées sur un
// téléphone donne 39 points par onglet : le libellé y tient sur quatre lettres et la cible de
// l'index tombe sous les 44 points d'Apple. Cinq écrans sont donc DANS la barre, cinq derrière
// « Mon espace », et le partage n'est pas arbitraire : est dans la barre ce qu'on ouvre debout,
// plusieurs fois par jour. Les autres — mes revenus, le catalogue de formation, les galeries, les
// fiches du Centre — se consultent une fois par semaine, assis.
//
// LA RÉPARTITION DÉPEND DU MÉTIER, ET DE LUI SEUL. Un responsable de production n'a pas « Mon
// planning » dans sa barre : il a « Pilotage », les quatre écrans avec lesquels il affecte, suit
// les livraisons, son équipe et son matériel. Son propre planning est derrière « Mon espace », où
// il le consulte comme n'importe qui — mesuré : il porte 4 missions acceptées, l'écran lui sert.
// Un opérateur, lui, n'a pas « Pilotage » : la base le lui refuserait, et un onglet qui mène à un
// refus est un onglet de trop (règle 5 du contrat).
//
// CE QUI EST MASQUÉ RESTE JOIGNABLE, ET ON EN SORT. `href: null` retire l'entrée de la barre, pas
// la route : « Mon espace » y mène, et ces écrans portent la flèche de retour d'`Ecran`. Un écran
// qu'on atteint par un chemin et dont on ne sort que par un autre, c'est le piège du 28/09.
//
// AUCUNE VUE WEB, ET C'EST LA CONSIGNE. Fouka, le 30/09 : « je ne veux pas une vue web,
// justement. Je veux vraiment une application de l'OS. » L'application ne montre donc QUE ce
// qu'elle sait dessiner elle-même. Ce qu'elle ne couvre pas n'y est pas — plutôt qu'un onglet qui
// ouvre un site dans un cadre et qui trahit la promesse dès qu'on le touche.
//
// CE CHOIX EST TENABLE PARCE QUE L'OS N'EST PAS UN BLOC. Mesuré dans sa table `ROLES` : un
// opérateur y voit NEUF écrans, un responsable de production seize, un community manager neuf.
// Le secrétariat en voit vingt-six et la comptabilité vingt-huit — mais personne ne fait un
// rapprochement bancaire sur un téléphone. L'application couvre les métiers qui travaillent
// debout ; les autres restent sur un ordinateur, et c'est le bon outil.
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { estProduction, useSession } from "../../src/lib/session";
import { C, E } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

export default function Onglets() {
  const { session, moi, chargement } = useSession();

  if (chargement) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.fond }}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }
  // Barrière unique : aucun écran n'est atteignable sans session, quelle que soit la façon dont on
  // y arrive — un lien, une notification, un retour d'arrière-plan.
  if (!session) return <Redirect href="/connexion" />;

  const production = estProduction(moi?.role ?? null);
  // Une valeur, pas deux : masquer un onglet et le lister dans « Mon espace » sont les deux faces
  // du même choix. `profil.tsx` relit `estProduction` pour la même raison.
  const masque = { href: null as null };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.accentClair,
        tabBarInactiveTintColor: C.texteDoux,
        // La barre flotte au-dessus du contenu, comme dans l'application des familles : le contenu
        // passe dessous en transparence plutôt que de s'arrêter net sur un bandeau opaque.
        tabBarStyle: {
          position: "absolute",
          backgroundColor: "transparent",
          borderTopColor: C.bordure,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0,
        },
        tabBarBackground: () => (
          <BlurView tint="dark" intensity={34} style={StyleSheet.absoluteFill}>
            <View style={{ flex: 1, backgroundColor: "rgba(7,11,24,.72)" }} />
          </BlurView>
        ),
        tabBarLabelStyle: { fontSize: 11, fontFamily: P.texteFort, marginBottom: 2 },
        tabBarItemStyle: { paddingTop: E.xs },
        sceneStyle: { backgroundColor: C.fond },
      }}
    >
      {/* L'ACCUEIL EN PREMIER, ET SOUS SON NOM DE L'OS. C'est `dash`, que l'OS intitule « Accueil »
          pour l'opérateur comme pour la production — et non « Tableau de bord », qui est le mot des
          rôles de bureau. L'onglet est le même pour les deux métiers, l'écran change dedans. */}
      <Tabs.Screen
        name="accueil"
        options={{
          title: "Accueil",
          tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="missions"
        options={{
          title: production ? "Production" : "Mes missions",
          // « MES MISSI… » ÉTAIT AFFICHÉ SUR LE TÉLÉPHONE (01/10/2026, vu à l'écran). Cinq onglets
          // sur 402 points laissent 80 points par libellé : « Mes missions » n'y tient pas et iOS
          // le coupe. Un mot tronqué dans une barre d'onglets est un bug, pas une mise en page — on
          // ne sait plus si on lit un libellé rogné ou un écran mal chargé.
          //
          // `title` reste « Mes missions » : c'est le nom de l'écran, celui que la lecture vocale
          // annonce et celui de l'OS. Seule l'étiquette de la barre raccourcit, et elle garde le
          // mot de l'OS.
          tabBarLabel: production ? "Production" : "Missions",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={production ? "grid" : "calendar"} color={color} size={size} />
          ),
        }}
      />
      {/* LA TROISIÈME PLACE SE PARTAGE ENTRE DEUX MÉTIERS.

          Pour qui va sur le terrain : « Mon planning », l'écran `planning` du rôle photo. C'est le
          seul endroit où l'on lit l'heure de rendez-vous et l'adresse d'une prestation à venir.

          Pour qui pilote : « Pilotage », les quatre écrans du responsable de production. L'onglet
          ne s'appelle pas « Production », qui est déjà le libellé du cockpit juste avant. */}
      <Tabs.Screen
        name="planning"
        options={{
          title: "Planning",
          tabBarIcon: ({ color, size }) => <Ionicons name="list" color={color} size={size} />,
          ...(production ? masque : null),
        }}
      />
      <Tabs.Screen
        name="prod"
        options={{
          title: "Pilotage",
          tabBarIcon: ({ color, size }) => <Ionicons name="options" color={color} size={size} />,
          ...(production ? null : masque),
        }}
      />
      {/* LA MESSAGERIE EST DANS LA BARRE POUR TOUT LE MONDE, et c'est le seul écran dont on peut
          dire ça sans réserve : cinq métiers sur six l'ont dans l'OS, et c'est le seul endroit où
          un opérateur au bord d'un terrain joint le responsable de production. Un message qu'on
          reçoit et qu'on met deux gestes à trouver, c'est un message auquel on ne répond pas. */}
      <Tabs.Screen
        name="messagerie"
        options={{
          title: "Messages",
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profil"
        options={{
          title: "Mon espace",
          tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color} size={size} />,
        }}
      />

      {/* LES QUATRE ÉCRANS DE « MON ESPACE ». Hors de la barre pour tout le monde, joignables par
          `profil.tsx`, et chacun porte sa flèche de retour. */}
      <Tabs.Screen name="revenus" options={masque} />
      <Tabs.Screen name="formation" options={masque} />
      <Tabs.Screen name="galeries" options={masque} />
      <Tabs.Screen name="centre" options={masque} />

      {/* LE MODE JOUR J N'EST NI UN ONGLET NI UNE ENTRÉE DE « MON ESPACE » (01/10/2026).
          C'est l'écran d'UNE mission : il n'a aucun sens sans savoir laquelle. L'OS fait le même
          choix — son Mode Jour J s'ouvre depuis la carte d'une prestation (`enterJourJ(p.id)`),
          jamais depuis un menu. On y entre donc depuis l'accueil, le planning ou « Mes missions »,
          et il porte sa propre barre de retour : ce n'est pas un onglet, il n'en a pas besoin.

          ET LA BARRE DU BAS DISPARAÎT DESSUS. Deux raisons, et la seconde est un défaut évité :

          · L'OS en fait un OVERLAY PLEIN ÉCRAN (`#mob-jourj`, `position:fixed; inset:0;
            z-index:9999`) qui recouvre sa navigation. Sur le terrain on ne navigue pas, on agit.
          · Cet écran pose son geste dans un pied de page fixe, comme l'OS (`.jj-m-foot`). Sans
            cette ligne, la barre d'onglets — elle aussi en position absolue, elle aussi collée en
            bas — passerait PAR-DESSUS le bouton : le seul bouton de l'écran, et le seul qui
            compte, serait à moitié sous « Accueil » et « Mes missions ». */}
      <Tabs.Screen name="terrain" options={{ href: null, tabBarStyle: { display: "none" } }} />
      {/* « MES LIVRABLES » EST HORS DE LA BARRE, ET C'EST UN ARBITRAGE (01/10/2026).
          C'est le geste qui déclenche le paiement d'un opérateur, donc le plus important de sa
          semaine — mais il le fait UNE FOIS par mission, assis, au retour du terrain, une fois les
          fichiers copiés sur son disque. La barre porte ce qu'on ouvre debout plusieurs fois par
          jour. Faire passer un onglet à la trappe pour celui-ci aurait coûté « Mon planning » ou la
          messagerie, qu'on ouvre l'un et l'autre au bord d'un terrain. Il est donc dans « Mon
          espace », comme les cinq autres, et il porte sa flèche de retour. */}
      <Tabs.Screen name="livrables" options={masque} />
    </Tabs>
  );
}
