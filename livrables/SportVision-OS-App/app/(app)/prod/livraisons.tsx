// LES LIVRAISONS (30/09/2026).
//
// CE QUE CET ECRAN A DECOUVERT EN SE MESURANT. Les 9 liens qui attendent quelque chose de la
// production se repartissent ainsi : 8 sur SV-2026-3121, 1 sur SV-2026-3843. Or SV-2026-3121 est
// rangee par la vue dans le groupe `terrain`, pas dans `a_verifier`. UN ECRAN BATI SUR LE GROUPE
// N'AURAIT MONTRE AUCUN DES HUIT. On part donc des liens, et on affiche le groupe de leur mission a
// cote — sans jamais le recalculer.
//
// « CE QUI EST EN RETARD » N'A PAS DE DONNEES, ET IL FAUT LE DIRE. Mesure : `livraison_en_retard`
// est faux sur les 10 missions, et `echeance_manquante` est VRAI sur 9. La raison est la meme : sans
// `deadline_photo_at` ni `deadline_video_at`, la base ne peut rien declarer en retard. Une liste
// vide se lirait « tout est a l'heure ». C'est faux : on ne sait pas. L'ecran le dit, et dit ou la
// saisir.
//
// CE QUI BLOQUE LA CLOTURE EST LA QUATRIEME LISTE, et c'est la plus utile. `mission_cloture_manquant`
// rend des phrases entieres, ecrites en base, du genre « Sauvegarde non confirmee par l'operateur
// (il doit cocher fichiers copies et verifies) ». On les affiche telles quelles : les reformuler
// serait ouvrir un second vocabulaire pour la meme regle.
//
// AUCUN VERDICT DEPUIS CET ECRAN, ET C'EST UN CHOIX. Valider un lien ou demander une correction
// declenche des triggers en base (`notifier_decision_livraison`) et engage la remuneration d'un
// freelance. Ce sont des decisions, pas des consultations. L'ecran les MONTRE ; le verdict reste
// dans l'OS jusqu'a ce que Fouka tranche.
import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Probleme, Vide } from "../../../src/ui/Ecran";
import { Pastille } from "../../../src/ui/Base";
import { Barre } from "../../../src/ui/Barre";
import { EcranProd } from "./_layout";
import { useDonnees } from "../../../src/lib/cache";
import { libelleCouverture } from "../../../src/lib/os-missions";
import { LIBELLE_CATEGORIE } from "../../../src/lib/os-livrables";
import { quand } from "../../../src/lib/dates";
import {
  lireLiensATraiter, lireMissions, type Lien, type MissionProd,
} from "../../../src/lib/os-production";
import { C, E, R } from "../../../src/theme/couleurs";
import { P } from "../../../src/theme/polices";

const LIBELLE_GROUPE: Record<string, string> = {
  a_planifier: "À planifier",
  attente_acceptation: "En attente",
  a_venir: "À venir",
  terrain: "Sur le terrain",
  post_production: "Post-production",
  a_verifier: "À vérifier",
  corrections: "Corrections",
  terminees: "Terminées",
  autres: "Autres",
};

// LE VOCABULAIRE DES LIENS A DEMENAGE DANS `os-livrables.ts` (01/10/2026).
//
// Il vivait ici, en quatre entrées sur les sept que porte `media_liens_categorie_check` : un lien en
// `travail`, `previsualisation` ou `bibliotheque` s'affichait donc avec sa valeur brute. L'écran des
// livrables de l'opérateur a besoin des mêmes mots, et une copie partielle d'un vocabulaire est un
// second vocabulaire qui dit moins. Les trois tables complètes — statuts, catégories, types de média
// — sont maintenant auprès du type qui porte les champs, et importées des deux côtés.
//
// Un mot a changé au passage : `final` se lisait « Livrable final » ici et « Final » dans l'OS.
// C'est l'OS qui fait foi (règle 9).

interface Donnees {
  missions: MissionProd[];
  liens: Lien[];
}

