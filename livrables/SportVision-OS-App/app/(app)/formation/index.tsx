// LE CENTRE DE FORMATION (01/10/2026).
//
// CET ÉCRAN A CHANGÉ DE NATURE AUJOURD'HUI. Jusqu'au 30/09 il répondait à une seule question, « où
// j'en suis », et son en-tête disait pourquoi : « IL N'Y A NI CATALOGUE NI LEÇON NI QUIZ, ET CE
// N'EST PAS UN MANQUE DE TEMPS […] le contenu du catalogue vit dans le HTML de l'OS, pas en base ».
// Fouka a résumé le résultat ce matin : « je ne peux pas cliquer sur les trucs. On dirait des
// captures d'écran posées, figées. »
//
// Les migrations v379 à v382 ont mis le catalogue, le règlement et les questions de quiz en base.
// Il y a donc maintenant trois onglets, et le deuxième est ouvrable :
//
//   · MES FORMATIONS — ce que j'ai commencé, avec l'avancement réel. On appuie, on entre.
//   · CATALOGUE — les formations que la base m'ouvre, cherchables, rangées par catégorie.
//   · CERTIFICATIONS — ce que j'ai obtenu, avec la date d'expiration.
//
// LE CATALOGUE N'EST PAS FILTRÉ ICI (règle 3 du contrat). La policy `formations_lire` borne déjà :
// un opérateur photo en voit 36, un secrétaire 20, un community manager 45, l'administration 108.
// Vérifié avec le jeton de sept personnes réelles. Un second filtre par rôle dans cet écran serait
// une deuxième version de la même règle, et un jour elles diraient deux choses.
//
// L'XP NE SE CALCULE PAS ICI. C'est `rpc_complete_formation` et `rpc_submit_quiz` qui créditent, et
// un trigger interdit à un collaborateur de toucher ses propres `xp_gagnes`. L'écran lit
// `profiles.xp` et `formation_inscriptions.xp_gagnes` : des résultats, pas des estimations.
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Ecran, Probleme, Section, Vide } from "../../../src/ui/Ecran";
import { Barre } from "../../../src/ui/Barre";
import { Jauge } from "../../../src/ui/Jauge";
import { Champ, Pastille } from "../../../src/ui/Base";
import { useSession } from "../../../src/lib/session";
import { useDonnees } from "../../../src/lib/cache";
import {
  dateCourte, formationCorrespond, libelleType, lireParcours,
  type MaCertification, type MaFormation, type Parcours,
} from "../../../src/lib/os-formation";
import { C, E, R, TOUCHE } from "../../../src/theme/couleurs";
import { P, T } from "../../../src/theme/polices";

/** Les trois onglets. Mêmes libellés que l'OS. */
type Onglet = "mes-formations" | "catalogue" | "certifications";

