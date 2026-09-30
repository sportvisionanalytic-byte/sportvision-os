// L'ACCUEIL — DANS L'ORDRE OÙ ON SE POSE LES QUESTIONS (30/09/2026).
//
// C'est l'écran `dash` de l'OS. Il s'appelle « Accueil » pour l'opérateur et pour la production,
// et « Tableau de bord » pour les autres rôles : ce sont les deux premiers qui sont ici.
//
// L'OPÉRATEUR, en sortant son téléphone, se demande trois choses et dans cet ordre :
//
//   1. « Je vais où, et à quelle heure ? »  → la prochaine prestation, en grand, tout en haut.
//   2. « On attend quelque chose de moi ? » → les invitations. Un geste, urgent, et le seul.
//   3. « Qu'est-ce que je dois encore rendre ? » → ce qui manque pour clore ses missions passées.
//
// Le reste de l'OS (revenus, formation, messagerie) n'est pas une question qu'on se pose au bord
// d'un terrain, et n'est donc pas ici.
//
// MESURÉ AVANT D'ÉCRIRE, LE 30/09, AVEC LE JETON DE CHAQUE COMPTE :
//
//   · 8 des 10 opérateurs n'ont AUCUNE affectation. L'état vide n'est pas un cas limite, c'est le
//     cas le plus fréquent : il porte la phrase de l'OS, mot pour mot.
//   · 0 invitation en attente sur les 10 affectations — toutes acceptées. La section 2 ne
//     s'affiche donc pas aujourd'hui, et c'est normal : on ne laisse pas un bloc vide à la place.
//   · `brief_cm` est NULL sur les 10 prestations, `description_besoin` rempli sur les 10. Le brief
//     affiché est donc presque toujours le besoin écrit par le club. C'est déjà ce que fait
//     `MaMission` (`brief || besoin`), on n'ajoute pas de « Brief non renseigné ».
//   · `adresse_complete` est NULL sur les 10 : aucune ligne d'adresse, aucun « lieu non précisé ».
//     `lieu` est rempli sur les 10, il suffit.
//   · `heure_rdv` de l'affectation : 5 sur 10. On retombe sur `heure_debut` (10 sur 10) mais on
//     CHANGE LE MOT : annoncer « Rendez-vous 09h30 » quand la base dit seulement « début 09h30 »
//     ferait arriver quelqu'un en retard.
//   · `est_responsable` est faux sur les 10 : la pastille « Responsable » existe mais ne se verra
//     pas avant qu'on désigne un responsable en base.
//
// LA PRODUCTION, elle, ne vient pas chercher SA mission : elle vient voir la journée et ce qui
// coince. Mesuré le 30/09 : 0 prestation aujourd'hui, 2 dans les sept prochains jours, 0 incident
// ouvert, 0 livraison en retard, mais 9 missions sur 10 sans échéance de livraison — et c'est
// justement pour ça que « livraison en retard » vaut faux partout : la vue compare à une échéance
// qui n'existe pas. Le chiffre est donc dit, une fois, en clair.
import React, { useCallback, useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Ecran, Probleme, Section, Vide } from "../../src/ui/Ecran";
import { Pastille } from "../../src/ui/Base";
import { Marque } from "../../src/ui/Marque";
import { estProduction, useSession } from "../../src/lib/session";
import { lireCockpit, type MaMission, type MissionProduction } from "../../src/lib/os-missions";
import {
  aRepondre, cleCloture, cleCockpit, cleCorrections, clePlanning,
  libelleCouverture, lireEtatCloture, lireMesCorrections, lireMonPlanning, prochaine,
  type CorrectionDemandee, type EtatCloture,
} from "../../src/lib/os-planning";
import { lireParcours, type Parcours } from "../../src/lib/os-formation";
import { lireResumeOperateur, type ResumeOperateur } from "../../src/lib/os-accueil";
import { BandeauParcours, CarteKit } from "../../src/ui/Parcours";
import { useDonnees } from "../../src/lib/cache";
import { dateDuJourParis, dateLongue, heureCourte, quand } from "../../src/lib/dates";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P, T } from "../../src/theme/polices";

export default function Accueil() {
  const { moi } = useSession();
  return estProduction(moi?.role ?? null) ? <AccueilProduction /> : <AccueilOperateur />;
}

/** Le pluriel français, écrit une fois. Trois « s » oubliés dans l'OS ont fini par se voir. */
const s_ = (n: number) => (n > 1 ? "s" : "");

