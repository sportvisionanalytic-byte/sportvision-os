// L'accueil de l'espace personnel (22/09/2026).
//
// Trois choses, dans cet ordre : mon club, ce qui arrive, ce qui vient de se passer. Le site
// empilait des cartes optionnelles ; sur un telephone, ce qui n'est pas dans le premier ecran
// n'est pas lu.
//
// Le parent voit la meme chose, pour l'enfant qu'il a choisi. Ce n'est pas un second ecran ecrit
// en parallele : ce sont les memes blocs, nourris par la fonction de la base qui connait ses
// droits.
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "../../src/lib/session";
import { useFamille, lireCalendrierFamille } from "../../src/lib/famille";
import { derniersResultats, lireEvenements, prochain, type Evenement } from "../../src/lib/donnees";
import { Ecran, Section, Vide } from "../../src/ui/Ecran";
import { CarteEvenement, Ecusson } from "../../src/ui/Cartes";
import { BandeauEnfant, SelecteurEnfant } from "../../src/ui/Enfants";
import { Prochain } from "../../src/ui/Prochain";
import { C, E, R } from "../../src/theme/couleurs";

export default function Accueil() {
  const { profil, rafraichir } = useSession();
  const famille = useFamille();
  const router = useRouter();
  const parent = profil?.espace === "parent";
  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [chargement, setChargement] = useState(true);

  const clubId = parent ? famille.detail?.clubId : profil?.clubId;
  const clubNom = parent ? (famille.detail?.clubNom ?? famille.choisi?.clubNom) : profil?.clubNom;
  const clubLogo = parent ? famille.detail?.clubLogoUrl : profil?.clubLogoUrl;
  const affilie = parent ? famille.choisi?.enAttente === false : !!profil?.affilie;

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      if (parent) {
        // Le calendrier du parent passe par la fonction de la base, qui ne lui rend que les
        // enfants dont le lien est confirme. On filtre ensuite sur l'enfant regarde.
        const tout = await lireCalendrierFamille();
        const ref = famille.choisi?.refId;
        setEvenements(ref ? tout.filter((e) => e.sportifRef === ref) : tout);
      } else if (profil?.clubId) {
        setEvenements(await lireEvenements(profil.clubId));
      } else {
        setEvenements([]);
      }
    } finally { setChargement(false); }
  }, [parent, profil?.clubId, famille.choisi?.refId]);

  useEffect(() => { charger(); }, [charger]);

  const suivant = prochain(evenements);
  const resultats = derniersResultats(evenements);

  return (
    <Ecran enCours={chargement} teinte="bleu" rafraichir={() => { rafraichir(); famille.recharger(); charger(); }}>
      <View style={s.entete}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.bonjour}>Bonjour {profil?.prenom || ""}</Text>
          <Text style={s.sous}>
            {parent
              ? (famille.sportifs.length > 1 ? "Vos sportifs" : "Votre espace SportVision")
              : (profil?.equipeNom ? profil.equipeNom : "Votre espace SportVision")}
          </Text>
        </View>
        {clubNom ? <Ecusson url={clubLogo} nom={clubNom} taille={44} /> : null}
      </View>

      {parent ? (
        famille.chargement && !famille.sportifs.length ? (
          <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
        ) : famille.sportifs.length ? (
          <View style={{ gap: E.s }}>
            <SelecteurEnfant />
            <BandeauEnfant />
          </View>
        ) : (
          <Vide
            titre="Aucun sportif rattaché"
            texte="Demandez à votre club de vous rattacher à votre enfant, ou ajoutez-le depuis votre espace en ligne."
          />
        )
      ) : null}

      {clubNom ? (
        <View style={s.carteClub}>
          <Ecusson url={clubLogo} nom={clubNom} taille={52} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.label}>{parent ? "Son club" : "Mon club"}</Text>
            <Text style={s.nomClub} numberOfLines={2}>{clubNom}</Text>
          </View>
          <View style={[s.pastille, affilie ? s.pastilleOk : s.pastilleAttente]}>
            <Text style={[s.pastilleTexte, { color: affilie ? C.succes : C.alerte }]}>
              {affilie ? "Affilié" : "En attente"}
            </Text>
          </View>
        </View>
      ) : parent && famille.sportifs.length ? null : (
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
          <Prochain
            e={suivant}
            clubNom={clubNom}
            clubLogoUrl={clubLogo}
            onPress={() => router.push("/calendrier")}
          />
        ) : (
          <Vide
            titre="Rien de prévu pour l'instant"
            texte={
              clubId
                ? "Les matchs et les entraînements apparaîtront ici dès que le club les publie."
                : "Le calendrier se remplira dès que le club aura validé le rattachement."
            }
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
          <Text style={s.raccourciTitre}>{parent ? "Ses photos" : "Mes photos"}</Text>
          <Text style={s.sous}>Les galeries de l'équipe, match par match.</Text>
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
