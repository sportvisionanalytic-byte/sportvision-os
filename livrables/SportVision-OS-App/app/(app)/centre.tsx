// LE CENTRE SPORTVISION (30/09/2026).
//
// UN ÉCRAN QU'ON OUVRE DEBOUT. Fouka l'a remis au menu le 09/09 : « un opérateur qui cherche une
// règle sur le terrain ne sait pas depuis quel écran y accéder ». Tout est dessiné pour ça :
//
//   · LA RECHERCHE EST EN HAUT, et elle cherche dans le CORPS des fiches, pas seulement dans leur
//     titre. On tape « batterie » : le mot n'est dans aucun titre, il est dans trois check-lists.
//   · SANS ACCENTS NI MAJUSCULES. « colorimetrie » trouve « Check-list colorimétrie ». Une
//     recherche qui exige l'accent ne trouve rien et fait croire que la fiche n'existe pas.
//   · LE TEXTE EST GRAND et les fiches s'ouvrent sur place : pas de sous-écran, pas d'aller-retour.
//     Une main, un pouce, un écran mouillé.
//
// LE RÈGLEMENT SE LIT ET S'ACCEPTE ICI DEPUIS LE 01/10/2026. Jusqu'au 30/09 cet écran n'affichait
// que l'état des neuf chapitres, sans leur texte et sans bouton, et l'en-tête de
// `src/lib/os-centre.ts` expliquait pourquoi : le texte n'était pas en base, et garder une copie
// dans l'application aurait fait accepter un texte qui n'est plus celui en vigueur. Fouka a résumé
// le résultat ce matin : « on peut pas lire, accepter les trucs, on peut rien cliquer ».
//
// La migration v381 met le règlement en base, versionné : 9 chapitres, 27 sections, 116 points. Il
// n'y a donc plus de copie, et le bouton existe. La version acceptée est celle que l'écran a
// AFFICHÉE, et c'est la base qui refuse une version dépassée, avec son propre message.
//
// CE QU'IL N'Y A TOUJOURS PAS : les procédures détaillées, les rôles, le matériel, la FAQ. Ces
// pages du Centre sont encore écrites en dur dans le HTML de l'OS. Ce sont de longues pages qu'on
// lit assis, et elles n'ont pas été mises en base aujourd'hui.
import React, { useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Ecran, Probleme, Section, Vide } from "../../src/ui/Ecran";
import { Bouton, Champ, Erreur, Pastille } from "../../src/ui/Base";
import { Ecusson } from "../../src/ui/Ecusson";
import { useSession } from "../../src/lib/session";
import { oublier, useDonnees } from "../../src/lib/cache";
import {
  ESCALADE, ORIENTATION, accepterChapitre, lireCentre, normaliser, ressourceCorrespond,
  type Centre as DonneesCentre, type Chapitre as UnChapitre, type Contact, type Ressource,
} from "../../src/lib/os-centre";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P, T } from "../../src/theme/polices";