// ══ L'OPÉRATEUR ════════════════════════════════════════════════════════════════════════════════

function AccueilOperateur() {
  const { moi } = useSession();
  const router = useRouter();
  const aujourdhui = dateDuJourParis();
  const moiId = moi?.id ?? null;

  // Trois lectures et non une seule requête groupée : celle du planning porte la MÊME clé que
  // l'onglet « Mon planning », qui s'ouvre donc déjà rempli. Une lecture groupée aurait sa propre
  // clé, et le planning repartirait de zéro.
  const plan = useDonnees<MaMission[]>(
    moiId ? clePlanning(moiId) : null,
    () => lireMonPlanning(moiId as string),
    [moiId],
  );
  const cloture = useDonnees<EtatCloture[]>(moiId ? cleCloture : null, lireEtatCloture, [moiId]);
  const corrections = useDonnees<CorrectionDemandee[]>(
    moiId ? cleCorrections(moiId) : null,
    () => lireMesCorrections(moiId as string),
    [moiId],
  );

  // LE PARCOURS ET LE KIT, PARCE QUE L'ACCUEIL ÉTAIT VIDE POUR TOUT LE MONDE. Mesuré le 30/09 :
  // aucun des dix opérateurs n'a de mission à venir. Le grade, l'XP et ce qui a été fait, eux,
  // existent pour six d'entre eux — et pour les quatre autres, le bandeau invite au lieu de juger.
  //
  // MÊME CLÉ QUE L'ONGLET FORMATION : arriver ici le remplit, et l'ouvrir ensuite ne recharge rien.
  const parcours = useDonnees<Parcours>(
    moiId ? `os:parcours:${moiId}` : null,
    () => lireParcours(moiId as string, moi?.role ?? null),
    [moiId, moi?.role],
  );
  const resume = useDonnees<ResumeOperateur>(
    moiId ? `os:resume:${moiId}` : null,
    () => lireResumeOperateur(moiId as string),
    [moiId],
  );

  const relireTout = useCallback(() => {
    plan.relire(); cloture.relire(); corrections.relire(); parcours.relire(); resume.relire();
  }, [plan.relire, cloture.relire, corrections.relire, parcours.relire, resume.relire]);

  const missions = plan.donnees ?? [];
  // Une panne de chargement n'est pas un écran vide (règle 7 du contrat) : tant qu'on a la réponse
  // d'avant, on la montre ; c'est seulement quand on n'a RIEN que l'on avoue la panne.
  const panne = !!plan.erreur && plan.donnees === undefined;
  // UNE SECTION QUI DISPARAÎT PARCE QU'UNE LECTURE A ÉCHOUÉ EST UN MENSONGE. Si `cloture` tombe,
  // « À faire » serait vide et l'opérateur croirait n'avoir rien à rendre. On le dit.
  const sansCloture = !!cloture.erreur && cloture.donnees === undefined;

  const dujour = missions.filter((m) => m.date === aujourdhui);
  const suivante = prochaine(missions, aujourdhui);
  const invitations = aRepondre(missions);

  // CE QU'IL RESTE À RENDRE : les phrases de la base, sur MES missions déjà passées seulement.
  // Sur une mission à venir, `mission_cloture_manquant` liste évidemment tout — « Aucun lien
  // déposé par l'opérateur » sur un match de samedi prochain n'est pas un retard, c'est l'ordre
  // normal des choses. Mesuré sur les 5 missions d'Antoine : 3 portent au moins une phrase.
  const aTerminer = useMemo(() => {
    const parPresta = new Map((cloture.donnees ?? []).map((e) => [e.prestationId, e]));
    const corrParPresta = new Map<string, CorrectionDemandee[]>();
    for (const c of corrections.donnees ?? []) {
      const l = corrParPresta.get(c.prestationId);
      if (l) l.push(c); else corrParPresta.set(c.prestationId, [c]);
    }
    return missions
      .filter((m) => m.date && m.date < aujourdhui)
      .map((m) => ({
        mission: m,
        manque: parPresta.get(m.prestationId)?.manque ?? [],
        corrections: corrParPresta.get(m.prestationId) ?? [],
      }))
      .filter((x) => x.manque.length > 0)
      // Le plus récent d'abord : c'est celui dont on se souvient encore.
      .reverse();
  }, [missions, cloture.donnees, corrections.donnees, aujourdhui]);

  const sousTitre = dujour.length
    ? `Tu as ${dujour.length} prestation${s_(dujour.length)} aujourd'hui.`
    : suivante?.date
      ? `Prochaine mission : ${dateLongue(suivante.date)}`
      : "Aucune mission planifiée.";

  return (
    <Ecran enCours={plan.rafraichissement} teinte="cyan" rafraichir={relireTout}>
      {/* LE LOGO DANS L'EN-TÊTE (01/10/2026). Une fois passé l'écran de connexion, l'application
          ne redisait plus jamais son nom : dix écrans d'un titre blanc sur du noir. Il est ici,
          discret, à la taille d'une ligne de texte, et ne revient sur aucun autre écran. */}
      <View style={s.entete}>
        <Marque taille={38} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.titre} numberOfLines={1}>Bonjour {moi?.prenom || ""}</Text>
          <Text style={s.sous}>{sousTitre}</Text>
        </View>
      </View>

      {plan.chargement ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : panne ? (
        <Probleme surReessayer={relireTout} />
      ) : (
        <>
          {suivante ? <CarteProchaine m={suivante} /> : (
            <Vide
              icone="calendar-outline"
              titre="Aucune prestation à venir"
              texte="Vous serez prévenu dès qu'une mission vous sera proposée, sur cet écran et par une notification."
              action={{ libelle: "Voir mes missions", surPression: () => router.push("/missions") }}
            />
          )}

          {/* LE KIT AVANT LE PARCOURS : c'est le seul des deux qui demande un geste. Un kit non
              rendu bloque sa réservation pour tout le monde. */}
          {resume.donnees?.kitEnMain ? <CarteKit {...resume.donnees.kitEnMain} /> : null}

          {/* Le bandeau ne s'affiche qu'une fois lu : un cadre vide qui se remplit une seconde
              plus tard fait sauter tout l'écran sous le doigt. */}
          {parcours.donnees ? (
            <BandeauParcours
              parcours={parcours.donnees}
              missionsRealisees={resume.donnees?.missionsRealisees ?? 0}
            />
          ) : null}

          {/* On n'affiche la section que s'il y a vraiment quelque chose à répondre. Un bloc
              « 0 invitation » occuperait le haut de l'écran pour dire qu'il n'y a rien à faire. */}
          {invitations.length ? (
            <Section titre="À répondre">
              <Pressable
                onPress={() => router.push("/missions")}
                accessibilityRole="button"
                accessibilityLabel={`${invitations.length} invitation${s_(invitations.length)} en attente. Ouvrir Mes missions pour répondre.`}
                style={({ pressed }) => [s.rangeeAction, pressed ? { opacity: 0.85 } : null]}
              >
                <Ionicons name="mail-unread" size={20} color={C.alerteTexte} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.rangeeTitre}>
                    {invitations.length} invitation{s_(invitations.length)} en attente
                  </Text>
                  <Text style={s.rangeeSous}>Répondre avant la date limite</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.texteFaible} />
              </Pressable>
            </Section>
          ) : null}

          {aTerminer.length ? (
            <Section titre="À faire">
              <View style={{ gap: E.s }}>
                {aTerminer.map((x) => (
                  <View key={x.mission.affectationId} style={s.carte}>
                    <View style={{ gap: 3 }}>
                      <Text style={s.nom} numberOfLines={2}>
                        {x.mission.client ?? "Mission SportVision"}
                      </Text>
                      <Text style={s.detail}>
                        {x.mission.date ? dateLongue(x.mission.date) : x.mission.reference}
                      </Text>
                    </View>

                    {/* Ces phrases sortent de `mission_cloture_manquant` : on les pose telles
                        quelles, sans les reformuler ni en déduire une priorité. */}
                    <View style={{ gap: E.xs }}>
                      {x.manque.map((phrase) => (
                        <View key={phrase} style={s.puceLigne}>
                          <View style={s.point} />
                          <Text style={s.manque}>{phrase}</Text>
                        </View>
                      ))}
                    </View>

                    {x.corrections.map((c) => (
                      <View key={c.id} style={s.correction}>
                        <Text style={s.correctionTitre}>Correction demandée</Text>
                        {c.nom ? <Text style={s.correctionLien} numberOfLines={2}>{c.nom}</Text> : null}
                        {c.commentaire ? <Text style={s.correctionTexte}>{c.commentaire}</Text> : null}
                      </View>
                    ))}
                  </View>
                ))}
              </View>
              {/* RÈGLE 5 DU CONTRAT : déclarer une prestation réalisée, cocher « fichiers copiés et
                  vérifiés » ou reposer un lien se font sur la fiche de la mission, dans l'OS.
                  L'application ne sait pas encore dessiner ces écrans, donc elle ne met pas de
                  bouton — elle dit où c'est. */}
              <Text style={s.note}>
                Ces points se règlent sur la fiche de la mission, dans l'OS.
              </Text>
            </Section>
          ) : null}

          {sansCloture ? (
            <Text style={s.note}>
              Ce qu'il vous reste à rendre n'a pas pu être chargé. Tirez vers le bas pour réessayer.
            </Text>
          ) : null}

          {/* ══ LES RACCOURCIS, ET SEULEMENT LES JOURS SANS MISSION ═══════════════════════════
              Fouka, en installant l'application : « l'accueil il fait trop trop vide ». Vu à
              l'écran avec le compte de recette : sous le bandeau de parcours, six cents points de
              noir jusqu'à la barre d'onglets, et rien dedans. Ce n'est pas un cas limite —
              aucun des dix opérateurs n'a de mission à venir.

              CE QU'ON N'A PAS FAIT : inventer un chiffre pour remplir. Pas de graphique, pas de
              « votre semaine en un coup d'œil » construit sur zéro donnée. Ces quatre entrées ne
              mènent qu'à des écrans qui existent déjà dans l'application et que ce rôle peut
              ouvrir : c'est de la navigation, pas du contenu.

              POURQUOI SEULEMENT QUAND IL N'Y A RIEN. L'en-tête de ce fichier pose que le reste de
              l'OS « n'est pas une question qu'on se pose au bord d'un terrain », et c'est vrai le
              jour où l'on a une prestation à lire : ce jour-là, `suivante` existe et ces tuiles
              n'apparaissent pas. Elles ne prennent la place que du vide. */}
          {!suivante ? (
            <Section titre="En attendant">
              <View style={{ gap: E.s }}>
                <View style={s.grille}>
                  <Tuile chemin="/centre" icone="book-outline" titre="Le Centre" sous="Check-lists et fiches" />
                  <Tuile chemin="/messagerie" icone="chatbubbles-outline" titre="Messages" sous="Joindre la production" />
                </View>
                <View style={s.grille}>
                  <Tuile chemin="/livrables" icone="cloud-upload-outline" titre="Mes livrables" sous="Ce que j'ai déposé" />
                  <Tuile chemin="/revenus" icone="cash-outline" titre="Mes revenus" sous="Montants versés" />
                </View>
              </View>
            </Section>
          ) : null}
        </>
      )}
    </Ecran>
  );
}

