// LE CENTRE DE FORMATION (30/09/2026).
//
// CET ÉCRAN RÉPOND À UNE SEULE QUESTION : OÙ J'EN SUIS. Mon grade, mon XP, mes formations
// commencées et terminées, mes certifications et leur date d'expiration. C'est ce qu'on vient
// vérifier depuis un téléphone — avant un entretien, avant une mission qui demande une
// certification, ou simplement parce qu'on a été noté.
//
// IL N'Y A NI CATALOGUE NI LEÇON NI QUIZ, ET CE N'EST PAS UN MANQUE DE TEMPS. Mesuré en base avant
// d'écrire (détail dans l'en-tête de `src/lib/os-formation.ts`) :
//   · le contenu du catalogue — titres, modules, leçons — vit dans le HTML de l'OS, pas en base ;
//   · les questions de quiz sont dans `formation_quiz_questions`, réservée au rôle 'admin' :
//     0 ligne visible avec le jeton d'un opérateur, sur 1 133 ;
//   · `formations_quiz_custom`, que lit `rpc_get_custom_quiz`, est vide.
// Un onglet « Catalogue » n'aurait donc aucun titre à montrer, et un quiz aucune question à poser.
// Personne ne suit une formation de 96 leçons debout ; on a mis ce qui se consulte debout.
//
// L'XP NE SE CALCULE PAS ICI. C'est `rpc_complete_formation` et `rpc_submit_quiz` qui créditent, et
// un trigger interdit à un collaborateur de toucher ses propres `xp_gagnes`. L'écran lit
// `profiles.xp` et `formation_inscriptions.xp_gagnes` : des résultats, pas des estimations. Et il
// n'écrit rien du tout.
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Ecran, Probleme, Section, Vide } from "../../src/ui/Ecran";
import { Barre } from "../../src/ui/Barre";
import { Pastille } from "../../src/ui/Base";
import { useSession } from "../../src/lib/session";
import { useDonnees } from "../../src/lib/cache";
import {
  dateCourte, lireParcours,
  type MaCertification, type MaFormation, type Parcours,
} from "../../src/lib/os-formation";
import { C, E, R } from "../../src/theme/couleurs";
import { P, T } from "../../src/theme/polices";

/** Les deux onglets que l'application sait dessiner. Mêmes libellés que l'OS. */
type Onglet = "mes-formations" | "certifications";

export default function Formation() {
  const { moi } = useSession();
  const [onglet, setOnglet] = useState<Onglet>("mes-formations");

  const { donnees, chargement, rafraichissement, erreur, relire } = useDonnees<Parcours>(
    moi ? `formation:${moi.id}` : null,
    () => lireParcours(moi!.id, moi!.role),
    [moi?.id, moi?.role],
  );

  return (
    <Ecran teinte="violet" enCours={rafraichissement} rafraichir={relire} retour="/profil">
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Centre de formation</Text>
        <Text style={s.sous}>Votre progression, vos certifications.</Text>
      </View>

      {erreur && !donnees ? <Probleme surReessayer={relire} /> : null}
      {chargement ? <Text style={s.attente}>Chargement…</Text> : null}

      {donnees ? (
        <>
          {/* Le grade ne s'affiche que pour les opérateurs terrain : décision de l'OS, reprise
              telle quelle. Afficher « Débutant, 0 XP » à la comptabilité serait un jugement
              tiré d'un parcours qui ne la concerne pas. */}
          {donnees.parcoursXp ? <BlocGrade parcours={donnees} /> : null}

          <View style={s.stats}>
            <Stat
              libelle="Formations"
              valeur={`${donnees.terminees}/${donnees.formations.length}`}
            />
            {donnees.parcoursXp ? <Stat libelle="XP total" valeur={donnees.xp.toLocaleString("fr-FR")} /> : null}
            <Stat
              libelle="Certifications"
              valeur={String(donnees.certificationsActives)}
              teinte={donnees.certificationsActives > 0 ? C.violetTexte : undefined}
            />
          </View>

          {/* La rangée de puces est la brique `src/ui/Barre.tsx`, celle du cockpit des missions.
              Deux rangées d'onglets presque identiques dans la même application, c'est exactement
              le reproche numéro un de Fouka. Les compteurs disent ce qu'il y a derrière avant
              qu'on y aille. */}
          <Barre
            choix={[
              { cle: "mes-formations", libelle: "Mes formations", n: donnees.formations.length },
              { cle: "certifications", libelle: "Certifications", n: donnees.certifications.length },
            ]}
            actif={onglet}
            surChoix={(c) => setOnglet(c as Onglet)}
          />

          {onglet === "mes-formations" ? <MesFormations parcours={donnees} /> : <Certifications parcours={donnees} />}

          <Text style={s.pied}>
            Les leçons, les quiz et le catalogue restent dans l'OS, sur un ordinateur : c'est là que
            vit leur contenu. Cette application montre ce que la base sait de votre parcours.
          </Text>
        </>
      ) : null}
    </Ecran>
  );
}

