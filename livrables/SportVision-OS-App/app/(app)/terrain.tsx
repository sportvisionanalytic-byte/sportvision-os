// LE MODE JOUR J (01/10/2026). L'écran `#mob-jourj` de l'OS, dessiné par l'application.
//
// C'EST LE SEUL ÉCRAN OÙ LE TÉLÉPHONE VAUT MIEUX QUE L'ORDINATEUR. Tout le reste de l'OS se
// consulte aussi bien assis ; ici, l'opérateur est debout au bord d'un terrain, il vient de garer
// sa voiture, il a une main libre. Trois choses seulement comptent : où il va, ce qu'il doit avoir
// dans son sac, et le bouton qui dit à la Production où il en est.
//
// LE GESTE EST EN BAS, TOUJOURS AU MÊME ENDROIT. L'OS le fixe dans un pied de page (`.jj-m-foot`)
// et il a raison : c'est le seul bouton de l'écran, il doit être sous le pouce sans qu'on cherche.
// Il ne défile pas avec le contenu.
//
// UNE SEULE ACTION À LA FOIS, ET C'EST LA BASE QUI LA DÉSIGNE. Pas de liste d'étapes à cocher dans
// l'ordre qu'on veut : à chaque statut correspond un geste, celui que le déclencheur
// `protect_prestation_operational_fields` accepte. Les 14 transitions du parcours ont été tentées
// une par une avec le jeton d'un vrai opérateur avant d'écrire cet écran (voir `os-terrain.ts`).
//
// CE QUI N'EST PAS ICI, ET POURQUOI :
//
//   · L'ÉQUIPE. Mesuré : un opérateur ne lit que SA ligne de `prestations_equipe`. Le bloc
//     « Équipe » de l'OS web lui affiche donc toujours une équipe d'une personne, lui-même.
//   · LE MATÉRIEL DANS LE SIGNALEMENT D'INCIDENT. `materiel_incidents` est fermée aux opérateurs.
//   · LA SUITE APRÈS LA PRESTATION (sécuriser, déposer les liens, la post-production). Elle a ses
//     propres garde-fous en base et son propre écran dans l'OS. On dit où elle continue, on ne
//     fait pas semblant de la porter.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { Probleme, Section, Vide } from "../../src/ui/Ecran";
import { Bouton, Champ, Erreur, Pastille } from "../../src/ui/Base";
import { Lueur } from "../../src/ui/Fond";
import { retourner } from "../../src/lib/retour";
import { useSession } from "../../src/lib/session";
import { libelleCouverture } from "../../src/lib/os-missions";
import { clePlanning } from "../../src/lib/os-planning";
import {
  actionSuivante, avancer, checklistAvant, cleTerrain, cocherCase, declarerIncident,
  enregistrerNotes, enregistrerRapport, libelleEtat, lireFicheTerrain, marquerBriefingLu,
  prestationRealisee, puisJeAgirSurLaMission,
  type FicheTerrain, type NiveauIncident,
} from "../../src/lib/os-terrain";
import { oublier, useDonnees } from "../../src/lib/cache";
import { dateLongue, heureCourte } from "../../src/lib/dates";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P } from "../../src/theme/polices";