/**
 * Une tuile de raccourci. Elle ne porte aucun chiffre : un compteur ici voudrait dire une lecture
 * de plus au chargement de l'Accueil, pour une information qu'on lit sur l'écran d'à côté.
 */
function Tuile({
  chemin, icone, titre, sous,
}: {
  chemin: string;
  icone: keyof typeof Ionicons.glyphMap;
  titre: string;
  sous: string;
}) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(chemin as never)}
      accessibilityRole="button"
      accessibilityLabel={`${titre}. ${sous}`}
      style={({ pressed }) => [s.tuile, pressed ? { opacity: 0.8 } : null]}
    >
      <Ionicons name={icone} size={19} color={C.accentClair} />
      {/* `alignSelf: stretch` : sans lui, un texte mesuré hors de sa colonne se tronque trop tôt,
          et le parent est justement une colonne centrée. Défaut déjà payé deux fois. */}
      <Text style={s.tuileTitre} numberOfLines={1}>{titre}</Text>
      <Text style={s.tuileSous} numberOfLines={2}>{sous}</Text>
    </Pressable>
  );
}

/** La prochaine prestation. Même intitulé que l'OS, qui l'appelle « Prochaine prestation ». */
function CarteProchaine({ m }: { m: MaMission }) {
  const router = useRouter();
  const rdv = heureCourte(m.heureRdv);
  const debut = heureCourte(m.heureDebut);
  const couverture = libelleCouverture(m.couverture);
  const enAttente = m.reponse === "invitation_envoyée" || m.reponse === "en_attente";

  return (
    <View style={s.hero}>
      <View style={s.heroHaut}>
        <Text style={s.etiquette}>Prochaine prestation</Text>
        {enAttente ? <Pastille ton="alerte" texte="À répondre" /> : null}
        {m.responsable ? <Pastille ton="info" texte="Responsable" /> : null}
      </View>

      <Text style={s.heroNom} numberOfLines={2}>{m.client ?? "Mission SportVision"}</Text>

      <View style={{ gap: E.xs }}>
        {m.date ? (
          <Ligne icone="calendar-outline" texte={quand(m.date)} />
        ) : null}
        {/* « Rendez-vous » seulement quand la base donne bien une heure de rendez-vous. Sinon on
            annonce l'heure de début sous son vrai nom : 5 affectations sur 10 n'ont pas de rdv. */}
        {rdv ? (
          <Ligne icone="time-outline" texte={`Rendez-vous ${rdv}`} />
        ) : debut ? (
          <Ligne icone="time-outline" texte={`Début ${debut}`} />
        ) : null}
        {m.lieu ? <Ligne icone="location-outline" texte={m.lieu} /> : null}
        {m.fonction ? <Ligne icone="camera-outline" texte={m.fonction} /> : null}
      </View>

      {/* LE BRIEF EST CE QU'ON VIENT LIRE AU BORD DU TERRAIN, avant la rémunération, qui ne change
          rien à ce qu'on fait sur place. Même ordre que la carte de l'onglet « Mes missions ». */}
      {m.brief || m.besoin ? (
        <View style={s.brief}>
          <Text style={s.briefTitre}>Brief</Text>
          <Text style={s.briefTexte}>{m.brief || m.besoin}</Text>
        </View>
      ) : null}

      <View style={s.heroBas}>
        {couverture ? <Pastille texte={couverture} /> : null}
        {m.remuneration !== null ? <Text style={s.remu}>{m.remuneration} €</Text> : null}
      </View>

      {/* LE MODE JOUR J S'OUVRE D'ICI (01/10/2026), comme dans l'OS, où le bouton est sur la carte
          de la prochaine prestation et sur celles du jour (`enterJourJ(p.id)`).

          PAS SUR UNE MISSION QU'ON N'A PAS ENCORE ACCEPTÉE, et ce n'est pas une barrière de
          sécurité : `operateur_affecte_prestation` ne regarde QUE l'existence de l'affectation, pas
          sa réponse — la base laisserait donc quelqu'un se déclarer « en route » sur une invitation
          qu'il n'a pas acceptée. C'est une règle de pertinence : on répond d'abord, on part ensuite.
          Elle est dite, plutôt que de laisser un bouton inexpliqué. */}
      {enAttente ? (
        <Text style={s.heroNote}>Répondez à l'invitation pour ouvrir le Mode Jour J.</Text>
      ) : (
        <Pressable
          onPress={() => router.push({ pathname: "/terrain", params: { prestation: m.prestationId } })}
          accessibilityRole="button"
          accessibilityLabel={`Ouvrir le Mode Jour J de la mission ${m.client ?? "SportVision"}`}
          style={({ pressed }) => [s.jourj, pressed ? { opacity: 0.85 } : null]}
        >
          <Ionicons name="radio-button-on" size={17} color={C.dangerTexte} />
          <Text style={s.jourjTexte}>Mode Jour J</Text>
        </Pressable>
      )}
    </View>
  );
}

