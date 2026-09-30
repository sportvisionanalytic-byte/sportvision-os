// MES LIVRABLES (01/10/2026). L'écran de l'opérateur qui rend son travail.
//
// LE GESTE QUI N'EXISTAIT PAS SUR TELEPHONE. Un photographe finit une prestation, il dépose le lien
// de ses photos ou de son montage. Ce dépôt déclenche la vérification par la production, puis la
// clôture de la mission, puis son paiement. Il fallait un ordinateur pour le faire. Le titre est
// celui de l'OS, mot pour mot : « Mes livrables ».
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// ON PART DES LIENS, SAUF POUR LA SEULE LISTE QUI N'EN A PAS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// La leçon est déjà payée côté production : 8 des 9 liens qui attendent quelque chose appartiennent
// à SV-2026-3121, que `v_production_missions` range dans le groupe `terrain` et non `a_verifier`.
// Un écran bâti sur l'état de la mission n'en aurait montré aucun. Ici c'est la même chose vue de
// l'autre côté : l'état d'une mission ne dit pas l'état de ses liens. Trois des quatre listes sont
// donc bâties sur `media_liens.statut`, et rien d'autre.
//
// LA QUATRIEME NE PEUT PAS L'ETRE, ET C'EST LA PLUS UTILE. « À déposer » est la liste des missions
// qui n'ont AUCUN lien : il n'y a par définition rien à lire dans `media_liens` pour les trouver.
// Mesuré : SV-2026-3957, du 27/09, statut `médias_complets`, zéro lien. C'est exactement la mission
// pour laquelle cet écran existe, et aucune liste de liens ne l'aurait fait apparaître.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// AUCUN LIEN CLIQUABLE, ET C'EST LA REGLE 2 DU CONTRAT
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// L'adresse s'affiche en TEXTE, pour reconnaître ce qu'on a déposé et chez quel fournisseur. Elle
// ne s'ouvre pas : l'application n'ouvre aucune page web, et de toute façon on ne relit pas 400
// photos sur un téléphone. La vérification se fait sur ordinateur.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// CE QUE CET ECRAN N'OFFRE PAS, ALORS QUE LA BASE L'ACCEPTERAIT
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Mesuré avec le jeton d'Antoine Blin : `update media_liens set statut = 'valide'` PASSE. Un
// opérateur peut valider sa propre livraison, ce qui lève la dernière condition de
// `mission_cloture_manquant` et débloque sa rémunération. Le verdict appartient à la production.
// Aucun bouton d'ici n'y touche. Le détail de la mesure est dans l'en-tête de `os-livrables.ts`.
import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Ecran, Probleme, Vide } from "../../src/ui/Ecran";
import { Bouton, Case, Champ, Erreur, Options, Pastille } from "../../src/ui/Base";
import { Barre } from "../../src/ui/Barre";
import { router } from "expo-router";
import { useSession } from "../../src/lib/session";
import { useDonnees, oublier } from "../../src/lib/cache";
import { libelleCouverture } from "../../src/lib/os-missions";
import { dateLongue, quand } from "../../src/lib/dates";
import {
  CATEGORIES_OPERATEUR, LIBELLE_CATEGORIE, LIBELLE_STATUT, LIBELLE_TYPE_MEDIA, TYPES_OPERATEUR,
  confirmerSauvegarde, deposerLien, lireLiensDeMesMissions, lireMesMissionsLivrables,
  problemeAdresse, problemeNom, redeposerLien, repondreParRemplacement,
  tonStatut, type MissionLivrable, type MonLien,
} from "../../src/lib/os-livrables";
import { C, E, R } from "../../src/theme/couleurs";
import { P, T } from "../../src/theme/polices";

/** La clé du cache. Elle porte l'identifiant : deux personnes sur le même téléphone un jour de
 *  tournage ne doivent pas se lire l'une l'autre. */