export default function EcranLivraisons() {
  const [liste, setListe] = useState("a_verifier");

  const { donnees, chargement, rafraichissement, erreur, relire } = useDonnees<Donnees>(
    "prod:livraisons",
    async () => {
      const [missions, liens] = await Promise.all([lireMissions(), lireLiensATraiter()]);
      return { missions, liens };
    },
  );

  const missions = donnees?.missions ?? [];
  const liens = donnees?.liens ?? [];

  const aVerifier = useMemo(() => liens.filter((l) => l.statut === "a_verifier"), [liens]);
  const corrections = useMemo(() => liens.filter((l) => l.statut === "correction_demandee"), [liens]);
  const enRetard = useMemo(() => missions.filter((m) => m.enRetard), [missions]);
  const aClore = useMemo(
    () => missions.filter((m) => m.clotureManquant.length && m.groupe !== "terminees"),
    [missions],
  );
  const sansEcheance = useMemo(() => missions.filter((m) => m.echeanceManquante).length, [missions]);

  const sous = chargement
    ? "Chargement"
    : [
        aVerifier.length ? `${aVerifier.length} lien${aVerifier.length > 1 ? "s" : ""} à vérifier` : null,
        corrections.length ? `${corrections.length} correction${corrections.length > 1 ? "s" : ""} demandée${corrections.length > 1 ? "s" : ""}` : null,
      ].filter(Boolean).join(" · ") || "Rien n'attend la production";

  return (
    <EcranProd titre="Livraisons" sous={sous} rafraichir={relire} enCours={rafraichissement}>
      <Barre
        choix={[
          { cle: "a_verifier", libelle: "À vérifier", n: aVerifier.length },
          { cle: "corrections", libelle: "Corrections", n: corrections.length },
          { cle: "a_clore", libelle: "À clôturer", n: aClore.length },
          { cle: "retard", libelle: "En retard", n: enRetard.length },
        ]}
        actif={liste}
        surChoix={setListe}
      />

      {chargement ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : erreur ? (
        <Probleme surReessayer={relire} />
      ) : liste === "a_verifier" ? (
        <ParMission
          liens={aVerifier}
          missions={missions}
          videTitre="Aucun lien à vérifier"
          videTexte={
            "Les liens déposés par les opérateurs arrivent ici tant que la production ne les a pas " +
            "validés. Un lien sans état compte comme « à vérifier », exactement comme en base."
          }
        />
      ) : liste === "corrections" ? (
        <ParMission
          liens={corrections}
          missions={missions}
          videTitre="Aucune correction en cours"
          videTexte={
            "Quand la production demande une correction sur un lien, il se range ici avec le motif, " +
            "et la mission passe dans le groupe « Corrections » du cockpit."
          }
        />
      ) : liste === "a_clore" ? (
        aClore.length ? (
          <View style={{ gap: E.s }}>
            {aClore.map((m) => (
              <View key={m.id} style={s.carte}>
                <EnteteMission m={m} />
                <View style={{ gap: E.xs }}>
                  {/* Les phrases sont celles de `mission_cloture_manquant`, mot pour mot. */}
                  {m.clotureManquant.map((p, i) => (
                    <View key={`${m.id}-${i}`} style={s.puceManque}>
                      <Text style={s.point}>•</Text>
                      <Text style={s.manqueTexte}>{p}</Text>
                    </View>
                  ))}
                </View>
                <Text style={s.compteurs}>
                  {`${m.nbPhotos} photo${m.nbPhotos > 1 ? "s" : ""} · ${m.nbMontages} montage${m.nbMontages > 1 ? "s" : ""} · ${m.nbRushs} rush${m.nbRushs > 1 ? "s" : ""}`}
                  {m.transfertConfirme ? " · sauvegarde confirmée" : ""}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Vide
            titre="Rien ne bloque une clôture"
            texte="Dès qu'une mission garde quelque chose en travers, la raison s'affiche ici, phrase par phrase."
          />
        )
      ) : enRetard.length ? (
        <View style={{ gap: E.s }}>
          {enRetard.map((m) => (
            <View key={m.id} style={s.carte}>
              <EnteteMission m={m} />
              <Pastille ton="danger" texte="Livraison en retard" />
            </View>
          ))}
        </View>
      ) : (
        <Vide
          titre="Le retard ne peut pas être calculé"
          texte={
            `Une livraison n'est « en retard » que par rapport à une échéance, et ${sansEcheance} mission` +
            `${sansEcheance > 1 ? "s" : ""} sur ${missions.length} n'en ` +
            `${sansEcheance > 1 ? "ont" : "a"} aucune. Cette liste est donc vide parce que la donnée ` +
            "manque, pas parce que tout est à l'heure. Les échéances photo et vidéo se saisissent sur " +
            "la fiche de la mission, dans l'OS."
          }
        />
      )}

      {/* Le chiffre est rappele sous chaque liste : c'est lui qui explique les zeros au-dessus. */}
      {!chargement && !erreur && sansEcheance ? (
        <Text style={s.note}>
          {`${sansEcheance} mission${sansEcheance > 1 ? "s" : ""} sur ${missions.length} sans échéance de livraison.`}
        </Text>
      ) : null}
    </EcranProd>
  );
}

/** Les liens ranges sous leur mission : on ne lit jamais un lien sans savoir de quel match il parle. */
function ParMission({
  liens, missions, videTitre, videTexte,
}: { liens: Lien[]; missions: MissionProd[]; videTitre: string; videTexte: string }) {
  const groupes = useMemo(() => {
    const m = new Map<string, Lien[]>();
    for (const l of liens) {
      const t = m.get(l.prestationId);
      if (t) t.push(l); else m.set(l.prestationId, [l]);
    }
    return [...m.entries()];
  }, [liens]);

  if (!groupes.length) return <Vide titre={videTitre} texte={videTexte} />;

  return (
    <View style={{ gap: E.s }}>
      {groupes.map(([prestationId, sesLiens]) => {
        const m = missions.find((x) => x.id === prestationId) ?? null;
        return (
          <View key={prestationId} style={s.carte}>
            {m ? <EnteteMission m={m} /> : (
              // Un lien dont la mission n'est pas dans la vue : on ne l'escamote pas, on le dit.
              <Text style={s.nom}>Mission hors de votre pôle</Text>
            )}
            <View style={{ gap: E.xs }}>
              {sesLiens.map((l) => <LigneLien key={l.id} l={l} />)}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function EnteteMission({ m }: { m: MissionProd }) {
  return (
    <View style={s.ligne}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={s.nom} numberOfLines={2}>{m.client ?? "Sans client"}</Text>
        <Text style={s.detail} numberOfLines={2}>
          {[m.date ? quand(m.date) : "Sans date", m.operateurs].filter(Boolean).join(" · ")}
        </Text>
        <Text style={s.reference}>{m.reference}</Text>
      </View>
      <Pastille texte={LIBELLE_GROUPE[m.groupe] ?? m.groupe} />
    </View>
  );
}

function LigneLien({ l }: { l: Lien }) {
  return (
    <View style={s.lien}>
      <View style={s.ligne}>
        <Text style={s.lienNom} numberOfLines={2}>{l.nom}</Text>
        {l.statut === "correction_demandee"
          ? <Pastille ton="danger" texte="Correction demandée" />
          : <Pastille ton="alerte" texte="À vérifier" />}
      </View>
      {/* DEUX LIGNES, ET C'EST UN DEFAUT VU A L'ECRAN : sur une seule, la ligne se terminait par
          « depose par Antoine Blin · m… » — le « m » de « mardi », qui n'apprend rien a personne.
          Un texte coupe au milieu d'un mot est un bug, pas une mise en page. */}
      <Text style={s.lienDetail} numberOfLines={2}>
        {[
          LIBELLE_CATEGORIE[l.categorie ?? ""] ?? l.categorie,
          libelleCouverture(l.typeMedia),
          l.deposePar ? `déposé par ${l.deposePar}` : null,
          l.depuis ? quand(l.depuis.slice(0, 10)) : null,
        ].filter(Boolean).join(" · ")}
      </Text>
      {/* Le motif de la correction est le texte de la production. Il se lit tel quel. */}
      {l.commentaire ? <Text style={s.commentaire}>« {l.commentaire} »</Text> : null}
      {/* Le transfert confirme est la seule preuve qu'une carte peut etre formatee. */}
      <Text style={l.transfertConfirme ? s.sauvegardeOk : s.sauvegardeNon}>
        {l.transfertConfirme ? "Sauvegarde confirmée" : "Sauvegarde non confirmée"}
      </Text>
      {/* Pas de lien cliquable : cette application ne renvoie vers aucune page (règle 2). L'adresse
          est affichée pour reconnaître le fournisseur, et la vérification se fait sur ordinateur. */}
      {l.url ? <Text style={s.url} numberOfLines={1}>{l.url}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  attente: { paddingVertical: E.xl * 2, alignItems: "center" },
  carte: {
    gap: E.s, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  ligne: { flexDirection: "row", alignItems: "flex-start", gap: E.s },
  nom: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  reference: { color: C.texteFaible, fontFamily: P.texte, fontSize: 11.5 },
  compteurs: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12 },
  note: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12, lineHeight: 17 },

  lien: {
    gap: 4, padding: E.s, borderRadius: R.m,
    backgroundColor: C.surfaceHaute, borderWidth: 1, borderColor: C.bordure,
  },
  lienNom: { flex: 1, color: C.texte, fontFamily: P.texteFort, fontSize: 14 },
  lienDetail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 12.5 },
  commentaire: { color: C.dangerTexte, fontFamily: P.texte, fontSize: 13, lineHeight: 18 },
  sauvegardeOk: { color: C.succesTexte, fontFamily: P.texteMoyen, fontSize: 12 },
  sauvegardeNon: { color: C.alerteTexte, fontFamily: P.texteMoyen, fontSize: 12 },
  url: { color: C.texteFaible, fontFamily: P.texte, fontSize: 11 },

  puceManque: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  point: { color: C.alerteTexte, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  manqueTexte: { flex: 1, color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
});
