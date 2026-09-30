// LES GALERIES DU CLUB, EN NATIF (30/09/2026).
//
// Troisième des quatre écrans choisis par Fouka. Une liste d'albums, et la grille de photos quand
// on en ouvre un. C'est l'écran le plus visuel de l'espace club : une page web encadrée y perd le
// plus, parce qu'une grille d'images qui ne défile pas comme le reste du téléphone se remarque
// immédiatement.
//
// AUCUN PARTAGE, ET C'EST LA RÈGLE (v285, 26/09) : le jeton d'un lien n'arrive plus jusqu'au club,
// Club+ a supprimé son bouton « copier » le même jour, et Fouka l'a demandé — « il faut que ce lien
// ne soit pas envoyable ». On affiche donc ce qui existe, jamais une adresse. La carte dit combien
// de liens SportVision a confiés au club, pas comment les diffuser.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Ecran, Probleme, Vide } from "../Ecran";
import { Pastille } from "../Base";
import { lireGaleriesClub, lirePhotosGalerie, type GalerieClub, type PhotoGalerie } from "../../lib/club-galeries";
import { dateLongue } from "../../lib/dates";
import { C, E, R, TOUCHE } from "../../theme/couleurs";
import { P } from "../../theme/polices";

export function GaleriesClub({
  clubId, clubNom, surWeb,
}: {
  clubId: string;
  clubNom: string;
  surWeb: (chemin: string) => void;
}) {
  const [galeries, setGaleries] = useState<GalerieClub[] | null>(null);
  const [panne, setPanne] = useState(false);
  const [ouverte, setOuverte] = useState<GalerieClub | null>(null);
  /** L'équipe sur laquelle on filtre, ou `null` pour toutes. Sans objet quand on a un périmètre. */
  const [equipe, setEquipe] = useState<string | null>(null);

  const charger = useCallback(async () => {
    setPanne(false);
    try { setGaleries(await lireGaleriesClub(clubId)); }
    catch { setPanne(true); }
  }, [clubId]);

  useEffect(() => { charger(); }, [charger]);

  const liste = galeries ?? [];
  const photos = liste.reduce((t, g) => t + g.nbPhotos, 0);

  /**
   * « TOUT, TOUT, TOUT, MAIS BIEN CLASSÉ » (Fouka, 30/09/2026).
   *
   * Une direction voit toutes les galeries du club — six aujourd'hui, une centaine sur une saison.
   * Sans rangement, c'est un mur. Deux axes, et pas trois : l'ÉQUIPE pour filtrer, le MOIS pour
   * parcourir. Ce sont exactement ceux du calendrier, et réutiliser la même grammaire vaut mieux
   * que d'en inventer une seconde pour le même club.
   *
   * SANS ÉQUIPE EST UNE ÉQUIPE COMME UNE AUTRE dans ce filtre : cinq galeries sur six sont dans ce
   * cas, et les noyer dans « Toutes » les rendrait introuvables.
   */
  const SANS = "__sans__";
  const equipesPresentes = useMemo(() => {
    const vues = new Set<string>();
    for (const g of liste) vues.add(g.equipe ?? SANS);
    return [...vues].sort((a, b) => {
      if (a === SANS) return 1;
      if (b === SANS) return -1;
      return rangEquipe(a) - rangEquipe(b) || a.localeCompare(b, "fr");
    });
  }, [liste]);

  const filtrees = useMemo(
    () => (equipe ? liste.filter((g) => (g.equipe ?? SANS) === equipe) : liste),
    [liste, equipe],
  );

  /** Les galeries par mois, la plus récente d'abord. Une galerie sans date ferme la marche. */
  const parMois = useMemo(() => {
    const groupes = new Map<string, GalerieClub[]>();
    const triees = [...filtrees].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    for (const g of triees) {
      const cle = g.date ? g.date.slice(0, 7) : "";
      (groupes.get(cle) ?? groupes.set(cle, []).get(cle)!).push(g);
    }
    return [...groupes.entries()];
  }, [filtrees]);

  return (
    <>
      <Ecran enCours={galeries === null} teinte="cyan" rafraichir={charger}>
        <View style={{ gap: 4 }}>
          <Text style={s.titre}>Galeries</Text>
          <Text style={s.sous} numberOfLines={1}>
            {liste.length
              ? [
                  `${liste.length} galerie${liste.length > 1 ? "s" : ""}`,
                  photos ? `${photos} photos` : null,
                ].filter(Boolean).join(" · ")
              : clubNom}
          </Text>
        </View>

        {galeries === null ? (
          <View style={{ paddingVertical: E.xl * 2, alignItems: "center" }}>
            <ActivityIndicator color={C.accent} />
          </View>
        ) : panne ? (
          <Probleme surReessayer={charger} />
        ) : liste.length ? (
          <View style={{ gap: E.l }}>
            {/* Le filtre par équipe n'a de sens que pour qui en voit plusieurs : avec un périmètre,
                toutes les lignes portent la même. */}
            {/* Les puces servent aussi à un coach : il voit ses équipes ET les galeries sans
                catégorie, donc au moins deux groupes dès qu'il y a un plateau. */}
            {equipesPresentes.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: E.s, paddingRight: E.l }}>
                <Pressable
                  onPress={() => setEquipe(null)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: !equipe }}
                  accessibilityLabel="Toutes les équipes"
                  style={[s.puce, !equipe && s.puceActive]}
                >
                  <Text style={[s.puceTexte, !equipe && s.puceTexteActif]}>Toutes</Text>
                </Pressable>
                {equipesPresentes.map((nom) => {
                  const actif = nom === equipe;
                  return (
                    <Pressable
                      key={nom}
                      onPress={() => setEquipe(actif ? null : nom)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: actif }}
                      accessibilityLabel={nom === SANS ? "Galeries sans équipe" : `Galeries de ${nom}`}
                      style={[s.puce, actif && s.puceActive]}
                    >
                      <Text style={[s.puceTexte, actif && s.puceTexteActif]}>
                        {nom === SANS ? "Sans équipe" : nom}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            {parMois.map(([mois, dedans]) => (
              <View key={mois || "sans-date"} style={{ gap: E.s }}>
                <View style={s.enteteSection}>
                  <Text style={s.libelleSection}>{mois ? libelleMois(mois) : "Sans date"}</Text>
                  <Text style={s.compte}>{dedans.length}</Text>
                </View>
                {dedans.map((g) => (
                  <Pressable
                    key={g.id}
                    onPress={() => setOuverte(g)}
                    accessibilityRole="button"
                    accessibilityLabel={`${g.titre}, ${g.nbPhotos} photos`}
                    style={({ pressed }) => [s.carte, pressed ? { opacity: 0.85 } : null]}
                  >
                    {g.couvertureUrl ? (
                      <Image source={{ uri: g.couvertureUrl }} style={s.vignette} contentFit="cover" transition={160} />
                    ) : (
                      <View style={[s.vignette, s.vignetteVide]}>
                        <Ionicons name="images-outline" size={20} color={C.texteFaible} />
                      </View>
                    )}
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={s.nom} numberOfLines={2}>{g.titre}</Text>
                      {/* LE NOMBRE DE PHOTOS A SA PROPRE PASTILLE. Sur une seule ligne avec la
                          date, « dimanche 27 septembre · 85 photos » se coupait à « 85 pho… » —
                          le chiffre qu'on vient lire était précisément celui qui disparaissait. */}
                      <View style={s.ligneDetail}>
                        <Text style={s.detail} numberOfLines={1}>
                          {/* Le mois est déjà en en-tête : la ligne porte le jour, et l'équipe
                              seulement quand la liste en mélange plusieurs. */}
                          {[g.date ? dateLongue(g.date) : null, equipe ? null : g.equipe]
                            .filter(Boolean).join(" · ")}
                        </Text>
                        <View style={s.compteur}>
                          <Ionicons name="images" size={11} color={C.texteDoux} />
                          <Text style={s.compteurTexte}>{g.nbPhotos}</Text>
                        </View>
                      </View>
                      {/* Une galerie non publiée existe mais n'est visible de personne d'autre :
                          le dire évite d'appeler SportVision pour demander pourquoi les familles
                          ne la trouvent pas. */}
                      {!g.publiee ? <Pastille ton="alerte" texte="Pas encore publiée" /> : null}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={C.texteFaible} />
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
        ) : (
          <Vide
            titre="Aucune galerie"
            texte="Les galeries de vos matchs apparaîtront ici dès que SportVision les publie."
          />
        )}


        <Pressable
          onPress={() => surWeb("/galeries")}
          accessibilityRole="button"
          accessibilityLabel="Ouvrir les galeries dans Club plus"
          style={({ pressed }) => [s.lienWeb, pressed ? { opacity: 0.85 } : null]}
        >
          <Ionicons name="open-outline" size={16} color={C.texteDoux} />
          <Text style={s.lienWebTexte}>Identifier les joueurs sur les photos</Text>
          <Ionicons name="chevron-forward" size={15} color={C.texteFaible} />
        </Pressable>
      </Ecran>

      <GrilleGalerie galerie={ouverte} surFermer={() => setOuverte(null)} />
    </>
  );
}

/** La grille de photos d'une galerie, par pages de soixante. */
function GrilleGalerie({ galerie, surFermer }: { galerie: GalerieClub | null; surFermer: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [photos, setPhotos] = useState<PhotoGalerie[]>([]);
  const [page, setPage] = useState(0);
  const [enCours, setEnCours] = useState(false);
  const [fini, setFini] = useState(false);
  const [souci, setSouci] = useState(false);

  // Trois colonnes : à deux les photos sont grandes et on fait défiler longtemps, à quatre on ne
  // reconnaît plus personne. Les marges sont celles d'`Ecran`, pour que la grille s'aligne.
  const colonnes = 3;
  const cote = (width - E.l * 2 - E.xs * (colonnes - 1)) / colonnes;

  const charger = useCallback(async (p: number) => {
    if (!galerie) return;
    setEnCours(true); setSouci(false);
    try {
      const lot = await lirePhotosGalerie(galerie.id, p);
      setPhotos((avant) => (p === 0 ? lot : [...avant, ...lot]));
      if (lot.length < 60) setFini(true);
    } catch { setSouci(true); }
    finally { setEnCours(false); }
  }, [galerie]);

  useEffect(() => {
    if (!galerie) { setPhotos([]); setPage(0); setFini(false); return; }
    setPhotos([]); setPage(0); setFini(false);
    charger(0);
  }, [galerie, charger]);

  return (
    <Modal visible={!!galerie} animationType="slide" transparent onRequestClose={surFermer}>
      <View style={[s.plein, { paddingTop: insets.top }]}>
        <View style={s.barre}>
          <Pressable onPress={surFermer} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fermer la galerie" style={s.boutonBarre}>
            <Ionicons name="chevron-down" size={22} color={C.texte} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.barreTitre} numberOfLines={1}>{galerie?.titre ?? ""}</Text>
            <Text style={s.barreSous} numberOfLines={1}>
              {galerie ? `${galerie.nbPhotos} photos` : ""}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: E.l, paddingBottom: insets.bottom + E.xl, gap: E.xs }}
          onScroll={({ nativeEvent: n }) => {
            const enBas = n.layoutMeasurement.height + n.contentOffset.y >= n.contentSize.height - 400;
            if (enBas && !enCours && !fini) { const p = page + 1; setPage(p); charger(p); }
          }}
          scrollEventThrottle={200}
        >
          <View style={s.grille}>
            {photos.map((p) => (
              <Image
                key={p.id}
                source={{ uri: p.url }}
                style={{ width: cote, height: cote, borderRadius: R.s, backgroundColor: "rgba(255,255,255,.05)" }}
                contentFit="cover"
                transition={140}
                accessibilityLabel="Photo de la galerie"
              />
            ))}
          </View>
          {enCours ? <View style={{ paddingVertical: E.l, alignItems: "center" }}><ActivityIndicator color={C.accent} /></View> : null}
          {souci ? (
            <Pressable onPress={() => charger(page)} style={s.reessayer} accessibilityRole="button" accessibilityLabel="Réessayer">
              <Text style={s.reessayerTexte}>Réessayer</Text>
            </Pressable>
          ) : null}
          {fini && photos.length ? (
            <Text style={s.fin}>
              {photos.length} photo{photos.length > 1 ? "s" : ""}
              {photos.some((p) => !p.net) ? " · aperçus filigranés" : ""}
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const MOIS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

/** « 2026-09 » devient « Septembre 2026 ». */
function libelleMois(cle: string): string {
  return `${MOIS[Number(cle.slice(5, 7)) - 1] ?? ""} ${cle.slice(0, 4)}`.trim();
}

/** L'ordre d'un club : les jeunes par âge croissant, les séniors après. Même règle qu'ailleurs. */
function rangEquipe(nom: string): number {
  const age = nom.match(/\bU\s?(\d{1,2})\b/i);
  return age ? Number(age[1]) : 100;
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 26, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5 },
  carte: {
    flexDirection: "row", alignItems: "center", gap: E.m, padding: E.s, paddingRight: E.m,
    borderRadius: R.l, backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  vignette: { width: 76, height: 76, borderRadius: R.m, backgroundColor: "rgba(255,255,255,.05)" },
  vignetteVide: { alignItems: "center", justifyContent: "center" },
  nom: { color: C.texte, fontFamily: P.titreFort, fontSize: 15.5 },
  detail: { flexShrink: 1, color: C.texteDoux, fontFamily: P.texte, fontSize: 13 },
  ligneDetail: { flexDirection: "row", alignItems: "center", gap: E.s },
  compteur: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: R.pill,
    backgroundColor: "rgba(255,255,255,.05)", borderWidth: 1, borderColor: C.bordure,
  },
  compteurTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 11.5 },
  lienWeb: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    minHeight: TOUCHE, paddingHorizontal: E.m, borderRadius: R.l,
    backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: C.bordure,
  },
  lienWebTexte: { flex: 1, color: C.texteDoux, fontFamily: P.texteFort, fontSize: 14 },

  plein: { flex: 1, backgroundColor: C.fond },
  barre: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    paddingHorizontal: E.s, paddingBottom: E.s,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.bordure,
  },
  boutonBarre: { width: TOUCHE, height: TOUCHE, alignItems: "center", justifyContent: "center" },
  barreTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  barreSous: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5 },
  grille: { flexDirection: "row", flexWrap: "wrap", gap: E.xs },
  enteteSection: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: E.s },
  libelleSection: { color: C.texte, fontFamily: P.titre, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.9 },
  compte: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5 },
  puce: {
    paddingHorizontal: E.m, height: TOUCHE - 6, borderRadius: R.pill, justifyContent: "center",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  puceActive: { backgroundColor: "rgba(36,84,255,.20)", borderColor: "rgba(36,84,255,.55)" },
  puceTexte: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13 },
  puceTexteActif: { color: C.texte, fontFamily: P.texteFort },
  note: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },
  fin: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, textAlign: "center", paddingTop: E.m },
  reessayer: {
    alignSelf: "center", minHeight: 40, justifyContent: "center", paddingHorizontal: E.m,
    borderRadius: R.pill, backgroundColor: "rgba(255,255,255,.08)", borderWidth: 1, borderColor: C.bordureForte,
  },
  reessayerTexte: { color: C.texte, fontFamily: P.texteFort, fontSize: 13.5 },
});