export default function CentreSportVision() {
  const { moi } = useSession();
  const [requete, setRequete] = useState("");
  const [ouverte, setOuverte] = useState<string | null>(null);
  // UN SEUL CHAPITRE OUVERT À LA FOIS. Le plus long en porte 21 points sur 4 sections : les neuf
  // dépliés donnent 116 puces à faire défiler d'un pouce pour retrouver une phrase.
  const [chapitreOuvert, setChapitreOuvert] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { donnees, chargement, rafraichissement, erreur, relire } = useDonnees<DonneesCentre>(
    moi ? `centre:${moi.id}` : null,
    () => lireCentre(moi!.id),
    [moi?.id],
  );

  const q = requete.trim();
  const fiches = useMemo(
    () => (donnees?.ressources ?? []).filter((r) => ressourceCorrespond(r, q)),
    [donnees?.ressources, q],
  );
  const contacts = useMemo(() => {
    const n = normaliser(q);
    if (!n) return donnees?.contacts ?? [];
    return (donnees?.contacts ?? []).filter(
      (c) => normaliser(`${c.sujet} ${c.titre} ${c.personnes.map((p) => p.nom).join(" ")}`).includes(n),
    );
  }, [donnees?.contacts, q]);
  // ON CHERCHE DANS LE TEXTE DU RÈGLEMENT, PLUS SEULEMENT DANS LES TITRES. C'est possible depuis
  // que les 116 points sont en base, et c'est tout l'intérêt : on tape « drone » ou « retard », pas
  // « Chapitre 7 ». Aucun titre de chapitre ne contient le mot « retard » ; quatre points du
  // chapitre 2 le contiennent.
  const chapitres = useMemo(() => {
    const n = normaliser(q);
    if (!n) return donnees?.chapitres ?? [];
    return (donnees?.chapitres ?? []).filter((c) =>
      normaliser(
        `${c.numero} ${c.titre} ${c.sections.map((x) => `${x.titre} ${x.points.join(" ")}`).join(" ")}`,
      ).includes(n),
    );
  }, [donnees?.chapitres, q]);

  const rienTrouve = !!q && !fiches.length && !contacts.length && !chapitres.length;

  return (
    <Ecran teinte="cyan" enCours={rafraichissement} rafraichir={relire} retour="/profil">
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Centre SportVision</Text>
        <Text style={s.sous}>Les règles, les check-lists et qui appeler.</Text>
      </View>

      <Champ
        label="Rechercher"
        placeholder="Une règle, une check-list, un contact…"
        value={requete}
        onChangeText={setRequete}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />

      {erreur && !donnees ? <Probleme surReessayer={relire} /> : null}

      {chargement ? (
        <Text style={s.attente}>Chargement…</Text>
      ) : null}

      {rienTrouve ? (
        <Vide
          icone="search-outline"
          titre={`Rien pour « ${q} »`}
          texte={
            "Aucune fiche, aucun chapitre ni aucun contact ne porte ce mot. Essayez un mot plus " +
            "court, « drone », « veo » ou « batterie », ou effacez la recherche pour revoir tout le Centre."
          }
        />
      ) : null}

      {donnees && fiches.length ? (
        <Section titre="Ressources" action={<Text style={s.compteur}>{fiches.length}</Text>}>
          {fiches.map((r) => (
            <Fiche
              key={r.id}
              fiche={r}
              ouverte={ouverte === r.id}
              surAppui={() => setOuverte(ouverte === r.id ? null : r.id)}
            />
          ))}
        </Section>
      ) : null}

      {donnees && !q && !donnees.ressources.length ? (
        <Section titre="Ressources">
          <Vide
            icone="book-outline"
            titre="Aucune ressource publiée pour le moment"
            texte={
              "Les check-lists et les fiches de terrain se publient depuis l'OS, par " +
              "l'administration ou la production. Dès qu'une fiche y est ajoutée, elle apparaît ici."
            }
          />
        </Section>
      ) : null}

      {donnees && chapitres.length ? (
        <Section
          titre="Règlement intérieur"
          action={<Text style={s.compteur}>{donnees.chapitresAcceptes} / {donnees.chapitres.length}</Text>}
        >
          <Erreur message={message} />
          {donnees.chapitresARelire > 0 ? (
            <Text style={s.aRelire}>
              {donnees.chapitresARelire === 1
                ? "Un chapitre a été republié depuis que vous l'avez accepté : relisez-le et acceptez la nouvelle version."
                : `${donnees.chapitresARelire} chapitres ont été republiés depuis que vous les avez acceptés : relisez-les et acceptez la nouvelle version.`}
            </Text>
          ) : null}

          {chapitres.map((c) => (
            <Chapitre
              key={c.id}
              chapitre={c}
              ouvert={chapitreOuvert === c.id}
              enCours={enCours === c.id}
              verrouille={!!enCours}
              surAppui={() => setChapitreOuvert(chapitreOuvert === c.id ? null : c.id)}
              surAccepter={async () => {
                if (enCours) return;
                setEnCours(c.id);
                setMessage(null);
                try {
                  // ON ENVOIE LA VERSION AFFICHÉE, pas une valeur en dur : le déclencheur de la base
                  // refuse toute autre version, et c'est ce refus qui fait qu'une acceptation en
                  // base est une preuve.
                  await accepterChapitre(moi!.id, c.id, c.version);
                  oublier("centre:");
                  relire();
                } catch (e) {
                  // Le message de la base dit déjà quoi faire (« Rechargez le règlement pour lire le
                  // texte à jour »). Une phrase à nous en dirait moins.
                  setMessage(e instanceof Error ? e.message : "L'acceptation n'a pas été enregistrée.");
                } finally {
                  setEnCours(null);
                }
              }}
            />
          ))}

          <Text style={s.note}>
            {donnees.chapitresAcceptes === donnees.chapitres.length && donnees.chapitresARelire === 0
              ? "Vous avez accepté les neuf chapitres dans leur version en vigueur. Ils restent consultables ici à tout moment."
              : "Ouvrez un chapitre pour le lire en entier, puis acceptez-le. La version acceptée est enregistrée avec la date : si le texte est republié, vous serez invité à relire le nouveau."}
          </Text>
        </Section>
      ) : null}

      {donnees && contacts.length ? (
        <Section titre="Qui contacter ?">
          {!q ? <Text style={s.note}>{ORIENTATION}</Text> : null}
          {contacts.map((c) => <CarteContact key={c.role + c.sujet} contact={c} />)}
          {!q ? (
            <View style={s.escalade}>
              <Text style={s.escaladeTitre}>Escalade</Text>
              <Text style={s.escaladeTexte}>{ESCALADE}</Text>
            </View>
          ) : null}
        </Section>
      ) : null}

      {donnees && !q ? (
        <Text style={s.pied}>
          Les procédures détaillées, les rôles, le matériel et la FAQ restent dans l'OS : ce sont de
          longues pages qu'on lit assis. Ici, on a mis ce qu'on consulte en marchant.
        </Text>
      ) : null}
    </Ecran>
  );
}

