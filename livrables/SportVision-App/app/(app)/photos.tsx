// Mes photos (22/09/2026).
//
// Une galerie ouverte s'ouvre. Une galerie verrouillee le dit, et dit pourquoi. Le compteur
// « vos photos » vient de la reconnaissance : il ne s'affiche que s'il est vrai.
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSession } from "../../src/lib/session";
import { useFamille } from "../../src/lib/famille";
import { lireGaleries, ouvrirGalerie, type Galerie } from "../../src/lib/donnees";
import { dateLongue } from "../../src/lib/dates";
import { Ecran, Probleme, Vide } from "../../src/ui/Ecran";
import { BandeauEnfant, SelecteurEnfant } from "../../src/ui/Enfants";
import { Erreur } from "../../src/ui/Base";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

export default function Photos() {
  const { profil } = useSession();
  const famille = useFamille();
  const router = useRouter();
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
  const [filtre, setFiltre] = useState<"tout" | "ouvertes" | "verrouillees">("tout");
  const [panne, setPanne] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    if (!clubId || !equipeId) { setGaleries([]); setChargement(false); return; }
    setChargement(true);
    setPanne(false);
    try { setGaleries(await lireGaleries(clubId, equipeId, saisonId, playerId)); }
    catch { setPanne(true); setGaleries([]); }
    finally { setChargement(false); }
  }, [clubId, equipeId, saisonId, playerId]);

  useEffect(() => { charger(); }, [charger]);

  async function ouvrir(g: Galerie) {
    setOuverture(g.id); setErreur(null);
    // Le lien n'existe qu'a cet instant : la base revalide le droit et journalise l'ouverture.
    const lien = await ouvrirGalerie(g.id);
    setOuverture(null);
    if (!lien) { setErreur("Cette collection n'a pas pu s'ouvrir. Si votre accès vient d'être ouvert, patientez une minute et réessayez."); return; }
    Linking.openURL(lien);
  }

  return (
    <Ecran enCours={chargement} rafraichir={charger} teinte="violet">
      <View style={{ gap: 3 }}>
        <Text style={s.titre}>{parent ? "Ses photos" : "Mes photos"}</Text>
        <Text style={s.sous}>
          {equipeNom ? `Les galeries de l'équipe ${equipeNom}.` : "Les galeries de votre équipe."}
        </Text>
      </View>

      {parent ? (
        <View style={{ gap: E.s }}>
          <SelecteurEnfant />
          <BandeauEnfant />
        </View>
      ) : null}

      {/* Le groupe « Medias » du site compte trois entrees : les galeries de l'equipe (cet
          ecran), les photos deja achetees, et ce que SportVision a livre. L'application n'avait
          que la premiere — une famille qui avait paye ne retrouvait pas ses propres photos. */}
      <View style={s.mediasLiens}>
        <Pressable
          onPress={() => router.push("/connect/galeries")}
          accessibilityRole="button"
          accessibilityLabel="Mes galeries, les photos que vous avez achetées"
          style={({ pressed }) => [s.mediasLien, pressed ? { opacity: 0.85 } : null]}
        >
          <Ionicons name="albums-outline" size={16} color={C.cyan} />
          <Text style={s.mediasLienTexte}>Mes galeries</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push("/connect/contenus")}
          accessibilityRole="button"
          accessibilityLabel="Mes contenus, photos et vidéos livrées par SportVision"
          style={({ pressed }) => [s.mediasLien, pressed ? { opacity: 0.85 } : null]}
        >
          <Ionicons name="film-outline" size={16} color={C.violet} />
          <Text style={s.mediasLienTexte}>Mes contenus</Text>
        </Pressable>
      </View>

      {galeries.length > 1 ? (
        <View style={s.filtres}>
          {([
            ["tout", "Toutes"],
            ["ouvertes", "Accessibles"],
            ["verrouillees", "Verrouillées"],
          ] as const).map(([cle, libelle]) => {
            const actif = filtre === cle;
            return (
              <Pressable key={cle} onPress={() => setFiltre(cle)} style={[s.filtre, actif && s.filtreActif]}>
                <Text style={[s.filtreTexte, actif && s.filtreTexteActif]} numberOfLines={1}>{libelle}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Erreur message={erreur} />

      {chargement && !galeries.length ? (
        <View style={{ paddingVertical: E.xl * 2, alignItems: "center" }}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : panne ? (
        <Probleme surReessayer={charger} />
      ) : galeries.length ? (
        <View style={{ gap: E.m }}>
          {galeries
            .filter((g) => filtre === "tout" ? true : filtre === "ouvertes" ? g.ouverte : !g.ouverte)
            .map((g) => (
            <Pressable
              key={g.id}
              accessibilityRole="button"
              accessibilityLabel={[
                g.titre,
                `${g.nbPhotos} photos`,
                g.ouverte ? "galerie accessible" : "galerie verrouillée",
                g.mesPhotos ? `${g.mesPhotos} photos de vous` : "",
              ].filter(Boolean).join(", ")}
              onPress={playerId ? () => router.push({
                pathname: "/galerie/[id]",
                params: { id: g.id, titre: g.titre, joueur: playerId, ouverte: g.ouverte ? "1" : "0" },
              }) : undefined}
              style={({ pressed }) => [s.carte, pressed && playerId ? { opacity: 0.9 } : null]}
            >
              <View style={s.visuel}>
                {g.apercuUrl ? (
                  <Image source={{ uri: g.apercuUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
                ) : (
                  <View style={[StyleSheet.absoluteFill, s.visuelVide]}>
                    <Ionicons name="images-outline" size={26} color={C.texteFaible} />
                  </View>
                )}

                {/* Le voile : sans lui, un titre blanc sur une photo claire devient illisible. */}
                <LinearGradient
                  colors={["rgba(7,11,24,0)", "rgba(7,11,24,.45)", "rgba(7,11,24,.92)"]}
                  locations={[0, 0.55, 1]}
                  style={StyleSheet.absoluteFill}
                />

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

                <View style={s.surVisuel}>
                  <Text style={s.titreGalerie} numberOfLines={2}>{g.titre}</Text>
                  <Text style={s.sousClair}>
                    {[g.date ? dateLongue(g.date) : null, `${g.nbPhotos} photo${g.nbPhotos > 1 ? "s" : ""}`]
                      .filter(Boolean).join(" · ")}
                  </Text>
                </View>
              </View>

              <View style={{ padding: E.m, gap: E.s }}>

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
                  // Ni prix, ni bouton d'achat, ni renvoi vers une page de paiement : l'App Store
                  // l'interdit, même sous forme d'allusion. On explique l'état de l'accès, et
                  // c'est tout.
                  <View style={{ gap: E.xs }}>
                    <Text style={s.note}>
                      L'accès à cette galerie est géré par votre club.
                    </Text>
                    <Pressable
                      onPress={() => router.push("/aide-photos")}
                      style={({ pressed }) => [s.action, s.actionVide, pressed ? { opacity: 0.85 } : null]}
                    >
                      <Text style={[s.actionTexte, { color: C.texte }]}>Comprendre mon accès</Text>
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
            </Pressable>
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
  mediasLiens: { flexDirection: "row", gap: E.s },
  mediasLien: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    height: TOUCHE, borderRadius: R.m,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  mediasLienTexte: { color: C.texte, fontFamily: P.texteFort, fontSize: 13.5 },
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 26, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5 },
  carte: { backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure, overflow: "hidden" },
  visuel: { height: 210, backgroundColor: "rgba(255,255,255,.05)", justifyContent: "flex-end" },
  surVisuel: { padding: E.m, gap: 2 },
  sousClair: { color: "rgba(255,255,255,.82)", fontFamily: P.texte, fontSize: 13 },
  visuelVide: { alignItems: "center", justifyContent: "center" },
  cadenas: {
    position: "absolute", top: E.s, right: E.s, flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(0,0,0,.55)", paddingHorizontal: E.s, paddingVertical: 5, borderRadius: R.pill,
  },
  cadenasTexte: { color: C.texte, fontFamily: P.texteFort, fontSize: 11 },
  mesPhotos: {
    // En haut a gauche, face au cadenas : en bas, la pastille se superposait au titre et a la
    // date, qui sont passes sur la photo.
    position: "absolute", left: E.s, top: E.s, flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(79,125,255,.92)", paddingHorizontal: E.s, paddingVertical: 5, borderRadius: R.pill,
  },
  mesPhotosTexte: { color: "#fff", fontFamily: P.texteFort, fontSize: 11 },
  titreGalerie: { color: "#fff", fontFamily: P.titre, fontSize: 18, letterSpacing: -0.3 },
  action: { minHeight: TOUCHE + 4, borderRadius: R.l, alignItems: "center", justifyContent: "center" },
  filtres: { flexDirection: "row", gap: 4, backgroundColor: C.surface, padding: 4, borderRadius: R.pill, borderWidth: 1, borderColor: C.bordure },
  filtre: { flex: 1, height: 36, borderRadius: R.pill, alignItems: "center", justifyContent: "center" },
  filtreActif: { backgroundColor: "rgba(255,255,255,.10)" },
  filtreTexte: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 12.5 },
  filtreTexteActif: { color: C.texte, fontFamily: P.texteFort },
  actionPleine: { backgroundColor: C.accent },
  actionVide: { borderWidth: 1, borderColor: C.bordureForte, backgroundColor: "rgba(255,255,255,.05)" },
  actionTexte: { color: "#fff", fontFamily: P.titreFort, fontSize: 15 },
  note: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  lienVideo: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingTop: 2 },
  lienVideoTexte: { color: C.accentClair, fontFamily: P.texteFort, fontSize: 13.5 },
});
