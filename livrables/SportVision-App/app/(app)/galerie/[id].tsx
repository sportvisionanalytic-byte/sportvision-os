// Une galerie, vue de l'intérieur (22/09/2026).
//
// Ce que la famille vient chercher, ce n'est pas « la galerie » : ce sont les photos où on la
// reconnaît. L'écran ouvre donc directement dessus. Tant que l'accès n'est pas acheté, six
// aperçus, pas un de plus : c'est la règle du site, et elle est tenue en base, pas ici.
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Dimensions, Linking, Modal, Platform, Pressable, StyleSheet, Text, View,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { lirePhotosDuJoueur, ouvrirGalerie, type PhotoDuJoueur } from "../../../src/lib/donnees";
import { CONNECT } from "../../../src/lib/connect";
import { Ecran, Probleme, Vide } from "../../../src/ui/Ecran";
import { Erreur } from "../../../src/ui/Base";
import { C, E, R } from "../../../src/theme/couleurs";

const APERCU_MAX = 6;

export default function Galerie() {
  const { id, titre, joueur, ouverte } = useLocalSearchParams<{
    id: string; titre?: string; joueur?: string; ouverte?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const deverrouillee = ouverte === "1";

  const [photos, setPhotos] = useState<PhotoDuJoueur[]>([]);
  const [chargement, setChargement] = useState(true);
  const [agrandie, setAgrandie] = useState<PhotoDuJoueur | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouverture, setOuverture] = useState(false);
  const [panne, setPanne] = useState(false);

  const charger = useCallback(async () => {
    if (!id || !joueur) { setChargement(false); return; }
    setChargement(true);
    setPanne(false);
    try { setPhotos(await lirePhotosDuJoueur(id, joueur)); }
    catch { setPanne(true); setPhotos([]); }
    finally { setChargement(false); }
  }, [id, joueur]);

  useEffect(() => { charger(); }, [charger]);

  async function ouvrirCollection() {
    setOuverture(true); setErreur(null);
    const lien = await ouvrirGalerie(id);
    setOuverture(false);
    if (!lien) { setErreur("Cette collection n'a pas pu s'ouvrir. Si votre accès vient d'être ouvert, patientez une minute et réessayez."); return; }
    Linking.openURL(lien);
  }

  const visibles = deverrouillee ? photos : photos.slice(0, APERCU_MAX);
  const restantes = photos.length - visibles.length;
  const largeur = (Dimensions.get("window").width - E.l * 2 - E.s * 2) / 3;

  return (
    <>
      <Ecran enCours={chargement} rafraichir={charger}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Retour aux photos" style={s.retour} hitSlop={8}>
          <Ionicons name="chevron-back" size={18} color={C.texteDoux} />
          <Text style={s.retourTexte}>Photos</Text>
        </Pressable>

        <View style={{ gap: 4 }}>
          <Text style={s.titre} numberOfLines={3}>{titre || "Galerie"}</Text>
          <Text style={s.sous}>
            {chargement ? "Recherche en cours…"
              : photos.length === 0 ? "Aucune photo de vous n'a encore été repérée dans cette galerie."
              : photos.length === 1 ? "1 photo de vous a été repérée."
              : `${photos.length} photos de vous ont été repérées.`}
          </Text>
        </View>

        <Erreur message={erreur} />

        {chargement && !photos.length ? (
          <View style={{ paddingVertical: E.xl * 2, alignItems: "center" }}>
            <ActivityIndicator color={C.accent} />
          </View>
        ) : panne ? (
          <Probleme surReessayer={charger} />
        ) : visibles.length ? (
          <View style={s.grille}>
            {visibles.map((p) => (
              <Pressable key={p.id} onPress={() => setAgrandie(p)} accessibilityRole="imagebutton" accessibilityLabel="Agrandir cette photo">
                <Image
                  source={{ uri: p.url }}
                  style={{ width: largeur, height: largeur, borderRadius: R.s, backgroundColor: C.surface }}
                  contentFit="cover"
                  transition={140}
                />
              </Pressable>
            ))}
          </View>
        ) : (
          <Vide
            titre="Rien pour le moment"
            texte="Dès qu'une photo de vous sera repérée dans cette galerie, elle apparaîtra ici."
          />
        )}

        {/* CE QUE CE BLOC DIT, ET CE QU'IL NE DIT PAS (25/09/2026).
            Il annonce ce qui existe et qui gere l'acces. Il ne nomme aucun produit payant, ne
            donne aucun prix, et ne propose aucun lien : la regle 3.1.1 d'Apple interdit toute
            incitation dirigeant vers un achat hors de leur systeme de paiement, et ce qu'ils
            regardent, c'est l'intention du bouton, pas seulement sa destination.
            Decrire le fonctionnement du service est permis ; inviter a l'achat ne l'est pas.
            Une famille qui lit ca appelle son coach, qui lui envoie le lien — exactement comme
            les ventes se font deja aujourd'hui. Rien n'est perdu, seul le raccourci manque. */}
        {restantes > 0 ? (
          <View style={s.bloque}>
            <Ionicons name="lock-closed" size={16} color={C.alerte} />
            <Text style={s.bloqueTexte}>
              {restantes === 1 ? "1 autre photo de vous" : `${restantes} autres photos de vous`} dans
              cette galerie. L'accès complet est géré par votre club : il s'ouvre dès que votre
              accès est actif.
            </Text>
          </View>
        ) : null}

        {/* LE RACCOURCI VERS CONNECT N'EXISTE QUE SUR ANDROID, ET C'EST UNE CONTRAINTE, PAS UN
            CHOIX (25/09/2026, demande de Fouka : « le pass doit être verrouillé et ça doit
            rediriger vers Connect web »).
            Google autorise un lien de paiement externe. Apple l'interdit — règle 3.1.1 : aucune
            incitation, dans l'app, à acheter hors de leur système. Ils jugent l'INTENTION du
            bouton, pas seulement sa destination. L'app est déjà sous le coup d'un refus en
            examen ; ajouter ce bouton sur iOS, c'est un second refus quasi certain.
            Sur iPhone, le bloc ci-dessus décrit donc le fonctionnement sans inviter à payer, et
            la famille passe par son coach ou par le lien reçu — comme les ventes se font déjà. */}
        {restantes > 0 && Platform.OS === "android" ? (
          <Pressable
            accessibilityRole="button" accessibilityLabel="Ouvrir cette galerie dans Connect"
            onPress={() => Linking.openURL(`${CONNECT}/galeries`)}
            style={({ pressed }) => [s.action, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={s.actionTexte}>Débloquer mon Pass Photo</Text>
          </Pressable>
        ) : null}

        {deverrouillee ? (
          <Pressable
            accessibilityRole="button" accessibilityLabel="Ouvrir la collection complète"
            onPress={ouvrirCollection}
            style={({ pressed }) => [s.action, pressed ? { opacity: 0.85 } : null]}
          >
            {ouverture ? <ActivityIndicator color="#fff" />
              : <Text style={s.actionTexte}>Ouvrir la collection complète</Text>}
          </Pressable>
        ) : null}
      </Ecran>

      {/* Le plein écran : fond noir, une seule sortie, aucun piège. */}
      <Modal visible={!!agrandie} transparent animationType="fade" onRequestClose={() => setAgrandie(null)}>
        <View style={s.plein}>
          <Pressable
            accessibilityRole="button" accessibilityLabel="Fermer la photo"
            onPress={() => setAgrandie(null)}
            style={[s.fermer, { top: insets.top + E.s }]}
            hitSlop={12}
          >
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          {agrandie ? (
            <Image source={{ uri: agrandie.url }} style={s.pleinImage} contentFit="contain" transition={120} />
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  retour: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  retourTexte: { color: C.texteDoux, fontSize: 14.5, fontWeight: "600" },
  titre: { color: C.texte, fontSize: 23, fontWeight: "800", letterSpacing: -0.5 },
  sous: { color: C.texteDoux, fontSize: 13.5, lineHeight: 19 },
  grille: { flexDirection: "row", flexWrap: "wrap", gap: E.s },
  bloque: {
    flexDirection: "row", alignItems: "flex-start", gap: E.s,
    backgroundColor: "rgba(232,163,61,.10)", borderWidth: 1, borderColor: "rgba(232,163,61,.28)",
    borderRadius: R.m, padding: E.m,
  },
  bloqueTexte: { flex: 1, color: C.alerteTexteChaud, fontSize: 13.5, lineHeight: 19 },
  action: { height: 50, borderRadius: R.m, alignItems: "center", justifyContent: "center", backgroundColor: C.accent },
  actionTexte: { color: "#fff", fontSize: 15, fontWeight: "700" },
  plein: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  pleinImage: { width: "100%", height: "86%" },
  fermer: {
    position: "absolute", right: E.l, width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.14)",
  },
});
