// Une galerie, vue de l'intérieur (22/09/2026).
//
// Ce que la famille vient chercher, ce n'est pas « la galerie » : ce sont les photos où on la
// reconnaît. L'écran ouvre donc directement dessus. Tant que l'accès n'est pas acheté, six
// aperçus, pas un de plus : c'est la règle du site, et elle est tenue en base, pas ici.
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Dimensions, Linking, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useDonnees, oublier } from "../../../src/lib/cache";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  declarerMonNumero, lireEtatReconnaissance, lireMonNumero, lirePhotosAIdentifier, lirePhotosDuJoueur,
  repondreCestMoi,
  type EtatReconnaissance, type PhotoAIdentifier, type PhotoDuJoueur,
} from "../../../src/lib/donnees";
import { MOTIF_LISIBLE, acheterPass, dernierMotif, etatDuPass, reprendreAchatsEnAttente, type EtatPass, type PassProposable } from "../../../src/lib/achat-pass";
import { cheminReconnaissanceEnfant } from "../../../src/lib/connect";
import { Ecran, Probleme, Vide } from "../../../src/ui/Ecran";
import { Erreur } from "../../../src/ui/Base";
import { C, E, R, TOUCHE } from "../../../src/theme/couleurs";
import { retourner } from "../../../src/lib/retour";
import { enregistrerPhoto, enregistrerToutes } from "../../../src/lib/enregistrer-photo";
import { legende, partagerPhoto } from "../../../src/lib/partager-photo";

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


  // 27/09/2026 (v299) — CE QUE L'ECRAN MONTRE N'EST PAS TOUJOURS « VOS PHOTOS ». Tant que la famille
  // n'a ni Pass ni photo marquee, la base rend quatre photos de la galerie, filigranees, pour qu'il
  // y ait une raison d'acheter : en production, 3 399 photos en ligne et ZERO marquage, donc l'ecran
  // etait vide et ne vendait rien. Annoncer « vos photos » devant ces quatre-la ferait chercher son
  // enfant dans des photos d'ambiance.

  // « A ce match-la, j'etais le numero 7 » (27/09/2026, demande de Fouka). Un moteur de visages ne
  // rend rien sur une photo de dos : le dossard y est lisible, mais lui seul ne dit pas QUI portait
  // ce numero. La famille le sait, et comme le numero change d'un match a l'autre en jeunes, il se
  // declare ICI, sur la galerie du match, et pas une fois pour la saison.
  const [numero, setNumero] = useState("");
  const [numeroEnCours, setNumeroEnCours] = useState(false);
  const [numeroDit, setNumeroDit] = useState<string | null>(null);
  /** Le numéro déjà déclaré pour ce match. Tant qu'il existe, on ne repose pas la question. */
  const [numeroConnu, setNumeroConnu] = useState<number | null>(null);
  const [modifierNumero, setModifierNumero] = useState(false);
  const [agrandie, setAgrandie] = useState<PhotoDuJoueur | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  /** Un message de reussite, distinct de l'erreur : « photo enregistree » n'est pas un probleme. */
  const [message, setMessage] = useState<string | null>(null);
  const [etatPass, setEtatPass] = useState<EtatPass | null>(null);
  // Le produit du magasin, quand il y en a un a vendre. Extrait pour alleger les conditions.
  const pass: PassProposable | null =
    etatPass?.etat === "a_prendre" ? etatPass.offre : null;
  const [achatEnCours, setAchatEnCours] = useState(false);
  const [ouvertMaintenant, setOuvertMaintenant] = useState(false);
  const [reco, setReco] = useState<EtatReconnaissance | null>(null);
  const [aTrancher, setATrancher] = useState<PhotoAIdentifier[]>([]);
  const [enCours, setEnCours] = useState<string | null>(null);

  // 29/09/2026 — L'ECRAN NE REPART PLUS DE ZERO. Revenir sur une galerie deja vue affichait un
  // vide et une roue pendant une a deux secondes avant de remontrer exactement les memes photos.
  // On garde la derniere reponse et on l'affiche tout de suite ; la relecture se fait derriere.
  const { donnees, chargement, erreur: souci, relire: charger } = useDonnees<{
    photos: PhotoDuJoueur[]; total: number; apercuGalerie: boolean;
  }>(
    id && joueur ? `photos-joueur:${id}:${joueur}` : null,
    () => lirePhotosDuJoueur(id as string, joueur as string),
    [id, joueur],
  );
  const photos = donnees?.photos ?? [];
  const total = donnees?.total ?? 0;
  // 27/09/2026 (v299) — CE QUE L'ECRAN MONTRE N'EST PAS TOUJOURS « VOS PHOTOS ». Tant que la famille
  // n'a ni Pass ni photo marquee, la base rend quatre photos de la galerie, filigranees, pour qu'il
  // y ait une raison d'acheter : en production, 3 399 photos en ligne et ZERO marquage, donc l'ecran
  // etait vide et ne vendait rien. Annoncer « vos photos » devant ces quatre-la ferait chercher son
  // enfant dans des photos d'ambiance.
  const apercuGalerie = donnees?.apercuGalerie ?? false;
  const panne = !!souci && donnees === undefined;

  // Deux choses au chargement, et dans cet ordre : rattraper un achat deja paye dont l'acces ne
  // s'est jamais ouvert (reseau coupe au mauvais moment), PUIS seulement regarder s'il reste
  // quelque chose a vendre. L'inverse proposerait d'acheter ce qui est deja paye.
  const enfant = pourEnfant === "1" ? joueur : undefined;

  // ON RELIT L'ÉTAT EN REVENANT SUR L'ÉCRAN (28/09/2026).
  //
  // L'accord de reconnaissance et la photo de référence se donnent dans Connect, qui s'ouvre dans
  // une vue web par-dessus cet écran. Au retour, l'écran n'était pas remonté : il gardait l'état
  // chargé AVANT le dépôt et continuait d'annoncer l'étape déjà faite. Fouka : « ça met photo
  // enregistrée, et quand je reviens dans mes photos il y a écrit une étape vous attend, alors que
  // j'ai déjà déposé ».
  //
  // Un écran qui réclame ce qu'on vient de faire fait douter de ce qu'on vient de faire. On relit
  // donc à chaque retour — `tour` change, l'effet ci-dessous se rejoue.
  const [tour, setTour] = useState(0);
  useFocusEffect(useCallback(() => { setTour((n) => n + 1); }, []));

  useEffect(() => {
    let vivant = true;
    (async () => {
      if (!club || !joueur) return;
      if (await reprendreAchatsEnAttente(club, joueur, enfant)) {
        if (!vivant) return;
        setOuvertMaintenant(true);
        toutRelire();
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
        if (id && joueur) lireMonNumero(id, joueur).then((n) => { if (vivant) setNumeroConnu(n); });
        // On ne propose a trancher QUE ce que la machine a suggere. Faire defiler cent photos dont
        // on ne dit rien n'est pas une question, c'est une corvee.
        setATrancher(t.filter((x) => x.suggeree && !x.mienne));
      }
    })();
    return () => { vivant = false; };
  }, [club, joueur, enfant, charger, tour]);

  /** L'ENREGISTREMENT DANS LA PELLICULE (28/09/2026).
   *  Fouka : « faut qu'il puisse telecharger toutes ses photos du match. » L'app n'avait aucun
   *  moyen d'enregistrer quoi que ce soit : une famille payait le Pass, regardait ses photos, et
   *  repartait sans rien — alors que c'est la seule chose qu'elle vient chercher. */
  const [enregistrement, setEnregistrement] = useState<string | null>(null);

  async function enregistrerUne(photo: { url: string; id: string }) {
    setEnregistrement("une"); setErreur(null);
    const r = await enregistrerPhoto(photo.url, `sportvision-${photo.id}.jpg`);
    setEnregistrement(null);
    if (r.etat === "enregistre") setMessage("Photo enregistrée dans vos photos.");
    else if (r.etat === "refuse") setErreur("SportVision n'a pas accès à vos photos. Réglages → SportVision → Photos.");
    else setErreur(r.message);
  }

  /** PARTAGER UNE PHOTO. La légende part dans le presse-papier : aucune application de partage
   *  n'accepte qu'on lui impose un texte, et l'écran doit donc DIRE qu'elle est copiée — sinon
   *  personne ne cite SportVision, faute de savoir qu'il y a quelque chose à coller. */
  const [partage, setPartage] = useState(false);
  async function partagerUne(photo: { url: string; id: string }) {
    setErreur(null); setMessage(null); setPartage(true);
    const r = await partagerPhoto(photo.url, `sportvision-${photo.id}.jpg`, titre);
    setPartage(false);
    if (r.etat === "partage") setMessage(`Légende copiée : « ${legende(titre)} ». Collez-la dans votre publication.`);
    else if (r.etat === "indisponible") setErreur("Le partage n'est pas disponible sur cet appareil.");
    else setErreur(r.message);
  }

  /** RETIRER UNE PHOTO DE SA GALERIE. Un refus n'efface rien et ne retire rien à personne
   *  d'autre : les marquages sont par sportif, la même photo appartient à tous ceux qui y sont. */
  async function retirerUne(photo: { id: string }) {
    if (!joueur) return;
    setEnCours("retrait"); setErreur(null); setMessage(null);
    const ok = await repondreCestMoi(photo.id, joueur, false);
    setEnCours(null);
    if (!ok) {
      setErreur("Cette photo a été identifiée par le club : demandez-lui de la retirer.");
      return;
    }
    setAgrandie(null);
    setMessage("Photo retirée de vos photos.");
    toutRelire();
  }

  async function enregistrerLot() {
    if (!photos.length) return;
    setErreur(null); setEnregistrement(`0 sur ${photos.length}`);
    const r = await enregistrerToutes(photos, (fait, total) => setEnregistrement(`${fait} sur ${total}`));
    setEnregistrement(null);
    if (r.etat === "enregistre") setMessage(`${r.combien} photo${r.combien > 1 ? "s" : ""} enregistrée${r.combien > 1 ? "s" : ""} dans vos photos.`);
    else if (r.etat === "refuse") setErreur("SportVision n'a pas accès à vos photos. Réglages → SportVision → Photos.");
    else setErreur(r.message);
  }

  /**
   * CE QU'ON CROIT SAVOIR VIENT DE DEVENIR FAUX (29/09/2026).
   *
   * Acheter le Pass, confirmer des photos ou declarer un numero change le compteur de la galerie ET
   * la liste des galeries de l'onglet Photos. Depuis qu'on garde les reponses en memoire, il faut
   * les oublier a ces moments-la : un cache qui survit a l'action qu'il contredit est pire que
   * pas de cache, parce qu'on croit l'ecran a jour.
   *
   * On oublie par prefixe, d'un seul appel : les oublier un par un se serait oublie un jour.
   */
  function toutRelire() {
    oublier("galeries:");
    oublier("photos-joueur:");
    charger();
    // ET LA LISTE DES PHOTOS A TRANCHER AVEC. Declarer un numero fait apparaitre des propositions :
    // sans ce tour de plus, la personne lisait « 4 photos vous sont proposees ci-dessous » sans
    // voir une seule photo. C'est exactement le « j'ai mis le numero 7 et il n'y a rien » du 28/09.
    setTour((n) => n + 1);
  }

  /** Ce que la personne a designe dans la grille, avant de valider. */
  const [choisies, setChoisies] = useState<Set<string>>(new Set());
  /** Le premier appui sur « Aucune » arme le geste, le second l'exécute. */
  const [confirmeAucune, setConfirmeAucune] = useState(false);
  function basculerChoix(id: string) {
    // Toucher une photo veut dire qu'on est en train de trier : le refus en bloc se désarme.
    setConfirmeAucune(false);
    setChoisies((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  /** Confirmer d'un coup. On traite en serie plutot qu'en parallele : vingt appels simultanes sur
   *  un reseau de stade, c'est la moitie qui echoue sans qu'on sache lesquels. */
  async function validerChoix() {
    if (!joueur || !choisies.size) return;
    setEnCours("lot"); setErreur(null);
    const faites: string[] = [];
    let rate = 0;
    for (const photo of aTrancher) {
      if (!choisies.has(photo.id)) continue;
      if (await repondreCestMoi(photo.id, joueur, true)) faites.push(photo.id); else rate++;
    }
    setEnCours(null);
    setATrancher((l) => l.filter((x) => !faites.includes(x.id)));
    setChoisies(new Set());
    if (rate) setErreur(`${rate} photo${rate > 1 ? "s n'ont" : " n'a"} pas pu être enregistrée${rate > 1 ? "s" : ""}. Réessayez.`);
    toutRelire();
  }

  /** « Aucune » : on refuse tout ce qui est affiche. Un refus est conserve, donc la machine ne les
   *  reproposera pas. */
  async function refuserTout() {
    if (!joueur || !aTrancher.length) return;
    setEnCours("lot"); setErreur(null);
    const faites: string[] = [];
    for (const photo of aTrancher) {
      if (await repondreCestMoi(photo.id, joueur, false)) faites.push(photo.id);
    }
    setEnCours(null);
    setATrancher((l) => l.filter((x) => !faites.includes(x.id)));
    setChoisies(new Set());
    setConfirmeAucune(false);
  }


  async function lancerAchat() {
    if (!pass) return;
    setAchatEnCours(true); setErreur(null);
    const r = await acheterPass(pass, enfant);
    setAchatEnCours(false);
    if (r.etat === "ouvert") {
      setEtatPass({ etat: "acquis" }); setOuvertMaintenant(true); toutRelire();
      // Acheter change la marche suivante : on relit l'etat pour la nommer tout de suite.
      if (joueur) lireEtatReconnaissance(joueur).then(setReco);
    }
    else if (r.etat === "erreur") setErreur(r.message);
    // « annule » : la personne a ferme la feuille de paiement d'Apple. Elle sait ce qu'elle a
    // fait, lui afficher un message serait du bruit.
  }



  // Tout ce que la base a rendu est affichable : c'est elle qui a deja decide combien.
  async function envoyerMonNumero() {
    const n = Number(numero.trim());
    if (!joueur || !Number.isInteger(n) || n < 1 || n > 99) {
      setNumeroDit("Un numéro de maillot est entre 1 et 99.");
      return;
    }
    setNumeroEnCours(true);
    try {
      const r = await declarerMonNumero(id, joueur, n);
      // ON DIT LA VÉRITÉ DANS LES QUATRE CAS (v340, 29/09/2026).
      //
      // Décision de Fouka : « dès qu'il renseigne son numéro, tu lances la recherche et tu lui dis
      // de revenir dans 5-10 minutes le temps que tu trouves toutes les photos de son numéro. Pas
      // que tu mettes "est-ce que c'est bien toi". »
      //
      // Les photos dont le dossard est déjà lu entrent DANS SA GALERIE tout de suite — son numéro
      // et le numéro lu sur le dos, ce sont déjà deux accords, lui en demander un troisième n'ajoute
      // rien. Et quand il reste des photos à examiner, on le dit : répondre « rien trouvé » à
      // quelqu'un dont on n'a rien cherché, c'est lui faire croire qu'il n'y a rien.
      const ajoutees = r.photosAjoutees > 1
        ? `${r.photosAjoutees} photos portant le n°${r.numero} viennent d'être ajoutées à vos photos.`
        : r.photosAjoutees === 1
          ? `Une photo portant le n°${r.numero} vient d'être ajoutée à vos photos.`
          : "";
      const enCours = r.rechercheEnCours
        ? `Nous relisons les ${r.photosAExaminer} photo${r.photosAExaminer > 1 ? "s" : ""} restante${r.photosAExaminer > 1 ? "s" : ""} pour y chercher le n°${r.numero}. Revenez dans cinq à dix minutes : celles qui le portent viendront s'ajouter toutes seules.`
        : "";
      setNumeroDit(
        r.conflit
          ? `Quelqu'un d'autre a aussi indiqué le n°${r.numero} pour ce match. Nous n'ajoutons rien tant que ce n'est pas tranché : deviner entre deux enfants serait pire.`
          : [ajoutees, enCours].filter(Boolean).join(" ")
            || (r.photosAvecCeNumero === 0
                  ? `Le n°${r.numero} est enregistré, mais il n'apparaît sur aucune des photos lisibles de cette galerie. Sur une photo de face, le numéro ne se voit pas : c'est votre visage qui vous y retrouvera.`
                  : `Le n°${r.numero} est enregistré. Les photos qui le portent sont déjà dans vos photos.`),
      );
      setNumeroConnu(n);
      setModifierNumero(false);
      toutRelire();
    } catch {
      setNumeroDit("Le numéro n'a pas pu être enregistré. Réessayez.");
    } finally {
      setNumeroEnCours(false);
    }
  }

  const visibles = photos;
  // Ce qui manque, et c'est le chiffre qui fait acheter : le total vrai moins ce qu'on montre.
  const restantes = Math.max(0, total - photos.length);
  const largeur = (Dimensions.get("window").width - E.l * 2 - E.s * 2) / 3;

  return (
    <>
      <Ecran enCours={chargement} rafraichir={charger}>
        <Pressable onPress={() => retourner("/photos")} accessibilityRole="button" accessibilityLabel="Retour aux photos" style={s.retour} hitSlop={8}>
          <Ionicons name="chevron-back" size={18} color={C.texteDoux} />
          <Text style={s.retourTexte}>Photos</Text>
        </Pressable>

        <View style={{ gap: 4 }}>
          <Text style={s.titre} numberOfLines={3}>{titre || "Galerie"}</Text>
          <Text style={s.sous}>
            {chargement ? "Recherche en cours…"
              : apercuGalerie
                ? `Un aperçu du match. ${total} photos ont été prises ce jour-là.`
              : photos.length === 0 ? "Aucune photo de vous n'a encore été repérée dans cette galerie."
              : photos.length === 1 ? "1 photo de vous a été repérée."
              : `${photos.length} photos de vous ont été repérées.`}
          </Text>
        </View>

        <Erreur message={erreur} />
        {/* Une reussite n'est pas une erreur : « photo enregistree » a sa propre ligne, verte, et
            disparait au prochain geste. */}
        {message ? <Text style={s.reussite}>{message}</Text> : null}

        {chargement && !photos.length ? (
          <View style={{ paddingVertical: E.xl * 2, alignItems: "center" }}>
            <ActivityIndicator color={C.accent} />
          </View>
        ) : panne ? (
          <Probleme surReessayer={charger} />
        ) : visibles.length ? (
          <>
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
          {photos.length ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Enregistrer mes ${photos.length} photos dans mes photos`}
              onPress={enregistrerLot}
              disabled={enregistrement !== null}
              style={({ pressed }) => [s.action, s.actionCreuse, { marginTop: E.s }, pressed || enregistrement ? { opacity: 0.85 } : null]}
            >
              <Text style={[s.actionTexte, { color: C.texte }]}>
                {enregistrement && enregistrement !== "une"
                  ? `Enregistrement… ${enregistrement}`
                  : photos.length === 1 ? "Enregistrer ma photo" : `Enregistrer mes ${photos.length} photos`}
              </Text>
            </Pressable>
          ) : null}
          </>
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
        {/* TOUTES LES PHOTOS A TRANCHER, D'UN COUP (28/09/2026).
            Fouka : « j'ai mis le numero 7 et il n'y a rien, aucune photo qui s'est rajoutee ».
            Elles etaient bel et bien la — vingt propositions, dont les sept photos portant le
            numero 7 — mais cet ecran n'en montrait QU'UNE, et il fallait repondre vingt fois pour
            les voir toutes. « On ne va pas passer les 117 photos en revue » valait aussi pour ca.
            On les montre donc en grille : on touche celles qui sont soi, et on valide en une fois. */}
        {aTrancher.length ? (
          <View style={{ gap: E.s }}>
            <Text style={s.sousTitre}>
              {aTrancher.length === 1
                ? "Une photo pourrait être vous"
                : `${aTrancher.length} photos pourraient être vous`}
            </Text>
            <Text style={s.bloqueTexte}>
              Touchez celles où vous êtes, puis validez. Votre réponse sert à vous retrouver sur les
              prochaines, et personne d'autre ne la voit.
            </Text>
            <View style={s.grille}>
              {aTrancher.map((photo) => {
                const prise = choisies.has(photo.id);
                return (
                  <Pressable
                    key={photo.id}
                    onPress={() => basculerChoix(photo.id)}
                    onLongPress={() => setAgrandie(photo)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: prise }}
                    accessibilityLabel={prise ? "Retirer cette photo de la sélection" : "C'est moi sur cette photo"}
                  >
                    <Image
                      source={{ uri: photo.url }}
                      style={{
                        width: largeur, height: largeur, borderRadius: R.s,
                        backgroundColor: C.surface,
                        opacity: prise ? 1 : 0.55,
                        borderWidth: prise ? 3 : 0, borderColor: C.accent,
                      }}
                      contentFit="cover"
                      transition={140}
                    />
                  </Pressable>
                );
              })}
            </View>
            <Text style={s.aide}>Appui long pour agrandir une photo.</Text>
            <View style={{ flexDirection: "row", gap: E.s }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Confirmer ${choisies.size} photo${choisies.size > 1 ? "s" : ""}`}
                disabled={!choisies.size || enCours !== null}
                onPress={validerChoix}
                style={({ pressed }) => [s.action, { flex: 1 }, !choisies.size ? { opacity: 0.45 } : null, pressed ? { opacity: 0.85 } : null]}
              >
                {enCours === "lot" ? <ActivityIndicator color="#fff" />
                  : <Text style={s.actionTexte}>
                      {choisies.size ? `Ce sont mes photos (${choisies.size})` : "Ce sont mes photos"}
                    </Text>}
              </Pressable>
              <Pressable
                accessibilityRole="button" accessibilityLabel="Aucune de ces photos n'est moi"
                disabled={enCours !== null}
                onPress={() => (confirmeAucune ? refuserTout() : setConfirmeAucune(true))}
                style={({ pressed }) => [s.action, s.actionCreuse, pressed ? { opacity: 0.85 } : null]}
              >
                {/* DEUX GESTES POUR UN REFUS EN BLOC (29/09/2026).
                    Fouka : « un joueur peut cliquer sans faire exprès ». Un refus n'est pas défait
                    d'un revers : la photo refusée n'est plus jamais reproposée, c'est justement ce
                    qui empêche de tourner en rond. Un seul doigt mal posé faisait donc disparaître
                    toute la grille pour de bon. Le second appui coûte une seconde et rend le geste
                    volontaire. */}
                <Text style={[s.actionTexte, { color: confirmeAucune ? C.alerteTexte : C.texte }]}>
                  {confirmeAucune ? "Confirmer : aucune n'est à moi" : "Aucune"}
                </Text>
              </Pressable>
            </View>
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
        {/* LA TROISIEME CONDITION EST UN CORRECTIF DU 27/09/2026, et elle vient d'un constat de
            Fouka : « je vois pas ou on achete le pass, ca a rien change sur l'app ».
            Quand le magasin ne rend AUCUNE offre — accord Paid Applications encore inactif, produit
            pas encore approuve, module natif absent — `pass` vaut null. Et si la famille n'a encore
            aucune photo, `restantes` vaut 0. Les deux conditions etaient donc fausses : l'ecran
            n'affichait RIEN DU TOUT, pas meme une explication. Un echec invisible fait chercher le
            defaut au mauvais endroit, et c'est exactement ce qui s'est passe pendant deux jours.
            L'app CONNAIT la raison (dernierMotif) et ne la montrait que dans Profil. */}
        {restantes > 0 || (pass && !ouvertMaintenant) || (etatPass?.etat === "a_prendre" && !pass) ? (
          <View style={s.bloque}>
            <Ionicons name="lock-closed" size={16} color={C.alerte} />
            <Text style={s.bloqueTexte}>
              {apercuGalerie
                ? `${total} photos dans cette galerie. Le Pass vous permet de vous y retrouver, et de les voir sans filigrane. `
                : restantes > 0
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
            {/* LA RAISON, EN CLAIR, QUAND IL N'Y A PAS DE BOUTON. On ne renvoie vers aucun paiement
                extérieur — la règle 3.1.1 l'interdit — on explique seulement pourquoi l'achat n'est
                pas proposé sur cet appareil. Sans cette ligne, l'écran est muet et le défaut se
                cherche à l'aveugle. */}
            {!pass && etatPass?.etat === "a_prendre" && dernierMotif.motif ? (
              <Text style={s.bloqueRaison}>
                Achat indisponible sur cet appareil : {MOTIF_LISIBLE[dernierMotif.motif]}
                {dernierMotif.sku ? ` (${dernierMotif.sku})` : ""}.
              </Text>
            ) : null}
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

        {/* LA DEVISE VIENT DE LA BOUTIQUE DE L'APPAREIL, JAMAIS DU CODE (28/09/2026).
            Verifie cote Apple : les deux Pass n'ont qu'UN SEUL prix, territoire France, et les deux
            comptes de test sont francais. Un prix dans une autre devise ne peut donc venir que du
            compte utilise SUR CET APPAREIL — et en TestFlight ce n'est pas le compte sandbox des
            Reglages Developpeur, c'est le vrai compte App Store.
            Ce message existe parce que la question est revenue quatre fois dans la journee, chaque
            fois lue comme un defaut de l'application. L'ecran repond desormais tout seul. */}
        {pass && !ouvertMaintenant && pass.deviseMagasin && pass.deviseMagasin !== "EUR" ? (
          <Text style={s.avertissement}>
            Ce prix est affiché en {pass.deviseMagasin} parce que le compte App Store de cet appareil
            est rattaché à une autre boutique. En France, le Pass est vendu en euros. Réglages → votre
            nom → Médias et achats → Afficher le compte → Pays/Région.
          </Text>
        ) : null}

        {/* 26/09/2026 — CE BOUTON NE S'AFFICHE PLUS AVANT LE PAIEMENT.
            Fouka : « ca ne me met pas d'acheter le pass, ca me met directement deposer ma photo de
            reference ». On reclamait une photo du visage d'un enfant a une famille qui n'avait rien
            paye — dans le mauvais ordre, et pour une donnee biometrique.
            La condition tient au fait que les trois etats du Pass sont maintenant distincts :
            « a_prendre » veut dire qu'il reste a payer, et rien d'autre ne se demande avant. */}
        {/* v332 — LE BOUTON RESTE APRES LA PREMIERE PHOTO, et ce n'est pas un detail : une seule
            photo de reference ne reconnait que les prises de vue qui lui ressemblent. Deux ou trois
            angles changent bien plus que n'importe quel reglage, et tant que ce bouton disparaissait
            des la premiere photo, personne ne pouvait en deposer une seconde. */}
        {etatPass && etatPass.etat !== "a_prendre" && reco ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={!reco.consentement ? "Donner mon accord pour être reconnu"
              : !reco.photoReference ? "Déposer ma photo de référence"
              : "Ajouter une photo de référence sous un autre angle"}
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
            style={({ pressed }) => [s.action, reco.photoReference ? s.actionCreuse : null, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={[s.actionTexte, reco.photoReference ? { color: C.texte } : null]}>
              {!reco.consentement ? "Me reconnaître sur les photos"
                : !reco.photoReference ? "Déposer mes photos de référence"
                : "Ajouter une photo sous un autre angle"}
            </Text>
          </Pressable>
        ) : null}

        {/* ON DIT CE QUE ÇA CHANGE, ET COMBIEN DE TEMPS ÇA PREND (29/09/2026).
            Décision de Fouka : après le Pass, la famille dépose « une ou plusieurs » photos, puis
            « boum, ça retrouve toutes ses photos ». Deux choses manquaient pour que ce soit vrai à
            l'écran : dire qu'une seule photo ne suffit pas — mesuré, plusieurs angles changent plus
            que n'importe quel réglage — et dire que la recherche prend quelques minutes, sinon on
            revient au bout de dix secondes et on croit que rien ne marche. */}
        {etatPass && etatPass.etat !== "a_prendre" && reco && !reco.photoReference ? (
          <Text style={s.avertissement}>
            Deux ou trois photos de face, prises sous des angles différents, valent bien mieux qu'une
            seule : c'est ce qui permet de reconnaître quelqu'un de profil ou en mouvement. La
            recherche démarre dès le dépôt et prend quelques minutes ; les photos arrivent toutes
            seules.
          </Text>
        ) : null}

        {/* LE NUMERO DE MAILLOT, APRES LE PASS COMME LE RESTE (27/09/2026).
            Meme condition que le bloc ci-dessus : rien ne se demande a une famille qui n'a pas encore
            paye. Ce geste ne reclame aucune donnee biometrique — c'est un chiffre — mais il n'a de
            sens que pour qui va voir ses photos. */}
        {/* `etatPass &&` N'EST PAS UNE PRECAUTION DE STYLE (28/09/2026). `etatPass?.etat !== "a_prendre"`
    est VRAI tant que l'etat du Pass n'est pas charge — `undefined !== "a_prendre"`. Ce bloc
    s'affichait donc pendant le chargement, PUIS disparaissait quand le bouton du Pass arrivait.
    Fouka : « ca ne met pas tout de suite debloquer mon pass photo, avant ca met c'est bien vos
    numeros ». On demandait son numero de maillot a quelqu'un qui n'a pas encore paye, pendant
    une seconde, avant de se retracter. */}
        {etatPass && etatPass.etat !== "a_prendre" ? (
          <View style={s.numBloc}>
            <Text style={s.numTitre}>
              {numeroConnu !== null && !modifierNumero
                ? `Vous étiez le n°${numeroConnu} à ce match`
                : "Vous étiez quel numéro à ce match\u00A0?"}
            </Text>
            <Text style={s.numSous}>
              {numeroConnu !== null && !modifierNumero
                ? "Les photos où ce numéro est lisible sont dans vos photos. Corrigez-le si vous vous êtes trompé."
                : "Sur une photo de dos, votre visage ne se voit pas — votre numéro, si. Indiquez-le et nous vous proposerons ces photos aussi."}
            </Text>
            {/* ON NE REPOSE PAS UNE QUESTION DEJA POSEE (29/09/2026).
                Fouka : « il le met QUE UNE FOIS. Il peut modifier s'il s'est trompé, mais après tu
                le remets pas encore une fois. » Un champ vide sous une réponse déjà donnée laisse
                croire qu'elle n'a pas été prise en compte. */}
            {numeroConnu !== null && !modifierNumero ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Corriger mon numéro, actuellement ${numeroConnu}`}
                onPress={() => { setNumero(String(numeroConnu)); setModifierNumero(true); setNumeroDit(null); }}
                style={({ pressed }) => [{ alignSelf: "flex-start", paddingVertical: 6 }, pressed ? { opacity: 0.7 } : null]}
              >
                <Text style={s.numCorriger}>Corriger mon numéro</Text>
              </Pressable>
            ) : (
            <View style={s.numLigne}>
              <TextInput
                value={numero}
                onChangeText={(t) => setNumero(t.replace(/[^0-9]/g, "").slice(0, 2))}
                keyboardType="number-pad"
                placeholder="7"
                placeholderTextColor={C.texteDoux}
                accessibilityLabel="Votre numéro de maillot à ce match"
                style={s.numChamp}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Enregistrer mon numéro de maillot"
                disabled={numeroEnCours || !numero}
                onPress={envoyerMonNumero}
                style={({ pressed }) => [
                  s.numBouton,
                  (numeroEnCours || !numero) ? { opacity: 0.5 } : null,
                  pressed ? { opacity: 0.85 } : null,
                ]}
              >
                <Text style={s.numBoutonTexte}>{numeroEnCours ? "…" : "C'était moi"}</Text>
              </Pressable>
            </View>
            )}
            {numeroDit ? <Text style={s.numDit}>{numeroDit}</Text> : null}
          </View>
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

      {/* LE PLEIN ÉCRAN, ET COMMENT ON EN SORT.
        *
        * Fouka, 28/09/2026 : « quand je clique sur une photo, je ne peux pas revenir en arrière.
        * Même quand je clique dans des endroits. » Il était bel et bien piégé, pour deux raisons
        * qui se cumulaient.
        *
        * 1. LA CROIX ÉTAIT RENDUE AVANT L'IMAGE. En React Native, ce qui vient plus tard dans le
        *    JSX passe au-dessus : l'image, large de tout l'écran et haute de 86 %, recouvrait donc
        *    le seul bouton de sortie. Elle est désormais rendue en dernier.
        *
        * 2. IL N'Y AVAIT AUCUNE AUTRE SORTIE. `onRequestClose` ne se déclenche PAS sur iOS — c'est
        *    le bouton retour d'Android. Taper le fond ne fermait rien. Une croix masquée, et plus
        *    rien ne répond.
        *
        * Un écran dont on ne peut pas sortir, c'est un refus Apple immédiat, et surtout une
        * famille bloquée. Il y a maintenant DEUX sorties indépendantes : toucher n'importe où, et
        * la croix. Aucune des deux ne dépend de l'autre. */}
      <Modal visible={!!agrandie} transparent animationType="fade" onRequestClose={() => setAgrandie(null)}>
        <Pressable
          style={s.plein}
          onPress={() => setAgrandie(null)}
          accessibilityRole="button"
          accessibilityLabel="Fermer la photo"
        >
          {agrandie ? (
            <Image source={{ uri: agrandie.url }} style={s.pleinImage} contentFit="contain" transition={120} />
          ) : null}
          <Pressable
            accessibilityRole="button" accessibilityLabel="Fermer la photo"
            onPress={() => setAgrandie(null)}
            style={[s.fermer, { top: insets.top + E.s }]}
            hitSlop={12}
          >
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          {/* ENREGISTRER CETTE PHOTO. A gauche, loin de la croix : les deux gestes sont opposes et
              se toucher serait la meilleure facon de fermer en croyant enregistrer. */}
          {agrandie ? (
            <Pressable
              accessibilityRole="button" accessibilityLabel="Enregistrer cette photo dans mes photos"
              onPress={() => enregistrerUne(agrandie)}
              disabled={enregistrement !== null}
              style={[s.fermer, { top: insets.top + E.s, right: undefined, left: E.l }]}
              hitSlop={12}
            >
              {enregistrement === "une"
                ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="arrow-down-circle-outline" size={22} color="#fff" />}
            </Pressable>
          ) : null}

          {/* PARTAGER (29/09/2026). Fouka : « qu'il puisse flex avec ses photos, qu'il puisse être
              fier, les partager, publier sur Instagram. » La feuille de partage du téléphone propose
              déjà Instagram, les stories, WhatsApp et les messages : c'est là que les gens vont
              déjà, et ça marche sans compte professionnel ni revue de Meta.
              Placé entre les deux autres, avec le même écart : trois gestes distincts, aucun voisin
              dangereux — fermer reste tout seul à droite. */}
          {/* CE N'EST PAS MOI (29/09/2026). Depuis que les photos entrent dans la galerie sans
              qu'on demande rien, il faut pouvoir en sortir une : c'est ce qui rend acceptable de
              les mettre d'office. Ce qu'une machine a posé, la famille le défait (v343) ; ce qu'un
              humain du club a posé ne bouge pas, et la base le dit alors elle-même.
              En bas, loin des trois autres : ce geste-là ne se fait pas par mégarde. */}
          {agrandie && !apercuGalerie ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retirer cette photo : ce n'est pas moi"
              onPress={() => retirerUne(agrandie)}
              disabled={enCours === "retrait"}
              style={[s.pasMoi, { bottom: insets.bottom + E.xl }]}
              hitSlop={10}
            >
              {enCours === "retrait" ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.pasMoiTexte}>Ce n'est pas moi</Text>}
            </Pressable>
          ) : null}

          {agrandie ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Partager cette photo"
              onPress={() => partagerUne(agrandie)}
              disabled={partage}
              style={[s.fermer, { top: insets.top + E.s, right: undefined, left: E.l + TOUCHE + E.s }]}
              hitSlop={12}
            >
              {partage ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="share-outline" size={22} color="#fff" />}
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  aide: { fontSize: 12, color: C.texteDoux, marginTop: -2 },
  pasMoi: {
    position: "absolute", alignSelf: "center",
    paddingHorizontal: E.l, paddingVertical: E.s + 2, borderRadius: R.xl,
    backgroundColor: "rgba(0,0,0,.55)", borderWidth: 1, borderColor: "rgba(255,255,255,.22)",
  },
  pasMoiTexte: { color: "#fff", fontWeight: "600", fontSize: 14 },
  reussite: {
    fontSize: 13, color: C.succesTexte, backgroundColor: C.surface,
    paddingHorizontal: E.m, paddingVertical: E.s, borderRadius: R.s, marginBottom: E.s,
  },
  avertissement: {
    marginTop: E.s, paddingHorizontal: E.m, paddingVertical: E.s,
    backgroundColor: C.surface, borderRadius: R.s,
    color: C.texteDoux, fontSize: 12.5, lineHeight: 18,
  },
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
    // zIndex explicite : l'ordre du JSX suffit, mais une future insertion ne doit pas
    // re-enterrer la seule sortie visible sans que personne le remarque.
    position: "absolute", right: E.l, width: 38, height: 38, borderRadius: 19, zIndex: 2,
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.14)",
  },

  numBloc: {
    gap: 8,
    padding: E.m,
    borderRadius: 14,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.bordure,
  },
  numTitre: { color: C.texte, fontSize: 15, fontWeight: "600" },
  numSous: { color: C.texteDoux, fontSize: 13, lineHeight: 18 },
  numLigne: { flexDirection: "row", gap: 8, alignItems: "center" },
  numChamp: {
    width: 68,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.bordure,
    backgroundColor: C.fond,
    color: C.texte,
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  numBouton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  numBoutonTexte: { color: "#fff", fontSize: 14, fontWeight: "600" },
  numCorriger: { color: C.accentClair, fontSize: 13.5, fontWeight: "600" },
  numDit: { color: C.texteDoux, fontSize: 13, lineHeight: 18 },
  bloqueRaison: { color: C.texteDoux, fontSize: 12, lineHeight: 17, marginTop: 6 },
});
