// UNE FORMATION, OUVERTE (01/10/2026).
//
// C'EST L'ÉCRAN QUE FOUKA DEMANDAIT CE MATIN : « je ne peux pas cliquer sur les trucs ». Il n'existe
// que depuis que la base porte le catalogue (v379, v380) et les questions de quiz (v382). Quatre
// gestes y sont possibles, et les quatre écrivent vraiment :
//
//   1. COMMENCER — un `insert` dans `formation_inscriptions`.
//   2. COCHER UNE LEÇON — un `insert` ou un `delete` dans `formation_progression`, sur la
//      `lecon_key` de la base. La même clé que l'OS écrit, donc une leçon cochée sur le téléphone
//      est cochée sur l'ordinateur.
//   3. PASSER LE QUIZ — `rpc_lire_quiz` pose les questions, `rpc_submit_quiz` corrige.
//   4. TERMINER — `rpc_complete_formation` crédite l'XP et crée la certification.
//
// AUCUN DE CES QUATRE N'EST CALCULÉ ICI. Le score, le seuil de 70 %, le bonus, le nombre de leçons
// exigé, la certification : tout est décidé par le serveur, et l'écran affiche sa réponse. C'est ce
// qui permet de poser les questions sans jamais détenir les bonnes réponses.
//
// AUCUN BOUTON QUI MÈNE À UN REFUS (règle 5). Mesuré par le chemin réel avant d'écrire une ligne :
//   · `rpc_lire_quiz` lève « Non autorisé : inscription requise » sans inscription → le bouton
//     « Passer le quiz » n'apparaît qu'inscrit.
//   · `rpc_complete_formation` lève « Toutes les leçons ne sont pas encore terminées (94 / 96) »
//     → le bouton « Terminer » n'apparaît que quand le compte du serveur est atteint.
//   · une formation verrouillée par le grade n'a PAS de bouton « Commencer » : on lit son
//     programme, on dit à partir de quel grade elle s'ouvre, et on nomme qui décide du grade.
//
// L'ÉTAT NE SE DEVINE PAS APRÈS UNE ÉCRITURE, ON RELIT. Chaque geste réussi appelle `relire()` :
// c'est la base qui dit où on en est, pas un compteur tenu à l'écran. Un compteur local finit par
// afficher 96 sur 96 là où la base en compte 95, et le bouton « Terminer » échoue sans qu'on
// comprenne.
import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { Ecran, Probleme, Section, Vide } from "../../../src/ui/Ecran";
import { Bouton, Erreur, Pastille } from "../../../src/ui/Base";
import { useSession } from "../../../src/lib/session";
import { oublier, useDonnees } from "../../../src/lib/cache";
import {
  basculerLecon, envoyerQuiz, libelleType, lireFormation, lireQuiz, sInscrire, terminerFormation,
  type FormationOuverte, type Module, type Question, type ResultatQuiz,
} from "../../../src/lib/os-formation";
import { C, E, R, TOUCHE } from "../../../src/theme/couleurs";
import { P, T } from "../../../src/theme/polices";
import { Jauge } from "../../../src/ui/Jauge";

