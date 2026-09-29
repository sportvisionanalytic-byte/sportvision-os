// L'espace club et l'espace production, avec une VRAIE coque native (29/09/2026).
//
// CE QUI CHANGEAIT TOUT POUR FOUKA. « J'ai l'impression que tu as juste foutu la page web dans
// l'app, alors que je veux une vraie refonte comme Connect. » C'était exact : Club+ arrivait dans
// un cadre nu — une barre, un titre, rien d'autre — et toute la navigation restait celle d'un site
// vu dans une fenêtre. Ce qu'on touche pour se déplacer doit être natif ; c'est ça qui fait la
// différence entre une application et un site encadré.
//
// CE QUE CET ÉCRAN APPORTE
//   - une barre d'onglets en bas, comme dans l'espace personnel : Accueil, Calendrier, Équipes ;
//   - un menu NATIF pour tout le reste, rangé comme dans Club+, qui s'ouvre d'un geste ;
//   - un profil NATIF, où l'on change d'espace et où l'on se déconnecte — plus de bouton
//     « Changer » posé en haut à droite, que Fouka trouvait à juste titre inélégant ;
//   - UNE SEULE vue web, dont on change l'adresse. Quatre vues superposées garderaient chacune sa
//     session et son ferraillage en mémoire, sur un téléphone qui n'en a pas besoin.
//
// CE QUI RESTE SERVI PAR LE SITE : le contenu, et les droits. Une section ouverte sans
// autorisation affiche son propre cadenas, décidé par Club+. L'application ne juge rien : elle
// propose, et c'est le site qui tranche. Refaire cette règle ici, ce serait en entretenir deux.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { VueConnect, type PoigneeVueConnect } from "../src/ui/VueConnect";
import {
  cookiesClubPlusDisponibles, marquerCookiesClubPlusPoses, oublierCookiesClubPlus,
  sourceClubPlus, sourceClubPlusDirecte, type SourceConnect,
} from "../src/lib/connect";
import { ADRESSES, oublierPorte, type Porte } from "../src/lib/espaces";
import { useSession } from "../src/lib/session";
import { MENU_CLUB, ONGLETS_CLUB, libelleDuChemin } from "../src/lib/sections-club";
import { C, E, R, TOUCHE } from "../src/theme/couleurs";
import { P } from "../src/theme/polices";

const TITRES: Record<Exclude<Porte, "personnel">, string> = {
  club: "Espace club",
  sportvision: "Équipe de production",
};

