// L'ACCUEIL DE L'ESPACE CLUB, EN NATIF (30/09/2026).
//
// POURQUOI CET ÉCRAN EXISTE. Fouka, trois fois : « on dirait trop encore le site web collé sur
// l'app, alors que par rapport à Connect, je veux la même fluidité, la même DA ». La cause était
// structurelle, pas cosmétique : tous les écrans de Connect sont natifs et lisent la base
// directement, là où Club+ était une page web dans un cadre. Aucune retouche de la coque ne
// rattrape ça — il fallait des écrans.
//
// LA MÊME CHARTE, ET PAS UNE VARIANTE. Rien n'est redéfini ici : `Ecran`, `Section`, `Prochain`,
// `Raccourcis`, `CarteEvenement`, `Ecusson`, et les jetons `C` / `E` / `R` / `P` sont ceux de
// l'espace personnel, aux mêmes valeurs. C'est exactement ce que Fouka a demandé quand je lui ai
// posé la question : « les couleurs, la typo, l'espacement ». Deux palettes proches mais pas
// identiques, c'est précisément ce qui donne l'impression de deux applications recollées.
//
// LIRE ICI, MODIFIER DANS CLUB+. L'application affiche ; la création et la modification restent
// dans Club+, qui porte les règles et les droits. Refaire ces règles ici, ce serait en entretenir
// deux, et le jour où elles divergent personne ne sait laquelle fait foi.
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Ecran, Probleme, Section, Vide } from "../Ecran";
import { CarteEvenement, Ecusson } from "../Cartes";
import { Prochain } from "../Prochain";
import { Raccourcis } from "../Raccourcis";
import { derniersResultats, prochain, type Evenement } from "../../lib/donnees";
import { CarteEquipe } from "./CarteEquipe";
import { libelleRole, mesEquipes, type EquipeDuClub, type MembreDuClub, type MonClub } from "../../lib/club";
import { type NavigationClub } from "../../lib/navigation-club";
import { C, E, R, TOUCHE } from "../../theme/couleurs";
import { P } from "../../theme/polices";

