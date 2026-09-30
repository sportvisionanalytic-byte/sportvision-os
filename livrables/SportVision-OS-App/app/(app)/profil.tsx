// MON COMPTE (30/09/2026). Qui je suis, et la sortie. Rien de plus pour l'instant : tout ce qui
// se règle se règle dans l'OS, et dupliquer des formulaires ici en ferait deux à tenir à jour.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Ecran, Section } from "../../src/ui/Ecran";
import { Ecusson } from "../../src/ui/Ecusson";
import { useSession } from "../../src/lib/session";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

export default function Profil() {
  const { moi, deconnexion, session } = useSession();
  const nom = `${moi?.prenom ?? ""} ${moi?.nom ?? ""}`.trim();

  return (
    <Ecran teinte="violet">
      <View style={s.entete}>
        <Ecusson nom={nom || "Moi"} taille={52} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.titre} numberOfLines={1}>{nom || "Mon compte"}</Text>
          <Text style={s.sous} numberOfLines={1}>{moi?.metier ?? "SportVision"}</Text>
        </View>
      </View>

      <Section titre="Mon compte">
        <View style={s.bloc}>
          <Ligne libelle="Adresse e-mail" valeur={session?.user?.email ?? "—"} />
          <Ligne libelle="Rôle" valeur={moi?.metier ?? "—"} />
        </View>
      </Section>

      <Pressable
        onPress={deconnexion}
        accessibilityRole="button"
        accessibilityLabel="Se déconnecter"
        style={({ pressed }) => [s.sortie, pressed ? { opacity: 0.85 } : null]}
      >
        <View style={s.rond}><Ionicons name="log-out-outline" size={17} color={C.alerteTexte} /></View>
        <Text style={[s.sortieTexte, { color: C.alerteTexte }]}>Se déconnecter</Text>
      </Pressable>

      <Text style={s.pied}>
        Vos coordonnées bancaires et vos documents restent sur l'OS, depuis un ordinateur : ce
        sont des démarches qu'on ne fait pas debout, et l'application ne fait pas semblant.
      </Text>
    </Ecran>
  );
}

function Ligne({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <View style={s.ligne}>
      <Text style={s.libelle}>{libelle}</Text>
      <Text style={s.valeur} numberOfLines={1}>{valeur}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  entete: { flexDirection: "row", alignItems: "center", gap: E.m },
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 24, letterSpacing: -0.5 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5 },
  bloc: { borderRadius: R.l, backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure, overflow: "hidden" },
  ligne: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: E.m,
    paddingHorizontal: E.m, minHeight: TOUCHE + 6,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.bordure,
  },
  libelle: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13.5 },
  valeur: { flexShrink: 1, color: C.texte, fontFamily: P.texteFort, fontSize: 13.5, textAlign: "right" },
  sortie: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    minHeight: TOUCHE, paddingHorizontal: E.m, borderRadius: R.l,
    backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: C.bordure,
  },
  rond: {
    width: 32, height: 32, borderRadius: R.m, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.05)", borderWidth: 1, borderColor: C.bordure,
  },
  sortieTexte: { flex: 1, fontFamily: P.texte, fontSize: 15 },
  pied: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },
});