/** Une fiche du Centre. Fermée, c'est un titre ; ouverte, c'est tout son texte. */
function Fiche({ fiche, ouverte, surAppui }: { fiche: Ressource; ouverte: boolean; surAppui: () => void }) {
  const lisible = !!fiche.contenu;
  return (
    <View style={s.carte}>
      <Pressable
        onPress={lisible ? surAppui : undefined}
        accessibilityRole={lisible ? "button" : undefined}
        accessibilityLabel={lisible ? `${fiche.titre}, ${ouverte ? "replier" : "déplier"}` : fiche.titre}
        accessibilityState={{ expanded: ouverte }}
        style={({ pressed }) => [s.entetteFiche, pressed && lisible ? { opacity: 0.7 } : null]}
      >
        <Text style={s.icone}>{fiche.icone ?? "📄"}</Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.ficheTitre}>{fiche.titre}</Text>
          {fiche.description ? <Text style={s.ficheSous}>{fiche.description}</Text> : null}
        </View>
        {!fiche.actif ? <Pastille texte="Masquée" ton="danger" /> : null}
        {lisible ? (
          <Ionicons name={ouverte ? "chevron-up" : "chevron-down"} size={18} color={C.texteFaible} />
        ) : null}
      </Pressable>

      {ouverte && fiche.contenu ? (
        // Le contenu est du texte à lignes, tel qu'il a été saisi dans l'OS : on le rend tel quel.
        // Le reformater en liste à puces supposerait un format que la colonne ne garantit pas.
        <Text style={s.ficheTexte} selectable>{fiche.contenu}</Text>
      ) : null}

      {/* Mesuré : aucune fiche de type « lien » en base aujourd'hui. Si l'OS en publie une, on
          montre son adresse en texte sélectionnable plutôt que d'ouvrir un navigateur : l'écran
          n'en sait pas assez pour promettre que le lien s'ouvrira. */}
      {!fiche.contenu && fiche.url ? (
        <Text style={s.ficheUrl} selectable>{fiche.url}</Text>
      ) : null}
      {!fiche.contenu && !fiche.url ? (
        <Text style={s.ficheVide}>Cette fiche n'a pas encore de contenu dans l'OS.</Text>
      ) : null}
    </View>
  );
}

/**
 * UN CHAPITRE DU RÈGLEMENT : SON TEXTE, ET SON ACCEPTATION.
 *
 * FERMÉ, C'EST UNE LIGNE AVEC SON ÉTAT. Ouvert, c'est le texte entier — ses sections et leurs
 * points, tels que la base les rend. Le bouton « J'accepte ce chapitre » n'apparaît QUE quand le
 * chapitre est ouvert : accepter un texte replié n'est pas un consentement, et c'était l'argument
 * qui empêchait ce bouton d'exister avant que la v381 mette le texte en base.
 *
 * LE TEXTE EST À 15,5 POINTS, comme les check-lists de cet écran : c'est la taille à laquelle une
 * règle se lit à bout de bras, au bord d'un terrain.
 *
 * AUCUN TIRET LONG N'EST AJOUTÉ PAR L'ÉCRAN. « Chapitre 1 · Respect et comportement » se compose du
 * `numero` et du `titre`, deux colonnes séparées en base précisément pour ça. Les quatre tirets
 * longs qui restent dans le texte des points du chapitre 3 sont ceux du règlement accepté en
 * version 1.0 : les réécrire serait modifier un texte que neuf personnes ont accepté, et cela
 * appartient à une version 1.1 que Fouka décide.
 */
