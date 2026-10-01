// MON PROFIL (01/10/2026). Le formulaire que « Mon espace » n'avait pas.
//
// Fouka, ce matin : « quand je vais dans mon profil, je peux même pas modifier mon profil, je peux
// même pas modifier mes informations. Ajouter une photo de profil. » L'en-tête de `profil.tsx`
// affirmait « AUCUN FORMULAIRE, ET C'EST INCHANGÉ. Tout ce qui se règle se règle dans l'OS ». La
// raison donnée — deux formulaires à tenir à jour finissent par diverger — reste vraie, et c'est
// pour ça que cet écran ne décide RIEN de son côté : il porte exactement les champs de l'écran
// « Mon profil » de l'OS, dans son ordre et avec ses mots (« Identité », « Coordonnées postales »,
// « Infos pratiques »). Ce qui change, c'est qu'un opérateur au bord d'un terrain n'a pas
// d'ordinateur sous la main, et qu'on lui demandait d'en trouver un pour corriger son numéro.
//
// == CE QUI EST ICI, ET CE QUI N'Y EST PAS =====================================================
//
// Chaque champ a été mesuré, un par un, avec le jeton d'un vrai opérateur, en transaction annulée.
// Le détail est dans l'en-tête de `src/lib/os-profil.ts`. En résumé :
//
//   · Prénom, nom, téléphone, bio, photo : `profiles`, acceptés.
//   · Adresse, code postal : `collaborateur_coordonnees`. Ville, véhicule, permis :
//     `collaborateur_logistique`. Les écrire dans `profiles` rend « 1 ligne modifiée » ET perd la
//     valeur — deux déclencheurs les déplacent puis posent NULL. C'est le faux succès de la
//     règle 4, en pire, parce qu'il survit au `.select`.
//   · Rôle, grade, niveau d'opérateur, type de contrat, compte actif : REFUSÉS par
//     `protect_sensitive_profile_fields`, avec une exception nommée. Ils ne sont donc pas
//     proposés — un champ qui se fait refuser est pire qu'un champ absent (règle 5). Ils sont
//     affichés en lecture, avec la phrase qui dit à qui s'adresser.
//   · L'adresse e-mail n'est pas ici : la changer dans `profiles` ne changerait PAS l'identifiant
//     de connexion, qui vit dans l'authentification. Un champ qui a l'air de marcher et ne change
//     rien est le pire des trois. L'OS ne la propose pas non plus dans ce formulaire.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Ecran, Probleme, Section } from "../../src/ui/Ecran";
import { Bouton, Case, Champ, Erreur } from "../../src/ui/Base";
import { Ecusson } from "../../src/ui/Ecusson";
import { useSession } from "../../src/lib/session";
import { useDonnees, oublier } from "../../src/lib/cache";
import {
  choisirPhoto, enregistrerMonProfil, lireMonProfil, prendrePhoto,
  PROFIL_VIDE, type MonProfil,
} from "../../src/lib/os-profil";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P, T } from "../../src/theme/polices";

/** La clé du cache porte l'identifiant : deux personnes sur le même téléphone un jour de tournage
 *  ne doivent pas voir le profil l'une de l'autre. */
const cle = (moiId?: string | null) => (moiId ? `profil:${moiId}` : null);

