// Une page de Connect ouverte dans l'application, déjà connectée (24/09/2026).
//
// Version téléphone. Le web a sa propre version dans VueConnect.web.tsx, pour la même raison que
// VueWeb : react-native-webview n'existe pas sur le web, et sans cette séparation la
// démonstration en ligne affiche un message technique suivi d'un chargement sans fin.
//
// La différence avec VueWeb : la page est chargée en POST, avec les jetons de la session dans le
// corps de la requête. C'est ce qui évite de redemander un mot de passe à quelqu'un qui vient de
// le saisir. Voir src/lib/connect.ts pour le pourquoi du POST.
import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { Linking } from "react-native";
import { WebView } from "react-native-webview";
import { C } from "../theme/couleurs";
import type { SourceConnect } from "../lib/connect";

export interface PoigneeVueConnect {
  reculer: () => void;
  /** Charger une adresse dans CETTE vue, sans en ouvrir une seconde. */
  allerA: (url: string) => void;
}

export interface ProprietesVueConnect {
  source: SourceConnect;
  surHistorique: (peutReculer: boolean) => void;
  /** Chaque adresse traversee : l'ecran s'en sert pour reconnaitre /auth/login et refaire le pont. */
  surAdresse?: (url: string) => void;
  surChargement: () => void;
  surPanne: () => void;
}

export const VueConnect = forwardRef<PoigneeVueConnect, ProprietesVueConnect>(
  function VueConnect({ source, surHistorique, surAdresse, surChargement, surPanne }, ref) {
    const vue = useRef<WebView>(null);
    useImperativeHandle(ref, () => ({
      reculer: () => vue.current?.goBack(),
      // On passe par le JavaScript de la page : `injectJavaScript` garde les cookies et
      // l'historique, la ou recharger la source repartirait du pont.
      allerA: (url) => vue.current?.injectJavaScript(`location.href=${JSON.stringify(url)};true;`),
    }), []);

    return (
      <WebView
        ref={vue}
        source={source}
        style={{ flex: 1, backgroundColor: C.fond }}
        onError={surPanne}
        onHttpError={surPanne}
        // FILET. `onNavigationStateChange` ne rend pas toujours un dernier etat `loading: false`
        // selon la plateforme. Sans ce second chemin, l'esquisse resterait indefiniment sur une
        // page pourtant arrivee — une attente sans fin est pire qu'une erreur, parce qu'on ne
        // sait meme pas qu'il faut recommencer. On applique la meme regle : le pont ne compte pas.
        onLoadEnd={(e) => {
          const url = e?.nativeEvent?.url ?? "";
          if (url && !url.includes("/auth/app") && url !== "about:blank") {
            surAdresse?.(url);
            surChargement();
          }
        }}
        // ON N'ANNONCE « CHARGE » QU'A L'ARRIVEE, PAS AU DEPART (28/09/2026).
        //
        // `onLoadEnd` se declenche a CHAQUE fin de navigation, et la premiere est celle du pont —
        // une page vide qui se soumet toute seule, chargee en un clin d'oeil. L'esquisse
        // disparaissait donc tout de suite, et la personne regardait un ecran sombre et vide
        // pendant que l'echange de session puis la vraie page se chargeaient. C'est exactement ce
        // que Fouka decrit : « ca met du temps a charger, beaucoup trop de temps ». Le temps n'a
        // pas change, c'est ce qu'on montrait pendant ce temps qui etait faux.
        //
        // On garde donc l'esquisse tant que la navigation en cours est le pont ou l'echange de
        // session. Une esquisse qui reste, c'est une attente ; un ecran vide, c'est une panne.
        onNavigationStateChange={(etat) => {
          surHistorique(etat.canGoBack);
          surAdresse?.(etat.url);
          const enRoute = etat.loading
            || etat.url.includes("/auth/app")
            || etat.url === "about:blank"
            || etat.url === "";
          if (!enRoute) surChargement();
        }}
        // Android composait la page en logiciel : le defilement accrochait et chaque retour
        // repeignait tout. La couche materielle est faite pour ca.
        androidLayerType="hardware"
        // LES LIENS QUI OUVRENT UNE NOUVELLE FENETRE (29/09/2026).
        //
        // C'etait faux : « aucune de ces pages n'ouvre de seconde fenetre ». Club+ en ouvre
        // plusieurs — messages, galeries, documents, facturation — plus deux `window.open`. Avec
        // `setSupportMultipleWindows={false}` et aucun gestionnaire, la vue web les IGNORE
        // silencieusement : on appuie sur le lien, il ne se passe rien, et rien n'explique
        // pourquoi. C'est exactement le « j'arrive pas a bien naviguer » de Fouka.
        //
        // On les accepte donc, et on decide quoi en faire : ce qui appartient a SportVision se
        // charge DANS cette vue — la session y est deja, une seconde fenetre la perdrait — et le
        // reste part dans le navigateur du telephone, ou l'on sait revenir en arriere.
        setSupportMultipleWindows
        onOpenWindow={(e) => {
          const url = e?.nativeEvent?.targetUrl;
          if (!url) return;
          if (/^https:\/\/[a-z0-9-]*\.?sportvision-an\.fr/i.test(url)) {
            vue.current?.injectJavaScript(`location.href=${JSON.stringify(url)};true;`);
          } else {
            Linking.openURL(url).catch(() => { /* une adresse qu'aucune application ne sait ouvrir */ });
          }
        }}
        allowsBackForwardNavigationGestures
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        pullToRefreshEnabled
        // La reconnaissance a besoin de la caméra, et le navigateur intégré d'iOS refuse de la
        // lancer en plein écran sans ces deux réglages : la vidéo doit pouvoir s'afficher dans
        // la page, et démarrer sans que la personne appuie une deuxième fois. Sans eux, l'écran
        // reste noir et on croit que la caméra est cassée.
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
      />
    );
  },
);
