// MES REVENUS (30/09/2026). L'écran `revenus` de l'OS, mot pour mot son titre.
//
// == LE VOCABULAIRE EST UNE RÈGLE, PAS UN STYLE =================================================
//
// Les collaborateurs sont des FREELANCES. « Salaire », « fiche de paie » et « pénalité » ne
// figurent nulle part dans ce fichier, et ne doivent jamais y entrer : envoyer un bulletin de paie
// à un indépendant, c'est fabriquer la preuve écrite d'un lien de subordination (décision de Fouka
// du 29/09). On dit « montant versé », « récapitulatif de prestations », « ajustement ».
//
// == TROIS CHIFFRES, PUIS LE DÉTAIL QUAND ON LE DEMANDE ========================================
//
// Combien j'ai gagné, combien on me doit encore, et pourquoi c'est moins que prévu quand ça l'est.
// Ça reste ce qu'on lit en premier. L'OS y ajoute un graphique sur six mois, des XP et un grade :
// le graphique n'a rien à dire ici — les cinq prestations d'Antoine tiennent toutes dans
// septembre, ce serait une barre et cinq creux — et les XP appartiennent à l'écran Formation.
//
// == CE QUE FOUKA A DEMANDÉ LE 01/10, ET CE QUE LA BASE PERMET D'Y RÉPONDRE ====================
//
// « Mes revenus, je veux un peu plus de détails. » Mesuré avant d'écrire, sur les 10 affectations
// de toute la base et sur les 5 qu'Antoine reçoit par le vrai chemin :
//
//   DISPONIBLE, ET AJOUTÉ ICI
//     · `travail_valide` / `travail_decide_le` : vrai sur 2 lignes, NULL sur 8, masqué à personne.
//       C'est la seule donnée qui EXPLIQUE une prestation encore en attente au lieu de la subir.
//     · Le chemin du versement, chiffré : 4 en attente, 5 à verser, 1 partie en comptabilité,
//       0 versée. Deux tuiles n'en montraient que deux états sur quatre.
//     · Le mois par mois, construit par SOMME DES NETS. `recapitulatifs_remuneration` est vide
//       dans toute la base (0 ligne) : aucun document n'est encore parti, et attendre qu'il en
//       existe un pour montrer un mois revenait à ne rien montrer.
//     · Le détail d'une prestation, ouvert au doigt : montant convenu, primes, ajustements et
//       leur motif, net, déclarations, état du travail. Il ne s'affichait qu'en cas d'écart.
//
//   DISPONIBLE, ET VOLONTAIREMENT ABSENT
//     · `type_prestation` vaut « match » sur les 10 lignes : la répartition par type de l'OS
//       serait une barre unique. `fonction` est NULL 6 fois sur 10, et les 4 valeurs restantes
//       sont trois orthographes du même métier. `frais_km`, `km_estimes` et `frais_declares` sont
//       NULL sur les 10. Un écran fidèle au premier jet aurait aligné des « non renseigné ».
//
//   ABSENT DE LA BASE, ET QU'ON N'INVENTE PAS
//     · `date_paiement` est NULL sur 10 lignes sur 10, et aucune affectation n'est `payé`. Il n'y
//       a donc RIEN à montrer sous « ce qui a été versé et quand ». L'écran le dit en une phrase
//       au lieu de laisser croire à une panne.
//
// == AUCUN CALCUL D'ARGENT N'EST FAIT ICI ======================================================
//
// `net_a_payer` vient de la base (`mission_net_a_payer` = montant + primes − ajustements, plancher
// à 0). L'écran ne fait que des SOMMES de ces nets. Refaire la soustraction côté téléphone, c'est
// se préparer à afficher un total différent du récapitulatif qui part chez la personne — et sur de
// l'argent, deux chiffres qui divergent, c'est un appel téléphonique.
//
// Mesuré avec le jeton d'Antoine Blin : 5 prestations, 240 €, 95 € en attente, 145 € à verser,
// 0 € versé, et `date_paiement` NULL sur 10 lignes sur 10 dans toute la base. L'écran n'annonce
// donc jamais une date de virement : il dit la règle, qui est vraie et que Fouka a posée lui-même
// le 25/09 — « à la fin du mois le photographe reçoit son virement ».
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Ecran, Probleme, Section, Vide } from "../../src/ui/Ecran";
import { Bouton, Erreur, Pastille } from "../../src/ui/Base";
import { useDonnees, oublier } from "../../src/lib/cache";
import { libelleCouverture } from "../../src/lib/os-missions";
import {
  contesterAjustement, lireMesRevenus, LIBELLE_VERSEMENT, parMois,
  type Ajustement, type MesRevenus, type Prestation, type StatutVersement,
} from "../../src/lib/os-revenus";
import { dateDuJourParis, dateLongue, versDate } from "../../src/lib/dates";
import { Barre } from "../../src/ui/Barre";
import { C, E, R, TOUCHE } from "../../src/theme/couleurs";
import { P, T } from "../../src/theme/polices";