function Ligne({ icone, texte }: { icone: keyof typeof Ionicons.glyphMap; texte: string }) {
  return (
    <View style={s.puceLigne}>
      <Ionicons name={icone} size={15} color={C.texteFaible} />
      <Text style={s.detail} numberOfLines={2}>{texte}</Text>
    </View>
  );
}

// ══ LA PRODUCTION ══════════════════════════════════════════════════════════════════════════════

/** Un point à traiter. Le `ton` vient d'un fait de la base, jamais d'une appréciation. */
interface Blocage {
  cle: string;
  ton: "danger" | "alerte" | "info";
  motif: string;
  qui: string;
  quand: string | null;
  detail: string | null;
}

const RANG: Record<Blocage["ton"], number> = { danger: 0, alerte: 1, info: 2 };

function AccueilProduction() {
  const { moi } = useSession();
  const aujourdhui = dateDuJourParis();

  const cockpit = useDonnees<MissionProduction[]>(cleCockpit, lireCockpit, []);
  const cloture = useDonnees<EtatCloture[]>(cleCloture, lireEtatCloture, []);

  const relireTout = useCallback(
    () => { cockpit.relire(); cloture.relire(); },
    [cockpit.relire, cloture.relire],
  );

  const missions = cockpit.donnees ?? [];
  const panne = !!cockpit.erreur && cockpit.donnees === undefined;
  // Sans `cloture`, « À traiter » perdrait les incidents et tout ce qui manque pour clore : la
  // liste raccourcirait sans le dire, ce qui est pire qu'une erreur affichée.
  const sansCloture = !!cloture.erreur && cloture.donnees === undefined;

  // Sept jours, bornes incluses, comptés à Paris comme tout « aujourd'hui » de cette application.
  const dansSeptJours = useMemo(() => {
    const borne = new Date(new Date(`${aujourdhui}T12:00:00`).getTime() + 7 * 86400000);
    const iso = `${borne.getFullYear()}-${String(borne.getMonth() + 1).padStart(2, "0")}-${String(borne.getDate()).padStart(2, "0")}`;
    return missions.filter((m) => m.date && m.date >= aujourdhui && m.date <= iso);
  }, [missions, aujourdhui]);

  const dujour = missions.filter((m) => m.date === aujourdhui);
  const aPlanifier = missions.filter((m) => m.groupe === "a_planifier");
  const sansEcheance = missions.filter((m) => m.echeanceManquante);

  // UN SEUL MOTIF PAR MISSION, LE PLUS GRAVE. Une mission qui apparaîtrait trois fois dans la même
  // liste ferait croire à trois problèmes, et la liste deviendrait plus longue que le travail.
  const blocages = useMemo<Blocage[]>(() => {
    const parPresta = new Map((cloture.donnees ?? []).map((e) => [e.prestationId, e]));
    const liste: Blocage[] = [];

    for (const m of missions) {
      if (m.groupe === "terminees") continue;
      const etat = parPresta.get(m.id);
      const manque = etat?.manque ?? [];
      const passee = !!m.date && m.date < aujourdhui;
      const qui = m.client ?? "Sans client";
      const base = { cle: m.id, qui, quand: m.date };

      if (etat?.incidentOuvert) {
        liste.push({ ...base, ton: "danger", motif: "Incident ouvert", detail: null });
      } else if (m.enRetard) {
        liste.push({ ...base, ton: "danger", motif: "Livraison en retard", detail: null });
      } else if (passee && m.groupe === "terrain") {
        // Une mission restée « sur le terrain » alors que sa date est passée n'est pas une mission
        // en cours : personne ne l'a fait avancer. Mesuré : une, du 19 septembre.
        liste.push({ ...base, ton: "danger", motif: "Toujours sur le terrain", detail: manque.join(" · ") || null });
      } else if (m.groupe === "a_planifier") {
        liste.push({ ...base, ton: "alerte", motif: "À planifier", detail: null });
      } else if (!passee && !m.operateurs) {
        // Le libellé de l'OS, mot pour mot : son compteur « Missions à attribuer » est légendé
        // « aucun opérateur confirmé ». `operateurs` n'agrège que les affectations acceptées.
        liste.push({ ...base, ton: "alerte", motif: "Aucun opérateur confirmé", detail: null });
      } else if (m.groupe === "corrections") {
        liste.push({ ...base, ton: "alerte", motif: "Correction en attente de l'opérateur", detail: manque.join(" · ") || null });
      } else if (passee && manque.length) {
        liste.push({ ...base, ton: "alerte", motif: "À clore", detail: manque.join(" · ") });
      } else if (m.groupe === "a_verifier") {
        liste.push({ ...base, ton: "info", motif: "Livraison à valider", detail: null });
      }
    }

    return liste.sort((a, b) =>
      RANG[a.ton] - RANG[b.ton] || (a.quand ?? "9999").localeCompare(b.quand ?? "9999"));
  }, [missions, cloture.donnees, aujourdhui]);

  // Règle 8 : on ne déroule pas une liste sans fin sur un téléphone. Dix missions aujourd'hui, mais
  // le plafond doit exister avant le jour où il y en aura deux cents.
  const PLAFOND = 8;
  const visibles = blocages.slice(0, PLAFOND);
  const reste = blocages.length - visibles.length;

  const sousTitre = dujour.length
    ? `${dujour.length} prestation${s_(dujour.length)} aujourd'hui.`
    : dansSeptJours.length
      ? `Aucune prestation aujourd'hui. ${dansSeptJours.length} dans les 7 prochains jours.`
      : "Aucune prestation aujourd'hui, ni dans les 7 prochains jours.";

  return (
    <Ecran enCours={cockpit.rafraichissement} teinte="bleu" rafraichir={relireTout}>
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Bonjour {moi?.prenom || ""}</Text>
        <Text style={s.sous}>{sousTitre}</Text>
      </View>

      {cockpit.chargement ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : panne ? (
        <Probleme surReessayer={relireTout} />
      ) : (
        <>
          <View style={s.compteurs}>
            <Compteur valeur={dujour.length} libelle="Aujourd'hui" />
            <Compteur valeur={dansSeptJours.length} libelle="7 prochains jours" />
            <Compteur valeur={aPlanifier.length} libelle="À planifier" />
          </View>

          <Section titre="Aujourd'hui">
            {dujour.length ? (
              <View style={{ gap: E.s }}>
                {dujour.map((m) => <CarteJournee key={m.id} m={m} />)}
              </View>
            ) : (
              <Vide
                titre="Aucune prestation aujourd'hui"
                texte={
                  dansSeptJours.length
                    ? `${dansSeptJours.length} mission${s_(dansSeptJours.length)} ${dansSeptJours.length > 1 ? "sont programmées" : "est programmée"} dans les 7 prochains jours. Elles sont dans l'onglet Production.`
                    : "Rien n'est programmé cette semaine. Les prestations arrivent ici dès qu'une date est posée."
                }
              />
            )}
          </Section>

          {blocages.length ? (
            <Section titre="À traiter">
              <View style={{ gap: E.s }}>
                {visibles.map((b) => (
                  <View key={b.cle} style={s.carte}>
                    <View style={s.ligne}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={s.nom} numberOfLines={1}>{b.qui}</Text>
                        {b.quand ? <Text style={s.detail}>{dateLongue(b.quand)}</Text> : null}
                      </View>
                      <Pastille ton={b.ton} texte={b.motif} />
                    </View>
                    {b.detail ? <Text style={s.manque}>{b.detail}</Text> : null}
                  </View>
                ))}
              </View>
              {reste > 0 ? (
                <Text style={s.note}>
                  {reste} autre{s_(reste)} point{s_(reste)} à traiter, dans l'onglet Production.
                </Text>
              ) : null}
            </Section>
          ) : sansCloture ? (
            <Vide
              titre="« À traiter » n'a pas pu être chargé"
              texte="Les incidents et ce qui manque pour clore les missions n'ont pas pu être lus. Tirez vers le bas pour réessayer."
            />
          ) : (
            <Vide
              titre="Rien à traiter"
              texte="Aucun incident, aucune livraison en retard, aucune mission sans opérateur. Le détail mission par mission est dans l'onglet Production."
            />
          )}

          {/* POURQUOI « LIVRAISON EN RETARD » VAUT FAUX PARTOUT. La vue compare la date du jour à
              `deadline_photo_at` / `deadline_video_at`, et ces deux colonnes sont NULL sur
              9 missions sur 10 (mesuré le 30/09) : sans échéance, aucun retard ne peut être
              détecté. Le dire une fois vaut mieux qu'une pastille « Échéance manquante » répétée
              sur presque chaque carte. */}
          {sansEcheance.length ? (
            <Text style={s.note}>
              {sansEcheance.length} mission{s_(sansEcheance.length)} sans échéance de livraison :
              tant qu'elle n'est pas posée, aucun retard de livraison ne peut être signalé.
            </Text>
          ) : null}
        </>
      )}
    </Ecran>
  );
}

