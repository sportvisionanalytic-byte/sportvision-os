// GALERIES PHOTO (30/09/2026). L'écran `media` de l'OS, celui que l'opérateur y trouve rangé avec
// ses missions : « verser les photos d'un match en fait partie », dit le commentaire de son menu.
//
// == DEUX ÉCRANS DANS UN ONGLET, ET LA BASE CHOISIT LEQUEL ======================================
//
// La liste, puis la galerie. Pas deux routes : la galerie est l'ouverture d'une ligne, et sur un
// téléphone on y entre et on en sort par le même geste. Aucun `estOperateur` ni `estProduction`
// nulle part dans ce fichier — la même requête sert tout le monde, et c'est la RLS qui décide de
// ce qu'elle rend. Mesuré : 57 galeries pour un responsable de production, 0 pour un opérateur.
//
// == LE VIDE DIT POURQUOI, ET CE N'EST PAS UNE FORMULE DE POLITESSE =============================
//
// Un opérateur voit zéro galerie aujourd'hui, et « Aucune galerie » tout court le ferait
// téléphoner. La raison est précise et vérifiée : une galerie ne lui appartient que s'il l'a
// créée ou si elle est rattachée à une de ses missions, et `media_albums.mission_id` est NULL sur
// 57 galeries sur 57. C'est ce que l'écran écrit, et il dit à qui s'adresser.
//
// == PAS DE VERSEMENT DEPUIS LE TÉLÉPHONE, ET C'EST MESURÉ ======================================
//
// `media_upload_staff()` autorise bien un opérateur à écrire, mais les 7 784 photos de la base ont
// été versées par un profil `prod` ou `admin`, aucune par un `photo`, et 4 921 portent
// `numeros_lus_par = 'macos-vision-dos-v1'` : la chaîne de versement lit les dossards avec Vision
// de macOS, sur un Mac. Une photo envoyée depuis un téléphone créerait une ligne sans vignette ni
// aperçu, donc invisible dans cette grille même — un bouton qui donne l'impression d'avoir livré
// sans avoir livré. Ce n'est pas un écran qui manque, c'est un outil de bureau.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { Ecran, Probleme, Vide } from "../../src/ui/Ecran";
import { Pastille } from "../../src/ui/Base";
import { lireMesGaleries, lirePhotosGalerie, type Galerie, type PhotoGalerie } from "../../src/lib/os-galeries";
import { useDonnees } from "../../src/lib/cache";
import { dateLongue } from "../../src/lib/dates";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

export default function Galeries() {
  const [ouverte, setOuverte] = useState<Galerie | null>(null);
  return ouverte
    ? <UneGalerie galerie={ouverte} surRetour={() => setOuverte(null)} />
    : <ListeGaleries surOuvrir={setOuverte} />;
}

// ── La liste ────────────────────────────────────────────────────────────────────────────────
function ListeGaleries({ surOuvrir }: { surOuvrir: (g: Galerie) => void }) {
  // `useDonnees` et pas un `useState` : au retour d'une galerie, la liste est déjà là. Un écran
  // qu'on quitte et qu'on retrouve ne doit jamais remontrer sa roue.
  const { donnees, chargement, rafraichissement, erreur, relire } =
    useDonnees<Galerie[]>("os:galeries", lireMesGaleries);

  const liste = donnees ?? [];
  const total = useMemo(() => liste.reduce((s, g) => s + g.nbPhotos, 0), [liste]);

  return (
    <Ecran enCours={!!donnees && rafraichissement} teinte="violet" rafraichir={relire} retour="/profil">
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Galeries photo</Text>
        <Text style={s.sous}>
          {liste.length
            ? `${liste.length} galerie${liste.length > 1 ? "s" : ""} · ${total.toLocaleString("fr-FR")} photo${total > 1 ? "s" : ""}`
            : "Les albums de vos missions"}
        </Text>
      </View>

      {chargement ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : erreur && !donnees ? (
        <Probleme surReessayer={relire} />
      ) : liste.length ? (
        <View style={{ gap: E.s }}>
          {liste.map((g) => <CarteGalerie key={g.id} g={g} surOuvrir={() => surOuvrir(g)} />)}
        </View>
      ) : (
        <Vide
          titre="Aucune galerie à votre nom"
          texte={
            "Une galerie vous revient quand vous l'avez créée, ou quand elle est rattachée à une de "
            + "vos missions. Aucune galerie n'est aujourd'hui rattachée à une mission : demandez à la "
            + "production de rattacher celles de vos matchs, elles apparaîtront ici."
          }
        />
      )}
    </Ecran>
  );
}