export default function Formation() {
  const { moi } = useSession();
  const [onglet, setOnglet] = useState<Onglet>("mes-formations");
  const [requete, setRequete] = useState("");

  const { donnees, chargement, rafraichissement, erreur, relire } = useDonnees<Parcours>(
    moi ? `formation:${moi.id}` : null,
    () => lireParcours(moi!.id, moi!.role),
    [moi?.id, moi?.role],
  );

  return (
    <Ecran teinte="violet" enCours={rafraichissement} rafraichir={relire} retour="/profil">
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Centre de formation</Text>
        <Text style={s.sous}>Vos formations, le catalogue, vos certifications.</Text>
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
              libelle="Commencées"
              valeur={`${donnees.terminees}/${donnees.mesFormations.length}`}
            />
            {donnees.parcoursXp ? <Stat libelle="XP total" valeur={donnees.xp.toLocaleString("fr-FR")} /> : null}
            <Stat
              libelle="Certifications"
              valeur={String(donnees.certificationsActives)}
              teinte={donnees.certificationsActives > 0 ? C.violetTexte : undefined}
            />
          </View>

          {/* LES OBLIGATOIRES SE DISENT AVANT TOUT LE RESTE. Quatre formations du catalogue portent
              `obligatoire` en base. Les laisser au milieu du catalogue, c'est les laisser à faire
              un jour ; les nommer en haut, c'est dire ce qui bloque. */}
          {donnees.obligatoiresRestantes > 0 ? (
            <View style={s.rappel}>
              <Ionicons name="alert-circle" size={18} color={C.alerteTexte} />
              <Text style={s.rappelTexte}>
                {donnees.obligatoiresRestantes === 1
                  ? "Une formation obligatoire n'est pas terminée."
                  : `${donnees.obligatoiresRestantes} formations obligatoires ne sont pas terminées.`}
                {" "}Elles sont marquées « Obligatoire » dans le catalogue.
              </Text>
            </View>
          ) : null}

          {/* La rangée de puces est la brique `src/ui/Barre.tsx`, celle du cockpit des missions.
              Deux rangées d'onglets presque identiques dans la même application, c'est exactement
              le reproche numéro un de Fouka. Les compteurs disent ce qu'il y a derrière avant
              qu'on y aille. */}
          <Barre
            choix={[
              { cle: "mes-formations", libelle: "Mes formations", n: donnees.mesFormations.length },
              { cle: "catalogue", libelle: "Catalogue", n: donnees.catalogue.length },
              { cle: "certifications", libelle: "Certifications", n: donnees.certifications.length },
            ]}
            actif={onglet}
            surChoix={(c) => setOnglet(c as Onglet)}
          />

          {onglet === "mes-formations" ? (
            <MesFormations parcours={donnees} surCatalogue={() => setOnglet("catalogue")} />
          ) : null}
          {onglet === "catalogue" ? (
            <Catalogue parcours={donnees} requete={requete} surRequete={setRequete} />
          ) : null}
          {onglet === "certifications" ? <Certifications parcours={donnees} /> : null}
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

function MesFormations({ parcours, surCatalogue }: { parcours: Parcours; surCatalogue: () => void }) {
  const enCours = parcours.mesFormations.filter((f) => !f.terminee);
  const terminees = parcours.mesFormations.filter((f) => f.terminee);

  if (!parcours.mesFormations.length) {
    return (
      <Vide
        icone="school-outline"
        titre="Aucune formation commencée"
        texte={
          "Le catalogue est juste à côté : ouvrez une formation, appuyez sur « Commencer », et ses " +
          "leçons se suivent ici, une par une."
        }
        // Règle 5 : ce bouton bascule vraiment sur l'onglet « Catalogue », il ne décrit pas un
        // geste à faire soi-même. Un état vide qui nomme une sortie sans l'ouvrir fait téléphoner.
        action={{ libelle: "Ouvrir le catalogue", surPression: surCatalogue }}
      />
    );
  }

  return (
    <View style={{ gap: E.l }}>
      {enCours.length ? (
        <Section titre="En cours">
          {enCours.map((f) => <CarteEnCours key={f.id} f={f} />)}
        </Section>
      ) : null}

      {terminees.length ? (
        <Section titre="Terminées">
          {terminees.map((f) => <CarteTerminee key={f.id} f={f} />)}
        </Section>
      ) : null}
    </View>
  );
}

/** Ouvrir une formation. Toute carte de formation de cet écran passe par là : une seule façon d'entrer. */
function ouvrir(id: string) {
  router.push(`/formation/${encodeURIComponent(id)}` as never);
}

function CarteEnCours({ f }: { f: MaFormation }) {
  return (
    <Pressable
      onPress={() => ouvrir(f.id)}
      accessibilityRole="button"
      accessibilityLabel={`${f.titre}, ${f.avancement} pour cent. Ouvrir.`}
      style={({ pressed }) => [s.carte, pressed ? { opacity: 0.85 } : null]}
    >
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
        <Ionicons name="chevron-forward" size={18} color={C.texteFaible} />
      </View>
      <Jauge avancement={f.avancement} couleur={C.accentClair} />
      {/* Le nombre de leçons attendu vient du serveur ; quand il manque, l'avancement n'a pas de
          dénominateur et on le dit au lieu d'afficher un 0 % trompeur. */}
      {f.leconsTotal === null ? (
        <Text style={s.avertissement}>
          Le serveur ne connaît pas le nombre de leçons de cette formation : l'avancement ne peut
          pas être calculé.
        </Text>
      ) : null}
    </Pressable>
  );
}

function CarteTerminee({ f }: { f: MaFormation }) {
  const le = dateCourte(f.termineeLe);
  return (
    <Pressable
      onPress={() => ouvrir(f.id)}
      accessibilityRole="button"
      accessibilityLabel={`${f.titre}, terminée. Ouvrir.`}
      style={({ pressed }) => [s.carte, s.carteTerminee, pressed ? { opacity: 0.85 } : null]}
    >
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
    </Pressable>
  );
}

// ── Le catalogue ────────────────────────────────────────────────────────────────────────────────

/**
 * LE CATALOGUE EST RANGÉ PAR CATÉGORIE, DANS L'ORDRE DE LA BASE.
 *
 * Mesuré : 24 catégories pour 108 formations, et `formations.ordre` porte l'ordre du catalogue de
 * l'OS, qui n'est pas alphabétique et qui a un sens — les trois modules d'accueil obligatoires
 * d'abord. On regroupe donc en respectant cet ordre au lieu de trier les catégories par leur nom :
 * un opérateur qui vient de s'inscrire doit tomber sur « Culture SportVision », pas sur « Bloc A ».
 */
function Catalogue({
  parcours, requete, surRequete,
}: {
  parcours: Parcours;
  requete: string;
  surRequete: (v: string) => void;
}) {
  const q = requete.trim();
  const trouvees = useMemo(
    () => parcours.catalogue.filter((f) => formationCorrespond(f, q)),
    [parcours.catalogue, q],
  );

  const groupes = useMemo(() => {
    const ordre: string[] = [];
    const par = new Map<string, MaFormation[]>();
    for (const f of trouvees) {
      const cle = f.categorie ?? "Autres";
      if (!par.has(cle)) { par.set(cle, []); ordre.push(cle); }
      par.get(cle)!.push(f);
    }
    return ordre.map((cle) => ({ categorie: cle, formations: par.get(cle)! }));
  }, [trouvees]);

  return (
    <View style={{ gap: E.l }}>
      <Champ
        label="Rechercher une formation"
        placeholder="Un titre, une catégorie, un niveau…"
        value={requete}
        onChangeText={surRequete}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />

      {!parcours.catalogue.length ? (
        <Vide
          icone="library-outline"
          titre="Aucune formation ouverte à votre rôle"
          texte={
            "Le catalogue est réservé par métier : chaque formation désigne les rôles qui peuvent " +
            "la suivre. Si vous devriez en voir une, demandez-la à l'administration."
          }
        />
      ) : null}

      {parcours.catalogue.length && !trouvees.length ? (
        <Vide
          icone="search-outline"
          titre={`Rien pour « ${q} »`}
          texte={
            "Aucune formation ne porte ce mot dans son titre, sa catégorie, son niveau ou sa " +
            "description. Essayez un mot plus court, « photo », « montage » ou « quiz », ou effacez " +
            "la recherche."
          }
        />
      ) : null}

      {groupes.map((g) => (
        <Section
          key={g.categorie}
          titre={g.categorie}
          action={<Text style={s.compteur}>{g.formations.length}</Text>}
        >
          {g.formations.map((f) => <CarteCatalogue key={f.id} f={f} />)}
        </Section>
      ))}
    </View>
  );
}

/**
 * Une formation du catalogue.
 *
 * ELLE S'OUVRE MÊME VERROUILLÉE, ET CE N'EST PAS UNE ENTORSE À LA RÈGLE 5. L'écran de la formation
 * montre son programme et n'y propose PAS le bouton « Commencer » : on peut lire ce qui attend, on
 * ne peut pas s'y inscrire. C'est ce que fait l'OS, qui affiche la carte avec « 🔒 Débloqué à partir
 * de ⭐⭐ » plutôt que de la cacher. Cacher ce qui reste à débloquer, c'est cacher le parcours.
 */
function CarteCatalogue({ f }: { f: MaFormation }) {
  const etat = f.terminee ? "Terminée" : f.inscriptionId ? "En cours" : null;
  return (
    <Pressable
      onPress={() => ouvrir(f.id)}
      accessibilityRole="button"
      accessibilityLabel={`${f.titre}${f.verrou ? `, ${f.verrou}` : ""}. Ouvrir.`}
      style={({ pressed }) => [
        s.carte,
        f.verrou ? s.carteVerrouillee : null,
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <View style={s.ligneHaute}>
        <Text style={s.icone}>{f.icone ?? "🎓"}</Text>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.formTitre}>{f.titre}</Text>
          <Text style={s.formSous}>
            {[
              f.niveau,
              libelleType(f.type),
              f.duree,
              f.leconsTotal !== null ? `${f.leconsTotal} leçons` : null,
              f.xp !== null ? `${f.xp} XP` : null,
            ].filter(Boolean).join(" · ")}
          </Text>
          <View style={s.etiquettes}>
            {f.obligatoire ? <Pastille texte="Obligatoire" ton="alerte" /> : null}
            {f.certifiante ? <Pastille texte="Certifiante" ton="info" /> : null}
            {etat ? <Pastille texte={etat} ton={f.terminee ? "succes" : "neutre"} /> : null}
          </View>
        </View>
        <Ionicons name={f.verrou ? "lock-closed" : "chevron-forward"} size={18} color={C.texteFaible} />
      </View>
      {f.verrou ? <Text style={s.verrou}>{f.verrou}</Text> : null}
      {!f.verrou && f.inscriptionId && !f.terminee ? (
        <Jauge avancement={f.avancement} couleur={C.accentClair} />
      ) : null}
    </Pressable>
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

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: T.titreEcran, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.sousEcran, lineHeight: T.sousEcranHauteur },
  attente: { color: C.texteFaible, fontFamily: P.texte, fontSize: T.detail },
  compteur: { color: C.texteFaible, fontFamily: P.texteFort, fontSize: 13 },

  grade: {
    backgroundColor: C.surfaceHaute, borderRadius: R.xl, borderWidth: 1, borderColor: C.bordureForte,
    padding: E.l, gap: E.m,
  },
  gradeNom: { color: C.texte, fontFamily: P.titre, fontSize: 24, letterSpacing: -0.5 },
  gradeXp: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: T.detail },
  gradeSuite: { color: C.texteFaible, fontFamily: P.texte, fontSize: T.note },
  gradeMax: { color: C.alerteTexte, fontFamily: P.texteFort, fontSize: T.detail },
  gradeNote: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12, lineHeight: 17 },

  rappel: {
    flexDirection: "row", alignItems: "flex-start", gap: E.s,
    backgroundColor: "rgba(232,163,61,.07)", borderRadius: R.l, borderWidth: 1,
    borderColor: "rgba(232,163,61,.28)", padding: E.m,
  },
  rappelTexte: { flex: 1, color: C.texteDoux, fontFamily: P.texte, fontSize: 13, lineHeight: 19 },

  stats: { flexDirection: "row", gap: E.s },
  stat: {
    flex: 1, backgroundColor: C.surface, borderRadius: R.m, borderWidth: 1, borderColor: C.bordure,
    paddingVertical: E.s, paddingHorizontal: E.s, gap: 2,
  },
  statLibelle: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 11.5 },
  statValeur: { color: C.texte, fontFamily: P.titre, fontSize: 19, letterSpacing: -0.4 },

  carte: {
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure,
    padding: E.m, gap: E.s, minHeight: TOUCHE,
  },
  carteTerminee: { backgroundColor: "rgba(18,183,106,.06)", borderColor: "rgba(18,183,106,.24)" },
  carteCertif: { backgroundColor: "rgba(131,45,255,.08)", borderColor: "rgba(131,45,255,.28)" },
  carteBientot: { backgroundColor: "rgba(232,163,61,.07)", borderColor: "rgba(232,163,61,.28)" },
  carteExpiree: { backgroundColor: "rgba(240,68,94,.07)", borderColor: "rgba(240,68,94,.26)" },
  carteVerrouillee: { opacity: 0.72 },
  ligneHaute: { flexDirection: "row", alignItems: "flex-start", gap: E.s },
  icone: { fontSize: 24, lineHeight: 28 },
  etiquettes: { flexDirection: "row", flexWrap: "wrap", gap: E.xs },
  formTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: 15, lineHeight: 20 },
  formSous: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.note, lineHeight: T.noteHauteur },
  formSousOk: { color: C.succesTexte, fontFamily: P.texteMoyen, fontSize: T.note, lineHeight: T.noteHauteur },
  pourcent: { color: C.accentClair, fontFamily: P.titre, fontSize: 18 },
  verrou: { color: C.alerteTexte, fontFamily: P.texteMoyen, fontSize: T.note, lineHeight: T.noteHauteur },
  badge: { fontSize: 30, lineHeight: 34 },
  certifNom: { color: C.texte, fontFamily: P.titreFort, fontSize: 15, lineHeight: 20 },
  numero: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 11.5, letterSpacing: 0.4 },
  avertissement: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12, lineHeight: 17 },
});
