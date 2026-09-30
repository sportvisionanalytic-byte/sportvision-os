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
// CE QU'IL N'Y A PAS, ET POURQUOI : le texte du règlement, les procédures, les rôles, la FAQ. Ces
// pages du Centre sont écrites en dur dans le HTML de l'OS, pas en base (voir l'en-tête de
// `src/lib/os-centre.ts`). L'application n'en garde pas de copie : un règlement qu'on accepte doit
// être lu dans sa version en vigueur, et deux copies d'un texte qu'on signe finissent par diverger.
import React, { useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Ecran, Probleme, Section, Vide } from "../../src/ui/Ecran";
import { Champ, Pastille } from "../../src/ui/Base";
import { Ecusson } from "../../src/ui/Ecusson";
import { useSession } from "../../src/lib/session";
import { useDonnees } from "../../src/lib/cache";
import {
  ESCALADE, ORIENTATION, lireCentre, normaliser, ressourceCorrespond,
  type Centre as DonneesCentre, type Contact, type Ressource,
} from "../../src/lib/os-centre";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P, T } from "../../src/theme/polices";

export default function CentreSportVision() {
  const { moi } = useSession();
  const [requete, setRequete] = useState("");
  const [ouverte, setOuverte] = useState<string | null>(null);

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
  const chapitres = useMemo(() => {
    const n = normaliser(q);
    if (!n) return donnees?.chapitres ?? [];
    return (donnees?.chapitres ?? []).filter((c) => normaliser(c.titre).includes(n));
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
          titre="Règlement"
          action={<Text style={s.compteur}>{donnees.chapitresAcceptes} / {donnees.chapitres.length}</Text>}
        >
          <View style={s.bloc}>
            {chapitres.map((c, i) => (
              <View key={c.id} style={[s.ligneChapitre, i === chapitres.length - 1 && { borderBottomWidth: 0 }]}>
                <Ionicons
                  name={c.accepte ? "checkmark-circle" : "ellipse-outline"}
                  size={19}
                  color={c.accepte ? C.succesTexte : C.texteFaible}
                />
                <Text style={[s.chapitreTitre, !c.accepte && { color: C.texteDoux }]} numberOfLines={2}>
                  {c.titre}
                </Text>
                {c.accepte ? null : <Pastille texte="À accepter" ton="alerte" />}
              </View>
            ))}
          </View>
          {/* LA RAISON D'ÊTRE DE CE PARAGRAPHE : sans lui, l'absence de bouton « Accepter »
              ressemble à une panne. Avec lui, c'est une décision qu'on comprend. */}
          <Text style={s.note}>
            {donnees.chapitresAcceptes === donnees.chapitres.length
              ? "Vous avez accepté les neuf chapitres. Le texte se relit dans l'OS, sur un ordinateur."
              : "Le texte des chapitres se lit et s'accepte dans l'OS, sur un ordinateur. " +
                "L'application n'en garde pas de copie : un règlement qu'on accepte doit être lu " +
                "dans sa version en vigueur."}
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
  bloc: { borderRadius: R.l, backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure, overflow: "hidden" },
  ligneChapitre: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    paddingHorizontal: E.m, paddingVertical: E.s, minHeight: TOUCHE,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.bordure,
  },
  chapitreTitre: { flex: 1, color: C.texte, fontFamily: P.texteMoyen, fontSize: 13.5, lineHeight: 19 },
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
