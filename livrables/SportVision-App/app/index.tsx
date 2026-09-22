// L'aiguillage : on ne montre rien tant qu'on ne sait pas qui regarde.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { useSession } from "../src/lib/session";
import { porteMemorisee, type Porte } from "../src/lib/espaces";
import { C } from "../src/theme/couleurs";

export default function Aiguillage() {
  const { session, chargement } = useSession();
  const [porte, setPorte] = useState<Porte | null | undefined>(undefined);

  useEffect(() => { porteMemorisee().then(setPorte); }, []);

  if (chargement || porte === undefined) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.fond }}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  // Premiere ouverture : on demande de quel cote on se trouve, plutot que de deviner.
  if (porte === null) return <Redirect href="/bienvenue" />;
  if (porte !== "personnel") return <Redirect href={{ pathname: "/espace-web", params: { porte } }} />;
  return <Redirect href={session ? "/accueil" : "/connexion"} />;
}
