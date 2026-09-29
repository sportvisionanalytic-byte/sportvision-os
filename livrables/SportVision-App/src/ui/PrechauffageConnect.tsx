// Ouvrir Connect sans attendre : on pose la session AVANT qu'on la demande (29/09/2026).
//
// LE PROBLEME MESURE. « Prestations », « Mes commandes », « Paiement collectif » sont des pages de
// Connect ouvertes dans une vue web. La PREMIERE de la session coute trois aller-retours : le pont
// qui se soumet, l'echange de session sur /auth/app, puis la page demandee. Fouka, le 29/09 :
// « quand je clique sur prestations, ca met un peu de temps a ouvrir ».
//
// Le raccourci existe depuis le 28/09 — une fois les cookies poses, les pages suivantes s'ouvrent
// en un seul aller-retour. Mais quelqu'un qui ouvre l'application et va droit aux prestations paie
// le plein tarif, chaque fois. Le raccourci ne servait qu'a partir de la deuxieme page.
//
// CE QU'ON FAIT. Une vue web invisible fait le pont une seule fois, peu apres l'ouverture de
// l'application, pendant que la personne regarde son accueil. Elle charge la page d'aide, la plus
// legere de Connect : les cookies sont poses, et le navigateur integre garde en cache le code
// commun a toutes les pages du site. La premiere vraie page devient donc la deuxieme.
//
// CE QU'ON NE FAIT PAS. On n'attend pas, on ne bloque rien, on n'affiche rien : si ca echoue,
// personne ne le voit et le premier ecran de Connect refait simplement le pont, comme avant. Un
// prechauffage qui casse quelque chose ne vaut pas la seconde qu'il economise.
//
// ET ON LIBERE. Des que les cookies sont poses, la vue web disparait : la garder en memoire pour
// rien, sur un telephone d'entree de gamme, se paierait ailleurs.
import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { useSession } from "../lib/session";
import {
  CONNECT, cookiesConnectDisponibles, marquerCookiesConnectPoses, sourceConnect,
  type SourceConnect,
} from "../lib/connect";

/** On laisse d'abord l'accueil s'afficher. Le prechauffage est un bonus, pas une priorite : il ne
 *  doit pas disputer le reseau aux ecrans que la personne regarde vraiment. */
const ATTENDRE_MS = 1500;

export function PrechauffageConnect() {
  const { session } = useSession();
  const [source, setSource] = useState<SourceConnect | null>(null);
  const [fini, setFini] = useState(false);
  const lance = useRef(false);

  useEffect(() => {
    if (!session || fini || lance.current || cookiesConnectDisponibles()) return;
    lance.current = true;
    let vivant = true;
    const minuteur = setTimeout(async () => {
      try {
        // Rend `null` s'il n'y a pas de vraie session — en demonstration, par exemple. On s'arrete
        // alors sans bruit.
        const s = await sourceConnect("aide");
        if (vivant && s) setSource(s);
      } catch { /* un prechauffage rate ne se signale pas */ }
    }, ATTENDRE_MS);
    return () => { vivant = false; clearTimeout(minuteur); };
  }, [session, fini]);

  if (!source || fini) return null;

  return (
    // Hors de l'ecran plutot que de taille nulle : une vue web de 0 par 0 ne charge pas toujours
    // sur iOS, et un prechauffage qui ne chauffe rien serait le pire des deux mondes.
    <View
      style={{ position: "absolute", left: -2000, top: 0, width: 1, height: 1, opacity: 0 }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <WebView
        source={source}
        style={{ flex: 1 }}
        // Une page de Connect atteinte hors de /auth/ : les cookies sont poses, le travail est fait.
        onNavigationStateChange={(etat) => {
          if (etat.loading) return;
          if (etat.url.startsWith(CONNECT) && !etat.url.includes("/auth/")) {
            marquerCookiesConnectPoses();
            setFini(true);
          }
        }}
        // Un echec ne se rattrape pas : le premier ecran de Connect refera le pont lui-meme.
        onError={() => setFini(true)}
        onHttpError={() => setFini(true)}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        // Rien n'est regarde ici : inutile de reclamer une couche materielle ou un lecteur media.
        androidLayerType="software"
        mediaPlaybackRequiresUserAction
      />
    </View>
  );
}