// ── Le grade ────────────────────────────────────────────────────────────────────────────────────

function BlocGrade({ parcours }: { parcours: Parcours }) {
  const g = parcours.grade;
  return (
    <View style={s.grade}>
      <View style={{ gap: 3 }}>
        <Text style={s.gradeNom}>{g.nom}</Text>
        <Text style={s.gradeXp}>{parcours.xp.toLocaleString("fr-FR")} XP total</Text>
      </View>

      {g.suivant && g.restant !== null ? (
        <View style={{ gap: E.xs }}>
          <Jauge avancement={g.avancement} couleur={C.accentClair} />
          <Text style={s.gradeSuite}>
            → {g.suivant} dans {g.restant.toLocaleString("fr-FR")} XP
          </Text>
        </View>
      ) : (
        <Text style={s.gradeMax}>Grade maximum atteint</Text>
      )}

      {/* La nuance vaut d'être écrite : le grade est ACCORDÉ, il ne se déclenche pas au seuil. Sans
          cette ligne, quelqu'un qui dépasse 2 000 XP sans changer de grade croit à un bug. */}
      <Text style={s.gradeNote}>
        Le grade est validé par l'administration. Franchir un seuil d'XP ne le change pas tout seul.
      </Text>
    </View>
  );
}

// ── Mes formations ──────────────────────────────────────────────────────────────────────────────

function MesFormations({ parcours }: { parcours: Parcours }) {
  const enCours = parcours.formations.filter((f) => !f.terminee);
  const terminees = parcours.formations.filter((f) => f.terminee);

  if (!parcours.formations.length) {
    return (
      <Vide
        icone="school-outline"
        titre="Aucune formation commencée"
        texte={
          "Les formations s'ouvrent depuis le Centre de formation de l'OS, sur un ordinateur : " +
          "c'est là que se lisent les leçons. Dès qu'une formation est commencée, sa progression " +
          "apparaît ici."
        }
      />
    );
  }

  return (
    <View style={{ gap: E.l }}>
      {enCours.length ? (
        <Section titre="En cours">
          {enCours.map((f) => <CarteEnCours key={f.formationId} f={f} />)}
        </Section>
      ) : null}

      {terminees.length ? (
        <Section titre="Terminées">
          {terminees.map((f) => <CarteTerminee key={f.formationId} f={f} />)}
        </Section>
      ) : null}
    </View>
  );
}

function CarteEnCours({ f }: { f: MaFormation }) {
  return (
    <View style={s.carte}>
      <View style={s.ligneHaute}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.formTitre}>{f.titre}</Text>
          <Text style={s.formSous}>
            {f.leconsTotal !== null
              ? `${f.leconsFaites} / ${f.leconsTotal} leçons`
              : `${f.leconsFaites} leçon${f.leconsFaites > 1 ? "s" : ""} validée${f.leconsFaites > 1 ? "s" : ""}`}
            {f.certifiante ? " · certifiante" : ""}
          </Text>
        </View>
        <Text style={s.pourcent}>{f.avancement}%</Text>
      </View>
      <Jauge avancement={f.avancement} couleur={C.accentClair} />
      {f.sansNom ? <Nomme id={f.formationId} /> : null}
      {/* Le nombre de leçons attendu vient du serveur ; quand il manque, l'avancement n'a pas de
          dénominateur et on le dit au lieu d'afficher un 0 % trompeur. */}
      {f.leconsTotal === null ? (
        <Text style={s.avertissement}>
          Le serveur ne connaît pas le nombre de leçons de cette formation : l'avancement ne peut
          pas être calculé.
        </Text>
      ) : null}
    </View>
  );
}

