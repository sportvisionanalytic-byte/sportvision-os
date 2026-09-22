// Mes photos (22/09/2026).
//
// Une galerie ouverte s'ouvre. Une galerie verrouillee le dit, et dit pourquoi. Le compteur
// « vos photos » vient de la reconnaissance : il ne s'affiche que s'il est vrai.
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "../../src/lib/session";
import { useFamille } from "../../src/lib/famille";
import { lireGaleries, ouvrirGalerie, type Galerie } from "../../src/lib/donnees";
import { dateLongue } from "../../src/lib/dates";
import { Ecran, Vide } from "../../src/ui/Ecran";
import { BandeauEnfant, SelecteurEnfant } from "../../src/ui/Enfants";
import { Erreur } from "../../src/ui/Base";
import { C, E, R } from "../../src/theme/couleurs";

export default function Photos() {
  const { profil } = useSession();
  const famille = useFamille();
  const parent = profil?.espace === "parent";
  // Pour un parent, l'equipe et la saison viennent du detail de l'enfant : c'est la base qui les
  // resout, apres avoir verifie que le lien parent-enfant est bien confirme.
  const clubId = parent ? famille.detail?.clubId : profil?.clubId;
  const equipeId = parent ? famille.detail?.equipeId : profil?.equipeId;
  const saisonId = parent ? (famille.detail?.saisonId ?? null) : (profil?.saisonId ?? null);
  const playerId = parent
    ? (famille.choisi?.kind === "club" ? famille.choisi.refId : undefined)
    : profil?.playerId;
  const equipeNom = parent ? famille.detail?.categorie : profil?.equipeNom;
  const [galeries, setGaleries] = useState<Galerie[]>([]);
  const [chargement, setChargement] = useState(true);
  const [ouverture, setOuverture] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    if (!clubId || !equipeId) { setGaleries([]); setChargement(false); return; }
    setChargement(true);
    try { setGaleries(await lireGaleries(clubId, equipeId, saisonId, playerId)); }
    finally { setChargement(false); }
  }, [clubId, equipeId, saisonId, playerId]);

  useEffect(() => { charger(); }, [charger]);

  async function ouvrir(g: Galerie) {
    setOuverture(g.id); setErreur(null);
    // Le lien n'existe qu'a cet instant : la base revalide le droit et journalise l'ouverture.
    const lien = await ouvrirGalerie(g.id);
    setOuverture(null);
    if (!lien) { setErreur("Cette collection n'a pas pu s'ouvrir. Si vous venez de l'acheter, patientez une minute et réessayez."); return; }
    Linking.openURL(lien);
  }

  return (
    <Ecran enCours={chargement} rafraichir={charger}>
      <View style={{ gap: 3 }}>
        <Text style={s.titre}>{parent ? "Ses photos" : "Mes photos"}</Text>
        <Text style={s.sous}>
          {equipeNom ? `Les galeries de ${equipeNom}.` : "Les galeries de l'équipe."}
        </Text>
      </View>

      {parent ? (
        <View style={{ gap: E.s }}>
          <SelecteurEnfant />
          <BandeauEnfant />
        </View>
      ) : null}

      <Erreur message={erreur} />

      {chargement && !galeries.length ? (
        <View style={{ paddingVertical: E.xl * 2, alignItems: "center" }}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : galeries.length ? (
        <View style={{ gap: E.m }}>
          {galeries.map((g) => (
            <View key={g.id} style={s.carte}>
              <View style={s.visuel}>
                {g.apercuUrl ? (
                  <Image source={{ uri: g.apercuUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
                ) : (
                  <View style={[StyleSheet.absoluteFill, s.visuelVide]}>
                    <Ionicons name="images-outline" size={26} color={C.texteFaible} />
                  </View>
                )}
                {!g.ouverte ? (
                  <View style={s.cadenas}>
                    <Ionicons name="lock-closed" size={12} color={C.texte} />
                    <Text style={s.cadenasTexte}>Verrouillée</Text>
                  </View>
                ) : null}
                {g.mesPhotos ? (
                  <View style={s.mesPhotos}>
                    <Ionicons name="person" size={11} color="#fff" />
                    <Text style={s.mesPhotosTexte}>
                      {g.mesPhotos} photo{g.mesPhotos > 1 ? "s" : ""}
                      {parent ? ` de ${famille.choisi?.prenom ?? "lui"}` : " de vous"}
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={{ padding: E.m, gap: E.s }}>
                <View style={{ gap: 3 }}>
                  <Text style={s.titreGalerie} numberOfLines={2}>{g.titre}</Text>
                  <Text style={s.sous}>
                    {[g.date ? dateLongue(g.date) : null, `${g.nbPhotos} photo${g.nbPhotos > 1 ? "s" : ""}`]
                      .filter(Boolean).join(" · ")}
                  </Text>
                </View>

                {g.ouverte ? (
                  <Pressable
                    onPress={() => ouvrir(g)}
                    style={({ pressed }) => [s.action, s.actionPleine, pressed ? { opacity: 0.85 } : null]}
                  >
                    {ouverture === g.id
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={s.actionTexte}>Ouvrir la collection</Text>}
                  </Pressable>
                ) : (
                  // Pas de bouton d'achat ici : l'App Store n'autorise pas un paiement hors de son
                  // systeme depuis l'application. On renvoie vers l'espace web, ou l'achat existe
                  // deja et ou il est encadre.
                  <View style={{ gap: E.xs }}>
                    <Text style={s.note}>
                      Cette galerie s'ouvre avec le Pass Photo de l'équipe.
                    </Text>
                    <Pressable
                      onPress={() => Linking.openURL("https://connect.sportvision-an.fr/photos")}
                      style={({ pressed }) => [s.action, s.actionVide, pressed ? { opacity: 0.85 } : null]}
                    >
                      <Text style={[s.actionTexte, { color: C.texte }]}>Voir sur mon espace</Text>
                    </Pressable>
                  </View>
                )}

                {g.videoUrl ? (
                  <Pressable onPress={() => Linking.openURL(g.videoUrl!)} style={s.lienVideo} hitSlop={6}>
                    <Ionicons name="play-circle" size={16} color={C.accentClair} />
                    <Text style={s.lienVideoTexte}>Voir la vidéo du match</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Vide
          titre="Aucune galerie pour le moment"
          texte={
            equipeId
              ? "Les photos prises par SportVision apparaissent ici après chaque match ou événement couvert."
              : "Le club doit d'abord rattacher le sportif à une équipe pour que ses galeries soient proposées."
          }
        />
      )}
    </Ecran>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontSize: 25, fontWeight: "800", letterSpacing: -0.5 },
  sous: { color: C.texteDoux, fontSize: 13.5 },
  carte: { backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure, overflow: "hidden" },
  visuel: { height: 168, backgroundColor: "rgba(255,255,255,.05)" },
  visuelVide: { alignItems: "center", justifyContent: "center" },
  cadenas: {
    position: "absolute", top: E.s, right: E.s, flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(0,0,0,.55)", paddingHorizontal: E.s, paddingVertical: 5, borderRadius: R.pill,
  },
  cadenasTexte: { color: C.texte, fontSize: 11, fontWeight: "600" },
  mesPhotos: {
    position: "absolute", left: E.s, bottom: E.s, flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(79,125,255,.85)", paddingHorizontal: E.s, paddingVertical: 5, borderRadius: R.pill,
  },
  mesPhotosTexte: { color: "#fff", fontSize: 11, fontWeight: "700" },
  titreGalerie: { color: C.texte, fontSize: 16.5, fontWeight: "700" },
  action: { height: 46, borderRadius: R.m, alignItems: "center", justifyContent: "center" },
  actionPleine: { backgroundColor: C.accent },
  actionVide: { borderWidth: 1, borderColor: C.bordureForte, backgroundColor: "rgba(255,255,255,.05)" },
  actionTexte: { color: "#fff", fontSize: 14.5, fontWeight: "700" },
  note: { color: C.texteDoux, fontSize: 13, lineHeight: 18 },
  lienVideo: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingTop: 2 },
  lienVideoTexte: { color: C.accentClair, fontSize: 13.5, fontWeight: "600" },
});
