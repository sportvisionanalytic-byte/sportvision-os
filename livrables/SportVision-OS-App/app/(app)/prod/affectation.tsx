// AFFECTER QUELQU'UN, DEPUIS LE TELEPHONE (30/09/2026).
//
// C'EST LE GESTE QUI MANQUAIT. Une prestation se vend, elle arrive « à planifier », et jusqu'ici il
// fallait un ordinateur pour y mettre une personne. Deux missions sont dans cet etat en ce moment
// meme : SV-2026-5455 et SV-2026-5456, toutes deux le 3 octobre.
//
// DEUX LISTES, ET LA SECONDE EST VIDE AUJOURD'HUI :
//
//   · SANS OPERATEUR. Mesure : 2 missions sur 10 n'ont personne. Et attention, la premiere est dans
//     le groupe `a_planifier`, LA SECONDE DANS `a_venir` — une mission deja planifiee peut n'avoir
//     personne dessus. « Sans operateur » n'est donc pas un groupe, c'est la colonne `operateurs` de
//     la vue, vide. On affiche a cote de chaque carte le groupe que la vue a calcule, pour ne pas
//     laisser croire qu'on en aurait fabrique un autre.
//   · SANS REPONSE. Mesure : les 10 affectations existantes sont TOUTES `acceptée`. Aucune
//     invitation n'attend de reponse. La liste est donc vide, et elle dit pourquoi, plutot que de
//     laisser une page blanche qui ressemble a une panne.
//
// CE QU'ON NE MET PAS DANS CET ECRAN :
//
//   · LE FILTRE PAR ZONE du picker de l'OS. Mesure : `profiles.zone` est nulle sur les douze
//     candidats. Un filtre dont toutes les valeurs sont vides n'aide personne et fait croire que la
//     donnee existe.
//   · LA SAISIE DE LA REMUNERATION. Decision de Fouka du 20/08 : la production affecte et donne des
//     consignes, elle ne fixe pas le montant. On AFFICHE ce que la grille de la base repond, on ne
//     l'edite pas. Mesure : la grille ne rend un montant que pour 2 des 12 personnes, les seules a
//     avoir un niveau d'operateur. L'ecran le dit au lieu de faire semblant.
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Probleme, Vide } from "../../../src/ui/Ecran";
import { Bouton, Champ, Erreur, Pastille } from "../../../src/ui/Base";
import { Barre } from "../../../src/ui/Barre";
import { Ecusson } from "../../../src/ui/Ecusson";
import { EcranProd } from "./_layout";
import { oublier, useDonnees } from "../../../src/lib/cache";
import { libelleCouverture } from "../../../src/lib/os-missions";
import { dateLongue, heureCourte, quand } from "../../../src/lib/dates";
import {
  affecter, chargeAVenir, envoyerPropositions, lireAffectations, lireCandidats, lireMissions,
  missionDansMonPerimetre, relancer, remunerationGrille, retirer,
  STATUTS_SANS_REPONSE,
  type Affectation, type Candidat, type MissionProd,
} from "../../../src/lib/os-production";
import { C, E, R, TOUCHE } from "../../../src/theme/couleurs";
import { P } from "../../../src/theme/polices";

/** Les libelles de groupe du cockpit, mot pour mot ceux de `missions.tsx` et de l'OS. */
const LIBELLE_GROUPE: Record<string, string> = {
  a_planifier: "À planifier",
  attente_acceptation: "En attente",
  a_venir: "À venir",
  terrain: "Sur le terrain",
  post_production: "Post-production",
  a_verifier: "À vérifier",
  corrections: "Corrections",
  terminees: "Terminées",
  annulees: "Annulées",
  autres: "Autres",
};

interface Donnees {
  missions: MissionProd[];
  affectations: Affectation[];
  candidats: Candidat[];
}

