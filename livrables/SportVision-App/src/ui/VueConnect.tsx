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
import { WebView } from "react-native-webview";
import { C } from "../theme/couleurs";
import type { SourceConnect } from "../lib/connect";

export interface PoigneeVueConnect {
  reculer: () => void;
}

export interface ProprietesVueConnect {
  source: SourceConnect;
  surHistorique: (peutReculer: boolean) => void;
  surChargement: () => void;
  surPanne: () => void;
}

export const VueConnect = forwardRef<PoigneeVueConnect, ProprietesVueConnect>(
  function VueConnect({ source, surHistorique, surChargement, surPanne }, ref) {
    const vue = useRef<WebView>(null);
    useImperativeHandle(ref, () => ({ reculer: () => vue.current?.goBack() }), []);

    return (
      <WebView
        ref={vue}
        source={source}
        style={{ flex: 1, backgroundColor: C.fond }}
        onLoadEnd={surChargement}
        onError={surPanne}
        onHttpError={surPanne}
        onNavigationStateChange={(etat) => surHistorique(etat.canGoBack)}
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