export function AccueilClub({
  club, clubs, nav, prenom, evenements, equipes, membres, chargement, panne,
  surRecharger, surChangerDeClub, surOnglet, surWeb, surProfil, surInviter, inviteAutorisee,
}: {
  club: MonClub;
  /** La navigation de son rôle : elle décide des raccourcis et de ce qui a le droit d'être proposé. */
  nav: NavigationClub;
  /** Le prénom qu'ELLE a écrit dans son profil, sinon celui que le club a saisi. */
  prenom: string;
  /** Tous les clubs de la personne : la barre de choix n'apparaît qu'à partir de deux. */
  clubs: MonClub[];
  evenements: Evenement[];
  equipes: EquipeDuClub[];
  membres: MembreDuClub[];
  chargement: boolean;
  panne: boolean;
  surRecharger: () => void;
  surChangerDeClub: (id: string) => void;
  /** Ouvrir une destination par son chemin Club+ : natif quand on sait, web sinon. */
  surOnglet: (chemin: string) => void;
  surWeb: (chemin: string) => void;
  surProfil: () => void;
  /** Inviter dans une équipe, ou `undefined` si la base ne lui en donne pas le droit. */
  surInviter?: (e: EquipeDuClub) => void;
  /** Le droit d'inviter dans CETTE équipe. Absent : on ne propose rien. */
  inviteAutorisee?: (e: EquipeDuClub) => boolean;
}) {
  const suivant = prochain(evenements);
  const resultats = derniersResultats(evenements, 2);
  const miennes = mesEquipes(club, equipes);
  const cheminsDuRole = new Set([...nav.onglets, ...nav.menu.flatMap((g) => g.entrees)].map((e) => e.chemin));
  const membresVisibles = cheminsDuRole.has("/users");
  const prestationsOuvertes = cheminsDuRole.has("/services");

  return (
    <Ecran enCours={chargement} teinte="bleu" rafraichir={surRecharger}>
      <View style={s.entete}>
        <Ecusson url={club.logoUrl} nom={club.nom} taille={48} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.bonjour} numberOfLines={1}>
            {prenom ? `Bonjour ${prenom}` : "Espace club"}
          </Text>
          <Text style={s.sous} numberOfLines={1}>
            {[club.nom, libelleRole(club.role, club.fonction)].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <Pressable
          onPress={surProfil}
          accessibilityRole="button"
          accessibilityLabel="Mon compte"
          hitSlop={8}
          style={({ pressed }) => [s.rondBarre, pressed ? { opacity: 0.8 } : null]}
        >
          <Ionicons name="person-circle-outline" size={24} color={C.texteDoux} />
        </Pressable>
      </View>

      {/* Une personne peut tenir un rôle dans deux clubs — un coach qui aide un club voisin, un CM
          affilié. La barre ne s'affiche qu'alors : à un seul club, elle n'apprend rien. */}
      {clubs.length > 1 ? (
        <View style={s.choixClubs}>
          {clubs.map((c) => {
            const actif = c.id === club.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => surChangerDeClub(c.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: actif }}
                accessibilityLabel={`Travailler pour ${c.nom}`}
                style={[s.puce, actif && s.puceActive]}
              >
                <Text style={[s.puceTexte, actif && s.puceTexteActif]} numberOfLines={1}>{c.nom}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Section
        titre="Prochainement"
        action={
          <Pressable onPress={() => surOnglet("/calendar")} accessibilityRole="link" accessibilityLabel="Voir tout le calendrier" hitSlop={10}>
            <Text style={s.lien}>Calendrier</Text>
          </Pressable>
        }
      >
        {chargement && !evenements.length ? (
          <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
        ) : panne ? (
          <Probleme surReessayer={surRecharger} />
        ) : suivant ? (
          <Prochain e={suivant} clubNom={club.nom} clubLogoUrl={club.logoUrl} onPress={() => surOnglet("/calendar")} />
        ) : (
          <Vide
            titre="Rien de prévu pour l'instant"
            texte="Les matchs et les entraînements apparaîtront ici dès qu'ils seront publiés dans Club+."
          />
        )}
      </Section>

      {/* LES RACCOURCIS SONT LES TROIS PREMIÈRES ENTRÉES DU MENU DE SON RÔLE (30/09/2026).
          Avant, c'était Galeries / Demandes / Communication pour tout le monde — trois destinations
          qu'un trésorier n'a pas dans son menu. Les prendre dans sa navigation, c'est la garantie
          qu'un raccourci ne mène jamais là où son rôle n'a rien à faire. */}
      {nav.raccourcis.length ? (
        <Raccourcis
          elements={nav.raccourcis.map((r, k) => ({
            icone: r.icone as never,
            libelle: r.libelle,
            teinte: [C.cyan, C.accentClair, C.violet][k % 3],
            onPress: () => surOnglet(r.chemin),
          }))}
        />
      ) : null}

      {/* MES ÉQUIPES, ET RIEN QUE LES SIENNES (30/09/2026).
          Fouka, d'abord : « il faut que le coach voie quelle catégorie il a ». Puis, en voyant
          l'écran : « faut pas que le coach voie tout, faut qu'il voie uniquement ce qu'il a besoin
          de voir — son équipe, ses effectifs, ses galeries à lui, ses matchs à lui ».

          Cette section portait un lien « Tout le club » vers les vingt-six équipes. Il est retiré :
          l'onglet Équipes ne montre plus que le périmètre de la personne, et un raccourci vers le
          reste contredirait exactement ce qu'on vient de fermer.

          Elle ne s'affiche pas pour qui n'a PAS de périmètre — direction, secrétariat, community
          manager : eux ont tout le club, et « Mes équipes : 26 » ne leur apprendrait rien. */}
      {miennes.length ? (
        <Section titre="Mes équipes">
          <View style={{ gap: E.s }}>
            {miennes.map((e) => (
              <CarteEquipe key={e.id} e={e} mienne onPress={() => surWeb(`/teams/${e.id}`)} surInviter={surInviter && inviteAutorisee?.(e) ? () => surInviter(e) : undefined} />
            ))}
          </View>
        </Section>
      ) : null}

      {/* LE CLUB EN DEUX CHIFFRES, OU EN AUCUN (30/09/2026).
          Ils ne s'affichent que pour un rôle qui a « Coachs & dirigeants » dans son menu, c'est-à-
          dire qui administre le club. Vu sur le simulateur avec la session d'un coach : sans la
          seconde tuile, « 26 Équipes » s'étalait seule sur toute la largeur, et ce chiffre ne lui
          apprend rien — son équipe est juste au-dessus, nommée. Un compteur qui ne sert pas à
          celui qui le lit vaut mieux absent que large. */}
      {membresVisibles ? (
        <View style={s.chiffres}>
          <Pressable
            onPress={() => surOnglet("/teams")}
            accessibilityRole="button"
            accessibilityLabel={`${equipes.length} équipes, voir la liste`}
            style={({ pressed }) => [s.chiffre, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={s.chiffreValeur}>{equipes.length}</Text>
            <Text style={s.chiffreLibelle}>{equipes.length > 1 ? "Équipes" : "Équipe"}</Text>
          </Pressable>
          <Pressable
            onPress={() => surWeb("/users")}
            accessibilityRole="button"
            accessibilityLabel={`${membres.length} coachs et dirigeants, ouvrir la liste`}
            style={({ pressed }) => [s.chiffre, pressed ? { opacity: 0.85 } : null]}
          >
            <Text style={s.chiffreValeur}>{membres.length}</Text>
            <Text style={s.chiffreLibelle}>Coachs & dirigeants</Text>
          </Pressable>
        </View>
      ) : null}

      {resultats.length ? (
        <Section
          titre="Derniers résultats"
          action={
            <Pressable onPress={() => surOnglet("/calendar")} accessibilityRole="link" accessibilityLabel="Voir tous les résultats" hitSlop={10}>
              <Text style={s.lien}>Tout voir</Text>
            </Pressable>
          }
        >
          <View style={{ gap: E.s }}>
            {resultats.map((e) => <CarteEvenement key={e.id} e={e} ecussonClub={club.logoUrl} />)}
          </View>
        </Section>
      ) : null}

      {/* LA PORTE VERS SPORTVISION, et elle est assumée : c'est le seul endroit de cet écran qui
          parle de prestations. L'enfouir dans le menu, c'est en faire une page que personne
          n'ouvre. Elle disparaît pour un rôle qui n'a pas « Prestations » — un trésorier, un
          responsable sponsors : chez eux, commander une captation n'est pas le sujet. */}
      {prestationsOuvertes ? (
        <Pressable
          onPress={() => surWeb("/services")}
          accessibilityRole="button"
          accessibilityLabel="Demander une prestation SportVision"
          style={({ pressed }) => [s.carteAction, pressed ? { opacity: 0.88 } : null]}
        >
          <View style={s.rondAction}><Ionicons name="camera" size={19} color={C.cyan} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.actionTitre}>Demander une prestation</Text>
            <Text style={s.actionTexte}>Photo, vidéo, drone : réservez une captation pour un match.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.texteFaible} />
        </Pressable>
      ) : null}
    </Ecran>
  );
}

const s = StyleSheet.create({
  entete: { flexDirection: "row", alignItems: "center", gap: E.m },
  bonjour: { color: C.texte, fontFamily: P.titre, fontSize: 26, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5 },
  rondBarre: { width: TOUCHE - 6, height: TOUCHE - 6, alignItems: "center", justifyContent: "center" },

  choixClubs: { flexDirection: "row", flexWrap: "wrap", gap: E.s },
  puce: {
    paddingHorizontal: E.m, height: TOUCHE - 6, borderRadius: R.pill, justifyContent: "center",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure, maxWidth: "100%",
  },
  puceActive: { backgroundColor: "rgba(36,84,255,.20)", borderColor: "rgba(36,84,255,.55)" },
  puceTexte: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 13 },
  puceTexteActif: { color: C.texte, fontFamily: P.texteFort },

  lien: { color: C.accentClair, fontFamily: P.texteFort, fontSize: 13.5, minHeight: 20 },
  attente: { paddingVertical: E.xl, alignItems: "center" },

  chiffres: { flexDirection: "row", gap: E.s },
  chiffre: {
    flex: 1, gap: 2, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  chiffreValeur: { color: C.texte, fontFamily: P.titre, fontSize: 26, letterSpacing: -0.8 },
  chiffreLibelle: { color: C.texteDoux, fontFamily: P.texteMoyen, fontSize: 12.5 },

  carteAction: {
    flexDirection: "row", alignItems: "center", gap: E.m, padding: E.m,
    borderRadius: R.l, backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  rondAction: {
    width: 40, height: 40, borderRadius: R.m, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,199,255,.13)",
  },
  actionTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: 15.5 },
  actionTexte: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13, lineHeight: 18 },
});