export default function UneFormation() {
  const { moi } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const formationId = typeof id === "string" ? id : "";

  const [ouvert, setOuvert] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<Question[] | null>(null);
  const [resultat, setResultat] = useState<ResultatQuiz | null>(null);

  const cle = moi && formationId ? `formation:${moi.id}:${formationId}` : null;
  const { donnees, chargement, rafraichissement, erreur, relire } = useDonnees<FormationOuverte>(
    cle,
    () => lireFormation(formationId, moi!.id, moi!.role),
    [moi?.id, moi?.role, formationId],
  );

  /**
   * Recharger APRÈS une écriture, et vider aussi le cache de l'écran d'accueil.
   *
   * `useDonnees` garde sa réponse par clé. Terminer une formation change l'XP, le nombre de
   * certifications et le compteur de « Mes formations » : sans cet oubli, on revient en arrière et
   * la liste affiche encore l'état d'avant. Vu à l'écran le 01/10 sur le bandeau de parcours de
   * l'accueil, qui restait à « 0 XP » après une formation terminée.
   */
  const relireTout = useCallback(() => {
    oublier("formation:");
    oublier("accueil:");
    relire();
  }, [relire]);

  /** Un geste, une fois, avec son message d'erreur. Le verrou empêche le double appui. */
  const faire = useCallback(async (nom: string, action: () => Promise<void>) => {
    if (enCours) return;
    setEnCours(nom);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      // ON RELAIE LE MESSAGE DU SERVEUR, ON NE LE RÉÉCRIT PAS. « Toutes les leçons ne sont pas
      // encore terminées (94 / 96) » dit exactement ce qu'il faut faire ; une phrase à nous dirait
      // moins, et deux versions d'un même refus finiraient par se contredire.
      setMessage(e instanceof Error ? e.message : "Le geste n'a pas abouti.");
    } finally {
      setEnCours(null);
    }
  }, [enCours]);

  const f = donnees?.formation ?? null;

  return (
    <Ecran teinte="violet" enCours={rafraichissement} rafraichir={relire} retour="/formation" retourLibelle="Formations">
      {erreur && !donnees ? (
        // Une formation qui n'est pas ouverte à mon rôle ne se distingue pas d'une panne réseau par
        // le seul fait que la lecture a échoué : `lireFormation` lève un message explicite dans le
        // premier cas, et on le montre plutôt que « Chargement impossible ».
        erreur instanceof Error && erreur.message.includes("ouverte")
          ? (
            <Vide
              icone="lock-closed-outline"
              titre="Formation non ouverte à votre rôle"
              texte={erreur instanceof Error ? erreur.message : ""}
            />
          )
          : <Probleme surReessayer={relire} />
      ) : null}
      {chargement && !donnees ? <Text style={s.attente}>Chargement…</Text> : null}

      {donnees && f ? (
        <>
          <View style={{ gap: E.s }}>
            <View style={s.entete}>
              <Text style={s.icone}>{f.icone ?? "🎓"}</Text>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.titre}>{f.titre}</Text>
                <Text style={s.sous}>
                  {[
                    f.categorie, f.niveau, libelleType(f.type), f.duree,
                    f.formateur ? `avec ${f.formateur}` : null,
                  ].filter(Boolean).join(" · ")}
                </Text>
              </View>
            </View>

            <View style={s.etiquettes}>
              {f.obligatoire ? <Pastille texte="Obligatoire" ton="alerte" /> : null}
              {f.certifiante ? <Pastille texte="Certifiante" ton="info" /> : null}
              {f.xp !== null ? <Pastille texte={`${f.xp} XP`} ton="neutre" /> : null}
              {f.terminee ? <Pastille texte="Terminée" ton="succes" /> : null}
            </View>

            {f.description ? <Text style={s.description}>{f.description}</Text> : null}
          </View>

          {/* L'AVANCEMENT, AVEC LE DÉNOMINATEUR DU SERVEUR. C'est `formation_rewards.total_lecons`
              que `rpc_complete_formation` exige, pas le nombre de lignes affichées. */}
          {f.inscriptionId ? (
            <View style={s.bloc}>
              <View style={s.ligneBloc}>
                <Text style={s.blocTitre}>
                  {f.leconsTotal !== null ? `${f.leconsFaites} / ${f.leconsTotal} leçons` : `${f.leconsFaites} leçons`}
                </Text>
                <Text style={s.pourcent}>{f.avancement}%</Text>
              </View>
              <Jauge avancement={f.avancement} couleur={f.terminee ? C.succes : C.accentClair} />
              {f.scoreQuiz !== null ? (
                <Text style={f.quizReussi ? s.noteOk : s.noteAlerte}>
                  Quiz : {f.scoreQuiz}% {f.quizReussi ? "(réussi)" : "(non validé, le seuil est à 70%)"}
                </Text>
              ) : null}
              {f.terminee && f.xpCredite > 0 ? (
                <Text style={s.noteOk}>+{f.xpCredite.toLocaleString("fr-FR")} XP crédités</Text>
              ) : null}
            </View>
          ) : null}

          {/* LE NOMBRE DE LEÇONS EN BASE ET CELUI DU SERVEUR DOIVENT COÏNCIDER. La migration v380
              refuse de s'appliquer s'ils diffèrent, mais l'écran ne parie pas dessus : si l'écart
              existait, cocher tout ce qui est affiché ne terminerait pas la formation, et il faut le
              dire plutôt que de laisser chercher une leçon qui n'est pas là. */}
          {f.leconsTotal !== null && donnees.leconsEnBase !== f.leconsTotal ? (
            <Text style={s.avertissement}>
              Le programme affiche {donnees.leconsEnBase} leçons alors que le serveur en attend{" "}
              {f.leconsTotal} pour délivrer la certification. Signalez-le à l'administration : la
              formation ne pourra pas être terminée en l'état.
            </Text>
          ) : null}

          <Erreur message={message} />

          <Gestes
            ouverte={donnees}
            enCours={enCours}
            quizOuvert={quiz !== null}
            surCommencer={() => faire("inscrire", async () => {
              await sInscrire(f.id, moi!.id);
              relireTout();
            })}
            surQuiz={() => faire("quiz", async () => {
              const questions = await lireQuiz(f.id);
              if (!questions.length) {
                throw new Error("Cette formation n'a pas de quiz en base : il n'y a rien à passer.");
              }
              setResultat(null);
              setQuiz(questions);
            })}
            surTerminer={() => faire("terminer", async () => {
              const r = await terminerFormation(f.inscriptionId!);
              relireTout();
              setMessage(
                r.dejaFait
                  ? "Cette formation était déjà terminée."
                  : `Formation terminée. ${r.xpGagnes > 0 ? `+${r.xpGagnes} XP. ` : ""}${r.certifiee ? "Votre certification a été créée." : ""}`.trim(),
              );
            })}
          />

          {quiz ? (
            <Quiz
              questions={quiz}
              resultat={resultat}
              enCours={enCours === "envoyer"}
              surEnvoyer={(reponses) => faire("envoyer", async () => {
                const r = await envoyerQuiz(f.inscriptionId!, reponses);
                setResultat(r);
                relireTout();
              })}
              surFermer={() => { setQuiz(null); setResultat(null); }}
            />
          ) : (
            <Programme
              modules={donnees.modules}
              inscrit={!!f.inscriptionId}
              verrouille={!!f.verrou}
              ouvert={ouvert}
              surOuvrir={(idModule) => setOuvert(ouvert === idModule ? null : idModule)}
              enCours={enCours}
              surLecon={(leconKey, cocher) => faire(`lecon:${leconKey}`, async () => {
                await basculerLecon(f.inscriptionId!, leconKey, cocher);
                relireTout();
              })}
            />
          )}
        </>
      ) : null}
    </Ecran>
  );
}