export default function MonProfilEcran() {
  const { moi, session, rafraichir } = useSession();
  const monId = moi?.id ?? null;

  const { donnees, chargement, erreur, relire } = useDonnees<MonProfil>(
    cle(monId),
    () => lireMonProfil(monId as string),
    [monId],
  );

  // Le brouillon vit ici, la réponse du serveur reste dans le cache. Sans cette séparation, un
  // rafraîchissement en arrière-plan écraserait ce que la personne est en train de taper.
  const [form, setForm] = useState<MonProfil | null>(null);
  // `undefined` = photo non touchée, `null` = photo retirée, chaîne = nouvelle photo.
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  // `touche` dit s'il y a un brouillon À PROTÉGER, et ce n'est pas la même question que « y a-t-il
  // une différence ». Sans lui, deux défauts : une relecture en arrière-plan effaçait la saisie en
  // cours, et après un enregistrement l'écran gardait l'ANCIENNE photo — la réponse du serveur
  // arrivait une fraction de seconde plus tard et n'était plus adoptée.
  const [touche, setTouche] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [photoEnCours, setPhotoEnCours] = useState(false);
  const [souci, setSouci] = useState<string | null>(null);
  const [fait, setFait] = useState(false);

  useEffect(() => { if (donnees && !touche) setForm(donnees); }, [donnees, touche]);

  const v = form ?? PROFIL_VIDE;
  const nomComplet = `${v.prenom} ${v.nom}`.trim();
  const photoAffichee = photo === undefined ? v.avatarUrl : photo;

  // « Enregistrer » ne s'allume que s'il y a quelque chose à enregistrer : un bouton qui ne fait
  // rien quand on le touche est indiscernable d'un bouton en panne.
  const modifie = useMemo(() => {
    if (!form || !donnees) return false;
    if (photo !== undefined) return true;
    return (["prenom", "nom", "telephone", "bio", "adresse", "codePostal", "ville"] as const)
      .some((k) => form[k].trim() !== donnees[k].trim())
      || form.vehicule !== donnees.vehicule
      || form.permis !== donnees.permis;
  }, [form, donnees, photo]);

  const poser = useCallback(<K extends keyof MonProfil>(champ: K, valeur: MonProfil[K]) => {
    setFait(false); setSouci(null); setTouche(true);
    setForm((f) => (f ? { ...f, [champ]: valeur } : f));
  }, []);

  const changerPhoto = useCallback(async (depuis: "photos" | "appareil") => {
    setPhotoEnCours(true); setSouci(null); setFait(false);
    try {
      const r = depuis === "photos" ? await choisirPhoto() : await prendrePhoto();
      if (r.etat === "refus") setSouci(r.message);
      else if (r.etat === "ok") { setPhoto(r.imageUri); setTouche(true); }
    } catch (e) {
      setSouci(e instanceof Error ? e.message : "La photo n'a pas pu être préparée.");
    } finally { setPhotoEnCours(false); }
  }, []);

  const enregistrer = useCallback(async () => {
    if (!form || !monId) return;
    setEnCours(true); setSouci(null); setFait(false);
    try {
      await enregistrerMonProfil(monId, { ...form, avatarUrl: photo });
      // Ce qui est à l'écran EST ce que la base vient d'accepter : on le garde tel quel plutôt que
      // de laisser réapparaître l'ancienne réponse le temps d'une relecture. La relecture qui suit
      // écrira la même chose, et fera foi si la base a normalisé quoi que ce soit.
      setForm((f) => (f ? { ...f, avatarUrl: photo === undefined ? f.avatarUrl : photo } : f));
      setPhoto(undefined);
      setTouche(false);
      // Le nom et la photo sont lus par « Mon espace » ET par la session : on oublie ce qu'on
      // croit savoir plutôt que de raccommoder deux objets en mémoire.
      oublier("profil:");
      relire();
      await rafraichir();
      setFait(true);
    } catch (e) {
      setSouci(e instanceof Error ? e.message : "L'enregistrement n'est pas passé.");
    } finally { setEnCours(false); }
  }, [form, monId, photo, relire, rafraichir]);

  return (
    <Ecran teinte="violet" retour="/profil">
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Mon profil</Text>
        <Text style={s.sous}>Vos informations, telles qu'elles apparaissent à l'équipe</Text>
      </View>

      {chargement ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : erreur && !donnees ? (
        <Probleme surReessayer={relire} />
      ) : (
        <>
          {/* LA PHOTO EST LE PREMIER BLOC, PARCE QUE C'EST LA DEMANDE. Deux chemins, parce que la
              moitié des photos d'un opérateur n'existent pas encore quand il y pense. */}
          <View style={s.bloc}>
            <View style={s.entete}>
              <Ecusson nom={nomComplet || "Moi"} taille={64} photo={photoAffichee} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.blocTitre}>Photo de profil</Text>
                <Text style={s.blocSous}>
                  Elle vous identifie dans la messagerie, l'annuaire et sur vos missions.
                </Text>
              </View>
            </View>
            <View style={s.rangee}>
              <Geste
                icone="images-outline"
                libelle="Choisir"
                enCours={photoEnCours}
                surPression={() => changerPhoto("photos")}
              />
              <Geste
                icone="camera-outline"
                libelle="Prendre"
                enCours={photoEnCours}
                surPression={() => changerPhoto("appareil")}
              />
              {/* On ne propose de retirer que s'il y a quelque chose à retirer. */}
              {photoAffichee ? (
                <Geste icone="trash-outline" libelle="Retirer" surPression={() => { setPhoto(null); setFait(false); }} />
              ) : null}
            </View>
          </View>

          <Section titre="Identité">
            <View style={{ gap: E.m }}>
              <View style={s.deux}>
                <View style={{ flex: 1 }}>
                  <Champ
                    label="Prénom"
                    value={v.prenom}
                    onChangeText={(t) => poser("prenom", t)}
                    autoCapitalize="words"
                    textContentType="givenName"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Champ
                    label="Nom"
                    value={v.nom}
                    onChangeText={(t) => poser("nom", t)}
                    autoCapitalize="words"
                    textContentType="familyName"
                  />
                </View>
              </View>
              <Champ
                label="Téléphone"
                value={v.telephone}
                onChangeText={(t) => poser("telephone", t)}
                placeholder="+33 6 00 00 00 00"
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
              />
              <Champ
                label="Bio"
                value={v.bio}
                onChangeText={(t) => poser("bio", t)}
                placeholder="Vos spécialités, votre équipement, une info utile"
                multiline
                hauteur={96}
                autoCapitalize="sentences"
                maxLength={500}
              />
            </View>
          </Section>

          <Section titre="Coordonnées postales">
            <View style={{ gap: E.m }}>
              <Champ
                label="Adresse"
                value={v.adresse}
                onChangeText={(t) => poser("adresse", t)}
                placeholder="Numéro, rue"
                autoCapitalize="words"
                textContentType="streetAddressLine1"
              />
              <View style={s.deux}>
                <View style={{ flex: 2 }}>
                  <Champ
                    label="Ville"
                    value={v.ville}
                    onChangeText={(t) => poser("ville", t)}
                    autoCapitalize="words"
                    textContentType="addressCity"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Champ
                    label="Code postal"
                    value={v.codePostal}
                    onChangeText={(t) => poser("codePostal", t)}
                    placeholder="77130"
                    keyboardType="number-pad"
                    maxLength={5}
                    textContentType="postalCode"
                  />
                </View>
              </View>
            </View>
          </Section>

          <Section titre="Infos pratiques">
            <View style={s.bloc}>
              {/* Les mots de l'OS : « Véhicule personnel », « Permis de conduire ». La production
                  s'en sert pour savoir qui peut se rendre sur une mission éloignée. */}
              <Case
                texte="Véhicule personnel"
                sous="La production le voit avant de vous proposer une mission loin de chez vous."
                cochee={v.vehicule}
                surChangement={() => poser("vehicule", !v.vehicule)}
              />
              <Case
                texte="Permis de conduire"
                cochee={v.permis}
                surChangement={() => poser("permis", !v.permis)}
              />
            </View>
          </Section>

          <Erreur message={souci} />
          {/* « Enregistré » ne s'affiche qu'après une écriture qui a RENDU une ligne : les trois
              écritures de `enregistrerMonProfil` lèvent si la base n'a rien changé (règle 4). */}
          {fait && !souci ? (
            <View style={s.fait}>
              <Ionicons name="checkmark-circle" size={17} color={C.succesTexte} />
              <Text style={s.faitTexte}>Profil enregistré.</Text>
            </View>
          ) : null}

          <Bouton
            titre="Enregistrer"
            onPress={enregistrer}
            enCours={enCours}
            desactive={!modifie}
          />

          <Section titre="Fixé par l'administration">
            <View style={s.bloc}>
              <Ligne libelle="Adresse e-mail" valeur={session?.user?.email ?? "Non renseignée"} />
              <Ligne libelle="Rôle" valeur={moi?.metier ?? "Non renseigné"} dernier />
            </View>
            <Text style={s.pied}>
              Ces deux informations ne se changent pas depuis l'application. L'adresse e-mail est
              votre identifiant de connexion, le rôle décide de ce que vous voyez : demandez à
              l'administration. Vos coordonnées bancaires et vos documents restent sur l'OS, depuis
              un ordinateur.
            </Text>
          </Section>
        </>
      )}
    </Ecran>
  );
}