export default function Terrain() {
  const { moi } = useSession();
  const { prestation } = useLocalSearchParams<{ prestation?: string }>();
  const moiId = moi?.id ?? null;
  const prestationId = typeof prestation === "string" && prestation ? prestation : null;
  const insets = useSafeAreaInsets();

  const { donnees, chargement, rafraichissement, erreur, relire } = useDonnees<FicheTerrain | null>(
    prestationId && moiId ? cleTerrain(prestationId, moiId) : null,
    () => lireFicheTerrain(prestationId as string, moiId as string),
    [prestationId, moiId],
  );

  // LA RÈGLE 5, DEMANDÉE À LA BASE ET PAS DÉDUITE DE L'ÉCRAN. `operateur_affecte_prestation` est la
  // fonction que la policy `mso_operateur` utilise elle-même. Tant qu'elle n'a pas répondu, aucun
  // bouton d'action ne s'affiche : un bouton qui apparaît puis disparaît est pire qu'un bouton lent.
  const [autorise, setAutorise] = useState<boolean | null>(null);
  useEffect(() => {
    let vivant = true;
    if (!prestationId) { setAutorise(false); return; }
    puisJeAgirSurLaMission(prestationId).then((v) => { if (vivant) setAutorise(v); });
    return () => { vivant = false; };
  }, [prestationId]);

  // Ouvrir l'écran, c'est avoir lu le briefing : c'est ce que fait l'OS, et c'est ce que la
  // Production lit dans « Prête ». Muet par construction (voir `marquerBriefingLu`).
  useEffect(() => { if (prestationId) void marquerBriefingLu(prestationId); }, [prestationId]);

  const [souci, setSouci] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [bascule, setBascule] = useState(false);

  const fiche = donnees ?? null;
  const panne = !!erreur && donnees === undefined;

  // Après toute écriture, la fiche ET le planning sont faux : « Mes missions », « Mon planning » et
  // l'accueil lisent le statut de la mission. Les oublier un par un se serait oublié un jour.
  const relireTout = useCallback(() => {
    if (moiId) oublier(clePlanning(moiId));
    oublier("os:cloture");
    relire();
  }, [moiId, relire]);

  const etape = fiche ? actionSuivante(fiche.statut) : null;
  const realisee = fiche ? prestationRealisee(fiche.statut) : false;

  async function surAvancer() {
    if (!fiche || !etape || !moiId) return;
    setEnCours(true); setSouci(null); setBascule(false);
    try {
      await avancer(fiche.prestationId, moiId, etape);
      if (etape.bascule) setBascule(true);
      relireTout();
    } catch (e) {
      setSouci(e instanceof Error ? e.message : "L'étape n'a pas été enregistrée.");
      // Même quand ça échoue on relit : si la mission a changé d'état de son côté, le bouton
      // suivant doit être le bon avant le prochain appui.
      relireTout();
    } finally { setEnCours(false); }
  }

  if (!prestationId) {
    return (
      <Cadre insets={insets}>
        <Vide
          titre="Aucune mission ouverte"
          texte="Ouvrez le Mode Jour J depuis une mission de votre planning ou de votre accueil."
        />
      </Cadre>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.fond }}>
      <Lueur teinte="cyan" />

      {/* La barre du haut de l'OS : un retour, un titre, et rien d'autre. Elle ne défile pas —
          on doit pouvoir sortir de cet écran depuis n'importe quel point du défilement. */}
      <View style={[s.barre, { paddingTop: insets.top + E.s }]}>
        <Pressable
          onPress={() => retourner("/accueil")}
          accessibilityRole="button"
          accessibilityLabel="Revenir à l'accueil"
          hitSlop={10}
          style={({ pressed }) => [s.retour, pressed ? { opacity: 0.7 } : null]}
        >
          <Ionicons name="chevron-back" size={20} color={C.texteDoux} />
          <Text style={s.retourTexte}>Retour</Text>
        </Pressable>
        <Text style={s.barreTitre}>Mode Jour J</Text>
        <View style={{ width: 72 }} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: E.l,
          // La barre d'onglets est retirée sur cette route (voir `_layout.tsx`) : il ne reste à
          // dégager que la hauteur du pied de page, et seulement quand il existe. `TOUCHE + 8` est
          // la hauteur d'un `Bouton` de `Base.tsx`, pas un nombre choisi à l'œil.
          paddingBottom: insets.bottom + (etape && autorise ? TOUCHE + 8 + E.l * 2 : E.xl),
          gap: E.l,
        }}
      >
        {chargement ? (
          <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
        ) : panne ? (
          <Probleme surReessayer={relireTout} />
        ) : !fiche ? (
          <Vide
            titre="Cette mission n'est pas la vôtre"
            texte="Vous n'avez pas d'affectation sur cette prestation. Si vous devriez en avoir une, demandez à la production de vous affecter."
          />
        ) : (
          <>
            <Entete fiche={fiche} />

            {souci ? <Erreur message={souci} /> : null}

            {/* LA PHRASE D'APRÈS-MATCH, VALIDÉE MOT POUR MOT PAR FOUKA LE 09/09. Elle existe parce
                que la couverture terrain peut être finie sans que la mission le soit — et un
                opérateur qui lit « match fini » comme « mission finie » repart sans sécuriser ses
                fichiers. */}
            {bascule ? (
              <View style={s.bascule}>
                <Text style={s.basculeTitre}>La couverture terrain est terminée.</Text>
                <Text style={s.basculeTexte}>
                  Votre mission SportVision reste ouverte jusqu'à la sécurisation des fichiers, la
                  livraison et la validation Production. Ces étapes se font dans l'OS, sur
                  ordinateur : cette application ne les porte pas encore.
                </Text>
              </View>
            ) : null}

            <InfosTerrain fiche={fiche} />

            {/* La check-list ne sert plus une fois la prestation faite : on la garde visible en
                lecture, mais elle passe derrière le reste. */}
            {!realisee && moiId ? (
              <Checklist fiche={fiche} moiId={moiId} apresEcriture={relireTout} />
            ) : null}

            {fiche.besoin || fiche.livrables ? <Brief fiche={fiche} /> : null}

            {autorise && moiId ? (
              <>
                <Rapport fiche={fiche} moiId={moiId} apresEcriture={relireTout} />
                <Incident fiche={fiche} moiId={moiId} apresEcriture={relireTout} />
              </>
            ) : autorise === false ? (
              <Vide
                titre="Aucune action sur cette mission"
                texte="La base ne vous reconnaît pas comme opérateur affecté à cette prestation. Demandez à la production de vérifier votre affectation."
              />
            ) : null}

            {realisee && moiId ? (
              <Checklist fiche={fiche} moiId={moiId} apresEcriture={relireTout} />
            ) : null}
          </>
        )}
      </ScrollView>

      {/* LE PIED DE PAGE N'EXISTE QUE S'IL Y A UN GESTE, et seulement quand la base a confirmé
          qu'il est permis. Aucune étape au-delà de « Prestation terminée » : la suite se fait
          ailleurs, et on le dit dans l'écran plutôt que de poser un bouton qui échouerait. */}
      {fiche && etape && autorise ? (
        <View style={[s.pied, { paddingBottom: insets.bottom + E.s }]}>
          <Bouton
            titre={etape.libelle}
            onPress={surAvancer}
            enCours={enCours}
            icone={<Ionicons name={etape.icone as never} size={18} color="#fff" />}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Le même cadre que l'écran, pour les cas où il n'y a rien à charger. */
function Cadre({ insets, children }: { insets: { top: number; bottom: number }; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.fond }}>
      <Lueur teinte="cyan" />
      <View style={[s.barre, { paddingTop: insets.top + E.s }]}>
        <Pressable onPress={() => retourner("/accueil")} accessibilityRole="button" accessibilityLabel="Revenir à l'accueil" hitSlop={10} style={s.retour}>
          <Ionicons name="chevron-back" size={20} color={C.texteDoux} />
          <Text style={s.retourTexte}>Retour</Text>
        </Pressable>
        <Text style={s.barreTitre}>Mode Jour J</Text>
        <View style={{ width: 72 }} />
      </View>
      <View style={{ paddingHorizontal: E.l }}>{children}</View>
    </View>
  );
}