const cle = (moiId?: string | null) => (moiId ? `livrables:${moiId}` : null);

interface Donnees {
  missions: MissionLivrable[];
  liens: MonLien[];
}

/** Ce qui est ouvert sous une carte. Un seul formulaire à la fois : deux champs d'adresse
 *  ouverts en même temps, et on ne sait plus lequel on remplit. */
type Ouvert =
  | { quoi: "depot"; prestationId: string }
  | { quoi: "redepot"; lienId: string }
  | { quoi: "reponse"; lienId: string }
  | null;

export default function MesLivrables() {
  const { moi } = useSession();
  const [liste, setListe] = useState("corrections");
  const [ouvert, setOuvert] = useState<Ouvert>(null);
  const [souci, setSouci] = useState<string | null>(null);

  const { donnees, chargement, rafraichissement, erreur, relire } = useDonnees<Donnees>(
    cle(moi?.id),
    async () => {
      const moiId = moi!.id;
      const missions = await lireMesMissionsLivrables(moiId);
      // EN DEUX TEMPS, ET C'EST OBLIGE : la seconde lecture a besoin des identifiants de la
      // première. Un seul aller-retour n'est possible qu'en lisant tous les liens visibles, ce qui
      // pour un `prod` affecté sur le terrain remonterait ceux de tout son pôle (mesuré : 35 liens
      // lisibles par Mikael, 8 sur ses missions).
      const liens = await lireLiensDeMesMissions(missions.map((m) => m.prestationId), moiId);
      return { missions, liens };
    },
    [moi?.id],
  );

  const missions = donnees?.missions ?? [];
  const liens = donnees?.liens ?? [];

  async function agir(action: () => Promise<void>) {
    setSouci(null);
    try {
      await action();
      setOuvert(null);
      // Le cockpit de la production lit les mêmes liens : sa réponse d'hier devient fausse à
      // l'instant où l'on dépose. On l'oublie tout de suite plutôt qu'au bout de cinq minutes.
      oublier("prod:");
      oublier("livrables:");
      relire();
    } catch (e) {
      setSouci(e instanceof Error ? e.message : "L'enregistrement n'est pas parti.");
    }
  }

  const parMission = useMemo(() => {
    const m = new Map<string, MonLien[]>();
    for (const l of liens) {
      const t = m.get(l.prestationId);
      if (t) t.push(l); else m.set(l.prestationId, [l]);
    }
    return m;
  }, [liens]);

  const corrections = useMemo(() => liens.filter((l) => l.statut === "correction_demandee"), [liens]);
  const aVerifier = useMemo(() => liens.filter((l) => l.statut === "a_verifier"), [liens]);
  const valides = useMemo(() => liens.filter((l) => l.statut === "valide"), [liens]);
  // TOUT CE QUI RESTE, ET RIEN NE DISPARAIT. Les onze valeurs de `media_liens_statut_check` ne
  // tiennent pas dans quatre listes : `remplace` apparaît dès qu'on répond à une correction,
  // `expire` et `inaccessible` sont posés par la production. Un lien sans liste serait un lien
  // qu'on croit perdu.
  const autres = useMemo(
    () => liens.filter((l) => !["correction_demandee", "a_verifier", "valide"].includes(l.statut)),
    [liens],
  );
  const aDeposer = useMemo(
    () => missions.filter((m) => !(parMission.get(m.prestationId)?.length)),
    [missions, parMission],
  );
  const sansSauvegarde = useMemo(() => liens.filter((l) => !l.transfertConfirme).length, [liens]);

  const sous = chargement
    ? "Chargement"
    : [
        corrections.length ? `${corrections.length} correction${corrections.length > 1 ? "s" : ""} à traiter` : null,
        aDeposer.length ? `${aDeposer.length} mission${aDeposer.length > 1 ? "s" : ""} sans lien` : null,
      ].filter(Boolean).join(" · ") || "Rien n'attend de vous";

  const trouver = (id: string) => liens.find((l) => l.id === id) ?? null;

  return (
    <Ecran teinte="cyan" retour="/profil" retourLibelle="Mon espace" rafraichir={relire} enCours={rafraichissement}>
      <View style={{ gap: 4 }}>
        <Text style={s.titre}>Mes livrables</Text>
        <Text style={s.sous}>{sous}</Text>
      </View>

      {souci ? <Erreur message={souci} /> : null}

      {chargement ? (
        <View style={s.attente}><ActivityIndicator color={C.accent} /></View>
      ) : erreur ? (
        <Probleme surReessayer={relire} />
      ) : !missions.length ? (
        // AUCUNE AFFECTATION : LE CAS NORMAL, PAS L'EXCEPTION. Mesuré, dix des treize comptes
        // terrain n'ont aucune mission. Une page blanche ici ferait téléphoner (règle 7).
        <Vide
          icone="cloud-upload-outline"
          titre="Aucune mission à livrer"
          texte={
            "Un livrable se dépose sur une mission. Vous n'êtes affecté à aucune pour l'instant, ou "
            + "vous les avez refusées. Dès que la production vous affecte une prestation et que vous "
            + "l'acceptez dans « Mes missions », elle apparaît ici et vous pouvez y déposer vos liens."
          }
          action={{ libelle: "Voir mes missions", surPression: () => router.push("/missions") }}
        />
      ) : (
        <>
          <Barre
            choix={[
              { cle: "corrections", libelle: "Corrections", n: corrections.length },
              { cle: "a_deposer", libelle: "À déposer", n: aDeposer.length },
              { cle: "a_verifier", libelle: "À vérifier", n: aVerifier.length },
              { cle: "valides", libelle: "Validés", n: valides.length },
              { cle: "autres", libelle: "Autres états", n: autres.length },
            ]}
            actif={liste}
            surChoix={(c) => { setListe(c); setOuvert(null); setSouci(null); }}
          />

          {liste === "corrections" ? (
            corrections.length ? (
              <View style={{ gap: E.s }}>
                {corrections.map((l) => (
                  <CarteLien
                    key={l.id}
                    l={l}
                    mission={missions.find((m) => m.prestationId === l.prestationId) ?? null}
                    ouvert={ouvert}
                    surOuvrir={setOuvert}
                    surAgir={agir}
                    moiId={moi!.id}
                  />
                ))}
              </View>
            ) : (
              <Vide
                titre="Aucune correction demandée"
                texte={
                  "Quand la production trouve quelque chose à revoir sur un lien, il arrive ici avec "
                  + "le motif qu'elle a écrit, et la mission reste bloquée jusqu'à votre réponse. "
                  + "Aucun de vos liens n'est dans ce cas."
                }
              />
            )
          ) : liste === "a_deposer" ? (
            aDeposer.length ? (
              <View style={{ gap: E.s }}>
                {aDeposer.map((m) => (
                  <CarteMission
                    key={m.prestationId}
                    m={m}
                    ouvert={ouvert}
                    surOuvrir={setOuvert}
                    surAgir={agir}
                    moiId={moi!.id}
                  />
                ))}
              </View>
            ) : (
              <Vide
                titre="Toutes vos missions portent un lien"
                texte={
                  `Vos ${missions.length} mission${missions.length > 1 ? "s ont" : " a"} au moins un `
                  + "livrable déposé. Cette liste montre celles où la production n'a rien à ouvrir : "
                  + "sans lien, une mission ne peut pas être clôturée, et elle ne peut pas être payée."
                }
              />
            )
          ) : liste === "a_verifier" ? (
            <ListeLiens
              liens={aVerifier}
              missions={missions}
              ouvert={ouvert}
              surOuvrir={setOuvert}
              surAgir={agir}
              moiId={moi!.id}
              videTitre="Rien en attente de vérification"
              videTexte={
                "Un lien déposé reste ici tant que la production ne l'a pas relu. Un lien sans état "
                + "compte comme « à vérifier », exactement comme en base."
              }
            />
          ) : liste === "valides" ? (
            <ListeLiens
              liens={valides}
              missions={missions}
              ouvert={ouvert}
              surOuvrir={setOuvert}
              surAgir={agir}
              moiId={moi!.id}
              videTitre="Aucun lien validé"
              videTexte={
                "La production valide vos liens un par un. Tant qu'un lien d'une mission n'est pas "
                + "validé, cette mission ne peut pas être clôturée."
              }
            />
          ) : (
            <ListeLiens
              liens={autres}
              missions={missions}
              ouvert={ouvert}
              surOuvrir={setOuvert}
              surAgir={agir}
              moiId={moi!.id}
              videTitre="Aucun lien dans un autre état"
              videTexte={
                "Un lien remplacé, expiré, inaccessible ou archivé se range ici avec son état exact. "
                + "Cette liste existe pour qu'aucun lien ne disparaisse de l'écran ; aujourd'hui elle "
                + "est vide, et c'est la bonne nouvelle."
              }
            />
          )}

          {/* LE CHIFFRE QUI EXPLIQUE LES MISSIONS BLOQUEES. Mesuré : 6 des 8 liens qui attendent
              la production n'ont pas de sauvegarde confirmée. Sans un lien confirmé,
              `mission_cloture_manquant` refuse la clôture et `proteger_liberation_cartes` refuse
              de déclarer les cartes préparables. C'est la cause la plus fréquente d'une mission
              qui n'avance plus, et elle est invisible si on ne la dit pas. */}
          {sansSauvegarde ? (
            <Text style={s.note}>
              {`${sansSauvegarde} de vos liens sur ${liens.length} n'`}
              {sansSauvegarde > 1 ? "ont" : "a"}
              {" pas de sauvegarde confirmée. Tant qu'aucun lien d'une mission n'est confirmé, la "}
              {"production ne peut pas la clôturer et vos cartes ne doivent pas être formatées."}
            </Text>
          ) : null}
        </>
      )}
    </Ecran>
  );
}