/** Un geste de la rangée sous la photo. `TOUCHE` au minimum, comme partout (règle 8). */
function Geste({
  icone, libelle, surPression, enCours,
}: {
  icone: keyof typeof Ionicons.glyphMap;
  libelle: string;
  surPression: () => void;
  enCours?: boolean;
}) {
  return (
    <Pressable
      onPress={enCours ? undefined : surPression}
      accessibilityRole="button"
      accessibilityLabel={libelle}
      accessibilityState={{ disabled: !!enCours, busy: !!enCours }}
      style={({ pressed }) => [s.geste, pressed && !enCours ? { opacity: 0.75 } : null, enCours ? { opacity: 0.5 } : null]}
    >
      {enCours
        ? <ActivityIndicator color={C.texteDoux} size="small" />
        : <Ionicons name={icone} size={16} color={C.texteDoux} />}
      <Text style={s.gesteTexte}>{libelle}</Text>
    </Pressable>
  );
}

function Ligne({ libelle, valeur, dernier }: { libelle: string; valeur: string; dernier?: boolean }) {
  return (
    <View style={[s.ligne, dernier ? { borderBottomWidth: 0 } : null]}>
      <Text style={s.libelle}>{libelle}</Text>
      {/* Pas de `numberOfLines={1}` sur une adresse : celle du compte de recette tient tout juste
          sur la largeur d'un iPhone 17, et un texte tronqué est un bug, pas une mise en page. */}
      <Text style={s.valeur} numberOfLines={2}>{valeur}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: T.titreEcran, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.sousEcran, lineHeight: T.sousEcranHauteur },
  attente: { paddingVertical: E.xl * 2, alignItems: "center" },

  bloc: {
    gap: E.m, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  entete: { flexDirection: "row", alignItems: "center", gap: E.m },
  blocTitre: { alignSelf: "stretch", color: C.texte, fontFamily: P.titreFort, fontSize: T.titreBloc, letterSpacing: -0.3 },
  blocSous: { alignSelf: "stretch", color: C.texteDoux, fontFamily: P.texte, fontSize: T.note, lineHeight: T.noteHauteur },
  rangee: { flexDirection: "row", gap: E.s },
  geste: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    minHeight: TOUCHE, borderRadius: R.m,
    backgroundColor: "rgba(255,255,255,.05)", borderWidth: 1, borderColor: C.bordureForte,
  },
  gesteTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 13 },

  deux: { flexDirection: "row", gap: E.s },

  fait: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    padding: E.m, borderRadius: R.l,
    backgroundColor: "rgba(18,183,106,.12)", borderWidth: 1, borderColor: "rgba(18,183,106,.35)",
  },
  faitTexte: { flex: 1, color: C.succesTexte, fontFamily: P.texteFort, fontSize: T.detail },

  ligne: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: E.m,
    paddingHorizontal: 0, minHeight: TOUCHE,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.bordure,
  },
  libelle: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: T.detail },
  valeur: { flexShrink: 1, color: C.texte, fontFamily: P.texteFort, fontSize: T.detail, textAlign: "right" },
  pied: { color: C.texteFaible, fontFamily: P.texte, fontSize: T.note, lineHeight: T.noteHauteur },
});