/** Les trois périodes de l'OS, dans son ordre et avec ses libellés. */
const PERIODES = [
  { cle: "mois", libelle: "Ce mois" },
  { cle: "annee", libelle: "Cette année" },
  { cle: "tout", libelle: "Tout" },
] as const;
type Periode = typeof PERIODES[number]["cle"];

/** « 92,50 € ». DEUX DÉCIMALES, TOUJOURS : sur ce qu'une personne va recevoir, un centime tronqué
 *  se remarque et fait douter du reste. Même choix que l'écran des récapitulatifs de l'OS. */
function eur(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/** « septembre 2026 », compté à Paris comme tout repère de date de cette application. */
function mois(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", month: "long", year: "numeric" })
    .format(versDate(iso));
}

const TON: Record<StatutVersement, "neutre" | "succes" | "alerte" | "info"> = {
  en_attente: "alerte",
  "validé": "info",
  transmis_compta: "info",
  "payé": "succes",
};

export default function Revenus() {
  const [periode, setPeriode] = useState<Periode>("mois");
  const { donnees, chargement, rafraichissement, erreur, relire } =
    useDonnees<MesRevenus>("os:revenus", lireMesRevenus);

  const toutes = donnees?.prestations ?? [];
  const recaps = donnees?.recapitulatifs ?? [];

  // Le filtre de période se calcule à Paris : un téléphone réglé sur un autre fuseau aurait changé
  // de mois avant ou après la personne, et son total du mois avec.
  const depuis = useMemo(() => {
    const aujourdhui = dateDuJourParis();
    if (periode === "mois") return `${aujourdhui.slice(0, 7)}-01`;
    if (periode === "annee") return `${aujourdhui.slice(0, 4)}-01-01`;
    return "";
  }, [periode]);

  const liste = useMemo(
    () => (depuis ? toutes.filter((p) => (p.date ?? "") >= depuis) : toutes),
    [toutes, depuis],
  );

  const total = liste.reduce((s, p) => s + p.net, 0);

  // LE CHEMIN DU VERSEMENT, CHIFFRÉ ÉTAPE PAR ÉTAPE (01/10/2026).
  //
  // Deux tuiles ne montraient que « À verser » et « Versé », et « À verser » valait en réalité
  // « tout ce qui n'est pas encore versé » : une prestation qu'on vient d'accepter et une
  // prestation validée par la production y tombaient au même endroit, alors que ce ne sont pas du
  // tout les mêmes nouvelles. Ici chaque étape porte sa somme et son compte.
  //
  // CHAQUE MONTANT EST UNE SOMME DE `net`, JAMAIS UNE SOUSTRACTION. L'ancien « attendu = total −
  // versé » était juste tant qu'il n'existait que deux états ; il aurait cessé de l'être le jour
  // d'un quatrième. On additionne ce qu'on montre, on ne déduit rien.
  const etapes = useMemo(() => {
    const somme = (cle: StatutVersement) => {
      const lignes = liste.filter((p) => p.statutVersement === cle);
      return { montant: lignes.reduce((s, p) => s + p.net, 0), n: lignes.length };
    };
    return {
      en_attente: somme("en_attente"),
      "validé": somme("validé"),
      transmis_compta: somme("transmis_compta"),
      "payé": somme("payé"),
    } as Record<StatutVersement, { montant: number; n: number }>;
  }, [liste]);

  // Le mois par mois porte sur TOUT l'historique, pas sur la période choisie : une personne qui
  // regarde « ce mois » et voit un seul mois dans ce tableau croirait que le reste a disparu.
  const mois12 = useMemo(() => parMois(toutes).slice(0, 12), [toutes]);

  return (
    <Ecran enCours={!!donnees && rafraichissement} teinte="bleu" rafraichir={relire} retour="/profil">
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Mes revenus</Text>
        <Text style={s.sous}>Prestation par prestation, et ce qui reste dû</Text>
      </View>

      {/* Les trois périodes restent affichées même vides : leur absence ferait croire que l'écran
          ne sait pas remonter plus loin. */}
      {/* `Barre` DE `src/ui/`, ET PLUS UNE COPIE (01/10/2026). Cet écran redessinait à la main la
          rangée de puces que `src/ui/Barre.tsx` dessine déjà, avec les mêmes vingt lignes et les
          mêmes valeurs : même hauteur, même bleu actif. Deux dessins identiques tenus à deux
          endroits finissent par diverger d'un point ou d'une nuance, et c'est ce qui donne
          l'impression de deux applications recollées (règle 1 du contrat). En prime, `Barre` ramène
          la puce active dans le champ de vision, ce que cette copie ne faisait pas. */}
      <Barre
        choix={PERIODES.map((p) => ({ cle: p.cle, libelle: p.libelle }))}
        actif={periode}
        surChoix={(cle: string) => setPeriode(cle as Periode)}
      />

      {chargement ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : erreur && !donnees ? (
        <Probleme surReessayer={relire} />
      ) : (
        <>
          <View style={s.total}>
            <Text style={s.totalEtiquette}>
              {periode === "mois" ? "CE MOIS" : periode === "annee" ? "CETTE ANNÉE" : "DEPUIS LE DÉBUT"}
            </Text>
            <Text style={s.totalValeur}>{eur(total)}</Text>
            <Text style={s.totalSous}>
              {liste.length
                ? `${liste.length} prestation${liste.length > 1 ? "s" : ""}`
                : "Aucune prestation sur cette période"}
            </Text>
          </View>

          {/* LES TROIS ÉTAPES RESTENT AFFICHÉES MÊME À ZÉRO. Leur absence ferait croire que
              l'étape n'existe pas, alors qu'elle est simplement vide — c'est la leçon du 30/09 sur
              les groupes masqués de `Barre`. « Transmis compta » n'est plus sur le chemin depuis
              la décision de Fouka du 25/09 ; une ligne l'a encore en base, elle ne s'affiche donc
              que s'il y a quelque chose dedans. */}
          <View style={s.tuiles}>
            <Etape
              libelle={LIBELLE_VERSEMENT.en_attente}
              montant={etapes.en_attente.montant}
              n={etapes.en_attente.n}
              couleur={C.alerteTexte}
              bordure={C.alerte}
            />
            <Etape
              libelle={LIBELLE_VERSEMENT["validé"]}
              montant={etapes["validé"].montant}
              n={etapes["validé"].n}
              couleur={C.cyanTexte}
              bordure={C.cyan}
            />
            <Etape
              libelle={LIBELLE_VERSEMENT["payé"]}
              montant={etapes["payé"].montant}
              n={etapes["payé"].n}
              couleur={C.succesTexte}
              bordure={C.succes}
            />
          </View>
          {etapes.transmis_compta.n ? (
            <View style={s.tuiles}>
              <Etape
                libelle={LIBELLE_VERSEMENT.transmis_compta}
                montant={etapes.transmis_compta.montant}
                n={etapes.transmis_compta.n}
                couleur={C.cyanTexte}
                bordure={C.cyan}
              />
            </View>
          ) : null}

          {/* LA RÈGLE, PAS UNE DATE INVENTÉE. `date_paiement` n'est renseignée sur aucune ligne de
              la base : promettre « virement le 5 » serait une invention. Ceci est la règle telle
              que Fouka l'a énoncée le 25/09, et elle répond à la seule question qu'on se pose
              devant un montant en attente. */}
          <Text style={s.regle}>
            Une prestation validée entre dans le récapitulatif du mois. En fin de mois, vous recevez
            par e-mail votre récapitulatif de prestations et l'annonce du virement.
          </Text>

          {/* MOIS PAR MOIS (01/10/2026). Le « récapitulatif mensuel » demandé, construit par somme
              des nets, parce qu'aucun document de fin de mois n'existe encore dans la base. Il
              porte sur tout l'historique, indépendamment de la période choisie plus haut : c'est
              sa raison d'être, voir d'un coup d'œil les mois précédents. Douze au plus, ce qui
              fait une année : au-delà, on ne lit plus, on défile. */}
          {mois12.length ? (
            <Section titre="Mois par mois">
              <View style={s.bloc}>
                {mois12.map((m, i) => (
                  <View key={m.cle} style={[s.ligneMois, i === mois12.length - 1 ? { borderBottomWidth: 0 } : null]}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.moisNom}>{mois(m.cle)}</Text>
                      <Text style={s.detail}>
                        {`${m.nbPrestations} prestation${m.nbPrestations > 1 ? "s" : ""}`}
                        {m.restant > 0 ? ` · ${eur(m.restant)} en attente de versement` : ""}
                      </Text>
                    </View>
                    <Text style={s.montant}>{eur(m.total)}</Text>
                  </View>
                ))}
              </View>
            </Section>
          ) : null}

          {/* CE QUI A ÉTÉ VERSÉ, ET QUAND. Mesuré : `recapitulatifs_remuneration` ne porte AUCUNE
              ligne dans toute la base, et `date_paiement` est NULL sur les 10 affectations. Un
              écran vide sans un mot se lit « c'est cassé » (règle 7) : on dit ce qui déclenche ce
              document et pourquoi il n'y en a pas encore. */}
          {recaps.length ? (
            <Section titre="Récapitulatifs de prestations">
              <View style={{ gap: E.s }}>
                {recaps.map((r) => (
                  <View key={r.id} style={s.carte}>
                    <View style={s.ligne}>
                      <Text style={s.nom}>{mois(r.mois)}</Text>
                      <Text style={s.montant}>{eur(r.montantVerse)}</Text>
                    </View>
                    <Text style={s.detail}>
                      {[
                        `${r.nbPrestations} prestation${r.nbPrestations > 1 ? "s" : ""}`,
                        r.vireLe ? `virement fait le ${dateLongue(r.vireLe.slice(0, 10))}` : null,
                        !r.vireLe && r.virementAnnonceLe ? `virement annoncé pour le ${dateLongue(r.virementAnnonceLe)}` : null,
                      ].filter(Boolean).join(" · ")}
                    </Text>
                    {r.note ? <Text style={s.detail}>{r.note}</Text> : null}
                  </View>
                ))}
              </View>
            </Section>
          ) : toutes.length ? (
            <Section titre="Récapitulatifs de prestations">
              <Vide
                icone="document-text-outline"
                titre="Aucun récapitulatif envoyé pour l'instant"
                texte={
                  "Vos prestations validées entrent dans le récapitulatif du mois. Il vous est "
                  + "envoyé par e-mail en fin de mois, avec l'annonce du virement, et il apparaît "
                  + "ici à ce moment-là. Tant qu'il n'est pas parti, rien n'a encore été versé."
                }
              />
            </Section>
          ) : null}

          {liste.length ? (
            <Section titre="Mes prestations">
              <View style={{ gap: E.s }}>
                {liste.map((p) => <CartePrestation key={p.affectationId} p={p} surChangement={relire} />)}
              </View>
            </Section>
          ) : toutes.length ? (
            <Vide
              icone="cash-outline"
              titre="Rien sur cette période"
              texte="Vos prestations plus anciennes sont là : touchez « Tout » ci-dessus pour les voir."
            />
          ) : (
            <Vide
              icone="cash-outline"
              titre="Aucune prestation pour l'instant"
              texte={
                "Une prestation apparaît ici dès que vous acceptez une mission. Son montant est fixé "
                + "par la production, et vous le voyez sur la mission comme ici."
              }
            />
          )}
        </>
      )}
    </Ecran>
  );
}