// ── Les liens d'une liste, rangés sous leur mission ───────────────────────────────────────────

function ListeLiens({
  liens, missions, ouvert, surOuvrir, surAgir, moiId, videTitre, videTexte,
}: {
  liens: MonLien[];
  missions: MissionLivrable[];
  ouvert: Ouvert;
  surOuvrir: (o: Ouvert) => void;
  surAgir: (a: () => Promise<void>) => Promise<void>;
  moiId: string;
  videTitre: string;
  videTexte: string;
}) {
  if (!liens.length) return <Vide titre={videTitre} texte={videTexte} />;
  return (
    <View style={{ gap: E.s }}>
      {liens.map((l) => (
        <CarteLien
          key={l.id}
          l={l}
          mission={missions.find((m) => m.prestationId === l.prestationId) ?? null}
          ouvert={ouvert}
          surOuvrir={surOuvrir}
          surAgir={surAgir}
          moiId={moiId}
        />
      ))}
    </View>
  );
}

// ── Une mission sans lien ─────────────────────────────────────────────────────────────────────

function CarteMission({
  m, ouvert, surOuvrir, surAgir, moiId,
}: {
  m: MissionLivrable;
  ouvert: Ouvert;
  surOuvrir: (o: Ouvert) => void;
  surAgir: (a: () => Promise<void>) => Promise<void>;
  moiId: string;
}) {
  const ici = ouvert?.quoi === "depot" && ouvert.prestationId === m.prestationId;
  return (
    <View style={s.carte}>
      <EnteteMission m={m} />
      <Text style={s.manque}>Aucun lien déposé. La production n'a rien à ouvrir.</Text>
      {ici ? (
        <Formulaire
          intitule="Déposer un lien"
          demandeNom
          demandeCategorie
          urlInitiale=""
          surAnnuler={() => surOuvrir(null)}
          surEnvoyer={(v) => surAgir(() => deposerLien({
            prestationId: m.prestationId,
            nom: v.nom,
            url: v.url,
            categorie: v.categorie,
            typeMedia: v.typeMedia,
            transfertConfirme: v.transfert,
          }, moiId).then(() => undefined))}
        />
      ) : (
        <Bouton titre="Déposer un lien" onPress={() => surOuvrir({ quoi: "depot", prestationId: m.prestationId })} />
      )}
    </View>
  );
}