function CarteGalerie({ g, surOuvrir }: { g: Galerie; surOuvrir: () => void }) {
  const detail = [g.date ? dateLongue(g.date) : null, g.reference].filter(Boolean).join(" · ");
  return (
    <Pressable
      onPress={surOuvrir}
      accessibilityRole="button"
      accessibilityLabel={`${g.titre}, ${g.nbPhotos} photos`}
      style={({ pressed }) => [s.carte, pressed ? { opacity: 0.85 } : null]}
    >
      <View style={s.ligne}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.nom} numberOfLines={2}>{g.titre}</Text>
          {/* Ni « date non renseignée » ni « catégorie non renseignée » : la catégorie manque sur
              41 galeries sur 57, et une ligne vide répétée quarante fois n'apprend rien. */}
          {detail ? <Text style={s.detail} numberOfLines={1}>{detail}</Text> : null}
          <Text style={s.compte}>
            {g.nbPhotos.toLocaleString("fr-FR")} photo{g.nbPhotos > 1 ? "s" : ""}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={C.texteFaible} />
      </View>
      {g.categorie || g.archivee ? (
        <View style={s.pastilles}>
          {g.categorie ? <Pastille texte={g.categorie} /> : null}
          {g.archivee ? <Pastille ton="alerte" texte="Archivée" /> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

// ── Une galerie ─────────────────────────────────────────────────────────────────────────────

/** Soixante par page : la plus grosse galerie réelle compte 431 photos. */
const PAR_PAGE = 60;

function UneGalerie({ galerie, surRetour }: { galerie: Galerie; surRetour: () => void }) {
  const [photos, setPhotos] = useState<PhotoGalerie[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [enCours, setEnCours] = useState(true);
  const [panne, setPanne] = useState(false);
  const [agrandie, setAgrandie] = useState<PhotoGalerie | null>(null);

  const { width } = useWindowDimensions();
  // Trois colonnes, gouttières comprises. `Ecran` pose E.l de marge de chaque côté.
  const cote = Math.floor((width - E.l * 2 - E.xs * 2) / 3);

  const charger = useCallback(async (p: number) => {
    setEnCours(true);
    setPanne(false);
    try {
      const r = await lirePhotosGalerie(galerie.id, p, PAR_PAGE);
      setTotal(r.total);
      // On AJOUTE à partir de la deuxième page, et on remplace sur la première : un rafraîchissement
      // qui empilerait les mêmes photos doublerait la grille.
      setPhotos((avant) => (p === 0 ? r.photos : [...avant, ...r.photos]));
      setPage(p);
    } catch { setPanne(true); }
    finally { setEnCours(false); }
  }, [galerie.id]);

  useEffect(() => { charger(0); }, [charger]);

  const nets = photos.filter((p) => p.net).length;
  const reste = total !== null ? total - photos.length : 0;

  return (
    <Ecran teinte="violet" enCours={enCours && page === 0} rafraichir={() => charger(0)}>
      <Pressable
        onPress={surRetour}
        accessibilityRole="button"
        accessibilityLabel="Revenir à la liste des galeries"
        hitSlop={8}
        style={({ pressed }) => [s.retour, pressed ? { opacity: 0.7 } : null]}
      >
        <Ionicons name="chevron-back" size={18} color={C.texteDoux} />
        <Text style={s.retourTexte}>Galeries</Text>
      </Pressable>

      <View style={{ gap: 4 }}>
        <Text style={s.titre}>{galerie.titre}</Text>
        <Text style={s.sous}>
          {[
            galerie.date ? dateLongue(galerie.date) : null,
            // Le total VRAI, compté par la base. `photo_count` dérive : mesuré faux sur 1 galerie
            // sur 57. Tant qu'on ne l'a pas, on n'annonce rien plutôt qu'un chiffre approximatif.
            total !== null ? `${total.toLocaleString("fr-FR")} photo${total > 1 ? "s" : ""}` : null,
          ].filter(Boolean).join(" · ")}
        </Text>
      </View>

      {/* CE QU'ON REGARDE SE DIT. L'aperçu net vit dans un bucket privé et demande une signature ;
          quand elle manque, on affiche l'aperçu filigrané, et le dire évite de croire qu'une photo
          a été livrée avec son filigrane. Mesuré : 4 921 photos sur 7 784 ont un aperçu net, le cas
          mélangé est donc le cas courant, pas une bizarrerie. */}
      {photos.length ? (
        <View style={s.pastilles}>
          {nets === photos.length ? <Pastille ton="info" texte="Aperçus sans filigrane" />
            : nets === 0 ? <Pastille texte="Aperçus filigranés" />
            : <Pastille texte={`${nets} aperçu${nets > 1 ? "s" : ""} sur ${photos.length} sans filigrane`} />}
          {galerie.archivee ? <Pastille ton="alerte" texte="Archivée" /> : null}
        </View>
      ) : null}

      {panne && !photos.length ? (
        <Probleme surReessayer={() => charger(0)} />
      ) : enCours && !photos.length ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : photos.length ? (
        <>
          <View style={s.grille}>
            {photos.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setAgrandie(p)}
                accessibilityRole="imagebutton"
                accessibilityLabel="Agrandir la photo"
                style={({ pressed }) => [{ width: cote, height: cote }, pressed ? { opacity: 0.8 } : null]}
              >
                <Image
                  source={{ uri: p.url }}
                  style={s.vignette}
                  contentFit="cover"
                  // La case porte déjà un fond : sur une grille de soixante vignettes, une case
                  // colorée qui se remplit vaut mieux que soixante cadres vides qui clignotent.
                  transition={120}
                />
              </Pressable>
            ))}
          </View>

          {reste > 0 ? (
            <Pressable
              onPress={() => charger(page + 1)}
              accessibilityRole="button"
              accessibilityLabel={`Charger ${Math.min(reste, PAR_PAGE)} photos de plus`}
              style={({ pressed }) => [s.suite, pressed ? { opacity: 0.8 } : null]}
            >
              {enCours
                ? <ActivityIndicator color={C.texte} />
                : <Text style={s.suiteTexte}>Voir {Math.min(reste, PAR_PAGE)} photos de plus</Text>}
            </Pressable>
          ) : null}

          {/* Une panne survenue APRÈS la première page ne doit pas effacer ce qui est déjà affiché :
              on la signale sous la grille, et le bouton reste. */}
          {panne ? (
            <Text style={s.souci}>La suite n'a pas pu être chargée. Réessayez dans un instant.</Text>
          ) : null}
        </>
      ) : (
        <Vide
          titre="Aucune photo dans cette galerie"
          texte="Les photos apparaissent ici une fois versées et traitées. Si vous en attendez, prévenez la production."
        />
      )}

      <Modal
        visible={!!agrandie}
        transparent
        animationType="fade"
        onRequestClose={() => setAgrandie(null)}
      >
        <Pressable
          onPress={() => setAgrandie(null)}
          accessibilityRole="button"
          accessibilityLabel="Fermer la photo"
          style={s.plein}
        >
          {agrandie ? (
            <Image
              source={{ uri: agrandie.url }}
              style={{ width: "100%", aspectRatio: agrandie.ratio }}
              contentFit="contain"
              transition={120}
            />
          ) : null}
        </Pressable>
      </Modal>
    </Ecran>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 26, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5 },
  attente: { paddingVertical: E.xl * 2, alignItems: "center" },

  carte: {
    gap: E.s, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
    // La carte entière est la cible : au bord d'un terrain, on ne vise pas un chevron.
    minHeight: TOUCHE + E.m * 2,
  },
  ligne: { flexDirection: "row", alignItems: "center", gap: E.s },
  nom: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  compte: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 12 },
  pastilles: { flexDirection: "row", flexWrap: "wrap", gap: E.xs, alignItems: "center" },

  retour: {
    flexDirection: "row", alignItems: "center", gap: 2,
    alignSelf: "flex-start", minHeight: TOUCHE, paddingRight: E.s,
  },
  retourTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 14.5 },

  grille: { flexDirection: "row", flexWrap: "wrap", gap: E.xs },
  vignette: { width: "100%", height: "100%", borderRadius: R.s, backgroundColor: C.surfaceHaute },

  suite: {
    minHeight: TOUCHE, alignItems: "center", justifyContent: "center",
    borderRadius: R.l, borderWidth: 1, borderColor: C.bordureForte,
    backgroundColor: "rgba(255,255,255,.05)",
  },
  suiteTexte: { color: C.texte, fontFamily: P.texteFort, fontSize: 14 },
  souci: { color: C.dangerTexte, fontFamily: P.texte, fontSize: 13, lineHeight: 19 },

  plein: {
    flex: 1, alignItems: "center", justifyContent: "center",
    // Le fond de la marque, opaque a 95 % : la photo se lit sans que l'ecran change de couleur.
    backgroundColor: C.fond + "F2", padding: E.m,
  },
});