/** Une tuile du chemin du versement : une étape, sa somme, son nombre de prestations. */
function Etape({
  libelle, montant, n, couleur, bordure,
}: { libelle: string; montant: number; n: number; couleur: string; bordure: string }) {
  return (
    <View style={[s.tuile, { borderColor: bordure + "4D" }]}>
      <Text style={s.tuileEtiquette} numberOfLines={1}>{libelle}</Text>
      <Text style={[s.tuileValeur, { color: n ? couleur : C.texteFaible }]}>{eur(montant)}</Text>
      {/* Le compte plutôt qu'un tiret : « 0,00 € » seul ne dit pas si l'étape est vide ou si
          l'écran n'a rien su lire. */}
      <Text style={s.tuileCompte}>
        {n ? `${n} prestation${n > 1 ? "s" : ""}` : "aucune"}
      </Text>
    </View>
  );
}

/**
 * Une prestation, et son détail au doigt.
 *
 * POURQUOI LE DÉTAIL EST REPLIÉ (01/10/2026). Fouka veut plus de détail ; une liste où chaque
 * ligne fait quinze lignes de haut n'est pas plus détaillée, elle est illisible. La carte fermée
 * répond à « combien, pour qui, où ça en est » ; ouverte, elle répond à « pourquoi ce montant, et
 * qu'est-ce qui le retient ». Toute la carte est la cible, pas une petite flèche : 44 points au
 * minimum (règle 8).
 *
 * LA DÉCOMPOSITION S'OUVRE TOUJOURS QUAND ON DEMANDE LE DÉTAIL, MÊME SANS ÉCART. Fermée, elle ne
 * s'affiche que s'il y a vraiment quelque chose à expliquer — deux fois la même somme n'apprend
 * rien. Ouverte, on est venu chercher le chiffre : « Montant convenu 60,00 € / Net à verser
 * 60,00 € » est une réponse, pas une redite.
 */