export default function EcranAffectation() {
  const [liste, setListe] = useState("sans_operateur");

  const { donnees, chargement, rafraichissement, erreur, relire } = useDonnees<Donnees>(
    "prod:affectation",
    async () => {
      const [missions, affectations, candidats] = await Promise.all([
        lireMissions(), lireAffectations(), lireCandidats(),
      ]);
      return { missions, affectations, candidats };
    },
  );

  // Apres une ecriture, plusieurs ecrans deviennent faux d'un coup (l'equipe, les livraisons) :
  // on oublie tout le prefixe plutot que de se souvenir un jour de la moitie.
  const recharger = useCallback(() => { oublier("prod:"); relire(); }, [relire]);

  const missions = donnees?.missions ?? [];
  const affectations = donnees?.affectations ?? [];
  const candidats = donnees?.candidats ?? [];

  // DEUX COLONNES DE LA VUE, ET PAS UNE DE PLUS.
  //
  // `operateurs` ne nomme que les personnes qui ont ACCEPTE : la vue l'assemble avec
  // `pe.statut = 'acceptée'`. Une mission qu'on vient de pourvoir garde donc `operateurs` a null
  // jusqu'a la reponse de la personne — la carte ne quitterait jamais cette liste, et on
  // affecterait deux fois. `invitation_depuis`, l'autre colonne de la vue, dit qu'une invitation de
  // cette mission attend une reponse : ces missions-la sont dans la liste « Sans reponse », pas ici.
  //
  // « Terminees » est ecarte : une mission close sans operateur nomme est une anomalie d'historique,
  // pas un geste a faire ce matin. Tout le reste passe, quel que soit le groupe.
  const sansOperateur = useMemo(
    () => missions.filter((m) => !m.operateurs && !m.invitationDepuis && m.groupe !== "terminees"),
    [missions],
  );
  const sansReponse = useMemo(
    () => affectations.filter((a) => (STATUTS_SANS_REPONSE as readonly string[]).includes(a.statut)),
    [affectations],
  );
  const charge = useMemo(() => chargeAVenir(affectations), [affectations]);

  const sous = chargement
    ? "Chargement"
    : sansOperateur.length
      ? `${sansOperateur.length} mission${sansOperateur.length > 1 ? "s" : ""} sans opérateur`
      : "Toutes les missions ont quelqu'un dessus";

  return (
    <EcranProd titre="Affectation" sous={sous} rafraichir={recharger} enCours={rafraichissement}>
      <Barre
        choix={[
          { cle: "sans_operateur", libelle: "Sans opérateur", n: sansOperateur.length },
          { cle: "sans_reponse", libelle: "Sans réponse", n: sansReponse.length },
        ]}
        actif={liste}
        surChoix={setListe}
      />

      {chargement ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : erreur ? (
        <Probleme surReessayer={recharger} />
      ) : liste === "sans_operateur" ? (
        sansOperateur.length ? (
          <View style={{ gap: E.s }}>
            {sansOperateur.map((m) => (
              <CarteAAffecter
                key={m.id}
                mission={m}
                candidats={candidats}
                charge={charge}
                surFait={recharger}
              />
            ))}
          </View>
        ) : (
          <Vide
            titre="Aucune mission sans opérateur"
            texte={
              "Dès qu'une prestation est vendue et qu'elle n'a personne dessus, elle apparaît ici, " +
              "quel que soit son état. Une mission dont l'invitation est partie passe dans " +
              "« Sans réponse » jusqu'à l'acceptation. Glissez vers le bas pour relire."
            }
          />
        )
      ) : sansReponse.length ? (
        <View style={{ gap: E.s }}>
          {sansReponse.map((a) => (
            <CarteSansReponse
              key={a.id}
              affectation={a}
              mission={missions.find((m) => m.id === a.prestationId) ?? null}
              surFait={recharger}
            />
          ))}
        </View>
      ) : (
        <Vide
          titre="Personne n'est en attente de réponse"
          texte={
            "Les invitations envoyées et pas encore acceptées se rangent ici. Il n'y en a aucune : " +
            "les affectations en cours ont toutes été acceptées. SportVision relance d'elle-même " +
            "une invitation sans réponse à partir de trois jours avant la mission, une fois par " +
            "jour ; ce bouton sert pour les missions plus lointaines."
          }
        />
      )}
    </EcranProd>
  );
}

// ── Une mission a pourvoir ────────────────────────────────────────────────────────────────────

