// Rouvrir l'application avec son visage ou son doigt (24/09/2026).
//
// CE QUE ÇA FAIT, ET SURTOUT CE QUE ÇA NE FAIT PAS
//
// Ce n'est pas une façon de se connecter. La session existe déjà — elle a été obtenue par mot de
// passe et elle survit à la fermeture de l'application, comme avant. Face ID ne fait qu'ajouter
// un verrou devant : tant qu'il n'est pas levé, les écrans restent masqués.
//
// La distinction compte. Si Face ID ouvrait la session, alors un téléphone déverrouillé par
// quelqu'un d'autre donnerait accès au compte, et un appareil sans Face ID n'aurait aucun moyen
// d'entrer. Ici, le mot de passe reste la seule clé, et le verrou n'est qu'une protection de
// plus, que chacun choisit.
//
// AUCUNE DONNÉE BIOMÉTRIQUE NE NOUS PARVIENT. iOS et Android répondent oui ou non, rien d'autre.
// Le visage ne quitte jamais la puce sécurisée du téléphone, et SportVision n'en voit rien —
// c'est vrai pour ce verrou, et c'est une autre histoire que la reconnaissance du joueur sur les
// photos, qui est un tout autre sujet avec son propre consentement.
//
// POURQUOI LE CHOIX VIT DANS AsyncStorage ET PAS EN BASE : il concerne CE téléphone. Quelqu'un
// qui active Face ID sur son iPhone n'a aucune raison de le voir s'activer sur la tablette de la
// maison, que toute la famille utilise.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Biometrie from "expo-local-authentication";

const CLE = "sportvision.verrou";

interface EtatBiometrie {
  /** L'appareil sait-il faire, et une empreinte y est-elle enregistrée ? */
  disponible: boolean;
  /** Le nom que la personne connaît : « Face ID », « Touch ID », « empreinte ». */
  nom: string;
  /** Le verrou est-il activé sur cet appareil ? */
  active: boolean;
  /** Faut-il masquer les écrans en attendant que le verrou soit levé ? */
  verrouille: boolean;
  activer: () => Promise<boolean>;
  desactiver: () => Promise<void>;
  demander: () => Promise<boolean>;
}

const Ctx = createContext<EtatBiometrie>({
  disponible: false, nom: "", active: false, verrouille: false,
  activer: async () => false, desactiver: async () => {}, demander: async () => false,
});

export const useBiometrie = () => useContext(Ctx);

async function nomDuCapteur(): Promise<string> {
  const types = await Biometrie.supportedAuthenticationTypesAsync();
  if (Platform.OS === "ios") {
    return types.includes(Biometrie.AuthenticationType.FACIAL_RECOGNITION) ? "Face ID" : "Touch ID";
  }
  if (types.includes(Biometrie.AuthenticationType.FACIAL_RECOGNITION)) return "reconnaissance du visage";
  return "empreinte digitale";
}

export function FournisseurBiometrie({ children }: { children: React.ReactNode }) {
  const [disponible, setDisponible] = useState(false);
  const [nom, setNom] = useState("");
  const [active, setActive] = useState(false);
  const [verrouille, setVerrouille] = useState(false);

  useEffect(() => {
    (async () => {
      // Deux conditions, et les confondre est le piège classique : un téléphone peut avoir un
      // capteur (`hasHardwareAsync`) sans qu'aucune empreinte n'y soit enregistrée
      // (`isEnrolledAsync`). Proposer Face ID dans ce cas mène à un échec incompréhensible.
      const [materiel, enregistre] = await Promise.all([
        Biometrie.hasHardwareAsync(),
        Biometrie.isEnrolledAsync(),
      ]);
      const ok = materiel && enregistre;
      setDisponible(ok);
      if (ok) setNom(await nomDuCapteur());

      const choisi = (await AsyncStorage.getItem(CLE).catch(() => null)) === "1";
      setActive(ok && choisi);
      // Au démarrage, si le verrou est posé, il est fermé. C'est tout l'intérêt.
      setVerrouille(ok && choisi);
    })();
  }, []);

  const demander = useCallback(async () => {
    const r = await Biometrie.authenticateAsync({
      promptMessage: "Ouvrir SportVision",
      // On garde le code du téléphone comme porte de secours : un visage qui ne passe pas au
      // bord d'un terrain, en plein soleil, ne doit pas enfermer quelqu'un dehors.
      disableDeviceFallback: false,
      cancelLabel: "Annuler",
    });
    if (r.success) setVerrouille(false);
    return r.success;
  }, []);

  const activer = useCallback(async () => {
    // On vérifie AVANT d'enregistrer le choix : activer un verrou qu'on n'arrive pas à lever,
    // c'est se fermer la porte au nez.
    const r = await Biometrie.authenticateAsync({
      promptMessage: "Activer le verrouillage de SportVision",
      disableDeviceFallback: false,
      cancelLabel: "Annuler",
    });
    if (!r.success) return false;
    await AsyncStorage.setItem(CLE, "1").catch(() => {});
    setActive(true);
    setVerrouille(false);
    return true;
  }, []);

  const desactiver = useCallback(async () => {
    await AsyncStorage.removeItem(CLE).catch(() => {});
    setActive(false);
    setVerrouille(false);
  }, []);

  // Refermer le verrou quand l'application part en arrière-plan : sans ça, il ne servirait
  // qu'au tout premier démarrage, et n'importe qui reprenant le téléphone posé sur la table
  // retrouverait l'écran ouvert.
  useEffect(() => {
    if (!active) return;
    const sub = AppState.addEventListener("change", (etat) => {
      if (etat === "background") setVerrouille(true);
    });
    return () => sub.remove();
  }, [active]);

  const valeur = useMemo<EtatBiometrie>(
    () => ({ disponible, nom, active, verrouille, activer, desactiver, demander }),
    [disponible, nom, active, verrouille, activer, desactiver, demander],
  );

  return <Ctx.Provider value={valeur}>{children}</Ctx.Provider>;
}
