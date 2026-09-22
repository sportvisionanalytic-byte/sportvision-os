// L'accueil de l'espace personnel (22/09/2026, refonte).
//
// L'ordre répond aux questions qu'on se pose en ouvrant l'application, dans l'ordre où on se les
// pose : c'est quand le prochain match, où sont mes photos, et qu'est-ce qu'on a fait la dernière
// fois. Tout le reste attend son onglet.
//
// Le parent voit la même chose, pour l'enfant qu'il a choisi. Ce ne sont pas deux écrans écrits en
// parallèle : ce sont les mêmes blocs, nourris par la fonction de la base qui connaît ses droits.
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "../../src/lib/session";
import { useFamille, lireCalendrierFamille } from "../../src/lib/famille";
import {
  derniersResultats, lireEvenements, lireGaleries, prochain,
  type Evenement, type Galerie,
} from "../../src/lib/donnees";
import { dateLongue } from "../../src/lib/dates";
import { FOND_MATCH_DEMO, MODE_DEMO } from "../../src/lib/demonstration";
import { Ecran, Section, Vide } from "../../src/ui/Ecran";
import { CarteEvenement, Ecusson } from "../../src/ui/Cartes";
import { BandeauEnfant, SelecteurEnfant } from "../../src/ui/Enfants";
import { Prochain } from "../../src/ui/Prochain";
import { Raccourcis } from "../../src/ui/Raccourcis";
import { Pastille } from "../../src/ui/Base";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