function CarteAAffecter({
  mission, candidats, charge, surFait,
}: {
  mission: MissionProd;
  candidats: Candidat[];
  charge: Map<string, number>;
  surFait: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [autorise, setAutorise] = useState<boolean | null>(null);
  const [choisi, setChoisi] = useState<string | null>(null);
  const [grille, setGrille] = useState<number | null | "inconnue">("inconnue");
  const [fonction, setFonction] = useState("");
  const [consignes, setConsignes] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [souci, setSouci] = useState<string | null>(null);
  const [fait, setFait] = useState<string | null>(null);
  const [aRenvoyer, setARenvoyer] = useState(false);

  // LE DROIT SE DEMANDE A LA BASE AVANT D'OUVRIR LE FORMULAIRE (regle 5). `prestation_pole_scope_ok`
  // est la moitie de la condition de `rpc_ajouter_membre_equipe` qui depend de la mission ; le role,
  // la session le porte deja. Un formulaire qu'on ne peut pas envoyer est pire que son absence.
  const ouvrir = useCallback(async () => {
    setOuvert(true);
    if (autorise !== null) return;
    try { setAutorise(await missionDansMonPerimetre(mission.id)); }
    catch { setAutorise(false); }
  }, [autorise, mission.id]);

  // Les candidats du POLE DE CETTE MISSION, comme le picker de l'OS. Le filet de securite est le
  // sien aussi : pole de la mission introuvable, on ne vide pas la liste, on la laisse entiere.
  const proposables = useMemo(() => {
    const base = mission.poleId
      ? candidats.filter((c) => c.poleIds.includes(mission.poleId as string))
      : candidats;
    // Le moins charge d'abord, les metiers de terrain devant : l'ordre du picker de l'OS.
    return [...base].sort((a, b) => {
      const pa = a.role === "photo" ? 0 : 1;
      const pb = b.role === "photo" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return (charge.get(a.id) ?? 0) - (charge.get(b.id) ?? 0);
    });
  }, [candidats, charge, mission.poleId]);

  async function choisir(c: Candidat) {
    setChoisi(c.id);
    setSouci(null);
    setGrille("inconnue");
    // Le montant vient de la grille en base (`remuneration_recommandee`), jamais d'un calcul ici.
    try { setGrille(await remunerationGrille(c.id, mission.id)); }
    catch { setGrille(null); }
  }

  async function envoyer() {
    if (!choisi) return;
    setEnCours(true); setSouci(null); setFait(null); setARenvoyer(false);
    try {
      const r = await affecter({
        prestationId: mission.id,
        collaborateurId: choisi,
        fonction,
        consignes,
        // L'heure de rendez-vous de la MISSION, quand le club en a convenu une : sans elle,
        // l'operateur lit l'heure de debut du match comme heure d'arrivee.
        heureRdv: mission.heureRdv,
        remuneration: grille === "inconnue" ? null : grille,
      });
      if (r.propositionsEnvoyees > 0) {
        setFait(
          `Affecté. ${r.propositionsEnvoyees} proposition${r.propositionsEnvoyees > 1 ? "s" : ""} envoyée${r.propositionsEnvoyees > 1 ? "s" : ""}.`,
        );
        setOuvert(false);
        surFait();
      } else {
        // Zero proposition partie : la personne est prevue mais n'a rien recu. On ne dit surtout
        // pas « envoye » (regle 4), on montre le bouton qui reste a appuyer.
        setSouci("Affecté, mais aucune proposition n'est partie. Personne n'a encore été prévenu.");
        setARenvoyer(true);
        surFait();
      }
    } catch (e) {
      setSouci(e instanceof Error ? e.message : "L'affectation n'est pas passée.");
    } finally {
      setEnCours(false);
    }
  }

  async function renvoyer() {
    setEnCours(true); setSouci(null);
    try {
      const n = await envoyerPropositions(mission.id);
      if (n > 0) { setARenvoyer(false); setFait(`${n} proposition${n > 1 ? "s" : ""} envoyée${n > 1 ? "s" : ""}.`); setOuvert(false); }
      else setSouci("Toujours aucune proposition à envoyer sur cette mission.");
      surFait();
    } catch (e) {
      setSouci(e instanceof Error ? e.message : "L'envoi n'est pas passé.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <View style={s.carte}>
      <View style={s.ligne}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.nom} numberOfLines={2}>{mission.client ?? "Sans client"}</Text>
          <Text style={s.detail} numberOfLines={2}>
            {[mission.date ? quand(mission.date) : "Sans date",
              heureCourte(mission.heureRdv ?? mission.heureDebut), mission.lieu]
              .filter(Boolean).join(" · ")}
          </Text>
          <Text style={s.reference}>{mission.reference}</Text>
        </View>
        {/* Le groupe vient de la vue. On le montre tel quel : c'est la seule verite sur l'etat. */}
        <Pastille texte={LIBELLE_GROUPE[mission.groupe] ?? mission.groupe} />
      </View>

      <Text style={s.manque}>Aucun opérateur affecté</Text>
      {libelleCouverture(mission.couverture) ? <Pastille texte={libelleCouverture(mission.couverture)!} /> : null}

      {fait ? <View style={s.ok}><Text style={s.okTexte}>{fait}</Text></View> : null}

      {!ouvert ? (
        <Bouton
          titre="Affecter quelqu'un"
          onPress={ouvrir}
          icone={<Ionicons name="person-add" size={16} color="#fff" />}
        />
      ) : autorise === null ? (
        <View style={s.attentePetite}><ActivityIndicator color={C.accent} /></View>
      ) : autorise === false ? (
        <Vide
          titre="Cette mission n'est pas dans votre pôle"
          texte={
            "La base refuse l'affectation, et le bouton ne sert donc à rien. Demandez à " +
            "l'administration de vous rattacher au pôle de cette mission, ou de l'affecter pour vous."
          }
        />
      ) : (
        <View style={{ gap: E.m }}>
          <Text style={s.sousTitreBloc}>
            {proposables.length
              ? `${proposables.length} personne${proposables.length > 1 ? "s" : ""} du pôle de cette mission`
              : "Aucune personne rattachée au pôle de cette mission"}
          </Text>

          {proposables.length ? (
            <View style={{ gap: E.xs }}>
              {proposables.map((c) => (
                <Personne
                  key={c.id}
                  c={c}
                  charge={charge.get(c.id) ?? 0}
                  choisie={choisi === c.id}
                  surChoix={() => choisir(c)}
                />
              ))}
            </View>
          ) : (
            <Vide
              titre="Personne à proposer"
              texte={
                "Les opérateurs sont rattachés à un pôle dans l'OS. Tant que personne n'est " +
                "rattaché au pôle de cette mission, il n'y a personne à mettre dessus."
              }
            />
          )}

          {choisi ? (
            <View style={{ gap: E.s }}>
              {/* LA REMUNERATION EST AFFICHEE, PAS SAISIE. Elle vient de la grille en base. */}
              <View style={s.grille}>
                <Text style={s.grilleLabel}>Rémunération</Text>
                <Text style={s.grilleTexte}>
                  {grille === "inconnue"
                    ? "Lecture de la grille…"
                    : grille === null
                      ? "Niveau d'opérateur non renseigné : la grille ne donne aucun montant. L'administration le fixera."
                      : `${grille} € selon la grille`}
                </Text>
              </View>

              <Champ
                label="Fonction"
                value={fonction}
                onChangeText={setFonction}
                placeholder="photo, vidéo, drone…"
              />
              <Champ
                label="Consignes pour cette personne"
                value={consignes}
                onChangeText={setConsignes}
                placeholder="Facultatif"
                multiline
              />

              <Erreur message={souci} />

              {aRenvoyer ? (
                <Bouton titre="Envoyer les propositions" onPress={renvoyer} enCours={enCours} />
              ) : (
                <Bouton
                  titre="Affecter et prévenir"
                  onPress={envoyer}
                  enCours={enCours}
                  desactive={grille === "inconnue"}
                />
              )}
              <Bouton titre="Annuler" onPress={() => { setOuvert(false); setChoisi(null); }} secondaire />
            </View>
          ) : (
            <>
              <Erreur message={souci} />
              <Bouton titre="Annuler" onPress={() => setOuvert(false)} secondaire />
            </>
          )}
        </View>
      )}
    </View>
  );
}

/** Une personne proposable. Le nom, le metier, sa charge, et ce qui doit alerter avant de cliquer. */
function Personne({
  c, charge, choisie, surChoix,
}: { c: Candidat; charge: number; choisie: boolean; surChoix: () => void }) {
  return (
    <Pressable
      onPress={surChoix}
      accessibilityRole="button"
      accessibilityState={{ selected: choisie }}
      accessibilityLabel={`${c.nom}, ${charge === 0 ? "libre" : `${charge} missions à venir`}`}
      style={[s.personne, choisie && s.personneChoisie]}
    >
      <Ecusson nom={c.nom} taille={38} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.personneNom} numberOfLines={1}>{c.nom || "Sans nom"}</Text>
        <Text style={s.personneDetail} numberOfLines={2}>
          {[
            c.role === "photo" ? "Opérateur terrain" : c.role === "cm" ? "Community manager" : c.role,
            // Mesure : 10 des 12 n'ont pas de niveau. On n'affiche rien plutot qu'un « niveau 0 ».
            c.niveau ? `niveau ${c.niveau}` : null,
            // Mesure : une seule personne a declare du materiel. Quand c'est le cas, ca compte.
            c.materielPersonnel ? "matériel perso" : null,
          ].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        {/* « Libre » est le mot du picker de l'OS. Mesure : les douze sont a zero aujourd'hui. */}
        <Pastille
          ton={charge === 0 ? "succes" : charge < 3 ? "alerte" : "danger"}
          texte={charge === 0 ? "Libre" : `${charge} mission${charge > 1 ? "s" : ""}`}
        />
        {!c.actif ? <Pastille ton="danger" texte="Compte inactif" /> : null}
        {!c.accepteInvitations ? <Pastille ton="alerte" texte="Notifs coupées" /> : null}
      </View>
    </Pressable>
  );
}

// ── Une invitation qui dort ───────────────────────────────────────────────────────────────────

function CarteSansReponse({
  affectation, mission, surFait,
}: { affectation: Affectation; mission: MissionProd | null; surFait: () => void }) {
  const [enCours, setEnCours] = useState<null | "relance" | "retrait">(null);
  const [souci, setSouci] = useState<string | null>(null);
  const [fait, setFait] = useState<string | null>(null);

  async function relance() {
    setEnCours("relance"); setSouci(null); setFait(null);
    try {
      await relancer({
        prestationId: affectation.prestationId,
        collaborateurId: affectation.collaborateurId,
        client: affectation.missionClient ?? mission?.client ?? null,
        date: affectation.missionDate ?? mission?.date ?? null,
        heureDebut: mission?.heureDebut ?? null,
      });
      setFait("Relance envoyée dans ses notifications.");
    } catch (e) {
      setSouci(e instanceof Error ? e.message : "La relance n'est pas partie.");
    } finally { setEnCours(null); }
  }

  async function retrait() {
    setEnCours("retrait"); setSouci(null); setFait(null);
    try { await retirer(affectation.id); surFait(); }
    catch (e) { setSouci(e instanceof Error ? e.message : "Le retrait n'est pas passé."); }
    finally { setEnCours(null); }
  }

  return (
    <View style={s.carte}>
      <View style={s.ligne}>
        <Ecusson nom={affectation.nom} taille={38} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.nom} numberOfLines={1}>{affectation.nom || "Sans nom"}</Text>
          <Text style={s.detail} numberOfLines={2}>
            {[affectation.missionClient, affectation.missionDate ? dateLongue(affectation.missionDate) : null]
              .filter(Boolean).join(" · ")}
          </Text>
          <Text style={s.reference}>{affectation.missionReference}</Text>
        </View>
        <Pastille ton="alerte" texte="Sans réponse" />
      </View>

      {affectation.creeLe ? (
        <Text style={s.detail}>Invitation envoyée le {dateLongue(affectation.creeLe.slice(0, 10))}</Text>
      ) : null}

      {fait ? <View style={s.ok}><Text style={s.okTexte}>{fait}</Text></View> : null}
      <Erreur message={souci} />

      <View style={{ gap: E.xs }}>
        <Bouton
          titre="Relancer"
          onPress={relance}
          enCours={enCours === "relance"}
          desactive={enCours !== null}
          icone={<Ionicons name="notifications" size={16} color="#fff" />}
        />
        <Bouton
          titre="Retirer de la mission"
          onPress={retrait}
          enCours={enCours === "retrait"}
          desactive={enCours !== null}
          secondaire
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  attente: { paddingVertical: E.xl * 2, alignItems: "center" },
  attentePetite: { paddingVertical: E.m, alignItems: "center" },

  carte: {
    gap: E.s, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  ligne: { flexDirection: "row", alignItems: "flex-start", gap: E.s },
  nom: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  reference: { color: C.texteFaible, fontFamily: P.texte, fontSize: 11.5 },
  manque: { color: C.alerteTexte, fontFamily: P.texteMoyen, fontSize: 13 },
  sousTitreBloc: { color: C.texteFaible, fontFamily: P.texteFort, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.8 },

  personne: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    minHeight: TOUCHE + 12, padding: E.s, borderRadius: R.m,
    backgroundColor: C.surfaceHaute, borderWidth: 1, borderColor: C.bordure,
  },
  personneChoisie: { borderColor: "rgba(36,84,255,.55)", backgroundColor: "rgba(36,84,255,.14)" },
  personneNom: { color: C.texte, fontFamily: P.texteFort, fontSize: 14.5 },
  personneDetail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 12.5, lineHeight: 17 },

  grille: {
    gap: 3, padding: E.s, borderRadius: R.m,
    backgroundColor: "rgba(0,199,255,.08)", borderWidth: 1, borderColor: "rgba(0,199,255,.26)",
  },
  grilleLabel: { color: C.cyan, fontFamily: P.texteFort, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 },
  grilleTexte: { color: C.texte, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },

  ok: {
    padding: E.s, borderRadius: R.m,
    backgroundColor: "rgba(18,183,106,.12)", borderWidth: 1, borderColor: "rgba(18,183,106,.35)",
  },
  okTexte: { color: C.succesTexte, fontFamily: P.texteMoyen, fontSize: 13.5, lineHeight: 19 },
});