function Chapitre({
  chapitre, ouvert, enCours, verrouille, surAppui, surAccepter,
}: {
  chapitre: UnChapitre;
  ouvert: boolean;
  enCours: boolean;
  verrouille: boolean;
  surAppui: () => void;
  surAccepter: () => void;
}) {
  const c = chapitre;
  return (
    <View style={[s.carte, c.accepte ? s.carteAcceptee : c.aRelire ? s.carteARelire : null]}>
      <Pressable
        onPress={surAppui}
        accessibilityRole="button"
        accessibilityLabel={`Chapitre ${c.numero}, ${c.titre}, ${c.accepte ? "accepté" : "à accepter"}. ${ouvert ? "Replier" : "Déplier pour lire"}.`}
        accessibilityState={{ expanded: ouvert }}
        style={({ pressed }) => [s.entetteFiche, pressed ? { opacity: 0.7 } : null]}
      >
        <Ionicons
          name={c.accepte ? "checkmark-circle" : c.aRelire ? "refresh-circle" : "ellipse-outline"}
          size={21}
          color={c.accepte ? C.succesTexte : c.aRelire ? C.alerteTexte : C.texteFaible}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.chapitreNumero}>Chapitre {c.numero}</Text>
          <Text style={s.ficheTitre}>{c.titre}</Text>
        </View>
        {c.accepte ? null : <Pastille texte={c.aRelire ? "À relire" : "À accepter"} ton="alerte" />}
        <Ionicons name={ouvert ? "chevron-up" : "chevron-down"} size={18} color={C.texteFaible} />
      </Pressable>

      {ouvert ? (
        <View style={s.texteChapitre}>
          {c.sections.map((x) => (
            <View key={x.id} style={{ gap: 4 }}>
              <Text style={s.sectionTitre}>{x.titre}</Text>
              {x.points.map((p, i) => (
                <View key={i} style={s.point}>
                  <Text style={s.pointPuce}>•</Text>
                  <Text style={s.pointTexte} selectable>{p}</Text>
                </View>
              ))}
            </View>
          ))}

          <Text style={s.version}>
            {c.accepte
              ? `Version ${c.version}, acceptée.`
              : c.aRelire
                ? `Version ${c.version} en vigueur. Vous aviez accepté la version ${c.versionAcceptee}.`
                : `Version ${c.version} en vigueur.`}
          </Text>

          {/* RÈGLE 5 : pas de bouton quand il n'y a rien à faire. Un chapitre déjà accepté dans sa
              version en vigueur ne se réaccepte pas, et l'index unique de la base le refuserait. */}
          {!c.accepte ? (
            <Bouton
              titre={c.aRelire ? "J'accepte la nouvelle version" : "J'accepte ce chapitre"}
              onPress={surAccepter}
              enCours={enCours}
              desactive={verrouille && !enCours}
              icone={<Ionicons name="checkmark" size={16} color="#fff" />}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Un sujet, et les personnes à qui l'adresser. */
function CarteContact({ contact }: { contact: Contact }) {
  return (
    <View style={s.carte}>
      <Text style={s.sujet}>{contact.sujet}</Text>
      <Text style={s.contactTitre}>{contact.titre}</Text>

      {contact.personnes.length ? (
        contact.personnes.map((p) => (
          <View key={p.id} style={s.personne}>
            <Ecusson nom={p.nom} taille={36} />
            <Text style={s.personneNom} numberOfLines={1}>{p.nom}</Text>

            {/* L'appel n'apparaît que si le numéro existe : 5 sur 18 en base. Un bouton qui ouvre
                le clavier sur « tel: » vide est pire que pas de bouton. */}
            {p.telephone ? (
              <Pressable
                onPress={() => { Linking.openURL(`tel:${p.telephone}`).catch(() => {}); }}
                accessibilityRole="button"
                accessibilityLabel={`Appeler ${p.nom}`}
                hitSlop={6}
                style={({ pressed }) => [s.rond, pressed ? { opacity: 0.7 } : null]}
              >
                <Ionicons name="call" size={16} color={C.succesTexte} />
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => router.push(`/messagerie?vers=${p.id}` as never)}
              accessibilityRole="button"
              accessibilityLabel={`Envoyer un message à ${p.nom}`}
              hitSlop={6}
              style={({ pressed }) => [s.rond, pressed ? { opacity: 0.7 } : null]}
            >
              <Ionicons name="chatbubble-ellipses" size={16} color={C.accentClair} />
            </Pressable>
          </View>
        ))
      ) : (
        // Pas de personne visible pour ce rôle : ou le poste n'est pas pourvu, ou l'annuaire ne
        // m'est pas ouvert. On ne devine pas laquelle des deux, et on ne propose pas d'action.
        <Text style={s.ficheVide}>
          Personne de visible à ce poste depuis votre compte. Passez par le Responsable Production.
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: T.titreEcran, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.sousEcran, lineHeight: T.sousEcranHauteur },
  attente: { color: C.texteFaible, fontFamily: P.texte, fontSize: 13.5 },
  compteur: { color: C.texteFaible, fontFamily: P.texteFort, fontSize: 13 },
  carte: {
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure,
    padding: E.m, gap: E.s,
  },
  entetteFiche: { flexDirection: "row", alignItems: "center", gap: E.s, minHeight: TOUCHE },
  icone: { fontSize: 22 },
  ficheTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: 15 },
  ficheSous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },
  // 15,5 points et une interligne de 23 : c'est la taille à laquelle une check-list se lit à bout
  // de bras, au soleil. En dessous, on rapproche le téléphone du visage, et on a les mains prises.
  ficheTexte: {
    color: C.texte, fontFamily: P.texte, fontSize: 15.5, lineHeight: 23,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.bordure, paddingTop: E.s,
  },
  ficheUrl: { color: C.cyanTexte, fontFamily: P.texte, fontSize: 13, lineHeight: 19 },
  ficheVide: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },
  carteAcceptee: { borderColor: "rgba(18,183,106,.24)" },
  carteARelire: { backgroundColor: "rgba(232,163,61,.06)", borderColor: "rgba(232,163,61,.28)" },
  chapitreNumero: {
    color: C.cyan, fontFamily: P.texteFort, fontSize: T.etiquette,
    textTransform: "uppercase", letterSpacing: 1,
  },
  texteChapitre: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.bordure,
    paddingTop: E.s, gap: E.m,
  },
  sectionTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: T.corps, lineHeight: 20 },
  point: { flexDirection: "row", gap: E.xs },
  pointPuce: { color: C.cyan, fontFamily: P.texte, fontSize: 15.5, lineHeight: 23 },
  // 15,5 points et une interligne de 23 : la meme que les check-lists de cet ecran. Une regle qu'on
  // s'engage a respecter se lit dans les memes conditions qu'une check-list, au bord d'un terrain.
  pointTexte: { flex: 1, color: C.texte, fontFamily: P.texte, fontSize: 15.5, lineHeight: 23 },
  version: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: T.note, lineHeight: T.noteHauteur },
  aRelire: { color: C.alerteTexte, fontFamily: P.texteMoyen, fontSize: T.detail, lineHeight: T.detailHauteur },
  note: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13, lineHeight: 19 },
  sujet: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 12 },
  contactTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  personne: {
    flexDirection: "row", alignItems: "center", gap: E.s, minHeight: TOUCHE,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.bordure, paddingTop: E.s,
  },
  personneNom: { flex: 1, color: C.texte, fontFamily: P.texteFort, fontSize: 14.5 },
  rond: {
    width: TOUCHE, height: TOUCHE, borderRadius: R.m, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.06)", borderWidth: 1, borderColor: C.bordure,
  },
  escalade: {
    borderRadius: R.l, padding: E.m, gap: E.xs,
    backgroundColor: "rgba(240,68,94,.07)", borderWidth: 1, borderColor: "rgba(240,68,94,.24)",
  },
  escaladeTitre: { color: C.dangerTexte, fontFamily: P.titreFort, fontSize: 14 },
  escaladeTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13, lineHeight: 19 },
  pied: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },
});