// ── L'en-tête : où j'en suis ────────────────────────────────────────────────────────────────────

function Entete({ fiche }: { fiche: FicheTerrain }) {
  const realisee = prestationRealisee(fiche.statut);
  return (
    <View style={s.hero}>
      <Text style={s.heroEtiquette}>
        {realisee ? "Prestation réalisée" : "Prestation en cours"}
      </Text>
      <Text style={s.heroNom} numberOfLines={2}>{fiche.client ?? "Mission SportVision"}</Text>
      <Text style={s.heroDetail}>
        {[fiche.format, fiche.date ? dateLongue(fiche.date) : null].filter(Boolean).join(" · ")}
      </Text>
      <View style={s.heroBas}>
        {/* L'état est dit EN MOT, jamais par une couleur seule. Et c'est le mot de l'opérateur :
            « En cours de vérification » plutôt que « Prêt validation », qui est du vocabulaire
            d'atelier (décision de l'OS le 13/09, reprise telle quelle). */}
        <Pastille ton={realisee ? "succes" : "info"} texte={libelleEtat(fiche.statut)} />
        {fiche.responsable ? <Pastille ton="info" texte="Responsable" /> : null}
        {libelleCouverture(fiche.couverture) ? <Pastille texte={libelleCouverture(fiche.couverture)!} /> : null}
      </View>
      <Text style={s.heroRef}>{fiche.reference}</Text>
    </View>
  );
}

// ── Les infos terrain ───────────────────────────────────────────────────────────────────────────

