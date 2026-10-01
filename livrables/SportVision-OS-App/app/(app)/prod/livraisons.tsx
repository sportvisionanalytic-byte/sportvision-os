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
// LE VERDICT EST ICI DEPUIS LE 01/10, ET CET EN-TETE DISAIT LE CONTRAIRE. Il affirmait « aucun
// verdict depuis cet ecran, et c'est un choix » : c'etait vrai le 30/09, ca ne l'est plus depuis que
// `os-pilotage.ts` existe. Un commentaire qui decrit l'ecran d'hier est pire qu'un commentaire
// absent : on le croit.
//
// CE QUE CET ECRAN SAIT FAIRE, AU 01/10 : valider un lien, demander une correction avec son motif,
// AVANCER une mission d'une marche et la CLORE. Les deux derniers manquaient, et c'est ce qui
// laissait quatre missions passees ouvertes — dont SV-2026-3121, bloquee en `arrivee_sur_place`
// depuis le 19 septembre alors que ses huit liens etaient deposes depuis le 23.
//
// « A CLOTURER » NE MONTRAIT PAS LA SEULE MISSION CLOTURABLE. Le filtre etait
// `clotureManquant.length` : une mission dont la base ne reproche RIEN — SV-2026-0274, au statut
// `livree` depuis le 25 septembre, tableau vide — n'apparaissait nulle part. L'ecran ne listait que
// les blocages, jamais les missions pretes. On liste donc toutes les missions PASSEES non closes, et
// chacune porte soit ce qui la bloque, soit le bouton qui la fait avancer.
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Probleme, Vide } from "../../../src/ui/Ecran";
import { Bouton, Champ, Erreur, Pastille } from "../../../src/ui/Base";
import {
  avancerMission, cloturerMission, demanderCorrection, validerLien,
} from "../../../src/lib/os-pilotage";
import { Barre } from "../../../src/ui/Barre";
import { EcranProd } from "./_layout";
import { useDonnees } from "../../../src/lib/cache";
import { libelleCouverture } from "../../../src/lib/os-missions";
import { LIBELLE_CATEGORIE } from "../../../src/lib/os-livrables";
import { dateDuJourParis, quand } from "../../../src/lib/dates";
import {
  lireLiensATraiter, lireMissions, lireTransitions, suiteDe,
  type Lien, type MissionProd, type Transition,
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
  /** L'enchainement legal des statuts, lu en base (v412). Jamais ecrit ici. */
  transitions: Transition[];
}