function CartePrestation({ p, surChangement }: { p: Prestation; surChangement: () => void }) {
  const [ouverte, setOuverte] = useState(false);
  const detail = [p.date ? dateLongue(p.date) : null, p.reference].filter(Boolean).join(" · ");
  const declare = [
    p.heures !== null ? `${p.heures.toLocaleString("fr-FR")} h déclarées` : null,
    p.km !== null ? `${p.km.toLocaleString("fr-FR")} km déclarés` : null,
    p.frais !== null ? `${eur(p.frais)} de frais déclarés` : null,
  ].filter(Boolean).join(" · ");
  const ecart = p.primes.length > 0 || p.ajustements.length > 0;

  return (
    <View style={s.carte}>
      <Pressable
        onPress={() => setOuverte((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={`${ouverte ? "Masquer" : "Voir"} le détail de ${p.client ?? "cette mission"}`}
        accessibilityState={{ expanded: ouverte }}
        style={({ pressed }) => [s.ligne, { minHeight: TOUCHE }, pressed ? { opacity: 0.8 } : null]}
      >
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.nom} numberOfLines={2}>{p.client ?? "Mission SportVision"}</Text>
          {detail ? <Text style={s.detail} numberOfLines={2}>{detail}</Text> : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Text style={s.montant}>{eur(p.net)}</Text>
          <Pastille ton={TON[p.statutVersement]} texte={LIBELLE_VERSEMENT[p.statutVersement]} />
        </View>
      </Pressable>

      {/* POURQUOI LE NET N'EST PAS LE MONTANT CONVENU. Un chiffre plus petit que prévu, sans un mot
          pour l'expliquer, c'est l'écran qui fait téléphoner. */}
      {ecart || ouverte ? (
        <View style={s.decompte}>
          <View style={s.ligneDecompte}>
            <Text style={s.decompteTexte}>Montant convenu</Text>
            <Text style={s.decompteTexte}>{eur(p.montant)}</Text>
          </View>
          {p.primes.map((pr) => (
            <View key={pr.id} style={s.ligneDecompte}>
              <Text style={s.decompteTexte} numberOfLines={2}>Prime · {pr.detail || pr.motif}</Text>
              <Text style={[s.decompteTexte, { color: C.succesTexte }]}>+ {eur(pr.montant)}</Text>
            </View>
          ))}
          {p.ajustements.map((a) => (
            <LigneAjustement key={a.id} a={a} surChangement={surChangement} />
          ))}
          {/* `net_a_payer` VIENT DE LA BASE. Cette ligne l'affiche, elle ne le recalcule pas : un
              total qui diverge du récapitulatif envoyé, c'est un appel téléphonique. */}
          <View style={[s.ligneDecompte, s.ligneNet]}>
            <Text style={s.netTexte}>Net à verser</Text>
            <Text style={s.netTexte}>{eur(p.net)}</Text>
          </View>
        </View>
      ) : null}

      <View style={s.bas}>
        {libelleCouverture(p.couverture) ? <Pastille texte={libelleCouverture(p.couverture)!} /> : null}
        {p.responsable ? <Pastille ton="info" texte="Responsable" /> : null}
      </View>

      {ouverte ? (
        <View style={{ gap: E.xs }}>
          {/* CE QUI RETIENT LE MONTANT, DIT AVEC LES MOTS DE L'OS. Sa foire aux questions répond
              déjà « la validation Production ou Comptable est en cours » ; cette ligne dit
              laquelle des deux, sur CETTE prestation. `null` n'est pas un refus : personne n'a
              encore regardé, et écrire « refusé » serait une accusation inventée. */}
          {p.travailValide === true ? (
            <Note
              icone="checkmark-circle-outline"
              couleur={C.succesTexte}
              texte={p.travailDecideLe
                ? `Travail validé par la production le ${dateLongue(p.travailDecideLe.slice(0, 10))}.`
                : "Travail validé par la production."}
            />
          ) : p.travailValide === false ? (
            <Note
              icone="alert-circle-outline"
              couleur={C.alerteTexte}
              texte={p.travailMotif
                ? `La production a des réserves sur le travail rendu : ${p.travailMotif}`
                : "La production a des réserves sur le travail rendu. Contactez-la."}
            />
          ) : (
            <Note
              icone="hourglass-outline"
              couleur={C.texteFaible}
              texte="La production n'a pas encore validé le travail rendu sur cette mission."
            />
          )}

          {/* Ni « 0 h », ni « non déclaré » : mesuré, 2 lignes sur 10 portent des heures et des
              kilomètres, et aucune ne porte de frais. Huit mentions « non déclaré » n'apprendraient
              rien à personne. */}
          {declare ? <Note icone="time-outline" couleur={C.texteFaible} texte={declare} /> : null}

          {/* Une date de versement ne s'affiche que si elle existe. Elle n'existe sur aucune des
              10 affectations de la base : cette ligne attend le jour où la comptabilité la
              remplira, et n'invente rien en attendant. */}
          {p.statutVersement === "payé" && p.dateVersement ? (
            <Note
              icone="cash-outline"
              couleur={C.succesTexte}
              texte={`Versé le ${dateLongue(p.dateVersement.slice(0, 10))}.`}
            />
          ) : null}
        </View>
      ) : null}

      <Pressable
        onPress={() => setOuverte((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={ouverte ? "Masquer le détail" : "Voir le détail"}
        style={({ pressed }) => [s.plier, pressed ? { opacity: 0.75 } : null]}
      >
        <Text style={s.plierTexte}>{ouverte ? "Masquer le détail" : "Voir le détail"}</Text>
        <Ionicons name={ouverte ? "chevron-up" : "chevron-down"} size={14} color={C.texteDoux} />
      </Pressable>
    </View>
  );
}

/** Une ligne d'explication sous une prestation : une icône, une phrase, jamais une couleur seule. */
function Note({
  icone, texte, couleur,
}: { icone: keyof typeof Ionicons.glyphMap; texte: string; couleur: string }) {
  return (
    <View style={s.note}>
      <Ionicons name={icone} size={14} color={couleur} style={{ marginTop: 2 }} />
      <Text style={[s.noteTexte, { color: couleur }]}>{texte}</Text>
    </View>
  );
}

/**
 * Un ajustement, et la seule action de cet écran.
 *
 * LE BOUTON N'APPARAÎT QUE SI LA BASE DIRA OUI. `contestable` reprend les trois conditions de
 * `mission_penalite_contester` : la retenue est appliquée, elle n'est pas annulée, et le versement
 * n'est pas parti — « le récapitulatif est parti, rouvrir le montant après coup ne rendrait pas
 * l'argent, ça rendrait le document faux », dit la fonction elle-même. Un bouton qui mène à un
 * refus est une promesse cassée ; quand on ne peut plus contester, on dit à qui s'adresser.
 */
function LigneAjustement({ a, surChangement }: { a: Ajustement; surChangement: () => void }) {
  const [ouvert, setOuvert] = useState(false);
  const [texte, setTexte] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [souci, setSouci] = useState<string | null>(null);

  const envoyer = useCallback(async () => {
    setEnCours(true); setSouci(null);
    try {
      await contesterAjustement(a.id, texte);
      // Le montant dû change, et il est lu par cet écran ET par l'accueil : on oublie tout ce qui
      // commence par « os:revenus » plutôt que de raccommoder l'objet en mémoire.
      oublier("os:revenus");
      setOuvert(false);
      surChangement();
    } catch (e) {
      setSouci(e instanceof Error ? e.message : "La contestation n'est pas partie.");
    } finally { setEnCours(false); }
  }, [a.id, texte, surChangement]);

  return (
    <View style={{ gap: E.xs }}>
      <View style={s.ligneDecompte}>
        <Text style={s.decompteTexte} numberOfLines={2}>Ajustement · {a.detail || a.motif}</Text>
        <Text style={[s.decompteTexte, { color: a.statut === "contestee" ? C.texteFaible : C.dangerTexte }]}>
          − {eur(a.montant)}
        </Text>
      </View>

      {a.statut === "contestee" ? (
        <Text style={s.suspendu}>
          Vous avez contesté cet ajustement. Il est suspendu et n'entrera pas dans votre
          récapitulatif tant que la direction n'a pas tranché.
        </Text>
      ) : a.contestable ? (
        ouvert ? (
          <View style={{ gap: E.s }}>
            <TextInput
              value={texte}
              onChangeText={setTexte}
              placeholder="Dites ce que vous contestez"
              placeholderTextColor={C.texteFaible}
              multiline
              maxLength={400}
              accessibilityLabel="Votre contestation"
              style={s.champ}
            />
            <Erreur message={souci} />
            <View style={{ flexDirection: "row", gap: E.s }}>
              <View style={{ flex: 1 }}>
                <Bouton titre="Annuler" secondaire onPress={() => { setOuvert(false); setSouci(null); }} />
              </View>
              <View style={{ flex: 1 }}>
                <Bouton
                  titre="Envoyer"
                  onPress={envoyer}
                  enCours={enCours}
                  desactive={!texte.trim()}
                />
              </View>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setOuvert(true)}
            accessibilityRole="button"
            accessibilityLabel="Contester cet ajustement"
            style={({ pressed }) => [s.contester, pressed ? { opacity: 0.8 } : null]}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={15} color={C.texteDoux} />
            <Text style={s.contesterTexte}>Contester cet ajustement</Text>
          </Pressable>
        )
      ) : (
        <Text style={s.suspendu}>
          Cet ajustement est parti sur un récapitulatif : il ne se conteste plus ici. Adressez-vous
          à la direction.
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: T.titreEcran, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.sousEcran, lineHeight: T.sousEcranHauteur },
  attente: { paddingVertical: E.xl * 2, alignItems: "center" },

  total: {
    gap: 4, padding: E.l, borderRadius: R.xl,
    backgroundColor: "rgba(36,84,255,.14)", borderWidth: 1, borderColor: "rgba(36,84,255,.32)",
  },
  totalEtiquette: {
    color: C.cyanTexte, fontFamily: P.texteFort, fontSize: 10.5,
    textTransform: "uppercase", letterSpacing: 1,
  },
  // `tabular-nums` : sans lui, les chiffres n'ont pas la même largeur et les montants dansent d'un
  // rafraîchissement à l'autre.
  totalValeur: { color: C.texte, fontFamily: P.titre, fontSize: 32, letterSpacing: -1, fontVariant: ["tabular-nums"] },
  totalSous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13 },

  tuiles: { flexDirection: "row", gap: E.s },
  tuile: {
    flex: 1, gap: 4, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1,
  },
  tuileEtiquette: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 11.5 },
  // 17 et non 19 : trois tuiles au lieu de deux sur la largeur d'un iPhone, et « 1 234,00 € » se
  // coupait en deux lignes sur celle du milieu.
  tuileValeur: { fontFamily: P.titreFort, fontSize: 17, fontVariant: ["tabular-nums"] },
  tuileCompte: { color: C.texteFaible, fontFamily: P.texte, fontSize: 11 },

  regle: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },

  carte: {
    gap: E.s, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  ligne: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: E.s },
  nom: { color: C.texte, fontFamily: P.titreFort, fontSize: 16, flexShrink: 1 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  montant: { color: C.texte, fontFamily: P.titreFort, fontSize: 17, fontVariant: ["tabular-nums"] },
  declare: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12, lineHeight: 17 },
  bas: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: E.xs },

  decompte: {
    gap: E.xs, padding: E.s, borderRadius: R.m,
    backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: C.bordure,
  },
  ligneDecompte: { flexDirection: "row", justifyContent: "space-between", gap: E.s },
  decompteTexte: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 12.5, flexShrink: 1 },
  ligneNet: { paddingTop: E.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.bordureForte },
  netTexte: { color: C.texte, fontFamily: P.texteFort, fontSize: 13, fontVariant: ["tabular-nums"] },
  suspendu: { color: C.alerteTexte, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },

  bloc: { borderRadius: R.l, backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure, paddingHorizontal: E.m },
  ligneMois: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: E.m,
    minHeight: TOUCHE + 10, paddingVertical: E.s,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.bordure,
  },
  moisNom: { color: C.texte, fontFamily: P.texteFort, fontSize: 14.5, textTransform: "capitalize" },

  note: { flexDirection: "row", alignItems: "flex-start", gap: E.xs },
  noteTexte: { flex: 1, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },
  plier: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    minHeight: TOUCHE - 8, marginBottom: -E.xs,
  },
  plierTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 12.5 },

  contester: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    minHeight: TOUCHE, borderRadius: R.m,
    borderWidth: 1, borderColor: C.bordureForte, backgroundColor: "rgba(255,255,255,.05)",
  },
  contesterTexte: { color: C.texteDoux, fontFamily: P.texteFort, fontSize: 13.5 },
  champ: {
    minHeight: 84, borderRadius: R.m, padding: E.s, textAlignVertical: "top",
    backgroundColor: C.fond, borderWidth: 1, borderColor: C.bordureForte,
    color: C.texte, fontFamily: P.texte, fontSize: 15,
  },
});