function InfosTerrain({ fiche }: { fiche: FicheTerrain }) {
  const heure = heureCourte(fiche.heure);
  // MESURÉ : `adresse_complete` est NULL sur les 10 prestations. L'itinéraire de l'OS, qui ne
  // s'ouvre que sur l'adresse, ne s'est donc jamais affiché. `lieu`, lui, est rempli 10 fois sur 10
  // et porte un nom de stade complet — « STADE PHILIPPE MAHUT 2 - FONTAINEBLEAU ». On l'ouvre donc,
  // mais en disant ce qu'on fait : CHERCHER un lieu, et non tracer un itinéraire vers une adresse
  // qu'on n'a pas. Les deux mots n'engagent pas la même confiance.
  const cible = fiche.adresse ?? fiche.lieu;
  const tel = fiche.telephone?.replace(/[\s\-().]/g, "") ?? null;

  function ouvrirPlan() {
    if (!cible) return;
    const q = encodeURIComponent(cible);
    const url = Platform.OS === "ios" ? `maps://?q=${q}` : `geo:0,0?q=${q}`;
    Linking.openURL(url).catch(() => Linking.openURL(`https://maps.google.com/?q=${q}`).catch(() => {}));
  }

  return (
    <Section titre="Infos terrain">
      <View style={s.bloc}>
        {heure ? (
          <Rangee
            icone="time-outline"
            // Le mot change avec ce que la base sait : 5 affectations sur 10 n'ont pas d'heure de
            // rendez-vous, et annoncer un début comme un rendez-vous fait arriver en retard.
            libelle={fiche.heureEstUnDebut ? "Début de la prestation" : "Rendez-vous équipe"}
            valeur={heure}
            grand
          />
        ) : null}
        {fiche.lieu ? <Rangee icone="location-outline" libelle="Lieu" valeur={fiche.lieu} /> : null}
        {fiche.contact ? (
          <Rangee
            icone="person-outline"
            libelle="Contact sur place"
            valeur={fiche.contact}
            action={tel ? { icone: "call", libelle: `Appeler ${fiche.contact}`, surPress: () => Linking.openURL(`tel:${tel}`).catch(() => {}) } : undefined}
          />
        ) : null}
        {fiche.fonction ? <Rangee icone="camera-outline" libelle="Ma fonction" valeur={fiche.fonction} /> : null}

        {cible ? (
          <Pressable
            onPress={ouvrirPlan}
            accessibilityRole="button"
            accessibilityLabel={fiche.adresse ? "Ouvrir l'itinéraire" : `Chercher ${fiche.lieu} dans le plan`}
            style={({ pressed }) => [s.lien, pressed ? { opacity: 0.85 } : null]}
          >
            <Ionicons name="navigate" size={17} color={C.accentClair} />
            <Text style={s.lienTexte}>
              {fiche.adresse ? "Ouvrir l'itinéraire" : "Chercher ce lieu dans le plan"}
            </Text>
          </Pressable>
        ) : null}

        {/* CE QUI MANQUE SE DIT, UNE FOIS, ET SEULEMENT SI ÇA CHANGE QUELQUE CHOSE (règle 7).
            L'adresse exacte est absente des 10 prestations : l'opérateur doit le savoir AVANT de
            partir, parce que la seule solution est d'appeler. Le contact sur place étant lui aussi
            vide sur les 10, la phrase dit qui appeler pour de vrai. */}
        {!fiche.adresse ? (
          <Text style={s.manque}>
            L'adresse exacte n'est pas renseignée pour cette mission. Le nom du lieu ci-dessus est
            le seul repère : vérifiez-le avec la production avant de partir.
          </Text>
        ) : null}
      </View>
    </Section>
  );
}