// ── Les gestes ──────────────────────────────────────────────────────────────────────────────────

/**
 * Les boutons, et seulement ceux qui aboutissent.
 *
 * L'ORDRE N'EST PAS ARBITRAIRE : « Terminer » passe devant « Passer le quiz » quand tout est fait,
 * parce que c'est lui qui crédite l'XP et crée la certification. Le quiz, lui, ne verse qu'un bonus
 * de 30 % et peut se repasser : `rpc_submit_quiz` ne verse ce bonus qu'une fois
 * (`not v_already_passed`), mais elle accepte de recorriger autant de fois qu'on veut.
 */
function Gestes({
  ouverte, enCours, quizOuvert, surCommencer, surQuiz, surTerminer,
}: {
  ouverte: FormationOuverte;
  enCours: string | null;
  quizOuvert: boolean;
  surCommencer: () => void;
  surQuiz: () => void;
  surTerminer: () => void;
}) {
  const f = ouverte.formation;

  // VERROUILLÉE : aucun bouton, et on dit qui décide. Le grade est posé par l'administration
  // (`grade_valide_par`), il ne se déclenche pas au franchissement d'un seuil d'XP : dire « gagnez
  // de l'XP » serait faux.
  if (f.verrou && !f.inscriptionId) {
    return (
      <View style={s.blocVerrou}>
        <View style={s.ligneVerrou}>
          <Ionicons name="lock-closed" size={18} color={C.alerteTexte} />
          <Text style={s.verrouTitre}>{f.verrou}</Text>
        </View>
        <Text style={s.verrouTexte}>
          Vous pouvez lire son programme dès maintenant. L'inscription s'ouvrira quand
          l'administration vous aura accordé ce grade : c'est elle qui le valide, un seuil d'XP ne le
          change pas tout seul.
        </Text>
      </View>
    );
  }

  if (!f.inscriptionId) {
    return (
      <View style={{ gap: E.s }}>
        <Bouton
          titre="Commencer la formation"
          onPress={surCommencer}
          enCours={enCours === "inscrire"}
          icone={<Ionicons name="play" size={16} color="#fff" />}
        />
        <Text style={s.aide}>
          {f.leconsTotal !== null
            ? `${f.leconsTotal} leçons, ${ouverte.modules.length} modules. Vous pouvez les suivre dans l'ordre que vous voulez et revenir quand vous voulez.`
            : "Vous pourrez suivre ses leçons une par une et revenir quand vous voulez."}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: E.s }}>
      {/* Le bouton n'apparaît que quand le compte du SERVEUR est atteint : c'est lui qui refuse, et
          un bouton qui échoue sur « 94 / 96 » est une promesse cassée. */}
      {ouverte.toutesFaites && !f.terminee ? (
        <Bouton
          titre="Terminer la formation"
          onPress={surTerminer}
          enCours={enCours === "terminer"}
          icone={<Ionicons name="checkmark-done" size={16} color="#fff" />}
        />
      ) : null}

      {!quizOuvert ? (
        <Bouton
          titre={f.scoreQuiz !== null ? "Repasser le quiz" : "Passer le quiz"}
          onPress={surQuiz}
          enCours={enCours === "quiz"}
          secondaire
          icone={<Ionicons name="help-circle-outline" size={16} color={C.texte} />}
        />
      ) : null}

      {!ouverte.toutesFaites && !f.terminee && f.leconsTotal !== null ? (
        <Text style={s.aide}>
          Il reste {f.leconsTotal - f.leconsFaites} leçon
          {f.leconsTotal - f.leconsFaites > 1 ? "s" : ""} à valider avant de pouvoir terminer la
          formation.
        </Text>
      ) : null}
    </View>
  );
}