function CarteTerminee({ f }: { f: MaFormation }) {
  const le = dateCourte(f.termineeLe);
  return (
    <View style={[s.carte, s.carteTerminee]}>
      <View style={s.ligneHaute}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.formTitre}>{f.titre}</Text>
          <Text style={s.formSousOk}>
            {[
              le ? `Terminée le ${le}` : null,
              f.xpCredite > 0 ? `+${f.xpCredite.toLocaleString("fr-FR")} XP` : null,
              f.scoreQuiz !== null ? `Quiz ${f.scoreQuiz}%` : null,
            ].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <Ionicons name="checkmark-circle" size={22} color={C.succesTexte} />
      </View>
      {f.sansNom ? <Nomme id={f.formationId} /> : null}
    </View>
  );
}

/** Quand aucun nom n'est connu, on montre l'identifiant et on dit pourquoi. Jamais un nom inventé. */
function Nomme({ id }: { id: string }) {
  return (
    <Text style={s.avertissement}>
      Formation « {id} » : son titre n'est pas encore connu de l'application. Il se lit dans l'OS.
    </Text>
  );
}

// ── Certifications ──────────────────────────────────────────────────────────────────────────────

function Certifications({ parcours }: { parcours: Parcours }) {
  if (!parcours.certifications.length) {
    return (
      <Vide
        icone="ribbon-outline"
        titre="Aucune certification"
        texte={
          "Une certification s'obtient en terminant une formation qui en délivre une. Elle est " +
          "créée par le serveur, avec son numéro et sa date d'expiration, et apparaît ici aussitôt."
        }
      />
    );
  }
  return (
    <Section titre="Certifications obtenues">
      {parcours.certifications.map((c) => <CarteCertification key={c.id} c={c} />)}
    </Section>
  );
}

function CarteCertification({ c }: { c: MaCertification }) {
  const expiree = c.statut === "expiree";
  // SOIXANTE JOURS, comme dans l'OS. Une certification qui expire dans deux mois, c'est une mission
  // qu'on ne pourra plus accepter : c'est maintenant qu'il faut la renouveler, pas la veille.
  const bientot = !expiree && c.joursRestants !== null && c.joursRestants <= 60;
  const obtenue = dateCourte(c.obtenueLe);
  const expire = dateCourte(c.expireLe);

  return (
    <View style={[s.carte, expiree ? s.carteExpiree : bientot ? s.carteBientot : s.carteCertif]}>
      <View style={s.ligneHaute}>
        <Text style={[s.badge, expiree && { opacity: 0.45 }]}>{c.badge ?? "🏅"}</Text>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.certifNom}>{c.nom}</Text>
          {c.parFormation ? <Text style={s.formSous}>via {c.parFormation}</Text> : null}
          {obtenue ? <Text style={s.formSousOk}>Obtenue le {obtenue}</Text> : null}
          {expire ? (
            <Text style={[s.formSous, expiree && { color: C.dangerTexte }, bientot && { color: C.alerteTexte }]}>
              {expiree ? "Expirée le" : "Expire le"} {expire}
              {bientot && c.joursRestants !== null ? ` (${c.joursRestants} j)` : ""}
            </Text>
          ) : null}
          {c.numero ? <Text style={s.numero}>{c.numero}</Text> : null}
        </View>
        <Pastille
          texte={expiree ? "Expirée" : bientot ? "Bientôt" : "Active"}
          ton={expiree ? "danger" : bientot ? "alerte" : "succes"}
        />
      </View>
      {/* L'OS propose une attestation PDF. Elle est fabriquée par le navigateur, côté OS : rien en
          base ne permet de la produire ici, et un bouton qui ne rendrait pas de fichier serait une
          promesse cassée. On dit où la chercher. */}
      {!expiree ? (
        <Text style={s.avertissement}>
          L'attestation PDF se télécharge depuis l'OS, sur un ordinateur.
        </Text>
      ) : null}
    </View>
  );
}

