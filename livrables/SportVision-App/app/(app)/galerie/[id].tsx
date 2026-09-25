// Une galerie, vue de l'intérieur (22/09/2026).
//
// Ce que la famille vient chercher, ce n'est pas « la galerie » : ce sont les photos où on la
// reconnaît. L'écran ouvre donc directement dessus. Tant que l'accès n'est pas acheté, six
// aperçus, pas un de plus : c'est la règle du site, et elle est tenue en base, pas ici.
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Dimensions, Linking, Modal, Pressable, StyleSheet, Text, View,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { lirePhotosDuJoueur, ouvrirGalerie, type PhotoDuJoueur } from "../../../src/lib/donnees";
import { acheterPass, passProposable, reprendreAchatsEnAttente, type PassProposable } from "../../../src/lib/achat-pass";
import { Ecran, Probleme, Vide } from "../../../src/ui/Ecran";
import { Erreur } from "../../../src/ui/Base";
import { C, E, R } from "../../../src/theme/couleurs";

const APERCU_MAX = 6;

export default function Galerie() {
  const { id, titre, joueur, ouverte, club, pourEnfant } = useLocalSearchParams<{
    id: string; titre?: string; joueur?: string; ouverte?: string;
    club?: string; pourEnfant?: string;
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
  const [pass, setPass] = useState<PassProposable | null>(null);
  const [achatEnCours, setAchatEnCours] = useState(false);
  const [ouvertMaintenant, setOuvertMaintenant] = useState(false);

  const charger = useCallback(async () => {
    if (!id || !joueur) { setChargement(false); return; }
    setChargement(true);
    setPanne(false);
    try { setPhotos(await lirePhotosDuJoueur(id, joueur)); }
    catch { setPanne(true); setPhotos([]); }
    finally { setChargement(false); }
  }, [id, joueur]);

  useEffect(() => { charger(); }, [charger]);

  // Deux choses au chargement, et dans cet ordre : rattraper un achat deja paye dont l'acces ne
  // s'est jamais ouvert (reseau coupe au mauvais moment), PUIS seulement regarder s'il reste
  // quelque chose a vendre. L'inverse proposerait d'acheter ce qui est deja paye.
  const enfant = pourEnfant === "1" ? joueur : undefined;
  useEffect(() => {
    let vivant = true;
    (async () => {
      if (!club || !joueur) return;
      if (await reprendreAchatsEnAttente(club, joueur, enfant)) {
        if (!vivant) return;
        setOuvertMaintenant(true);
        charger();
        return;
      }
      const p = await passProposable(club, joueur);
      if (vivant) setPass(p);
    })();
    return () => { vivant = false; };
  }, [club, joueur, enfant, charger]);

  async function lancerAchat() {
    if (!pass) return;
    setAchatEnCours(true); setErreur(null);
    const r = await acheterPass(pass, enfant);
    setAchatEnCours(false);
    if (r.etat === "ouvert") { setPass(null); setOuvertMaintenant(true); charger(); }
    else if (r.etat === "erreur") setErreur(r.message);
    // « annule » : la personne a ferme la feuille de paiement d'Apple. Elle sait ce qu'elle a
    // fait, lui afficher un message serait du bruit.
  }

  async function ouvrirCollection() {
    setOuverture(true); setErreur(null);
    const lien = await ouvrirGalerie(id);
    setOuverture(false);
    if (!lien) { setErreur("Cette collection n'a pas pu s'ouvrir. Si votre accès vient d'être ouvert, patientez une minute et réessayez."); return; }
    Linking.openURL(lien);
  }

  const visibles = deverrouillee || ouvertMaintenant ? photos : photos.slice(0, APERCU_MAX);
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

        {/* CE QUE CE BLOC DIT (revu le 25/09/2026, decision de Fouka de vendre via Apple).
            Il annonce ce qui manque et comment l'obtenir. Il ne nomme toujours AUCUN prix :
            celui qui compte est celui d'Apple, affiche sur le bouton juste en dessous, et deux
            prix a l'ecran dont un seul sera debite est une reclamation qui arrive.
            La mention du club reste, parce qu'elle est vraie : beaucoup de familles paieront au
            club en especes ou par virement, et leur acces s'ouvrira sans passer par ici. */}
        {restantes > 0 ? (
          <View style={s.bloque}>
            <Ionicons name="lock-closed" size={16} color={C.alerte} />
            <Text style={s.bloqueTexte}>
              {restantes === 1 ? "1 autre photo de vous" : `${restantes} autres photos de vous`} dans
              cette galerie. Votre accès s'ouvre ici, ou auprès de votre club si vous préférez
              régler avec lui.
            </Text>
          </View>
        ) : null}

        {/* UN SEUL BOUTON, LES DEUX MAGASINS (26/09/2026).
            Il y en avait deux : StoreKit sur iOS, un lien vers Connect sur Android. Ce lien
            reposait sur une affirmation de ma part trop rapide — que Google autorisait le
            paiement externe. Play exige aussi son systeme de facturation, et l'ouverture imposee
            par le DMA dans l'EEE passe par un programme d'inscription. Fouka a tranche pour
            l'achat integre des deux cotes.
            Le prix affiche vient du magasin, jamais du club : Apple impose ses paliers (19,99 la
            ou le club affiche 19,90), Google accepte le prix exact. C'est le magasin qui debite,
            c'est donc lui qui annonce.
            Le bouton n'apparait que si le Pass est reellement achetable : declare en base POUR
            CETTE plateforme, et connu du magasin. Un produit pas encore cree dans la console
            n'affiche rien, plutot qu'un bouton qui echoue au paiement. */}
        {restantes > 0 && pass ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Débloquer le Pass Photo pour ${pass.prixMagasin}`}
            disabled={achatEnCours}
            onPress={lancerAchat}
            style={({ pressed }) => [s.action, pressed || achatEnCours ? { opacity: 0.85 } : null]}
          >
            {achatEnCours ? <ActivityIndicator color="#fff" />
              : <Text style={s.actionTexte}>Débloquer mon Pass Photo · {pass.prixMagasin}</Text>}
          </Pressable>
        ) : null}

        {deverrouillee || ouvertMaintenant ? (
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