export default function EcranLivraisons() {
  const [liste, setListe] = useState("a_verifier");

  const { donnees, chargement, rafraichissement, erreur, relire } = useDonnees<Donnees>(
    "prod:livraisons",
    async () => {
      const [missions, liens, transitions] = await Promise.all([
        lireMissions(), lireLiensATraiter(), lireTransitions(),
      ]);
      return { missions, liens, transitions };
    },
  );

  const missions = donnees?.missions ?? [];
  const liens = donnees?.liens ?? [];
  const transitions = donnees?.transitions ?? [];

  const aVerifier = useMemo(() => liens.filter((l) => l.statut === "a_verifier"), [liens]);
  const corrections = useMemo(() => liens.filter((l) => l.statut === "correction_demandee"), [liens]);
  const enRetard = useMemo(() => missions.filter((m) => m.enRetard), [missions]);
  // TOUTES LES MISSIONS PASSEES NON CLOSES, et pas seulement celles qui ont un blocage. Une
  // mission a qui la base ne reproche rien est justement celle qu'il faut clore : elle n'apparaissait
  // nulle part. On ecarte les missions a venir, qui n'ont pas a etre closes, et les groupes
  // `terminees` / `annulees`, qui le sont deja.
  const aClore = useMemo(() => {
    const aujourdhui = dateDuJourParis();
    return missions.filter(
      (m) => m.groupe !== "terminees" && m.groupe !== "annulees" && (!m.date || m.date < aujourdhui),
    );
  }, [missions]);
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
          surChangement={relire}
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
          surChangement={relire}
        />
      ) : liste === "a_clore" ? (
        aClore.length ? (
          <View style={{ gap: E.s }}>
            {aClore.map((m) => (
              <CarteCloture key={m.id} m={m} transitions={transitions} surChangement={relire} />
            ))}
          </View>
        ) : (
          <Vide
            titre="Aucune mission passée n'est restée ouverte"
            texte={
              "Toute mission dont la date est passée est soit clôturée, soit annulée. Dès qu'une " +
              "reste en route, elle s'affiche ici avec ce qui la bloque ou l'étape qui lui manque."
            }
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
  liens, missions, videTitre, videTexte, surChangement,
}: {
  liens: Lien[]; missions: MissionProd[]; videTitre: string; videTexte: string;
  /** Relit la liste apres un verdict : la ligne doit quitter « A verifier » sous les yeux. */
  surChangement: () => void;
}) {
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
              {sesLiens.map((l) => <LigneLien key={l.id} l={l} surChangement={surChangement} />)}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * UNE MISSION PASSEE QUI N'EST PAS CLOSE, ET LE GESTE QUI LA FAIT AVANCER (01/10/2026).
 *
 * DEUX REGLES DISTINCTES, ET IL FAUT SE GARDER DE LES CONFONDRE — la premiere version de cette
 * carte les avait melangees, et SV-2026-3121 se retrouvait sans aucun bouton alors que c'est
 * precisement la mission a debloquer.
 *
 *   · `mission_cloture_manquant` interdit LA CLOTURE, et elle seule. Ses phrases disent ce qui
 *     empechera la derniere marche ; elles n'empechent pas les marches d'avant. Mesure, jeton de
 *     Mikael, transaction annulee : `arrivee_sur_place -> production_demarree` PASSE sur
 *     SV-2026-3121, dont le tableau de blocage contient pourtant deux phrases.
 *   · `prestation_transitions` dit quelle marche est ouverte apres le statut courant. C'est la
 *     table que le trigger consulte depuis la v412 : un bouton ne peut plus proposer ce que la base
 *     refusera.
 *
 * D'OU : on propose TOUJOURS l'etape suivante quand elle existe, et on reserve le refus a la seule
 * cloture. Les phrases de blocage restent affichees — elles disent ce qu'il faudra avoir leve en
 * arrivant au bout — mais en information, pas en interdiction.
 *
 * ON N'ENCHAINE PAS LES ETAPES TOUT SEUL. SV-2026-3121 est a sept marches de la cloture : les
 * franchir d'un appui serait ecrire sept lignes d'historique en une seconde, au nom de quelqu'un qui
 * n'a vu passer qu'un ecran. Chaque marche est un appui, et l'ecran dit combien il en reste.
 */
function CarteCloture({
  m, transitions, surChangement,
}: { m: MissionProd; transitions: Transition[]; surChangement: () => void }) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<string | null>(null);

  const bloque = m.clotureManquant.length > 0;
  const suite = suiteDe(m.statut, transitions);
  // La derniere marche est `livrée → clôturée` : c'est la SEULE que les phrases de blocage
  // interdisent. Partout ailleurs, elles informent.
  const derniereMarche = suite?.vers === "clôturée";
  const prete = derniereMarche && !bloque;

  // Combien de marches avant `clôturée`, en suivant la suite normale. Le chiffre qui dit si on est
  // a un appui ou a sept de la fin.
  const restantes = useMemo(() => {
    let courant = m.statut;
    let n = 0;
    // 40 : la chaine en compte 27, la borne est la pour qu'un cycle ne boucle jamais ici.
    while (courant !== "clôturée" && n < 40) {
      const t = transitions.find((x) => x.depuis === courant && x.estLaSuite);
      if (!t) return null;
      courant = t.vers;
      n += 1;
    }
    return courant === "clôturée" ? n : null;
  }, [m.statut, transitions]);

  const agir = async () => {
    setErreur(null);
    setResultat(null);
    setEnCours(true);
    try {
      if (prete) {
        const r = await cloturerMission(m.id);
        setResultat(
          r.dejaClose
            ? "Cette mission était déjà clôturée. Rien de nouveau n'a été enregistré."
            : `Mission clôturée. ${r.payablesValides} rémunération${r.payablesValides > 1 ? "s" : ""} ` +
              `passée${r.payablesValides > 1 ? "s" : ""} à « validé ».`,
        );
      } else if (suite) {
        await avancerMission(m.id, suite.vers);
      }
      surChangement();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <View style={s.carte}>
      <EnteteMission m={m} />

      {bloque ? (
        <View style={{ gap: E.xs }}>
          {/* Les phrases sont celles de `mission_cloture_manquant`, mot pour mot. */}
          {m.clotureManquant.map((p, i) => (
            <View key={`${m.id}-${i}`} style={s.puceManque}>
              <Text style={s.point}>•</Text>
              <Text style={s.manqueTexte}>{p}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={s.compteurs}>
        {`${m.nbPhotos} photo${m.nbPhotos > 1 ? "s" : ""} · ${m.nbMontages} montage${m.nbMontages > 1 ? "s" : ""} · ${m.nbRushs} rush${m.nbRushs > 1 ? "s" : ""}`}
        {m.transfertConfirme ? " · sauvegarde confirmée" : ""}
      </Text>

      <Erreur message={erreur} />
      {resultat ? <Text style={s.resultat}>{resultat}</Text> : null}

      {prete ? (
        <>
          <Bouton titre="Clôturer la mission" onPress={agir} enCours={enCours} />
          <Text style={s.note}>
            {"La clôture marque les livrables « livré », pose la rétention à 90 jours pour un " +
              "particulier, et fait passer la rémunération des opérateurs à « validé »."}
          </Text>
        </>
      ) : derniereMarche ? (
        <Text style={s.note}>
          {"Il ne manque plus que la clôture, et la base la refuse tant qu'une des phrases " +
            "ci-dessus reste. Elle ne se force pas depuis un écran : c'est l'opérateur, ou la " +
            "vérification des liens, qui la lève."}
        </Text>
      ) : suite ? (
        <>
          <Bouton titre={`Étape suivante : ${suite.libelle}`} onPress={agir} enCours={enCours} />
          <Text style={s.note}>
            {(restantes === null
              ? "Après cette étape, la suite se décide au cas par cas."
              : restantes > 1
                ? `${restantes} étapes avant la clôture, une par appui.`
                : "Dernière étape avant la clôture.") +
              (bloque
                ? " Les phrases ci-dessus n'empêchent pas cette étape : elles empêcheront la clôture."
                : "")}
          </Text>
        </>
      ) : (
        <Text style={s.note}>
          {`Aucune étape n'est ouverte après « ${m.statut} ». Cette mission se reprend dans l'OS.`}
        </Text>
      )}
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

/**
 * UNE LIVRAISON, ET LE VERDICT QUI VA AVEC (01/10/2026).
 *
 * Cet ecran n'avait AUCUN element appuyable — mesure a l'audit : zero. Il annoncait « 8 liens a
 * verifier » et la Production ne pouvait rien en faire depuis son telephone, pendant que l'ecran
 * de l'operateur lui disait que sa mission restait bloquee tant qu'elle n'avait pas valide. On
 * demandait a quelqu'un d'attendre un geste qu'on avait rendu impossible.
 *
 * LE MOTIF EST OBLIGATOIRE POUR UNE CORRECTION, et le formulaire ne s'ouvre que si on la demande :
 * un champ de texte affiche en permanence sous chaque lien pousserait a ecrire avant d'avoir
 * decide. Depuis la v375, l'operateur ne peut plus effacer ce motif ; c'est la seule phrase qu'il
 * lira.
 */
function LigneLien({ l, surChangement }: { l: Lien; surChangement: () => void }) {
  const [enCours, setEnCours] = useState<"valider" | "corriger" | null>(null);
  const [formulaire, setFormulaire] = useState(false);
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  const agir = async (quoi: "valider" | "corriger") => {
    setErreur(null);
    setEnCours(quoi);
    try {
      if (quoi === "valider") await validerLien(l.id);
      else await demanderCorrection(l.id, motif);
      setFormulaire(false);
      setMotif("");
      surChangement();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(null);
    }
  };

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

      {/* On ne propose pas de valider ce qui l'est deja. Un bouton « Valider » sur une livraison
          validee ne fait rien de visible : c'est exactement ce qui fait croire a une application
          figee. */}
      {l.statut === "valide" ? null : (
        <View style={{ gap: E.s }}>
          <Erreur message={erreur} />
          {formulaire ? (
            <View style={{ gap: E.s }}>
              <Champ
                label="Qu'est-ce qu'il faut corriger ?"
                value={motif}
                onChangeText={setMotif}
                placeholder="Ce que l'opérateur lira, et la seule chose qu'il lira."
                multiline
                hauteur={92}
              />
              <View style={s.gestes}>
                <Pressable
                  onPress={() => { setFormulaire(false); setMotif(""); setErreur(null); }}
                  accessibilityRole="button"
                  accessibilityLabel="Annuler la demande de correction"
                  style={({ pressed }) => [s.secondaire, pressed ? { opacity: 0.8 } : null]}
                >
                  <Text style={s.secondaireTexte}>Annuler</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Bouton
                    titre="Demander la correction"
                    onPress={() => agir("corriger")}
                    enCours={enCours === "corriger"}
                  />
                </View>
              </View>
            </View>
          ) : (
            <View style={s.gestes}>
              <Pressable
                onPress={() => { setFormulaire(true); setErreur(null); }}
                accessibilityRole="button"
                accessibilityLabel={`Demander une correction sur ${l.nom}`}
                style={({ pressed }) => [s.secondaire, pressed ? { opacity: 0.8 } : null]}
              >
                <Text style={s.secondaireTexte}>Demander une correction</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Bouton
                  titre="Valider"
                  onPress={() => agir("valider")}
                  enCours={enCours === "valider"}
                />
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  gestes: { flexDirection: "row", alignItems: "center", gap: E.s },
  secondaire: {
    minHeight: 44, justifyContent: "center", paddingHorizontal: E.m, borderRadius: R.pill,
    backgroundColor: "rgba(255,255,255,.06)", borderWidth: 1, borderColor: C.bordureForte,
  },
  secondaireTexte: { color: C.texte, fontFamily: P.texteFort, fontSize: 13 },
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
  resultat: { color: C.succesTexte, fontFamily: P.texte, fontSize: 13, lineHeight: 18 },
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