// ── Briques locales ─────────────────────────────────────────────────────────────────────────────

function Stat({ libelle, valeur, teinte }: { libelle: string; valeur: string; teinte?: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLibelle}>{libelle}</Text>
      <Text style={[s.statValeur, teinte ? { color: teinte } : null]}>{valeur}</Text>
    </View>
  );
}

/** Une jauge d'avancement. Pas la même chose que `Barre` de `src/ui/` : celle-là est une rangée de
 *  puces, celle-ci une barre de progression. Elle ne sert qu'ici, elle reste donc ici. */
function Jauge({ avancement, couleur }: { avancement: number; couleur: string }) {
  return (
    <View style={s.barre} accessibilityRole="progressbar" accessibilityValue={{ now: avancement, min: 0, max: 100 }}>
      {/* UNE JAUGE À ZÉRO DOIT QUAND MÊME SE LIRE COMME UNE JAUGE (01/10/2026, vu à l'écran).
          Avec 0 % de remplissage, il ne restait qu'un filet gris sur toute la largeur : on le lit
          comme un trait de séparation, pas comme « il reste tout à faire ». Deux pour cent de
          couleur au départ suffisent à dire que c'est une barre qui se remplit. La valeur
          annoncée à la lecture vocale, elle, reste le vrai avancement, juste au-dessus. */}
      <View style={[s.barreRemplie, { width: `${Math.max(2, Math.min(100, avancement))}%`, backgroundColor: couleur }]} />
    </View>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: T.titreEcran, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.sousEcran, lineHeight: T.sousEcranHauteur },
  attente: { color: C.texteFaible, fontFamily: P.texte, fontSize: 13.5 },

  grade: {
    backgroundColor: C.surfaceHaute, borderRadius: R.xl, borderWidth: 1, borderColor: C.bordureForte,
    padding: E.l, gap: E.m,
  },
  gradeNom: { color: C.texte, fontFamily: P.titre, fontSize: 24, letterSpacing: -0.5 },
  gradeXp: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13.5 },
  gradeSuite: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5 },
  gradeMax: { color: C.alerteTexte, fontFamily: P.texteFort, fontSize: 13.5 },
  gradeNote: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12, lineHeight: 17 },

  stats: { flexDirection: "row", gap: E.s },
  stat: {
    flex: 1, backgroundColor: C.surface, borderRadius: R.m, borderWidth: 1, borderColor: C.bordure,
    paddingVertical: E.s, paddingHorizontal: E.s, gap: 2,
  },
  statLibelle: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 11.5 },
  statValeur: { color: C.texte, fontFamily: P.titre, fontSize: 19, letterSpacing: -0.4 },

  carte: {
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure,
    padding: E.m, gap: E.s,
  },
  carteTerminee: { backgroundColor: "rgba(18,183,106,.06)", borderColor: "rgba(18,183,106,.24)" },
  carteCertif: { backgroundColor: "rgba(131,45,255,.08)", borderColor: "rgba(131,45,255,.28)" },
  carteBientot: { backgroundColor: "rgba(232,163,61,.07)", borderColor: "rgba(232,163,61,.28)" },
  carteExpiree: { backgroundColor: "rgba(240,68,94,.07)", borderColor: "rgba(240,68,94,.26)" },
  ligneHaute: { flexDirection: "row", alignItems: "flex-start", gap: E.s },
  formTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: 15, lineHeight: 20 },
  formSous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },
  formSousOk: { color: C.succesTexte, fontFamily: P.texteMoyen, fontSize: 12.5, lineHeight: 18 },
  pourcent: { color: C.accentClair, fontFamily: P.titre, fontSize: 18 },
  badge: { fontSize: 30, lineHeight: 34 },
  certifNom: { color: C.texte, fontFamily: P.titreFort, fontSize: 15, lineHeight: 20 },
  numero: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 11.5, letterSpacing: 0.4 },
  avertissement: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12, lineHeight: 17 },

  barre: { height: 6, borderRadius: R.pill, backgroundColor: "rgba(255,255,255,.09)", overflow: "hidden" },
  barreRemplie: { height: "100%", borderRadius: R.pill },

  pied: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },
});