// ── Le programme ────────────────────────────────────────────────────────────────────────────────

/**
 * Les modules et leurs leçons.
 *
 * UN SEUL MODULE OUVERT À LA FOIS, ET C'EST UNE NÉCESSITÉ, PAS UN GOÛT. La plus grosse formation en
 * base porte 16 modules et 96 leçons : tout déplier donne 112 lignes à faire défiler d'un pouce.
 * Fermé, un module tient sur une ligne avec son compte ; ouvert, il montre ses six leçons.
 *
 * LA LIGNE ENTIÈRE EST LA CIBLE, texte compris, pour tenir les 44 points du contrat. Une case de
 * 20 points, sous la pluie, avec des gants, ne se touche pas.
 */
function Programme({
  modules, inscrit, verrouille, ouvert, surOuvrir, enCours, surLecon,
}: {
  modules: Module[];
  inscrit: boolean;
  verrouille: boolean;
  ouvert: string | null;
  surOuvrir: (id: string) => void;
  enCours: string | null;
  surLecon: (leconKey: string, cocher: boolean) => void;
}) {
  if (!modules.length) {
    return (
      <Vide
        icone="document-text-outline"
        titre="Programme non publié"
        texte={
          "Cette formation existe au catalogue mais ses modules ne sont pas encore en base. " +
          "Signalez-le à l'administration : il n'y a rien à suivre en l'état."
        }
      />
    );
  }

  return (
    <Section
      titre="Programme"
      action={<Text style={s.compteur}>{modules.length} modules</Text>}
    >
      {modules.map((m, i) => {
        const deplie = ouvert === m.id;
        const complet = m.lecons.length > 0 && m.faites === m.lecons.length;
        return (
          <View key={m.id} style={s.module}>
            <Pressable
              onPress={() => surOuvrir(m.id)}
              accessibilityRole="button"
              accessibilityLabel={`Module ${i + 1}, ${m.titre}, ${m.faites} sur ${m.lecons.length}. ${deplie ? "Replier" : "Déplier"}.`}
              accessibilityState={{ expanded: deplie }}
              style={({ pressed }) => [s.enteteModule, pressed ? { opacity: 0.75 } : null]}
            >
              <View style={[s.numero, complet && s.numeroComplet]}>
                {complet
                  ? <Ionicons name="checkmark" size={14} color={C.succesTexte} />
                  : <Text style={s.numeroTexte}>{i + 1}</Text>}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.moduleTitre}>{m.titre}</Text>
                <Text style={s.moduleSous}>
                  {inscrit ? `${m.faites} / ${m.lecons.length} leçons` : `${m.lecons.length} leçons`}
                </Text>
              </View>
              <Ionicons name={deplie ? "chevron-up" : "chevron-down"} size={18} color={C.texteFaible} />
            </Pressable>

            {deplie ? (
              <View style={s.lecons}>
                {m.lecons.map((l) => {
                  const occupe = enCours === `lecon:${l.leconKey}`;
                  // PAS DE CASE À COCHER QUAND ON N'EST PAS INSCRIT. Il n'y a aucune inscription à
                  // laquelle rattacher la progression : le geste échouerait. On montre le titre, et
                  // le bouton « Commencer » est plus haut.
                  if (!inscrit) {
                    return (
                      <View key={l.id} style={s.lecon}>
                        <View style={s.puce} />
                        <Text style={[s.leconTitre, verrouille && { color: C.texteFaible }]}>{l.titre}</Text>
                      </View>
                    );
                  }
                  return (
                    <Pressable
                      key={l.id}
                      onPress={() => surLecon(l.leconKey, !l.faite)}
                      disabled={!!enCours}
                      accessibilityRole="checkbox"
                      accessibilityLabel={l.titre}
                      accessibilityState={{ checked: l.faite, disabled: !!enCours }}
                      style={({ pressed }) => [
                        s.lecon,
                        pressed && !enCours ? { opacity: 0.7 } : null,
                        occupe ? { opacity: 0.45 } : null,
                      ]}
                    >
                      <View style={[s.coche, l.faite && s.cocheFaite]}>
                        {l.faite ? <Ionicons name="checkmark" size={15} color="#fff" /> : null}
                      </View>
                      <Text style={[s.leconTitre, l.faite && s.leconFaite]}>{l.titre}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}

      {inscrit ? (
        <Text style={s.aide}>
          Une leçon cochée ici est cochée dans l'OS, et l'inverse : c'est la même ligne en base.
        </Text>
      ) : null}
    </Section>
  );
}

// ── Le quiz ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Le quiz, posé et corrigé par le serveur.
 *
 * L'INDICE COMPTE, ET C'EST TOUT CE QUI COMPTE. `rpc_submit_quiz` lit la réponse de la question n°
 * i avec `p_answers ->> i`. Une question laissée sans réponse porte donc `null` à sa place : sauter
 * la case décalerait toutes les suivantes, et chaque réponse serait notée sur la question d'après,
 * sans aucune erreur visible. `rpc_lire_quiz` (v382) et `rpc_submit_quiz` partagent la même source
 * d'ordre en base, et la migration refuse de s'appliquer si les deux ne comptent pas pareil.
 *
 * ON N'AFFICHE JAMAIS LA BONNE RÉPONSE AVANT D'AVOIR ENVOYÉ. Elle n'est pas dans l'application : la
 * fonction qui pose les questions ne rend pas `correct_index`. Elle arrive avec la correction, dans
 * la réponse de `rpc_submit_quiz`.
 */
function Quiz({
  questions, resultat, enCours, surEnvoyer, surFermer,
}: {
  questions: Question[];
  resultat: ResultatQuiz | null;
  enCours: boolean;
  surEnvoyer: (reponses: (number | null)[]) => void;
  surFermer: () => void;
}) {
  const [reponses, setReponses] = useState<(number | null)[]>(() => questions.map(() => null));
  const repondues = reponses.filter((r) => r !== null).length;
  const corrige = resultat !== null;

  return (
    <Section
      titre={corrige ? "Correction" : "Quiz"}
      action={
        <Pressable
          onPress={surFermer}
          accessibilityRole="button"
          accessibilityLabel="Fermer le quiz et revenir au programme"
          hitSlop={8}
        >
          <Text style={s.fermer}>Fermer</Text>
        </Pressable>
      }
    >
      {corrige && resultat ? (
        <View style={[s.bloc, resultat.reussi ? s.blocOk : s.blocAlerte]}>
          <Text style={s.scoreGros}>{resultat.score}%</Text>
          <Text style={resultat.reussi ? s.noteOk : s.noteAlerte}>
            {resultat.justes} bonne{resultat.justes > 1 ? "s" : ""} réponse
            {resultat.justes > 1 ? "s" : ""} sur {resultat.total}
            {resultat.reussi ? " · quiz réussi" : " · le seuil est à 70%"}
          </Text>
          {resultat.bonusXp > 0 ? (
            <Text style={s.noteOk}>+{resultat.bonusXp} XP de bonus crédités</Text>
          ) : null}
          {!resultat.reussi ? (
            <Text style={s.aide}>
              Le quiz peut être repassé. Fermez la correction, relisez les leçons concernées, et
              recommencez.
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={s.bloc}>
          <View style={s.ligneBloc}>
            <Text style={s.blocTitre}>{repondues} / {questions.length} répondues</Text>
            <Text style={s.pourcent}>{Math.round((repondues / Math.max(1, questions.length)) * 100)}%</Text>
          </View>
          <Jauge avancement={Math.round((repondues / Math.max(1, questions.length)) * 100)} couleur={C.cyan} />
          <Text style={s.aide}>
            Le seuil de réussite est à 70%. Une question sans réponse compte comme une erreur, mais
            vous pouvez envoyer sans avoir tout répondu.
          </Text>
        </View>
      )}

      {questions.map((q, i) => {
        const correction = resultat?.corrections.find((c) => c.rang === q.rang) ?? null;
        return (
          <View key={q.rang} style={s.carteQuestion}>
            <Text style={s.question}>
              {i + 1}. {q.question}
            </Text>
            {q.options.map((o, j) => {
              const choisie = reponses[i] === j;
              const bonne = correction !== null && correction.bonne === j;
              const fausse = correction !== null && choisie && !correction.juste;
              return (
                <Pressable
                  key={j}
                  onPress={corrige || enCours ? undefined : () => {
                    setReponses((av) => av.map((v, k) => (k === i ? j : v)));
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={o}
                  accessibilityState={{ selected: choisie, checked: choisie, disabled: corrige }}
                  style={({ pressed }) => [
                    s.option,
                    choisie && !corrige ? s.optionChoisie : null,
                    bonne ? s.optionBonne : null,
                    fausse ? s.optionFausse : null,
                    pressed && !corrige ? { opacity: 0.8 } : null,
                  ]}
                >
                  <View style={[s.rond, choisie && s.rondPlein]} />
                  <Text style={[s.optionTexte, bonne && { color: C.succesTexte }, fausse && { color: C.dangerTexte }]}>
                    {o}
                  </Text>
                  {bonne ? <Ionicons name="checkmark-circle" size={16} color={C.succesTexte} /> : null}
                  {fausse ? <Ionicons name="close-circle" size={16} color={C.dangerTexte} /> : null}
                </Pressable>
              );
            })}
          </View>
        );
      })}

      {!corrige ? (
        <Bouton
          titre="Envoyer mes réponses"
          onPress={() => surEnvoyer(reponses)}
          enCours={enCours}
          icone={<Ionicons name="send" size={15} color="#fff" />}
        />
      ) : (
        <Bouton titre="Revenir au programme" onPress={surFermer} secondaire />
      )}
    </Section>
  );
}

const s = StyleSheet.create({
  attente: { color: C.texteFaible, fontFamily: P.texte, fontSize: T.detail },
  compteur: { color: C.texteFaible, fontFamily: P.texteFort, fontSize: 13 },
  fermer: { color: C.accentClair, fontFamily: P.texteFort, fontSize: 13.5 },

  entete: { flexDirection: "row", alignItems: "flex-start", gap: E.s },
  icone: { fontSize: 30, lineHeight: 34 },
  titre: { color: C.texte, fontFamily: P.titre, fontSize: 21, letterSpacing: -0.5, lineHeight: 27 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.note, lineHeight: T.noteHauteur },
  etiquettes: { flexDirection: "row", flexWrap: "wrap", gap: E.xs },
  description: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.corps, lineHeight: T.corpsHauteur },

  bloc: {
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure,
    padding: E.m, gap: E.s,
  },
  blocOk: { backgroundColor: "rgba(18,183,106,.07)", borderColor: "rgba(18,183,106,.26)" },
  blocAlerte: { backgroundColor: "rgba(232,163,61,.07)", borderColor: "rgba(232,163,61,.28)" },
  ligneBloc: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: E.s },
  blocTitre: { color: C.texte, fontFamily: P.texteFort, fontSize: T.corps },
  pourcent: { color: C.accentClair, fontFamily: P.titre, fontSize: 17 },
  scoreGros: { color: C.texte, fontFamily: P.titre, fontSize: 32, letterSpacing: -0.8 },
  noteOk: { color: C.succesTexte, fontFamily: P.texteMoyen, fontSize: T.detail, lineHeight: T.detailHauteur },
  noteAlerte: { color: C.alerteTexte, fontFamily: P.texteMoyen, fontSize: T.detail, lineHeight: T.detailHauteur },
  aide: { color: C.texteFaible, fontFamily: P.texte, fontSize: T.note, lineHeight: T.noteHauteur },
  avertissement: { color: C.alerteTexte, fontFamily: P.texte, fontSize: T.note, lineHeight: T.noteHauteur },

  blocVerrou: {
    backgroundColor: "rgba(232,163,61,.07)", borderRadius: R.l, borderWidth: 1,
    borderColor: "rgba(232,163,61,.28)", padding: E.m, gap: E.xs,
  },
  ligneVerrou: { flexDirection: "row", alignItems: "center", gap: E.xs },
  verrouTitre: { flex: 1, color: C.alerteTexte, fontFamily: P.titreFort, fontSize: T.corps },
  verrouTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.note, lineHeight: T.noteHauteur },

  module: {
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure,
    overflow: "hidden",
  },
  enteteModule: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    paddingHorizontal: E.m, paddingVertical: E.s, minHeight: TOUCHE,
  },
  numero: {
    width: 26, height: 26, borderRadius: R.pill, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.07)", borderWidth: 1, borderColor: C.bordure,
  },
  numeroComplet: { backgroundColor: "rgba(18,183,106,.16)", borderColor: "rgba(18,183,106,.4)" },
  numeroTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 12.5 },
  moduleTitre: { color: C.texte, fontFamily: P.texteFort, fontSize: T.corps, lineHeight: 19 },
  moduleSous: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12, lineHeight: 17 },

  lecons: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.bordure, paddingVertical: E.xs },
  lecon: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    paddingHorizontal: E.m, paddingVertical: E.xs, minHeight: TOUCHE,
  },
  coche: {
    width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: C.bordureForte,
    alignItems: "center", justifyContent: "center",
  },
  cocheFaite: { backgroundColor: C.succes, borderColor: C.succes },
  puce: { width: 6, height: 6, borderRadius: R.pill, backgroundColor: C.texteFaible, marginHorizontal: 8 },
  leconTitre: { flex: 1, color: C.texte, fontFamily: P.texte, fontSize: T.corps, lineHeight: T.corpsHauteur },
  leconFaite: { color: C.texteDoux },

  carteQuestion: {
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, borderColor: C.bordure,
    padding: E.m, gap: E.xs,
  },
  question: { color: C.texte, fontFamily: P.texteFort, fontSize: T.corps, lineHeight: T.corpsHauteur, marginBottom: 2 },
  option: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    paddingHorizontal: E.s, paddingVertical: E.xs, minHeight: TOUCHE,
    borderRadius: R.m, borderWidth: 1, borderColor: C.bordure, backgroundColor: "rgba(255,255,255,.03)",
  },
  optionChoisie: { borderColor: C.accentClair, backgroundColor: "rgba(22,134,255,.14)" },
  optionBonne: { borderColor: "rgba(18,183,106,.5)", backgroundColor: "rgba(18,183,106,.12)" },
  optionFausse: { borderColor: "rgba(240,68,94,.5)", backgroundColor: "rgba(240,68,94,.12)" },
  optionTexte: { flex: 1, color: C.texte, fontFamily: P.texte, fontSize: T.detail, lineHeight: T.detailHauteur },
  rond: {
    width: 18, height: 18, borderRadius: R.pill, borderWidth: 1.5, borderColor: C.bordureForte,
  },
  rondPlein: { backgroundColor: C.accentClair, borderColor: C.accentClair },
});
