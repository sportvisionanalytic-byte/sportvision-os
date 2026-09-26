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
import {
  lireEtatReconnaissance, lirePhotosAIdentifier, lirePhotosDuJoueur, repondreCestMoi,
  type EtatReconnaissance, type PhotoAIdentifier, type PhotoDuJoueur,
} from "../../../src/lib/donnees";
import {
  acheterPass, etatDuPass, reprendreAchatsEnAttente,
  type EtatPass, type PassProposable,
} from "../../../src/lib/achat-pass";
import { cheminReconnaissanceEnfant } from "../../../src/lib/connect";
import { Ecran, Probleme, Vide } from "../../../src/ui/Ecran";
import { Erreur } from "../../../src/ui/Base";
import { C, E, R } from "../../../src/theme/couleurs";

// 26/09/2026 — LA COUPE N'EST PLUS FAITE ICI. La base ne rend que quatre photos a qui n'a pas pris
// le Pass (v282), et le vrai total a cote. Couper une seconde fois dans l'ecran aurait masque des
// photos qu'on a le droit de voir, et surtout : une limite posee dans l'application se contourne en
// rejouant la requete, alors que ces photos se vendent.

export default function Galerie() {
  // `ouverte` n'est plus lu (26/09/2026) : « la galerie est deverrouillee » ne dit RIEN de ce qui
  // se vend ici. En Full Communication elle l'est pour toutes les familles du club, et le Pass reste
  // pourtant a prendre — il n'ouvre pas l'acces, il retire le filigrane et rend toutes les photos.
  const { id, titre, joueur, club, pourEnfant } = useLocalSearchParams<{
    id: string; titre?: string; joueur?: string;
    club?: string; pourEnfant?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [photos, setPhotos] = useState<PhotoDuJoueur[]>([]);
  const [total, setTotal] = useState(0);
  const [chargement, setChargement] = useState(true);
  const [agrandie, setAgrandie] = useState<PhotoDuJoueur | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [panne, setPanne] = useState(false);
  const [etatPass, setEtatPass] = useState<EtatPass | null>(null);
  // Le produit du magasin, quand il y en a un a vendre. Extrait pour alleger les conditions.
  const pass: PassProposable | null =
    etatPass?.etat === "a_prendre" ? etatPass.offre : null;
  const [achatEnCours, setAchatEnCours] = useState(false);
  const [ouvertMaintenant, setOuvertMaintenant] = useState(false);
  const [reco, setReco] = useState<EtatReconnaissance | null>(null);
  const [aTrancher, setATrancher] = useState<PhotoAIdentifier[]>([]);
  const [enCours, setEnCours] = useState<string | null>(null);

  const charger = useCallback(async () => {
    if (!id || !joueur) { setChargement(false); return; }
    setChargement(true);
    setPanne(false);
    try {
      const r = await lirePhotosDuJoueur(id, joueur);
      setPhotos(r.photos); setTotal(r.total);
    }
    catch { setPanne(true); setPhotos([]); setTotal(0); }
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
      const [p, e, t] = await Promise.all([
        etatDuPass(club, joueur),
        lireEtatReconnaissance(joueur),
        // Ne rend rien tant que le Pass n'est pas pris (v287) : inutile de conditionner ici.
        lirePhotosAIdentifier(id, joueur),
      ]);
      if (vivant) {
        setEtatPass(p); setReco(e);
        // On ne propose a trancher QUE ce que la machine a suggere. Faire defiler cent photos dont
        // on ne dit rien n'est pas une question, c'est une corvee.
        setATrancher(t.filter((x) => x.suggeree && !x.mienne));
      }
    })();
    return () => { vivant = false; };
  }, [club, joueur, enfant, charger]);

  async function repondre(photo: PhotoAIdentifier, cestMoi: boolean) {
    if (!joueur) return;
    setEnCours(photo.id);
    const ok = await repondreCestMoi(photo.id, joueur, cestMoi);
    setEnCours(null);
    if (!ok) { setErreur("Votre réponse n'a pas pu être enregistrée. Réessayez."); return; }
    // La photo quitte la file, qu'on ait dit oui ou non : dans les deux cas elle est tranchee.
    setATrancher((l) => l.filter((x) => x.id !== photo.id));
    // « C'est moi » ajoute une photo a mes photos : on relit.
    if (cestMoi) charger();
  }

  async function lancerAchat() {
    if (!pass) return;
    setAchatEnCours(true); setErreur(null);
    const r = await acheterPass(pass, enfant);
    setAchatEnCours(false);
    if (r.etat === "ouvert") {
      setEtatPass({ etat: "acquis" }); setOuvertMaintenant(true); charger();
      // Acheter change la marche suivante : on relit l'etat pour la nommer tout de suite.
      if (joueur) lireEtatReconnaissance(joueur).then(setReco);
    }
    else if (r.etat === "erreur") setErreur(r.message);
    // « annule » : la personne a ferme la feuille de paiement d'Apple. Elle sait ce qu'elle a
    // fait, lui afficher un message serait du bruit.
  }



  // Tout ce que la base a rendu est affichable : c'est elle qui a deja decide combien.
  const visibles = photos;
  // Ce qui manque, et c'est le chiffre qui fait acheter : le total vrai moins ce qu'on montre.
  const restantes = Math.max(0, total - photos.length);
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
          /* 26/09/2026 — « RIEN POUR LE MOMENT » NE SUFFISAIT PAS.
             C'etait vrai et inutile : la famille ne pouvait pas savoir qu'il lui restait une chose a
             faire, ni laquelle. Les quatre marches sont le Pass, l'accord, la photo de reference,
             puis les photos retrouvees. On nomme celle qui vient, jamais les quatre a la fois. */
          <Vide
            titre={
              etatPass?.etat === "a_prendre" ? "Vos photos vous attendent"
                : reco && !reco.photoReference ? "Une étape vous attend"
                : "Rien pour le moment"
            }
            texte={
              // L'ORDRE DU TEXTE SUIT L'ORDRE REEL DES ETAPES. Il annoncait la photo de reference en
              // premier, alors que le Pass vient avant : une famille lisait donc une consigne qu'elle
              // ne devait pas encore suivre.
              etatPass?.etat === "a_prendre"
                ? "Le Pass ouvre vos photos de la saison. Une fois pris, vous pourrez vous faire reconnaître sur les photos du match."
                : !reco
                ? "Dès qu'une photo de vous sera repérée dans cette galerie, elle apparaîtra ici."
                : !reco.consentement
                  ? "Pour vous retrouver sur les photos, il faut d'abord votre accord. Cela se fait dans « Me reconnaître », et se retire quand vous voulez."
                  : !reco.photoReference
                    ? "Votre accord est enregistré. Il reste à déposer une photo de votre visage : c'est elle qui permet de vous retrouver sur les photos du match."
                    : !reco.empreinte
                      ? "Votre photo est enregistrée, son empreinte est en cours de calcul. Revenez dans quelques minutes."
                      : "Vous n'apparaissez sur aucune photo de cette galerie. Ce sont les prochains matchs qui la rempliront."
            }
          />
        )}

        {/* LA MARCHE SUIVANTE, ET UN SEUL BOUTON A LA FOIS.
            La page « Me reconnaître » vit dans Connect et s'ouvre DANS l'application, deja
            connectee : c'est la meme page pour tout le monde, avec son texte d'engagement et sa
            version — deux ecrans separes finiraient par faire accepter deux choses differentes sous
            le meme nom. */}

        {/* CE QUE CE BLOC DIT (revu le 25/09/2026, decision de Fouka de vendre via Apple).
            Il annonce ce qui manque et comment l'obtenir. Il ne nomme toujours AUCUN prix :
            celui qui compte est celui d'Apple, affiche sur le bouton juste en dessous, et deux
            prix a l'ecran dont un seul sera debite est une reclamation qui arrive.
            La mention du club reste, parce qu'elle est vraie : beaucoup de familles paieront au
            club en especes ou par virement, et leur acces s'ouvrira sans passer par ici. */}
        {/* 26/09/2026 — CE BLOC NE DEPEND PLUS DU MARQUAGE, ET C'EST UN CORRECTIF.
            Il n'apparaissait que s'il RESTAIT des photos a debloquer, donc jamais tant qu'aucune
            photo n'etait rattachee au joueur. Or c'est l'etat de depart de toute galerie : mesure
            du 26/09, 110 photos publiees et zero rattachement. Fouka : « ca ne me propose pas
            d'acheter le pass photo ».
            Une famille doit pouvoir prendre le Pass AVANT que son enfant soit reconnu : c'est meme
            l'ordre naturel, elle paie puis les photos arrivent. */}
        {/* « EST-CE BIEN VOUS ? » — la derniere marche du parcours decrit par Fouka.
            Elle vient AVANT le verrou et avant l'achat dans l'ecran, parce que c'est la seule qui
            demande quelque chose a la personne : tout le reste est de l'information.
            La base ne rend ces photos qu'a qui a pris le Pass (v287), donc ce bloc n'apparait jamais
            avant l'achat — aucune condition a ecrire ici. */}
        {aTrancher.length ? (
          <View style={{ gap: E.s }}>
            <Text style={s.sousTitre}>
              {aTrancher.length === 1
                ? "Une photo pourrait être vous"
                : `${aTrancher.length} photos pourraient être vous`}
            </Text>
            <Text style={s.bloqueTexte}>
              Votre réponse sert à vous retrouver sur les prochaines. Personne d'autre ne la voit.
            </Text>
            {aTrancher.slice(0, 1).map((photo) => (
              <View key={photo.id} style={{ gap: E.s }}>
                <Pressable onPress={() => setAgrandie(photo)} accessibilityRole="imagebutton" accessibilityLabel="Agrandir cette photo">
                  <Image
                    source={{ uri: photo.url }}
                    style={{ width: "100%", height: 260, borderRadius: R.m, backgroundColor: C.surface }}
                    contentFit="cover"
                    transition={140}
                  />
                </Pressable>
                <View style={{ flexDirection: "row", gap: E.s }}>
                  <Pressable
                    accessibilityRole="button" accessibilityLabel="Oui, c'est moi"
                    disabled={enCours === photo.id}
                    onPress={() => repondre(photo, true)}
                    style={({ pressed }) => [s.action, { flex: 1 }, pressed || enCours === photo.id ? { opacity: 0.85 } : null]}
                  >
                    {enCours === photo.id ? <ActivityIndicator color="#fff" />
                      : <Text style={s.actionTexte}>Oui, c'est moi</Text>}
                  </Pressable>
                  <Pressable
                    accessibilityRole="button" accessibilityLabel="Non, ce n'est pas moi"
                    disabled={enCours === photo.id}
                    onPress={() => repondre(photo, false)}
                    style={({ pressed }) => [s.action, s.actionCreuse, { flex: 1 }, pressed ? { opacity: 0.85 } : null]}
                  >
                    <Text style={[s.actionTexte, { color: C.texte }]}>Non</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* 26/09/2026, SECONDE CORRECTION DU MEME BLOC — et celle-ci vient d'une mesure.
            Je conditionnais l'offre du Pass a « la galerie n'est pas deverrouillee ». Or en Full
            Communication elle l'est POUR TOUT LE MONDE : le contrat du club donne le droit de voir.
            Mesure sur le compte de Nathan Girard, U16A : galerie visible, deverrouillee = vrai, zero
            photo de lui, et aucune offre de Pass. C'est ce que Fouka constatait.
            Voir et voir SANS FILIGRANE sont deux choses. `pass` vaut deja null quand le Pass est
            acquis (passProposable le verifie) : sa seule presence suffit donc a dire qu'il y a
            quelque chose a vendre. */}
        {restantes > 0 || (pass && !ouvertMaintenant) ? (
          <View style={s.bloque}>
            <Ionicons name="lock-closed" size={16} color={C.alerte} />
            <Text style={s.bloqueTexte}>
              {restantes > 0
                ? `${restantes === 1 ? "1 autre photo de vous" : `${restantes} autres photos de vous`} dans cette galerie. `
                : "Le Pass ouvre toutes vos photos de la saison, dans cette galerie et les suivantes. "}
              {/* LE TEXTE DÉPEND DU BOUTON, ET C'EST UN CORRECTIF (26/09/2026).
                  Il annonçait « votre accès s'ouvre ici » en toutes circonstances, alors que le
                  bouton n'apparaît que si le magasin connaît vraiment le produit. Sur un appareil
                  où il manque, l'écran promettait donc quelque chose qu'il ne tenait pas — et
                  Fouka l'a constaté avant moi : « je vois toujours pas où payer le pass ».
                  Sans bouton, on décrit le fonctionnement sans inviter à acheter ailleurs : c'est
                  permis par la règle 3.1.1, contrairement à un renvoi vers un paiement externe. */}
              {pass
                ? "Votre accès s'ouvre ici, ou auprès de votre club si vous préférez régler avec lui."
                : "Votre accès est géré par votre club : il s'ouvre dès qu'il est actif."}
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
        {pass && !ouvertMaintenant ? (
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

        {/* 26/09/2026 — CE BOUTON NE S'AFFICHE PLUS AVANT LE PAIEMENT.
            Fouka : « ca ne me met pas d'acheter le pass, ca me met directement deposer ma photo de
            reference ». On reclamait une photo du visage d'un enfant a une famille qui n'avait rien
            paye — dans le mauvais ordre, et pour une donnee biometrique.
            La condition tient au fait que les trois etats du Pass sont maintenant distincts :
            « a_prendre » veut dire qu'il reste a payer, et rien d'autre ne se demande avant. */}
        {etatPass?.etat !== "a_prendre" && reco && (!reco.consentement || !reco.photoReference) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={reco.consentement ? "Déposer ma photo de référence" : "Donner mon accord pour être reconnu"}
            // LE CHEMIN DIFFERE SELON QUI DEMANDE, et ce n'est pas un detail : mesure du 25/09,
            // pour un compte parent /reconnaissance repond 307 et renvoie vers /particulier — cette
            // page-la est celle d'un JOUEUR qui donne son propre accord. Un parent consent pour un
            // enfant precis, et la page vit donc sous la fiche de cet enfant.
            onPress={() => router.push({
              pathname: "/connect/[page]",
              params: enfant
                ? { page: "reconnaissance", chemin: cheminReconnaissanceEnfant("club", enfant) }
                : { page: "reconnaissance" },
            })}
            style={({ pressed }) => [s.action, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={s.actionTexte}>
              {reco.consentement ? "Déposer ma photo de référence" : "Me reconnaître sur les photos"}
            </Text>
          </Pressable>
        ) : null}

        {/* « OUVRIR LA COLLECTION COMPLETE » EST RETIRE (26/09/2026), et ce n'est pas une
            regression : c'est la regle metier, enoncee par Fouka. « Les joueurs, parents, ils
            doivent voir uniquement leurs photos via l'achat du pass. Ils ne peuvent pas voir les
            galeries ou acheter des galeries. »
            Ce bouton ouvrait la page publique de la galerie DANS LE NAVIGATEUR — ce que Fouka a
            constate : « ouvrir la collection, ca met vers un lien externe ». Le reparer aurait
            voulu dire donner aux familles un acces qu'elles ne doivent pas avoir. Parcourir la
            galerie entiere est reserve au club : coach, president, community manager, depuis
            Club+. */}
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
  // « Non » ne doit pas avoir le meme poids visuel que « Oui, c'est moi » : la reponse attendue est
  // la confirmation, le refus est l'exception. Deux boutons pleins cote a cote donnent l'impression
  // d'un choix cornelien la ou il n'y a qu'une question simple.
  actionCreuse: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.bordureForte },
  sousTitre: { color: C.texte, fontSize: 16, fontWeight: "700" },
  plein: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  pleinImage: { width: "100%", height: "86%" },
  fermer: {
    position: "absolute", right: E.l, width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.14)",
  },
});
