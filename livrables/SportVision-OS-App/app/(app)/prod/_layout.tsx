// LES QUATRE ECRANS DU RESPONSABLE DE PRODUCTION (30/09/2026).
//
// UN SEUL ONGLET, QUATRE ECRANS DEDANS. Ils sont deux en production sur dix-huit comptes : leur
// donner quatre onglets aurait pousse la barre du bas a huit entrees, dont quatre vides pour les dix
// operateurs terrain. Le choix suit celui que `_layout.tsx` a deja fait pour « Production » contre
// « Mes missions » : le meme onglet, un contenu qui depend du metier.
//
// LA PILE PLUTOT QU'UNE SOUS-BARRE D'ONGLETS. Deux barres d'onglets empilees sur un telephone, c'est
// 100 points de hauteur perdus sur 800. Les quatre ecrans se joignent donc par une rangee de puces
// en haut, dessinee par `Barre` — la meme que les groupes du cockpit — et la navigation se fait en
// `replace` : on ne veut pas que six allers-retours entre « Livraisons » et « Materiel » construisent
// six retours arriere.
//
// `EcranProd` est expose ici, et pas dans un fichier voisin, POUR UNE RAISON DE ROUTAGE : dans ce
// dossier, expo-router fait une route de tout fichier sauf `_layout`. Un `cadre.tsx` deviendrait un
// ecran fantome joignable par une URL.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack, usePathname, useRouter } from "expo-router";
import { Ecran, Vide } from "../../../src/ui/Ecran";
import { Barre } from "../../../src/ui/Barre";
import { estProduction, useSession } from "../../../src/lib/session";
import { KITS_ACTIFS } from "../../../src/lib/modules";
import { C } from "../../../src/theme/couleurs";
import { P, T } from "../../../src/theme/polices";

export const unstable_settings = { initialRouteName: "affectation" };

export default function PileProduction() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Aucune animation : les quatre ecrans sont des onglets deguises, et une glissade
        // laterale ferait croire a une profondeur qui n'existe pas.
        animation: "none",
        contentStyle: { backgroundColor: C.fond },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="affectation" />
      <Stack.Screen name="livraisons" />
      <Stack.Screen name="equipe" />
      <Stack.Screen name="materiel" />
    </Stack>
  );
}

/**
 * Les ecrans, dans l'ordre du travail : on affecte, on suit, on regarde qui, puis avec quoi.
 *
 * « Materiel » n'apparait que si les kits sont allumes (`KITS_ACTIFS`, retires le 02/10/2026 sur
 * decision de Fouka). On filtre la liste plutot que de retirer la ligne : le jour ou les kits
 * reviennent, il n'y a rien a reecrire ni a replacer dans le bon ordre.
 */
const ECRANS = [
  { cle: "affectation", libelle: "Affectation" },
  { cle: "livraisons", libelle: "Livraisons" },
  { cle: "equipe", libelle: "Équipe" },
  ...(KITS_ACTIFS ? [{ cle: "materiel", libelle: "Matériel" }] : []),
];

/**
 * Le cadre commun aux quatre ecrans : le titre, la rangee de puces, et la barriere de metier.
 *
 * LA BARRIERE EST ICI, ET ELLE EXPLIQUE. Un community manager ou un operateur qui arriverait sur
 * ces ecrans par un lien ne verrait pas une page vide : la base lui refuserait tout, et un vide
 * muet se termine par un appel telephonique. On dit donc que l'ecran est celui de la production, et
 * a qui s'adresser (regles 5 et 7 du contrat).
 */
export function EcranProd({
  titre, sous, rafraichir, enCours, children,
}: {
  titre: string;
  sous?: string | null;
  rafraichir?: () => void;
  enCours?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const chemin = usePathname();
  const { moi } = useSession();
  const actif = ECRANS.find((e) => chemin.endsWith(`/${e.cle}`))?.cle ?? "affectation";

  if (!estProduction(moi?.role ?? null)) {
    return (
      <Ecran teinte="bleu">
        <Text style={s.titre}>Production</Text>
        <Vide
          titre="Cet écran est celui de la production"
          texte={
            "Affecter un opérateur, suivre les livraisons, voir qui est sur quoi : ces gestes " +
            "appartiennent au responsable de production et à l'administration. Si vous avez " +
            "besoin d'une affectation, demandez-la à la production."
          }
        />
      </Ecran>
    );
  }

  return (
    <Ecran teinte="bleu" rafraichir={rafraichir} enCours={enCours}>
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>{titre}</Text>
        {sous ? <Text style={s.sous}>{sous}</Text> : null}
      </View>

      <Barre
        choix={ECRANS}
        actif={actif}
        surChoix={(cle) => {
          if (cle === actif) return;
          router.replace(`/prod/${cle}` as never);
        }}
      />

      {children}
    </Ecran>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: T.titreEcran, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.sousEcran, lineHeight: T.sousEcranHauteur },
});