function Rangee({
  icone, libelle, valeur, grand, action,
}: {
  icone: string; libelle: string; valeur: string; grand?: boolean;
  action?: { icone: string; libelle: string; surPress: () => void };
}) {
  return (
    <View style={s.rangee}>
      <Ionicons name={icone as never} size={19} color={C.texteFaible} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={s.rangeeLibelle}>{libelle}</Text>
        <Text style={grand ? s.rangeeValeurGrande : s.rangeeValeur}>{valeur}</Text>
      </View>
      {action ? (
        <Pressable
          onPress={action.surPress}
          accessibilityRole="button"
          accessibilityLabel={action.libelle}
          style={({ pressed }) => [s.appel, pressed ? { opacity: 0.85 } : null]}
        >
          <Ionicons name={action.icone as never} size={18} color={C.succesTexte} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ── La check-list d'avant-match ─────────────────────────────────────────────────────────────────

function Checklist({
  fiche, moiId, apresEcriture,
}: { fiche: FicheTerrain; moiId: string; apresEcriture: () => void }) {
  const cases = useMemo(() => checklistAvant(fiche.couverture), [fiche.couverture]);
  const etapes = fiche.suivi?.etapes ?? {};
  const [enCours, setEnCours] = useState<string | null>(null);
  const [souci, setSouci] = useState<string | null>(null);
  const faites = cases.filter((c) => etapes[c.cle]?.fait === true).length;

  async function basculer(cle: string, coche: boolean) {
    setEnCours(cle); setSouci(null);
    try {
      await cocherCase(fiche.prestationId, moiId, cle, coche, etapes);
      apresEcriture();
    } catch (e) {
      setSouci(e instanceof Error ? e.message : "La case n'a pas été enregistrée.");
    } finally { setEnCours(null); }
  }

  return (
    <Section
      titre="Check-list avant départ"
      action={<Text style={s.compte}>{faites} / {cases.length}</Text>}
    >
      <View style={s.bloc}>
        {souci ? <Erreur message={souci} /> : null}
        {cases.map((c) => {
          const cochee = etapes[c.cle]?.fait === true;
          return (
            <Pressable
              key={c.cle}
              onPress={() => basculer(c.cle, !cochee)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: cochee, busy: enCours === c.cle }}
              accessibilityLabel={c.libelle}
              style={({ pressed }) => [s.caseRangee, pressed ? { opacity: 0.8 } : null]}
            >
              <View style={[s.coche, cochee && s.cocheFaite]}>
                {enCours === c.cle
                  ? <ActivityIndicator size="small" color={C.texteDoux} />
                  : cochee ? <Ionicons name="checkmark" size={15} color={C.succes} /> : null}
              </View>
              <Text style={[s.caseTexte, cochee && s.caseTexteFaite]}>{c.libelle}</Text>
            </Pressable>
          );
        })}
        {/* L'OS web garde ces cases dans le `localStorage` du navigateur : la Production ne les voit
            jamais et elles disparaissent avec le cache. Ici elles vont dans la base, et il faut le
            dire — c'est ce qui justifie de les cocher. */}
        <Text style={s.manque}>
          Ces cases sont enregistrées sur votre mission : la production les voit.
        </Text>
      </View>
    </Section>
  );
}

// ── Le brief ────────────────────────────────────────────────────────────────────────────────────

function Brief({ fiche }: { fiche: FicheTerrain }) {
  return (
    <Section titre="Brief">
      <View style={s.brief}>
        {fiche.besoin ? (
          <View style={{ gap: 3 }}>
            <Text style={s.briefLibelle}>Besoin client</Text>
            <Text style={s.briefTexte}>{fiche.besoin}</Text>
          </View>
        ) : null}
        {/* Mesuré NULL sur les 10 prestations : ce bloc ne s'affichera pas aujourd'hui, et c'est
            pour ça qu'il n'y a pas de « Livrables non renseignés » à la place. */}
        {fiche.livrables ? (
          <View style={{ gap: 3 }}>
            <Text style={s.briefLibelle}>Livrables attendus</Text>
            <Text style={s.briefTexte}>{fiche.livrables}</Text>
          </View>
        ) : null}
      </View>
    </Section>
  );
}

// ── Le rapport de mission ───────────────────────────────────────────────────────────────────────

const nombre = (t: string): number | null => {
  const v = parseFloat(t.replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

function Rapport({
  fiche, moiId, apresEcriture,
}: { fiche: FicheTerrain; moiId: string; apresEcriture: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [heures, setHeures] = useState(fiche.heuresDeclarees?.toString() ?? "");
  const [km, setKm] = useState(fiche.kmDeclares?.toString() ?? "");
  const [frais, setFrais] = useState(fiche.fraisDeclares?.toString() ?? "");
  const [notes, setNotes] = useState(fiche.notesDeclaration ?? "");
  const [libres, setLibres] = useState(fiche.suivi?.notes ?? "");
  const [enCours, setEnCours] = useState(false);
  const [souci, setSouci] = useState<string | null>(null);
  const [fait, setFait] = useState(false);

  const deja = fiche.heuresDeclarees !== null;

  async function envoyer() {
    const h = nombre(heures);
    // Le seul champ obligatoire, comme dans l'OS : c'est la valeur que la Production attend.
    if (h === null || h <= 0) { setSouci("Indiquez le nombre d'heures travaillées."); return; }
    if (h > 24) { setSouci("Le nombre d'heures ne peut pas dépasser 24."); return; }
    setEnCours(true); setSouci(null); setFait(false);
    try {
      await enregistrerRapport(fiche.affectationId, {
        heures: h,
        // Un champ vidé écrit `null` et non « rien » : l'OS n'écrit que les valeurs > 0, si bien
        // qu'un kilométrage saisi par erreur ne pouvait plus être effacé.
        km: km.trim() ? nombre(km) : null,
        frais: frais.trim() ? nombre(frais) : null,
        notes: notes.trim() || null,
      });
      // Les notes libres vivent dans `mission_suivi_operateur`, pas dans l'affectation : deux
      // écritures, donc, et la seconde ne doit pas faire croire que la première a échoué.
      const avant = fiche.suivi?.notes ?? "";
      if (libres.trim() !== avant.trim()) {
        try { await enregistrerNotes(fiche.prestationId, moiId, libres.trim() || null); }
        catch {
          setSouci("Heures, kilomètres et frais enregistrés. Vos notes de mission, elles, n'ont pas pu l'être.");
          apresEcriture();
          return;
        }
      }
      setFait(true);
      apresEcriture();
    } catch (e) {
      setSouci(e instanceof Error ? e.message : "Le rapport n'a pas été enregistré.");
    } finally { setEnCours(false); }
  }

  return (
    <Section
      titre="Mon rapport de mission"
      action={deja ? <Text style={s.compteOk}>{fiche.heuresDeclarees} h déclarées</Text> : null}
    >
      <View style={s.bloc}>
        {!ouvert ? (
          <>
            <Text style={s.blocTexte}>
              {deja
                ? "Vos heures sont déclarées. Vous pouvez les corriger tant que la production n'a pas réglé la mission."
                : "Ce que vous déclarez ici part à la production : heures travaillées, kilomètres et frais. La rémunération, elle, reste fixée par la production."}
            </Text>
            <Bouton
              titre={deja ? "Corriger mon rapport" : "Déclarer mes heures"}
              onPress={() => setOuvert(true)}
              secondaire
            />
          </>
        ) : (
          <View style={{ gap: E.m }}>
            {souci ? <Erreur message={souci} /> : null}
            {fait ? <Text style={s.confirme}>Rapport enregistré.</Text> : null}
            <View style={s.deuxColonnes}>
              <View style={{ flex: 1 }}>
                <Champ
                  label="Heures travaillées *"
                  value={heures}
                  onChangeText={setHeures}
                  keyboardType="decimal-pad"
                  placeholder="Ex : 4,5"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Champ
                  label="Km parcourus"
                  value={km}
                  onChangeText={setKm}
                  keyboardType="number-pad"
                  placeholder="Ex : 45"
                />
              </View>
            </View>
            <Champ
              label="Frais divers (€)"
              value={frais}
              onChangeText={setFrais}
              keyboardType="decimal-pad"
              placeholder="Stationnement, péage…"
            />
            <Champ
              label="Précisions sur les heures ou les frais"
              value={notes}
              onChangeText={setNotes}
              multiline
              hauteur={84}
              placeholder="Facultatif"
            />
            {/* CE CHAMP N'EXISTE NULLE PART DANS L'OS, ET C'EST POURQUOI IL EST VIDE EN BASE.
                `mission_suivi_operateur.notes` est là depuis le 09/09 et vaut NULL sur les 9
                lignes : aucun écran ne l'a jamais proposé. C'est le seul endroit où l'opérateur
                peut raconter sa mission autrement qu'en déclarant un incident. */}
            <Champ
              label="Comment s'est passée la mission"
              value={libres}
              onChangeText={setLibres}
              multiline
              hauteur={96}
              placeholder="Ce que la production gagnerait à savoir : conditions, accueil du club, ce qui a manqué…"
            />
            <View style={s.deuxColonnes}>
              <View style={{ flex: 1 }}>
                <Bouton titre="Annuler" onPress={() => { setOuvert(false); setSouci(null); }} secondaire />
              </View>
              <View style={{ flex: 1 }}>
                <Bouton titre="Enregistrer" onPress={envoyer} enCours={enCours} />
              </View>
            </View>
          </View>
        )}
      </View>
    </Section>
  );
}

// ── Le signalement d'incident ───────────────────────────────────────────────────────────────────

const NIVEAUX: { cle: NiveauIncident; libelle: string }[] = [
  { cle: "mineur", libelle: "Mineur" },
  { cle: "important", libelle: "Important" },
  { cle: "critique", libelle: "Critique" },
];

function Incident({
  fiche, moiId, apresEcriture,
}: { fiche: FicheTerrain; moiId: string; apresEcriture: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [texte, setTexte] = useState("");
  const [niveau, setNiveau] = useState<NiveauIncident>("mineur");
  const [enCours, setEnCours] = useState(false);
  const [souci, setSouci] = useState<string | null>(null);
  const [fait, setFait] = useState(false);

  async function envoyer() {
    const d = texte.trim();
    if (!d) { setSouci("Décrivez l'incident."); return; }
    setEnCours(true); setSouci(null);
    try {
      await declarerIncident(fiche.prestationId, moiId, d, niveau);
      setFait(true); setOuvert(false); setTexte(""); setNiveau("mineur");
      apresEcriture();
    } catch (e) {
      setSouci(e instanceof Error ? e.message : "Le signalement n'est pas parti.");
    } finally { setEnCours(false); }
  }

  return (
    <Section
      titre="Un problème sur place"
      action={fiche.incidentsOuverts
        ? <Text style={s.compteAlerte}>{fiche.incidentsOuverts} signalé{fiche.incidentsOuverts > 1 ? "s" : ""}</Text>
        : null}
    >
      <View style={s.bloc}>
        {fait ? <Text style={s.confirme}>Incident signalé. La production est prévenue.</Text> : null}
        {!ouvert ? (
          <>
            <Text style={s.blocTexte}>
              {/* La phrase du Centre SportVision, mot pour mot : « Production préfère un retard
                  annoncé à un silence. » */}
              Retard, terrain fermé, matériel en panne, accès refusé. Production préfère un retard
              annoncé à un silence.
            </Text>
            <Bouton titre="Signaler un incident" onPress={() => setOuvert(true)} secondaire />
          </>
        ) : (
          <View style={{ gap: E.m }}>
            {souci ? <Erreur message={souci} /> : null}
            <Champ
              label="Description"
              value={texte}
              onChangeText={setTexte}
              multiline
              hauteur={96}
              placeholder="Décrivez l'incident…"
            />
            <View style={{ gap: E.xs }}>
              <Text style={s.label}>Niveau</Text>
              {/* Trois valeurs, trois cibles de 44 points : un sélecteur déroulant sur téléphone
                  demande deux gestes pour trois choix. Les libellés sont ceux de
                  l'énumération `niveau_incident` de la base. */}
              <View style={s.deuxColonnes}>
                {NIVEAUX.map((n) => {
                  const actif = n.cle === niveau;
                  return (
                    <Pressable
                      key={n.cle}
                      onPress={() => setNiveau(n.cle)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: actif }}
                      accessibilityLabel={`Niveau ${n.libelle}`}
                      style={[s.niveau, actif && s.niveauActif]}
                    >
                      <Text style={[s.niveauTexte, actif && s.niveauTexteActif]}>{n.libelle}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {/* On ne propose pas de désigner un kit : `materiel_incidents` est fermée aux
                opérateurs (policy `materiel_incidents_access`, rôles admin et prod). L'OS web
                tente l'écriture et affiche « le lien matériel n'a pas pu être créé » à chaque
                fois. Le dire ici vaut mieux que de le faire échouer. */}
            <Text style={s.manque}>
              Si du matériel est en cause, précisez-le dans la description : le rattachement au kit
              se fait par la production.
            </Text>
            <View style={s.deuxColonnes}>
              <View style={{ flex: 1 }}>
                <Bouton titre="Annuler" onPress={() => { setOuvert(false); setSouci(null); }} secondaire />
              </View>
              <View style={{ flex: 1 }}>
                <Bouton titre="Envoyer" onPress={envoyer} enCours={enCours} />
              </View>
            </View>
          </View>
        )}
      </View>
    </Section>
  );
}

const s = StyleSheet.create({
  barre: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: E.m, paddingBottom: E.s, gap: E.s,
  },
  retour: { flexDirection: "row", alignItems: "center", gap: 1, width: 72 },
  retourTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 14 },
  barreTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  attente: { paddingVertical: E.xl * 2, alignItems: "center" },

  hero: {
    gap: E.xs, padding: E.l, borderRadius: R.xl,
    backgroundColor: "rgba(36,84,255,.12)", borderWidth: 1, borderColor: "rgba(36,84,255,.38)",
  },
  heroEtiquette: {
    color: C.cyanTexte, fontFamily: P.texteFort, fontSize: 11,
    textTransform: "uppercase", letterSpacing: 1,
  },
  heroNom: { color: C.texte, fontFamily: P.titre, fontSize: 23, letterSpacing: -0.5 },
  heroDetail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, textTransform: "capitalize" },
  heroBas: { flexDirection: "row", flexWrap: "wrap", gap: E.xs, marginTop: E.xs },
  heroRef: { color: C.texteFaible, fontFamily: P.texte, fontSize: 11.5 },

  bloc: {
    gap: E.s, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  blocTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  label: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 12.5 },
  compte: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5 },
  compteOk: { color: C.succesTexte, fontFamily: P.texteFort, fontSize: 12.5 },
  compteAlerte: { color: C.alerteTexte, fontFamily: P.texteFort, fontSize: 12.5 },
  confirme: { color: C.succesTexte, fontFamily: P.texteFort, fontSize: 13.5 },
  manque: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },

  rangee: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    paddingVertical: E.xs, minHeight: TOUCHE - 8,
  },
  rangeeLibelle: { color: C.texteFaible, fontFamily: P.texte, fontSize: 11.5 },
  rangeeValeur: { color: C.texte, fontFamily: P.texteFort, fontSize: 14.5 },
  rangeeValeurGrande: { color: C.texte, fontFamily: P.titre, fontSize: 22, letterSpacing: -0.4 },
  appel: {
    minWidth: TOUCHE, minHeight: TOUCHE, alignItems: "center", justifyContent: "center",
    borderRadius: R.pill, backgroundColor: "rgba(18,183,106,.12)",
    borderWidth: 1, borderColor: "rgba(18,183,106,.34)",
  },
  lien: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: E.xs,
    minHeight: TOUCHE, borderRadius: R.m,
    backgroundColor: "rgba(36,84,255,.12)", borderWidth: 1, borderColor: "rgba(36,84,255,.32)",
  },
  lienTexte: { color: C.accentClair, fontFamily: P.texteFort, fontSize: 13.5 },

  caseRangee: { flexDirection: "row", alignItems: "center", gap: E.s, minHeight: TOUCHE },
  coche: {
    width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.bordureForte, backgroundColor: "rgba(255,255,255,.04)",
  },
  cocheFaite: { borderColor: "rgba(18,183,106,.5)", backgroundColor: "rgba(18,183,106,.14)" },
  caseTexte: { flex: 1, color: C.texte, fontFamily: P.texte, fontSize: 14, lineHeight: 19 },
  caseTexteFaite: { color: C.texteDoux },

  brief: {
    gap: E.m, padding: E.m, borderRadius: R.l,
    backgroundColor: "rgba(0,199,255,.08)", borderWidth: 1, borderColor: "rgba(0,199,255,.26)",
  },
  briefLibelle: {
    color: C.cyan, fontFamily: P.texteFort, fontSize: 11,
    textTransform: "uppercase", letterSpacing: 0.8,
  },
  briefTexte: { color: C.texte, fontFamily: P.texte, fontSize: 14, lineHeight: 20 },

  bascule: {
    gap: E.xs, padding: E.m, borderRadius: R.l,
    backgroundColor: "rgba(232,163,61,.10)", borderWidth: 1, borderColor: "rgba(232,163,61,.32)",
  },
  basculeTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: 15 },
  basculeTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },

  deuxColonnes: { flexDirection: "row", gap: E.s },
  niveau: {
    flex: 1, minHeight: TOUCHE, alignItems: "center", justifyContent: "center",
    borderRadius: R.m, backgroundColor: C.surfaceHaute, borderWidth: 1, borderColor: C.bordure,
  },
  niveauActif: { backgroundColor: "rgba(36,84,255,.20)", borderColor: "rgba(36,84,255,.55)" },
  niveauTexte: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13.5 },
  niveauTexteActif: { color: C.texte, fontFamily: P.texteFort },

  pied: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: E.l, paddingTop: E.s,
    backgroundColor: "rgba(7,10,23,.94)",
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.bordure,
  },
});
