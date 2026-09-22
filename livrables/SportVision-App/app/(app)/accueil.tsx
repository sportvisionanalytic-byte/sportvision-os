// L'accueil de l'espace personnel (22/09/2026).
//
// Trois choses, dans cet ordre : mon club, ce qui arrive, ce qui vient de se passer. Le site
// empilait des cartes optionnelles ; sur un telephone, ce qui n'est pas dans le premier ecran
// n'est pas lu.
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "../../src/lib/session";
import { derniersResultats, lireEvenements, prochain, type Evenement } from "../../src/lib/donnees";
import { Ecran, Section, Vide } from "../../src/ui/Ecran";
import { CarteEvenement, Ecusson } from "../../src/ui/Cartes";
import { C, E, R } from "../../src/theme/couleurs";

export default function Accueil() {
  const { profil, rafraichir } = useSession();
  const router = useRouter();
  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async () => {
    if (!profil?.clubId) { setEvenements([]); setChargement(false); return; }
    setChargement(true);
    try { setEvenements(await lireEvenements(profil.clubId)); }
    finally { setChargement(false); }
  }, [profil?.clubId]);

  useEffect(() => { charger(); }, [charger]);

  const suivant = prochain(evenements);
  const resultats = derniersResultats(evenements);

  return (
    <Ecran enCours={chargement} rafraichir={() => { rafraichir(); charger(); }}>
      <View style={s.entete}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.bonjour}>Bonjour {profil?.prenom || ""}</Text>
          <Text style={s.sous}>
            {profil?.equipeNom ? profil.equipeNom : "Votre espace SportVision"}
          </Text>
        </View>
        {profil?.clubNom ? <Ecusson url={profil.clubLogoUrl} nom={profil.clubNom} taille={44} /> : null}
      </View>

      {profil?.clubNom ? (
        <View style={s.carteClub}>
          <Ecusson url={profil.clubLogoUrl} nom={profil.clubNom} taille={52} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.label}>Mon club</Text>
            <Text style={s.nomClub} numberOfLines={2}>{profil.clubNom}</Text>
          </View>
          <View style={[s.pastille, profil.affilie ? s.pastilleOk : s.pastilleAttente]}>
            <Text style={[s.pastilleTexte, { color: profil.affilie ? C.succes : C.alerte }]}>
              {profil.affilie ? "Affilié" : "En attente"}
            </Text>
          </View>
        </View>
      ) : (
        <Vide
          titre="Rejoignez votre club"
          texte="Associez votre profil à votre club pour retrouver votre calendrier, vos résultats et vos photos."
        />
      )}

      <Section
        titre="Prochainement"
        action={
          <Pressable onPress={() => router.push("/calendrier")} hitSlop={8}>
            <Text style={s.lien}>Calendrier</Text>
          </Pressable>
        }
      >
        {chargement && !evenements.length ? (
          <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
        ) : suivant ? (
          <CarteEvenement e={suivant} onPress={() => router.push("/calendrier")} />
        ) : (
          <Vide
            titre="Rien de prévu pour l'instant"
            texte="Les matchs et les entraînements de votre équipe apparaîtront ici dès que le club les publie."
          />
        )}
      </Section>

      {resultats.length > 0 ? (
        <Section titre="Derniers résultats">
          <View style={{ gap: E.s }}>
            {resultats.map((e) => <CarteEvenement key={e.id} e={e} />)}
          </View>
        </Section>
      ) : null}

      <Pressable
        onPress={() => router.push("/photos")}
        style={({ pressed }) => [s.raccourci, pressed ? { opacity: 0.85 } : null]}
      >
        <View style={s.raccourciIcone}>
          <Ionicons name="images" size={20} color={C.accentClair} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.raccourciTitre}>Mes photos</Text>
          <Text style={s.sous}>Les galeries de votre équipe, match par match.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={C.texteFaible} />
      </Pressable>
    </Ecran>
  );
}

const s = StyleSheet.create({
  entete: { flexDirection: "row", alignItems: "center", gap: E.m },
  bonjour: { color: C.texte, fontSize: 25, fontWeight: "800", letterSpacing: -0.5 },
  sous: { color: C.texteDoux, fontSize: 13.5 },
  label: { color: C.cyan, fontSize: 10.5, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  nomClub: { color: C.texte, fontSize: 18, fontWeight: "700" },
  carteClub: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    backgroundColor: C.surfaceHaute, borderRadius: R.l, borderWidth: 1,
    borderColor: "rgba(34,211,238,.28)", padding: E.m,
  },
  pastille: { paddingHorizontal: E.s, paddingVertical: 5, borderRadius: R.pill },
  pastilleOk: { backgroundColor: "rgba(46,204,138,.14)" },
  pastilleAttente: { backgroundColor: "rgba(232,163,61,.14)" },
  pastilleTexte: { fontSize: 11.5, fontWeight: "700" },
  lien: { color: C.accentClair, fontSize: 13.5, fontWeight: "600" },
  attente: { paddingVertical: E.xl, alignItems: "center" },
  raccourci: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure, padding: E.m,
  },
  raccourciIcone: {
    width: 42, height: 42, borderRadius: R.m, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(79,125,255,.14)",
  },
  raccourciTitre: { color: C.texte, fontSize: 15.5, fontWeight: "700" },
});
