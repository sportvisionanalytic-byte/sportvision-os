// LE MOUVEMENT, ET SA DOSE (01/10/2026).
//
// « Il faut que ça soit vivant » (Fouka, 30/09). Vivant ne veut pas dire animé : une application
// qui bouge tout le temps fatigue en trois jours, et au bord d'un terrain, sous le soleil, avec des
// gants, une animation qui retarde un appui devient un bug.
//
// LA DOSE QU'ON S'AUTORISE, ET RIEN DE PLUS :
//
//   · une apparition à l'arrivée sur un écran, 260 ms, une fois ;
//   · une pression qui répond, immédiate, sur ce qu'on touche.
//
// PAS de boucle, PAS de rotation permanente, PAS d'animation qui retarde une action : l'appui
// déclenche le travail tout de suite, l'image suit.
//
// `useNativeDriver` partout : sans lui, chaque image de l'animation passe par le fil JavaScript, et
// une liste qui se charge au même moment fait saccader l'apparition. Opacité et translation sont
// justement les deux propriétés que le pilote natif sait porter.
//
// PREFERS-REDUCED-MOTION SE LIT, ET EN RÉACT NATIVE AUSSI : `AccessibilityInfo.isReduceMotionEnabled`
// rend le réglage « Réduire les animations » d'iOS et d'Android. Quand il est actif, on ne
// ralentit pas l'animation, on la SUPPRIME : le contenu est posé à sa place, opaque, dès la
// première image. Une personne qui a coupé les animations ne veut pas d'une version douce, elle
// veut qu'il n'y en ait pas.
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, type ViewStyle } from "react-native";

/** Le réglage système « Réduire les animations », et ses changements en cours de route. */
export function useMouvementReduit(): boolean {
  const [reduit, setReduit] = useState(false);

  useEffect(() => {
    let vivant = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (vivant) setReduit(!!v); });
    const abo = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setReduit(!!v));
    return () => { vivant = false; abo.remove(); };
  }, []);

  return reduit;
}

/**
 * Une apparition : le contenu monte de dix points en se révélant. Une fois, au montage.
 *
 * `decalage` sert à faire arriver deux blocs l'un après l'autre. On reste sous 120 ms au total :
 * au-delà, on attend l'écran au lieu de le regarder apparaître.
 */
export function Apparition({
  children, decalage = 0, style,
}: {
  children: React.ReactNode;
  decalage?: number;
  style?: ViewStyle;
}) {
  const reduit = useMouvementReduit();
  // La valeur démarre à 1 quand le mouvement est réduit : l'animation n'est jamais jouée, et le
  // contenu n'a pas une seule image de transparence.
  const avancement = useRef(new Animated.Value(reduit ? 1 : 0)).current;

  useEffect(() => {
    if (reduit) { avancement.setValue(1); return; }
    const a = Animated.timing(avancement, {
      toValue: 1, duration: 260, delay: decalage, useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [reduit, decalage, avancement]);

  return (
    <Animated.View
      style={[
        {
          opacity: avancement,
          transform: [{
            translateY: avancement.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
          }],
        },
        style as never,
      ]}
    >
      {children}
    </Animated.View>
  );
}