function EnteteMission({ m }: { m: MissionLivrable | null }) {
  if (!m) {
    // Un lien dont la mission n'est plus dans la liste : on ne l'escamote pas, on le dit.
    return <Text style={s.nom}>Mission hors de vos affectations</Text>;
  }
  return (
    <View style={{ gap: 3 }}>
      <Text style={s.nom} numberOfLines={2}>{m.client ?? "Sans client"}</Text>
      <Text style={s.detail} numberOfLines={2}>
        {[m.date ? dateLongue(m.date) : "Sans date", libelleCouverture(m.couverture)].filter(Boolean).join(" · ")}
      </Text>
      <Text style={s.reference}>{m.reference}</Text>
    </View>
  );
}

// ── Un lien ───────────────────────────────────────────────────────────────────────────────────

function CarteLien({
  l, mission, ouvert, surOuvrir, surAgir, moiId,
}: {
  l: MonLien;
  mission: MissionLivrable | null;
  ouvert: Ouvert;
  surOuvrir: (o: Ouvert) => void;
  surAgir: (a: () => Promise<void>) => Promise<void>;
  moiId: string;
}) {
  const enRedepot = ouvert?.quoi === "redepot" && ouvert.lienId === l.id;
  const enReponse = ouvert?.quoi === "reponse" && ouvert.lienId === l.id;
  const correction = l.statut === "correction_demandee";
  // Un lien remplacé ou archivé ne se corrige plus : c'est le lien qui l'a remplacé qui compte.
  const modifiable = !["remplace", "archive"].includes(l.statut);

  return (
    <View style={[s.carte, correction && s.carteCorrection]}>
      <EnteteMission m={mission} />

      <View style={s.lien}>
        <View style={s.ligne}>
          <Text style={s.lienNom} numberOfLines={2}>{l.nom}</Text>
          <Pastille ton={tonStatut(l.statut)} texte={LIBELLE_STATUT[l.statut] ?? l.statut} />
        </View>
        <Text style={s.lienDetail} numberOfLines={2}>
          {[
            LIBELLE_CATEGORIE[l.categorie ?? ""] ?? l.categorie,
            LIBELLE_TYPE_MEDIA[l.typeMedia ?? ""] ?? l.typeMedia,
            l.nombreFichiers !== null ? `${l.nombreFichiers} fichier${l.nombreFichiers > 1 ? "s" : ""}` : null,
          ].filter(Boolean).join(" · ")}
        </Text>
        {/* QUI A DEPOSE, ET SEULEMENT QUAND CE N'EST PAS SOI. Mesuré : 1 des 28 liens des missions
            d'Antoine a été déposé par Fouka, qui colle lui-même les liens qu'on lui envoie en
            privé. Voir « déposé par vous » vingt-sept fois n'apprend rien ; voir « déposé par
            Fouka Elkana » une fois explique un lien qu'on ne reconnaît pas. */}
        <Text style={s.lienDetail} numberOfLines={2}>
          {[
            l.parMoi ? null : l.deposePar ? `déposé par ${l.deposePar}` : "déposé par quelqu'un d'autre",
            l.depuis ? quand(l.depuis.slice(0, 10)) : null,
          ].filter(Boolean).join(" · ")}
        </Text>
        {/* L'adresse en TEXTE, jamais cliquable (règle 2). Sur deux lignes : une adresse coupée au
            milieu d'un mot ne permet plus de reconnaître le fournisseur, qui est tout ce qu'on
            vient lire ici. */}
        {l.url ? <Text style={s.url} numberOfLines={2}>{l.url}</Text> : null}
      </View>

      {/* LE MOTIF DE LA PRODUCTION, MOT POUR MOT. On ne le reformule pas, et on ne l'écrase
          jamais : répondre passe par un nouveau lien, pas par ce champ. */}
      {l.commentaire ? (
        <View style={correction ? s.motif : s.motifDoux}>
          <Text style={s.motifTitre}>
            {correction ? "Ce que la production demande" : "Note"}
          </Text>
          <Text style={correction ? s.motifTexte : s.motifTexteDoux}>« {l.commentaire} »</Text>
        </View>
      ) : null}

      {/* LA SAUVEGARDE. C'est la seule preuve qu'une carte mémoire peut être formatée : sans un
          lien confirmé sur la mission, `mission_cloture_manquant` refuse la clôture et
          `proteger_liberation_cartes` refuse de déclarer les cartes préparables. */}
      <Case
        texte={
          l.transfertConfirme
            ? "Fichiers copiés et vérifiés, sauvegarde confirmée"
            : "Mes fichiers sont copiés et vérifiés, le transfert est terminé."
        }
        sous={
          l.transfertConfirme
            ? null
            : "Sans cette confirmation, la production ne peut pas clôturer la mission, et vos cartes "
              + "ne doivent pas être formatées."
        }
        cochee={l.transfertConfirme}
        verrouillee={l.transfertConfirme || !modifiable}
        surChangement={
          l.transfertConfirme || !modifiable
            ? undefined
            : () => surAgir(() => confirmerSauvegarde(l, moiId))
        }
      />

      {enRedepot ? (
        <Formulaire
          intitule="Nouvelle adresse"
          aide={
            // CHANGER UNE ADRESSE DEJA VALIDEE N'EST PAS ANODIN, ET L'OS LE DIT. Le lien repart à
            // `a_verifier`, et `mission_cloture_manquant` recompte alors la mission comme bloquée :
            // une mission close peut redevenir ouverte. La phrase est celle de l'OS, mot pour mot.
            l.statut === "valide"
              ? "Ce lien a déjà été validé par la Production. Le modifier le remet à vérifier : elle "
                + "devra le revalider, et la mission ne pourra pas être clôturée en attendant."
              : "Le lien repart « à vérifier » avec cette adresse, et la production le relit. Ce qu'elle "
                + "vous a demandé reste affiché à côté."
          }
          urlInitiale={l.url}
          surAnnuler={() => surOuvrir(null)}
          surEnvoyer={(v) => surAgir(() => redeposerLien(l, v.url, moiId))}
        />
      ) : enReponse ? (
        <Formulaire
          intitule="Répondre à la production"
          aide={
            "Votre réponse part avec un nouveau lien, qui remplace celui-ci. L'ancien garde la demande "
            + "de la production, pour qu'on puisse vérifier qu'elle a bien été traitée. Laissez la même "
            + "adresse si elle est la bonne."
          }
          demandeMot
          urlInitiale={l.url}
          surAnnuler={() => surOuvrir(null)}
          surEnvoyer={(v) => surAgir(() => repondreParRemplacement(l, v.url, v.mot, moiId))}
        />
      ) : modifiable ? (
        <View style={s.actions}>
          <View style={{ flex: 1 }}>
            <Bouton
              titre={correction ? "Redéposer" : "Changer l'adresse"}
              secondaire={!correction}
              onPress={() => surOuvrir({ quoi: "redepot", lienId: l.id })}
            />
          </View>
          {correction ? (
            <View style={{ flex: 1 }}>
              <Bouton titre="Répondre" secondaire onPress={() => surOuvrir({ quoi: "reponse", lienId: l.id })} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ── Le formulaire, un seul pour les trois gestes ──────────────────────────────────────────────
//
// TROIS GESTES, UN SEUL DESSIN. Déposer, redéposer, répondre demandent tous une adresse ; ils
// diffèrent par ce qu'ils demandent en plus. Trois formulaires auraient fini par avoir trois
// validations d'adresse légèrement différentes — c'est exactement ce que raconte l'en-tête de
// `Base.tsx` à propos des trois boutons.

interface Saisie {
  url: string;
  nom: string;
  categorie: string;
  typeMedia: string;
  transfert: boolean;
  mot: string;
}

function Formulaire({
  intitule, aide, urlInitiale, demandeNom, demandeCategorie, demandeMot, surEnvoyer, surAnnuler,
}: {
  intitule: string;
  aide?: string;
  urlInitiale: string;
  demandeNom?: boolean;
  demandeCategorie?: boolean;
  demandeMot?: boolean;
  surEnvoyer: (v: Saisie) => Promise<void>;
  surAnnuler: () => void;
}) {
  const [url, setUrl] = useState(urlInitiale);
  const [nom, setNom] = useState("");
  const [categorie, setCategorie] = useState("final");
  const [typeMedia, setTypeMedia] = useState("photo");
  const [transfert, setTransfert] = useState(false);
  const [mot, setMot] = useState("");
  const [faute, setFaute] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const aideCategorie = CATEGORIES_OPERATEUR.find((c) => c.cle === categorie)?.aide ?? null;

  async function envoyer() {
    // ON DIT CE QUI MANQUE AVANT D'ENVOYER. `nom` et `url` sont NOT NULL en base, et sans forme
    // imposée : une chaîne vide passerait et la production ouvrirait un lien vide.
    const f = problemeAdresse(url) ?? (demandeNom ? problemeNom(nom) : null)
      ?? (demandeMot && mot.trim().length < 4
        ? "Dites en un mot ce que vous avez changé, ou pourquoi l'adresse reste la même."
        : null);
    if (f) { setFaute(f); return; }
    setFaute(null);
    setEnCours(true);
    try { await surEnvoyer({ url, nom, categorie, typeMedia, transfert, mot }); }
    finally { setEnCours(false); }
  }

  return (
    <View style={s.formulaire}>
      <Text style={s.formulaireTitre}>{intitule}</Text>
      {aide ? <Text style={s.formulaireAide}>{aide}</Text> : null}

      {demandeNom ? (
        <Champ
          label="Ce que contient ce lien"
          placeholder="U14 A contre Joinville"
          value={nom}
          onChangeText={setNom}
          // Le nom d'un livrable porte des majuscules : c'est le seul champ de l'application où
          // `autoCapitalize` doit reprendre le comportement normal, que `Champ` coupe pour les
          // adresses e-mail.
          autoCapitalize="sentences"
        />
      ) : null}

      <Champ
        label="Adresse du lien"
        placeholder="https://…"
        value={url}
        onChangeText={setUrl}
        keyboardType="url"
        autoComplete="off"
      />

      {demandeCategorie ? (
        <>
          <Options
            label="Ce que c'est"
            aide={aideCategorie}
            choix={CATEGORIES_OPERATEUR.map((c) => ({ cle: c.cle, libelle: c.libelle }))}
            actif={categorie}
            surChoix={setCategorie}
          />
          <Options
            label="Type de média"
            choix={TYPES_OPERATEUR.map((t) => ({ cle: t, libelle: LIBELLE_TYPE_MEDIA[t] ?? t }))}
            actif={typeMedia}
            surChoix={setTypeMedia}
          />
          <Case
            texte="Mes fichiers sont copiés et vérifiés, le transfert est terminé."
            sous={
              "Sans cette confirmation, la production ne peut pas clôturer la mission, et vos cartes "
              + "ne doivent pas être formatées. Vous pourrez la cocher plus tard."
            }
            cochee={transfert}
            surChangement={() => setTransfert((v) => !v)}
          />
        </>
      ) : null}

      {demandeMot ? (
        <Champ
          label="Votre réponse à la production"
          placeholder="Galerie complétée, 42 photos de plus"
          value={mot}
          onChangeText={setMot}
          autoCapitalize="sentences"
          multiline
          // `hauteur` et pas `style` : passer `style` écraserait tout le style du champ, fond et
          // bordure comprises, et donnerait un champ légèrement différent des autres.
          hauteur={92}
        />
      ) : null}

      <Erreur message={faute} />

      <View style={s.actions}>
        <View style={{ flex: 1 }}>
          <Bouton titre="Annuler" discret onPress={surAnnuler} desactive={enCours} />
        </View>
        <View style={{ flex: 1 }}>
          <Bouton titre="Enregistrer" onPress={envoyer} enCours={enCours} />
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  titre: { color: C.texte, fontFamily: P.titre, fontSize: T.titreEcran, letterSpacing: -0.6 },
  sous: { color: C.texteDoux, fontFamily: P.texte, fontSize: T.sousEcran, lineHeight: T.sousEcranHauteur },
  attente: { paddingVertical: E.xl * 2, alignItems: "center" },
  note: { color: C.texteFaible, fontFamily: P.texte, fontSize: 12, lineHeight: 17 },

  carte: {
    gap: E.s, padding: E.m, borderRadius: R.l,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.bordure,
  },
  carteCorrection: { borderColor: "rgba(240,68,94,.32)" },
  ligne: { flexDirection: "row", alignItems: "flex-start", gap: E.s },
  nom: { color: C.texte, fontFamily: P.titreFort, fontSize: 16 },
  detail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  reference: { color: C.texteFaible, fontFamily: P.texte, fontSize: 11.5 },
  manque: { color: C.alerteTexte, fontFamily: P.texteMoyen, fontSize: 13 },

  lien: {
    gap: 4, padding: E.s, borderRadius: R.m,
    backgroundColor: C.surfaceHaute, borderWidth: 1, borderColor: C.bordure,
  },
  lienNom: { flex: 1, color: C.texte, fontFamily: P.texteFort, fontSize: 14 },
  lienDetail: { color: C.texteDoux, fontFamily: P.texte, fontSize: 12.5 },
  url: { color: C.texteFaible, fontFamily: P.texte, fontSize: 11, lineHeight: 15 },

  motif: {
    gap: 3, padding: E.s, borderRadius: R.m,
    backgroundColor: "rgba(240,68,94,.09)", borderWidth: 1, borderColor: "rgba(240,68,94,.3)",
  },
  motifDoux: {
    gap: 3, padding: E.s, borderRadius: R.m,
    backgroundColor: "rgba(255,255,255,.04)", borderWidth: 1, borderColor: C.bordure,
  },
  motifTitre: {
    color: C.texteFaible, fontFamily: P.texteFort, fontSize: 10.5,
    textTransform: "uppercase", letterSpacing: 0.8,
  },
  motifTexte: { color: C.dangerTexte, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },
  motifTexteDoux: { color: C.texteDoux, fontFamily: P.texte, fontSize: 13.5, lineHeight: 19 },

  actions: { flexDirection: "row", gap: E.s },

  formulaire: {
    gap: E.m, padding: E.m, borderRadius: R.m,
    backgroundColor: "rgba(36,84,255,.07)", borderWidth: 1, borderColor: "rgba(36,84,255,.3)",
  },
  formulaireTitre: { color: C.texte, fontFamily: P.titreFort, fontSize: 15 },
  formulaireAide: { color: C.texteDoux, fontFamily: P.texte, fontSize: 12.5, lineHeight: 18 },
});
