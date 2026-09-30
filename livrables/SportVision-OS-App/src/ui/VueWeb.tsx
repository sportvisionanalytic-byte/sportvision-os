// L'espace club et l'espace production, ouverts dans l'application (22/09/2026).
//
// Version téléphone. Le web a sa propre version dans VueWeb.web.tsx : Metro choisit le fichier
// selon la plateforme, et react-native-webview n'entre donc JAMAIS dans le paquet web. C'est la
// façon propre de régler ce que la relecture a vu : « React Native WebView does not support this
// platform », un message technique affiché à un visiteur, suivi d'un chargement sans fin.
import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { WebView } from "react-native-webview";
import { C } from "../theme/couleurs";

export interface PoigneeVueWeb {
  /** Revenir en arrière dans l'historique de la page ouverte. */
  reculer: () => void;
}

export interface ProprietesVueWeb {
  adresse: string;
  /** Prévient quand un retour en arrière devient possible, pour allumer le bouton. */
  surHistorique: (peutReculer: boolean) => void;
  surChargement: () => void;
  /** Non utilisé sur téléphone : le retour au choix d'espace vit dans la barre. */
  surRetourChoix: () => void;
}

export const VueWeb = forwardRef<PoigneeVueWeb, ProprietesVueWeb>(function VueWeb(
  { adresse, surHistorique, surChargement },
  ref,
) {
  const vue = useRef<WebView>(null);
  useImperativeHandle(ref, () => ({ reculer: () => vue.current?.goBack() }), []);

  return (
    <WebView
      ref={vue}
      source={{ uri: adresse }}
      style={{ flex: 1, backgroundColor: C.fond }}
      onLoadEnd={surChargement}
      onNavigationStateChange={(etat) => surHistorique(etat.canGoBack)}
      // Le geste de bord, en plus du bouton : sur iOS, c'est le réflexe naturel pour revenir.
      allowsBackForwardNavigationGestures
      sharedCookiesEnabled
      // La session du site doit survivre à la fermeture de l'application, sinon il faut se
      // reconnecter à chaque ouverture.
      thirdPartyCookiesEnabled
      domStorageEnabled
      pullToRefreshEnabled
    />
  );
});