function Compteur({ valeur, libelle }: { valeur: number; libelle: string }) {
  return (
    <View style={s.compteur}>
      <Text style={s.compteurValeur}>{valeur}</Text>
      <Text style={s.compteurLibelle} numberOfLines={2}>{libelle}</Text>
    </View>
  );
}

function CarteJournee({ m }: { m: MissionProduction }) {
  const couverture = libelleCouverture(m.couverture);
  return (
    <View style={s.carte}>
      <View style={s.ligne}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.nom} numberOfLines={1}>{m.client ?? "Sans client"}</Text>
          <Text style={s.detail} numberOfLines={2}>
            {[heureCourte(m.heureRdv ?? m.heureDebut), m.lieu].filter(Boolean).join(" · ")}
          </Text>
        </View>
        {m.prete ? <Pastille ton="succes" texte="Prête" /> : null}
      </View>
      <Text style={s.operateurs} numberOfLines={2}>
        {m.operateurs || "Aucun opérateur affecté"}
      </Text>
      {couverture ? (
        <View style={s.heroBas}><Pastille texte={couverture} /></View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  entete: { flexDirection: "row", alignItems: "center", gap: E.m },
  titre: { color: C.texte, fontFamily: P.titre, fontSize: T.titreEcran, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.sousEcran, lineHeight: T.sousEcranHauteur },
  attente: { paddingVertical: E.xl * 2, alignItems: "center" },

  grille: { flexDirection: "row", gap: E.s },
  tuile: {
    flex: 1, gap: E.xs, padding: E.m, minHeight: TOUCHE * 2, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  tuileTitre: { alignSelf: "stretch", color: C.texte, fontFamily: P.texteFort, fontSize: T.detail },
  tuileSous: { alignSelf: "stretch", color: C.texteFaible, fontFamily: P.texte, fontSize: T.note, lineHeight: T.noteHauteur },

  hero: {
    gap: E.s, padding: E.m, borderRadius: R.xl,
    backgroundColor: "rgba(36,84,255,.10)", borderWidth: 1, borderColor: "rgba(36,84,255,.32)",
  },
  heroHaut: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: E.s },
  heroNom: { color: C.texte, fontFamily: P.titre, fontSize: 20, letterSpacing: -0.4 },
  heroBas: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: E.s },
  etiquette: {
    flex: 1, color: C.cyan, fontFamily: P.texteFort, fontSize: 11,
    textTransform: "uppercase", letterSpacing: 1,
  },

  carte: {
    gap: E.s, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  ligne: { flexDirection: "row", alignItems: "flex-start", gap: E.s },
  nom: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  detail: { flex: 1, color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  operateurs: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13 },
  puceLigne: { flexDirection: "row", alignItems: "flex-start", gap: E.s },
  point: { width: 5, height: 5, borderRadius: R.pill, backgroundColor: C.texteFaible, marginTop: 7 },
  manque: { flex: 1, color: C.texteDoux, fontFamily: P.texte, fontSize: 13, lineHeight: 19 },
  note: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },

  brief: {
    gap: 3, padding: E.s, borderRadius: R.m,
    backgroundColor: "rgba(0,199,255,.08)", borderWidth: 1, borderColor: "rgba(0,199,255,.26)",
  },
  briefTitre: { color: C.cyan, fontFamily: P.texteFort, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 },
  briefTexte: { color: C.texte, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  remu: { color: C.texte, fontFamily: P.titreFort, fontSize: 15 },

  // Le rouge du Mode Jour J, celui de l'OS (`var(--er)` sur ses deux boutons « 🔴 Mode Jour J »).
  // C'est le seul rouge de l'application qui ne signale pas une erreur : il dit « en direct ».
  jourj: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: E.xs,
    minHeight: TOUCHE, borderRadius: R.m,
    backgroundColor: "rgba(240,68,94,.12)", borderWidth: 1, borderColor: "rgba(240,68,94,.34)",
  },
  jourjTexte: { color: C.dangerTexte, fontFamily: P.texteFort, fontSize: 14.5 },
  heroNote: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },

  correction: {
    gap: 3, padding: E.s, borderRadius: R.m,
    backgroundColor: "rgba(240,68,94,.09)", borderWidth: 1, borderColor: "rgba(240,68,94,.30)",
  },
  correctionTitre: { color: C.dangerTexte, fontFamily: P.texteFort, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 },
  correctionLien: { color: C.texte, fontFamily: P.texteMoyen, fontSize: 13 },
  correctionTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },

  rangeeAction: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    minHeight: TOUCHE + 8, padding: E.m, borderRadius: R.l,
    backgroundColor: "rgba(232,163,61,.10)", borderWidth: 1, borderColor: "rgba(232,163,61,.30)",
  },
  rangeeTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: 15 },
  rangeeSous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 12.5 },

  compteurs: { flexDirection: "row", gap: E.s },
  compteur: {
    flex: 1, gap: 2, paddingVertical: E.s, paddingHorizontal: E.s, borderRadius: R.m,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  compteurValeur: { color: C.texte, fontFamily: P.titre, fontSize: 22, letterSpacing: -0.5 },
  compteurLibelle: { color: C.texteFaible, fontFamily: P.texteMoyen, fontSize: 11.5, lineHeight: 15 },
});
