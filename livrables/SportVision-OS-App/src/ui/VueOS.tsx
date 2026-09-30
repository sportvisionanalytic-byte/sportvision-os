// L'OS DANS L'APPLICATION, DÉJÀ CONNECTÉ (30/09/2026).
//
// L'OS est une page unique, servie par Netlify, qui lit sa session dans `localStorage` — cinq
// clés, `sv_tok`, `sv_ref`, `sv_uid`, `sv_role`, `sv_prenom`. C'est ainsi qu'il a toujours
// fonctionné, et c'est aussi comme ça que la suite de tests l'ouvre avec l'identité d'une vraie
// personne (`tests/_session-os.mjs`).
//
// ON POSE DONC LES CINQ CLÉS AVANT QUE LA PAGE NE SE CHARGE. `injectedJavaScriptBeforeContentLoaded`
// s'exécute avant les scripts du document, exactement comme `addInitScript` côté Playwright : l'OS
// démarre connecté, sans écran de connexion, sans aller-retour.
//
// PAS DE PONT PAR COOKIE ICI, contrairement à Club+ : l'OS ne lit aucun cookie, et un pont qui
// n'a pas lieu d'être est une chose de plus qui peut casser.
import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { WebView } from "react-native-webview";
import { C } from "../theme/couleurs";

export interface PoigneeVueOS {
  reculer: () => void;
  /** Recharger la page, après une action faite en natif qui change ce qu'elle affiche. */
  recharger: () => void;
}

export interface SessionOS {
  jeton: string;
  rafraichissement: string;
  uid: string;
  role: string;
  prenom: string;
}

/**
 * Le script d'amorçage.
 *
 * `JSON.stringify` sur chaque valeur, et pas une concaténation : un prénom avec une apostrophe —
 * « N'Diaye » — casserait le script et l'OS s'ouvrirait déconnecté, sans que rien ne le dise.
 */
function amorce(s: SessionOS): string {
  return `(function(){try{
    localStorage.setItem('sv_tok', ${JSON.stringify(s.jeton)});
    localStorage.setItem('sv_ref', ${JSON.stringify(s.rafraichissement)});
    localStorage.setItem('sv_uid', ${JSON.stringify(s.uid)});
    localStorage.setItem('sv_role', ${JSON.stringify(s.role)});
    localStorage.setItem('sv_prenom', ${JSON.stringify(s.prenom)});
  }catch(e){}})(); true;`;
}

export const VueOS = forwardRef<PoigneeVueOS, {
  adresse: string;
  session: SessionOS;
  surHistorique?: (peutReculer: boolean) => void;
  surChargement?: () => void;
  surPanne?: () => void;
}>(function VueOS({ adresse, session, surHistorique, surChargement, surPanne }, ref) {
  const vue = useRef<WebView>(null);
  useImperativeHandle(ref, () => ({
    reculer: () => vue.current?.goBack(),
    recharger: () => vue.current?.reload(),
  }), []);

  return (
    <WebView
      ref={vue}
      source={{ uri: adresse }}
      style={{ flex: 1, backgroundColor: C.fond }}
      injectedJavaScriptBeforeContentLoaded={amorce(session)}
      onLoadEnd={surChargement}
      onError={surPanne}
      onHttpError={surPanne}
      onNavigationStateChange={(etat) => surHistorique?.(etat.canGoBack)}
      allowsBackForwardNavigationGestures
      // L'OS téléverse des médias et ouvre des documents : sans ça, les boutons de fichier ne
      // répondent pas, et on croit l'écran cassé.
      allowFileAccess
      originWhitelist={["https://*"]}
    />
  );
});