export default function EspaceWeb() {
  const { porte } = useLocalSearchParams<{ porte?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const vue = useRef<PoigneeVueConnect>(null);
  const { profil, deconnexion, chargement: sessionEnCours } = useSession();

  const cle: Exclude<Porte, "personnel"> = porte === "sportvision" ? "sportvision" : "club";
  // La coque à onglets est celle de Club+. L'espace de production garde la vue simple : ses écrans
  // n'ont pas la même charpente, et lui inventer une navigation qui ne colle pas serait pire.
  const avecOnglets = cle === "club";
  const racine = `${ADRESSES[cle]}/clubplus`;

  const [source, setSource] = useState<SourceConnect | null>(null);
  const [sansSession, setSansSession] = useState(false);
  const [panne, setPanne] = useState(false);
  const [charge, setCharge] = useState(false);
  const [peutReculer, setPeutReculer] = useState(false);
  /** Le chemin affiché, pour savoir quel onglet allumer et quoi écrire dans la barre. */
  const [chemin, setChemin] = useState("/dashboard");
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [profilOuvert, setProfilOuvert] = useState(false);

  const changerEspace = useCallback(async () => {
    await oublierPorte();
    router.replace("/bienvenue");
  }, [router]);

  // LE CHEMIN COURT, ET SON REPLI. Une fois les cookies posés, la page s'ouvre directement : un
  // aller-retour au lieu de trois. On ne devine pas s'ils tiennent encore — si Club+ renvoie vers
  // sa page de connexion, on refait le pont (voir surAdresse). Le pire cas est l'ancien
  // comportement, jamais une impasse.
  const preparer = useCallback(async (forcerLePont = false) => {
    setPanne(false); setCharge(false); setSource(null);
    if (!forcerLePont && cookiesClubPlusDisponibles()) {
      setSansSession(false);
      setSource(sourceClubPlusDirecte(chemin));
      return;
    }
    const s = await sourceClubPlus();
    if (!s) { setSansSession(true); return; }
    setSansSession(false);
    setSource(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ON ATTEND QUE LA SESSION SOIT LUE AVANT DE DÉCIDER QU'IL N'Y EN A PAS (29/09/2026).
  //
  // CE N'EST PAS LA CAUSE DU DÉFAUT DE FOUKA, et il faut le dire ici pour que personne ne croie
  // l'avoir réglé en lisant cette ligne. J'ai d'abord accusé une course au démarrage ; c'était
  // faux : app/index.tsx attend déjà `chargement` avant d'envoyer ici. Le vrai défaut était dans
  // bienvenue.tsx, qui ouvrait l'espace club sans session et sans moyen d'en obtenir une.
  //
  // La garde reste, parce qu'elle est juste : cet écran vit à la racine, hors du groupe
  // (app)/_layout.tsx qui, lui, attend `chargement`. Tout futur chemin qui mènerait ici sans
  // passer par l'aiguillage afficherait « plus connecté » à quelqu'un de connecté, et
  // DÉFINITIVEMENT — rien ne relance la préparation quand la session arrive une fraction de
  // seconde plus tard. Une garde à l'endroit où la décision se prend, pas chez ceux qui appellent.
  useEffect(() => { if (!sessionEnCours) preparer(); }, [preparer, sessionEnCours]);

  // CLUB+ RENVOIE VERS SA PAGE DE CONNEXION QUAND IL NE RECONNAÎT PLUS LA SESSION. Premier renvoi :
  // les cookies ont expiré, on refait le pont. Second : c'est une déconnexion voulue — on oublie
  // l'espace mémorisé et on ramène au choix, sinon l'application rouvrirait Club+ au lancement
  // suivant et le pont l'y reconnecterait, ce qui rendrait la déconnexion impossible.
  const dejaRefait = useRef(false);
  const surAdresse = useCallback((url: string) => {
    const apresRacine = url.startsWith(racine) ? url.slice(racine.length) : "";
    if (apresRacine) setChemin(apresRacine.split("?")[0] || "/dashboard");
    if (!url.includes("/auth/login") && !url.includes("/clubplus/login")) {
      // Une page de Club+ atteinte hors de /auth/ : les cookies sont posés, le raccourci vaut.
      if (url.startsWith(ADRESSES[cle]) && !url.includes("/auth/")) marquerCookiesClubPlusPoses();
      return;
    }
    oublierCookiesClubPlus();
    if (dejaRefait.current) { changerEspace(); return; }
    dejaRefait.current = true;
    preparer(true);
  }, [preparer, changerEspace, racine]);

  const aller = useCallback((c: string) => {
    setChemin(c);
    setMenuOuvert(false);
    vue.current?.allerA(`${racine}${c}`);
  }, [racine]);

  const ongletActif = ONGLETS_CLUB.find((o) => chemin.startsWith(o.chemin))?.cle;

  return (
    <View style={{ flex: 1, backgroundColor: C.fond }}>
      <View style={[s.barre, { paddingTop: insets.top + 6 }]}>
        {/* LE RETOUR SUIT LA PAGE, PUIS RAMÈNE À L'ACCUEIL. Un bouton grisé n'est pas une sortie :
            quand la page n'a plus d'historique, il ramène au tableau de bord du club. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={peutReculer ? "Retour" : "Revenir à l'accueil du club"}
          onPress={() => (peutReculer ? vue.current?.reculer() : aller("/dashboard"))}
          hitSlop={10}
          style={s.boutonBarre}
        >
          <Ionicons name="chevron-back" size={20} color={C.texte} />
        </Pressable>

        <Text style={s.titre} numberOfLines={1}>
          {avecOnglets ? libelleDuChemin(chemin) : TITRES[cle]}
        </Text>

        {/* PLUS DE BOUTON « CHANGER » EN HAUT (décision de Fouka, 29/09) : « pour changer, il faut
            que tu ailles dans profil, se déconnecter ». On sort d'un espace par là où l'on sort.
            Et ce bouton EST cette sortie, donc il est là dans TOUS LES CAS (30/09/2026). Il ne
            s'affichait qu'avec la barre d'onglets, c'est-à-dire pour l'espace club seulement.
            L'espace de production, lui, n'avait alors AUCUNE sortie : pas d'onglets, pas de menu,
            pas de profil, et une flèche de retour qui ne fait que reculer dans la page web. Un
            écran fermé, et il est encore atteignable — l'espace n'est plus proposé dans l'accueil
            depuis le 25/09, mais le choix mémorisé sur un téléphone d'avant y renvoie à chaque
            lancement. Aucun écran de cette application ne se garde sans issue. */}
        <Pressable
          accessibilityRole="button" accessibilityLabel="Mon compte"
          onPress={() => setProfilOuvert(true)} hitSlop={10} style={s.boutonBarre}
        >
          <Ionicons name="person-circle-outline" size={23} color={C.texteDoux} />
        </Pressable>
      </View>

      {sansSession ? (
        <View style={s.centre}>
          <Text style={s.grosTexte}>Vous n'êtes plus connecté</Text>
          <Text style={s.petitTexte}>Reconnectez-vous et cet espace s'ouvrira sans rien redemander.</Text>
          {/* SE CONNECTER, ET C'EST LA SORTIE QUI MANQUAIT. Le seul bouton proposé ramenait au
              choix d'espace, d'où « Espace club » renvoyait ici : une boucle fermée, sans aucun
              endroit pour saisir son mot de passe. Un écran qui dit « reconnectez-vous » doit
              porter le moyen de le faire. Après la connexion, on revient dans cet espace-ci :
              le choix est mémorisé et connexion.tsx le relit. */}
          <Pressable
            accessibilityRole="button" accessibilityLabel="Se connecter"
            onPress={() => router.replace("/connexion")}
            style={({ pressed }) => [s.action, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={s.actionTexte}>Se connecter</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button" accessibilityLabel="Choisir mon espace"
            onPress={changerEspace}
            style={({ pressed }) => [s.lien, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={s.lienTexte}>Choisir mon espace</Text>
          </Pressable>
        </View>
      ) : panne ? (
        <View style={s.centre}>
          <Text style={s.grosTexte}>La page n'a pas répondu</Text>
          <Text style={s.petitTexte}>
            Vérifiez votre connexion. Rien n'est perdu, vos données sont sur nos serveurs.
          </Text>
          <Pressable
            accessibilityRole="button" accessibilityLabel="Réessayer"
            onPress={() => { dejaRefait.current = false; preparer(); }}
            style={({ pressed }) => [s.action, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={s.actionTexte}>Réessayer</Text>
          </Pressable>
        </View>
      ) : source ? (
        <VueConnect
          ref={vue}
          source={source}
          surHistorique={setPeutReculer}
          surAdresse={surAdresse}
          surChargement={() => setCharge(true)}
          surPanne={() => { setCharge(true); setPanne(true); }}
        />
      ) : null}

      {!charge && !sansSession && !panne ? (
        <View style={s.attente} pointerEvents="none"><ActivityIndicator color={C.accent} /></View>
      ) : null}

      {/* LA BARRE D'ONGLETS. Trois destinations quotidiennes et un menu : au-delà, les libellés se
          coupent et l'onglet actif devient difficile à lire — même règle que l'espace personnel. */}
      {avecOnglets ? (
        <View style={[s.onglets, { paddingBottom: insets.bottom || E.s }]}>
          {ONGLETS_CLUB.map((o) => {
            const actif = ongletActif === o.cle;
            return (
              <Pressable
                key={o.cle}
                accessibilityRole="tab"
                accessibilityState={{ selected: actif }}
                accessibilityLabel={o.libelle}
                onPress={() => aller(o.chemin)}
                style={s.onglet}
              >
                <Ionicons name={o.icone as never} size={21} color={actif ? C.accentClair : C.texteDoux} />
                <Text style={[s.ongletTexte, actif ? { color: C.accentClair } : null]}>{o.libelle}</Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button" accessibilityLabel="Ouvrir le menu"
            onPress={() => setMenuOuvert(true)} style={s.onglet}
          >
            <Ionicons name="grid-outline" size={21} color={menuOuvert ? C.accentClair : C.texteDoux} />
            <Text style={[s.ongletTexte, menuOuvert ? { color: C.accentClair } : null]}>Menu</Text>
          </Pressable>
        </View>
      ) : null}

      {/* LE MENU, rangé comme dans Club+ : mêmes titres, même ordre. Une famille de coachs qui
          passe de l'ordinateur au téléphone doit retrouver les mêmes mots au même endroit. */}
      <Modal visible={menuOuvert} animationType="slide" transparent onRequestClose={() => setMenuOuvert(false)}>
        <Pressable style={s.voile} onPress={() => setMenuOuvert(false)} accessibilityLabel="Fermer le menu" />
        <View style={[s.feuille, { paddingBottom: insets.bottom + E.m }]}>
          <View style={s.poignee} />
          <ScrollView contentContainerStyle={{ paddingBottom: E.l }} showsVerticalScrollIndicator={false}>
            {MENU_CLUB.map((groupe) => (
              <View key={groupe.titre} style={{ marginTop: E.m }}>
                <Text style={s.groupeTitre}>{groupe.titre}</Text>
                {groupe.entrees.map((e) => (
                  <Pressable
                    key={e.cle}
                    accessibilityRole="button" accessibilityLabel={e.libelle}
                    onPress={() => aller(e.chemin)}
                    style={({ pressed }) => [s.ligne, pressed ? { backgroundColor: "rgba(255,255,255,.05)" } : null]}
                  >
                    <View style={s.rond}><Ionicons name={e.icone as never} size={17} color={C.texteDoux} /></View>
                    <Text style={s.ligneTexte}>{e.libelle}</Text>
                    <Ionicons name="chevron-forward" size={16} color={C.texteFaible} />
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* LE PROFIL. C'est ici qu'on change d'espace et qu'on se déconnecte — et nulle part
          ailleurs, pour que le geste soit délibéré. */}
      <Modal visible={profilOuvert} animationType="slide" transparent onRequestClose={() => setProfilOuvert(false)}>
        <Pressable style={s.voile} onPress={() => setProfilOuvert(false)} accessibilityLabel="Fermer" />
        <View style={[s.feuille, { paddingBottom: insets.bottom + E.m }]}>
          <View style={s.poignee} />
          <View style={{ gap: 3, paddingTop: E.s, paddingBottom: E.m }}>
            <Text style={s.grosTexte}>{profil?.prenom || "Mon compte"}</Text>
            <Text style={s.petitTexte}>{profil?.clubNom || TITRES[cle]}</Text>
          </View>
          <Pressable
            accessibilityRole="button" accessibilityLabel="Changer d'espace"
            onPress={() => { setProfilOuvert(false); changerEspace(); }}
            style={({ pressed }) => [s.ligne, pressed ? { backgroundColor: "rgba(255,255,255,.05)" } : null]}
          >
            <View style={s.rond}><Ionicons name="swap-horizontal" size={17} color={C.texteDoux} /></View>
            <Text style={s.ligneTexte}>Changer d'espace</Text>
            <Ionicons name="chevron-forward" size={16} color={C.texteFaible} />
          </Pressable>
          <Pressable
            accessibilityRole="button" accessibilityLabel="Se déconnecter"
            onPress={async () => { setProfilOuvert(false); await oublierPorte(); await deconnexion(); }}
            style={({ pressed }) => [s.ligne, pressed ? { backgroundColor: "rgba(255,255,255,.05)" } : null]}
          >
            <View style={s.rond}><Ionicons name="log-out-outline" size={17} color={C.alerteTexte} /></View>
            <Text style={[s.ligneTexte, { color: C.alerteTexte }]}>Se déconnecter</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  barre: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    paddingHorizontal: E.s, paddingBottom: E.s,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.bordure,
  },
  boutonBarre: { width: TOUCHE, height: TOUCHE, alignItems: "center", justifyContent: "center" },
  titre: { flex: 1, color: C.texte, fontFamily: P.titreFort, fontSize: 16.5, textAlign: "center" },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: E.xl, gap: E.s },
  grosTexte: { color: C.texte, fontFamily: P.titreFort, fontSize: 18, textAlign: "center" },
  petitTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 14.5, lineHeight: 21, textAlign: "center", maxWidth: 320 },
  lien: { paddingVertical: E.s, paddingHorizontal: E.m, marginTop: E.xs },
  lienTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 14, textAlign: "center" },
  action: {
    marginTop: E.m, paddingHorizontal: E.xl, minHeight: TOUCHE, borderRadius: R.m,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.06)", borderWidth: 1, borderColor: C.bordure,
  },
  actionTexte: { color: C.texte, fontFamily: P.texteFort, fontSize: 15 },
  attente: {
    position: "absolute", left: 0, right: 0, bottom: 0, top: 96,
    alignItems: "center", justifyContent: "center", backgroundColor: C.fond,
  },
  onglets: {
    flexDirection: "row", paddingTop: E.xs,
    backgroundColor: C.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.bordure,
  },
  onglet: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 4, minHeight: TOUCHE },
  ongletTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 11 },
  voile: { ...(StyleSheet.absoluteFill as object), backgroundColor: "rgba(0,0,0,.55)" },
  feuille: {
    position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "82%",
    backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl,
    paddingHorizontal: E.l, paddingTop: E.s,
    borderTopWidth: 1, borderTopColor: C.bordure,
  },
  poignee: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: C.bordure, marginBottom: E.s },
  groupeTitre: {
    color: C.texteFaible, fontFamily: P.texteFort, fontSize: 11.5,
    textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4, marginTop: E.xs,
  },
  ligne: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    minHeight: TOUCHE, borderRadius: R.m, paddingHorizontal: E.s,
  },
  rond: {
    width: 32, height: 32, borderRadius: R.m, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.05)", borderWidth: 1, borderColor: C.bordure,
  },
  ligneTexte: { flex: 1, color: C.texte, fontFamily: P.texte, fontSize: 15 },
});