export default function Accueil() {
  const { profil, rafraichir } = useSession();
  const famille = useFamille();
  const router = useRouter();
  const parent = profil?.espace === "parent";

  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [galerie, setGalerie] = useState<Galerie | null>(null);
  const [chargement, setChargement] = useState(true);

  const clubId = parent ? famille.detail?.clubId : profil?.clubId;
  const clubNom = parent ? (famille.detail?.clubNom ?? famille.choisi?.clubNom) : profil?.clubNom;
  const clubLogo = parent ? famille.detail?.clubLogoUrl : profil?.clubLogoUrl;
  const equipeId = parent ? famille.detail?.equipeId : profil?.equipeId;
  const saisonId = parent ? (famille.detail?.saisonId ?? null) : (profil?.saisonId ?? null);
  const playerId = parent
    ? (famille.choisi?.kind === "club" ? famille.choisi.refId : undefined)
    : profil?.playerId;
  const affilie = parent ? famille.choisi?.enAttente === false : !!profil?.affilie;

  const charger = useCallback(async () => {
    setChargement(true);
    try {
      if (parent) {
        // Le calendrier du parent passe par la fonction de la base, qui ne lui rend que les
        // enfants dont le lien est confirmé. On filtre ensuite sur l'enfant regardé.
        const tout = await lireCalendrierFamille();
        const ref = famille.choisi?.refId;
        setEvenements(ref ? tout.filter((e) => e.sportifRef === ref) : tout);
      } else if (profil?.clubId) {
        setEvenements(await lireEvenements(profil.clubId));
      } else {
        setEvenements([]);
      }

      // La dernière galerie publiée, une seule : l'accueil annonce, l'onglet Photos détaille.
      if (clubId && equipeId) {
        const galeries = await lireGaleries(clubId, equipeId, saisonId, playerId);
        setGalerie(galeries[0] ?? null);
      } else {
        setGalerie(null);
      }
    } finally { setChargement(false); }
  }, [parent, profil?.clubId, famille.choisi?.refId, clubId, equipeId, saisonId, playerId]);

  useEffect(() => { charger(); }, [charger]);

  const suivant = prochain(evenements);
  const resultats = derniersResultats(evenements, 2);

  return (
    <Ecran enCours={chargement} teinte="bleu" rafraichir={() => { rafraichir(); famille.recharger(); charger(); }}>
      <View style={s.entete}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.bonjour}>Bonjour {profil?.prenom || ""}</Text>
          <Text style={s.sous} numberOfLines={1}>
            {[parent ? famille.choisi?.prenom : profil?.equipeNom, clubNom].filter(Boolean).join(" · ")
              || "Votre espace SportVision"}
          </Text>
        </View>
        {clubNom ? <Ecusson url={clubLogo} nom={clubNom} taille={46} /> : null}
      </View>

      {parent && famille.sportifs.length > 1 ? (
        <View style={{ gap: E.s }}>
          <SelecteurEnfant />
          <BandeauEnfant />
        </View>
      ) : null}

      {parent && !famille.chargement && !famille.sportifs.length ? (
        <Vide
          titre="Aucun sportif rattaché"
          texte="Demandez à votre club de vous rattacher à votre enfant, ou ajoutez-le depuis votre espace en ligne."
        />
      ) : null}

      {!clubNom && !parent ? (
        <Vide
          titre="Rejoignez votre club"
          texte="Associez votre profil à votre club pour retrouver votre calendrier, vos résultats et vos photos."
        />
      ) : null}

      <Section
        titre="Prochainement"
        action={
          <Pressable onPress={() => router.push("/calendrier")} hitSlop={10}>
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
            fond={MODE_DEMO ? FOND_MATCH_DEMO : null}
            onPress={() =>
              suivant.genre === "match"
                ? router.push({ pathname: "/match/[id]", params: { id: suivant.id } })
                : router.push("/calendrier")
            }
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

      <Raccourcis
        elements={[
          { icone: "calendar", libelle: "Calendrier", teinte: C.cyan, onPress: () => router.push("/calendrier") },
          { icone: "images", libelle: parent ? "Ses photos" : "Mes photos", teinte: C.accentClair, onPress: () => router.push("/photos") },
          { icone: "trophy", libelle: "Résultats", teinte: C.violet, onPress: () => router.push({ pathname: "/calendrier", params: { filtre: "match" } }) },
        ]}
      />

      {galerie ? (
        <Section
          titre="Dernière galerie"
          action={
            <Pressable onPress={() => router.push("/photos")} hitSlop={10}>
              <Text style={s.lien}>Tout voir</Text>
            </Pressable>
          }
        >
          <Pressable
            onPress={() => playerId
              ? router.push({ pathname: "/galerie/[id]", params: { id: galerie.id, titre: galerie.titre, joueur: playerId, ouverte: galerie.ouverte ? "1" : "0" } })
              : router.push("/photos")}
            style={({ pressed }) => [s.galerie, pressed ? { opacity: 0.85 } : null]}
          >
            {galerie.apercuUrl ? (
              <Image source={{ uri: galerie.apercuUrl }} style={s.vignette} contentFit="cover" transition={160} />
            ) : (
              <View style={[s.vignette, s.vignetteVide]}>
                <Ionicons name="images-outline" size={20} color={C.texteFaible} />
              </View>
            )}
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.galerieTitre} numberOfLines={2}>{galerie.titre}</Text>
              <Text style={s.detail} numberOfLines={1}>
                {[galerie.date ? dateLongue(galerie.date) : null, `${galerie.nbPhotos} photos`].filter(Boolean).join(" · ")}
              </Text>
              {galerie.mesPhotos ? (
                <Pastille
                  ton="info"
                  texte={`${galerie.mesPhotos} photo${galerie.mesPhotos > 1 ? "s" : ""} ${parent ? `de ${famille.choisi?.prenom ?? "lui"}` : "de vous"}`}
                />
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.texteFaible} />
          </Pressable>
        </Section>
      ) : null}

      {resultats.length ? (
        <Section
          titre="Derniers résultats"
          action={
            <Pressable onPress={() => router.push({ pathname: "/calendrier", params: { filtre: "match" } })} hitSlop={10}>
              <Text style={s.lien}>Tout voir</Text>
            </Pressable>
          }
        >
          <View style={{ gap: E.s }}>
            {resultats.map((e) => (
              <CarteEvenement
                key={e.id}
                e={e}
                onPress={() => router.push({ pathname: "/match/[id]", params: { id: e.id } })}
              />
            ))}
          </View>
        </Section>
      ) : null}

      {clubNom ? (
        <View style={s.carteClub}>
          <Ecusson url={clubLogo} nom={clubNom} taille={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.label}>{parent ? "Son club" : "Mon club"}</Text>
            <Text style={s.nomClub} numberOfLines={1}>{clubNom}</Text>
          </View>
          <Pastille ton={affilie ? "succes" : "alerte"} texte={affilie ? "Affilié" : "En attente"} />
        </View>
      ) : null}
    </Ecran>
  );
}

const s = StyleSheet.create({
  entete: { flexDirection: "row", alignItems: "center", gap: E.m },
  bonjour: { color: C.texte, fontFamily: P.titre, fontSize: 26, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5 },
  label: { color: C.cyan, fontFamily: P.texteFort, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.9 },
  nomClub: { color: C.texte, fontFamily: P.titreFort, fontSize: 16.5 },
  carteClub: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure, padding: E.m,
  },
  lien: { color: C.accentClair, fontFamily: P.texteFort, fontSize: 13.5, minHeight: 20 },
  attente: { paddingVertical: E.xl, alignItems: "center" },
  galerie: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure, padding: E.s,
    minHeight: TOUCHE + 30,
  },
  vignette: { width: 76, height: 76, borderRadius: R.m, backgroundColor: "rgba(255,255,255,.05)" },
  vignetteVide: { alignItems: "center", justifyContent: "center" },
  galerieTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: 15.5 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13 },
});
