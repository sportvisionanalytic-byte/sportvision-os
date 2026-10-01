// LE CENTRE SPORTVISION, VU DE L'APPLICATION (30/09/2026).
//
// POURQUOI CET ÉCRAN EXISTE. Fouka, le 09/09 : « un opérateur qui cherche une règle sur le terrain
// ne sait pas depuis quel écran y accéder ». C'est un écran de LECTURE qu'on ouvre debout, sous la
// pluie, avec une main : la recherche et la taille du texte passent avant tout le reste.
//
// CE QUI EST EN BASE, ET CE QUI N'Y EST PAS — mesuré avant d'écrire :
//
//   · EN BASE : `centre_ressources`, 12 fiches réelles, toutes de type « texte », avec un contenu
//     de 166 à 414 caractères. Et ce sont EXACTEMENT les fiches qu'on cherche sur un terrain :
//     « Check-list matériel avant départ », « Réglages de départ recommandés », « Check-list
//     drone », « Check-list Veo », « Liste de plans match / tournoi ». C'est le cœur de cet écran.
//   · EN BASE AUSSI : `centre_validations`, 81 acceptations de chapitres de règlement, 9 chapitres
//     distincts, 9 personnes.
//   · PAS EN BASE : le TEXTE du règlement, des procédures, des rôles, du matériel, de la FAQ, de
//     l'organisation. Tout cela vit dans `SportVision-OS-Full.html` (`SV_REGLEMENT`, et une
//     douzaine de fonctions `renderCentre*` qui écrivent le texte en dur).
//
// PIÈGE ÉCARTÉ SUR `publie`. Les 12 fiches ont `publie = false`. On pourrait croire qu'elles sont
// invisibles : c'est faux, et l'avoir cru aurait produit un écran vide à tort. La policy `cr_read`
// ne regarde pas `publie` du tout — elle dit `(actif = true AND is_staff()) OR admin/prod` — et
// `renderCentreRessources` dans l'OS ne filtre pas `publie` non plus : elle lit tout et badge
// « Masquée » ce qui n'est pas `actif`. Mesuré avec le jeton d'Antoine (opérateur) : 12 fiches
// visibles sur 12. La colonne `publie` ne sert donc plus à rien, et l'écran ne s'en sert pas.
//
// LE RÈGLEMENT SE LIT ET S'ACCEPTE ICI, DEPUIS LE 01/10/2026. La version du 30/09 de ce fichier
// n'affichait QUE l'état des neuf chapitres, sans leur texte et sans bouton « Accepter », et elle
// expliquait pourquoi : « le texte des neuf chapitres n'est pas en base : il faudrait en garder une
// copie dans l'application. Or ce texte est celui qu'on ACCEPTE. Une copie qui dérive, c'est
// quelqu'un qui accepte un texte qui n'est plus celui en vigueur, sans le savoir. »
//
// Le raisonnement était bon, la conclusion a changé parce que la base a changé. La migration v381
// met le règlement en base : `centre_reglement_chapitres` (9 lignes, avec leur VERSION en vigueur)
// et `centre_reglement_sections` (27 sections, 116 points). Il n'y a plus de copie : l'application
// affiche le texte de la base, et renvoie à l'acceptation la version qu'elle a affichée.
//
// ET C'EST LA BASE QUI REFUSE UNE VERSION DÉPASSÉE, PAS L'ÉCRAN. Le déclencheur
// `centre_validation_version_en_vigueur` de la v381 lève « Version dépassée : vous acceptez la
// version 0.9 du chapitre « comportement », or la version en vigueur est la 1.0 » — vérifié par le
// chemin réel. L'écran n'a donc aucune règle de version à tenir : il envoie ce qu'il a montré, et
// si le texte a été republié entre-temps, le refus vient de la base avec son propre message.
import { supabase } from "./supabase";

// ── LES RESSOURCES ────────────────────────────────────────────────────────────────────────────

export interface Ressource {
  id: string;
  titre: string;
  description: string | null;
  contenu: string | null;
  url: string | null;
  type: string;
  icone: string | null;
  /** Faux = « Masquée » dans l'OS. Seuls l'administration et la production la voient encore. */
  actif: boolean;
}

// ── LE RÈGLEMENT ──────────────────────────────────────────────────────────────────────────────
//
// PLUS AUCUN CONTENU ICI. Les neuf chapitres, leurs titres, leurs sections et leurs 116 points
// viennent de `centre_reglement_chapitres` et `centre_reglement_sections` (v381). Les identifiants
// sont ceux que `centre_validations` enregistre déjà sur 81 lignes.

export interface Section {
  id: string;
  titre: string;
  /** Les puces, dans l'ordre de la base. */
  points: string[];
}

export interface Chapitre {
  id: string;
  /** Le numéro, séparé du titre en base : l'écran écrit « Chapitre 1 » sans tiret long. */
  numero: number;
  titre: string;
  icone: string | null;
  /** La version EN VIGUEUR. C'est elle qu'on renvoie en acceptant, jamais une valeur en dur. */
  version: string;
  sections: Section[];
  accepte: boolean;
  /** La version que j'ai acceptée, quand ce n'est pas celle en vigueur. */
  versionAcceptee: string | null;
  /** Vrai quand j'ai accepté une version ANTÉRIEURE : à relire et à réaccepter. */
  aRelire: boolean;
}

// ── QUI CONTACTER ─────────────────────────────────────────────────────────────────────────────
//
// La table sujet → rôle de `renderCentreContacts`, verbatim. C'est la seule partie du Centre qui
// mène à une ACTION dans cette application : le rôle se résout en personnes réelles depuis
// `profiles`, et un appui ouvre la conversation dans la Messagerie. L'OS fait exactement ça
// (`switchView('msg')` puis `msgOpenConvByRole`).
export const CONTACTS: { sujet: string; role: string; titre: string }[] = [
  { sujet: "Administratif (contrats, documents)", role: "sec", titre: "Secrétaire" },
  { sujet: "Production & terrain", role: "prod", titre: "Responsable Production" },
  { sujet: "Paiement, frais, rémunération", role: "compta", titre: "Comptable" },
  { sujet: "Vente ou demande client", role: "com", titre: "Commercial" },
  { sujet: "Contenu et réseaux sociaux", role: "cm", titre: "Community Manager" },
  { sujet: "Incident grave ou situation exceptionnelle", role: "admin", titre: "Administrateur" },
];

/** Le texte d'escalade du Centre, mot pour mot. */
export const ESCALADE =
  "Si votre interlocuteur principal n'est pas disponible et que la situation est urgente → " +
  "contactez directement l'Administrateur. Pour une urgence terrain le Jour J : appelez en direct.";

/** Le conseil d'orientation, mot pour mot lui aussi. */
export const ORIENTATION =
  "En cas de doute sur qui contacter, privilégiez le Responsable Production pour tout ce qui est " +
  "opérationnel, et le Secrétaire pour l'administratif.";

export interface Personne {
  id: string;
  nom: string;
  role: string | null;
  telephone: string | null;
}

export interface Contact {
  sujet: string;
  role: string;
  titre: string;
  /** Les personnes de ce rôle que la base m'autorise à voir. Parfois aucune. */
  personnes: Personne[];
}

export interface Centre {
  ressources: Ressource[];
  chapitres: Chapitre[];
  chapitresAcceptes: number;
  /** Combien de chapitres j'ai acceptés dans une version qui n'est plus en vigueur. */
  chapitresARelire: number;
  contacts: Contact[];
}

/**
 * Tout le Centre, en une lecture.
 *
 * ON FILTRE LES VALIDATIONS SUR SON PROPRE IDENTIFIANT. `validations_own` ouvre la table entière à
 * l'administration et au secrétariat : sans ce filtre, Sabrina verrait les 81 acceptations de
 * l'équipe et son propre règlement s'afficherait « 9 sur 9 » alors qu'elle n'en a accepté que
 * quelques-uns. La base a raison de les lui montrer ailleurs, pas sur son écran à elle.
 */
export async function lireCentre(moiId: string): Promise<Centre> {
  const [ressources, chapitresBase, sectionsBase, validations, equipe] = await Promise.all([
    supabase
      .from("centre_ressources")
      .select("id, type, titre, description, contenu, url, icone, actif, ordre")
      .order("ordre", { ascending: true, nullsFirst: false }),
    supabase
      .from("centre_reglement_chapitres")
      .select("id, numero, titre, icone, version, ordre")
      .order("ordre", { ascending: true }),
    supabase
      .from("centre_reglement_sections")
      .select("id, chapitre_id, ordre, titre, points")
      .order("ordre", { ascending: true }),
    supabase
      .from("centre_validations")
      .select("chapitre_id, version")
      .eq("collaborateur_id", moiId)
      .eq("type", "accepte"),
    supabase
      .from("profiles")
      .select("id, prenom, nom, role, telephone, actif")
      .order("prenom", { ascending: true }),
  ]);

  for (const r of [ressources, chapitresBase, sectionsBase, validations, equipe]) if (r.error) throw r.error;

  type LigneRessource = {
    id: string; type: string | null; titre: string; description: string | null;
    contenu: string | null; url: string | null; icone: string | null; actif: boolean | null;
  };
  const fiches: Ressource[] = ((ressources.data ?? []) as unknown as LigneRessource[]).map((r) => ({
    id: String(r.id),
    titre: r.titre,
    description: (r.description ?? "").trim() || null,
    contenu: (r.contenu ?? "").trim() || null,
    url: (r.url ?? "").trim() || null,
    type: r.type ?? "texte",
    icone: (r.icone ?? "").trim() || null,
    actif: r.actif !== false,
  }));

  // ON GARDE LA VERSION ACCEPTÉE, PAS SEULEMENT LE FAIT DE L'AVOIR ACCEPTÉ. Une personne peut avoir
  // accepté la 1.0 d'un chapitre republié depuis en 1.1 : la base garde les deux lignes, et ce
  // n'est pas la même chose que « accepté ». Sans cette nuance, un chapitre republié s'afficherait
  // coché et personne ne relirait le nouveau texte.
  const acceptees = new Map<string, string[]>();
  for (const v of (validations.data ?? []) as unknown as { chapitre_id: string | null; version: string | null }[]) {
    if (!v.chapitre_id) continue;
    const liste = acceptees.get(v.chapitre_id) ?? [];
    if (v.version) liste.push(v.version);
    acceptees.set(v.chapitre_id, liste);
  }

  type LigneSection = { id: string; chapitre_id: string; ordre: number; titre: string; points: string[] | null };
  const parChapitre = new Map<string, Section[]>();
  for (const x of (sectionsBase.data ?? []) as unknown as LigneSection[]) {
    const liste = parChapitre.get(String(x.chapitre_id)) ?? [];
    liste.push({ id: String(x.id), titre: x.titre, points: (x.points ?? []).map((p) => String(p)) });
    parChapitre.set(String(x.chapitre_id), liste);
  }

  type LigneChapitre = {
    id: string; numero: number; titre: string; icone: string | null; version: string; ordre: number;
  };
  const chapitres: Chapitre[] = ((chapitresBase.data ?? []) as unknown as LigneChapitre[]).map((c) => {
    const versions = acceptees.get(String(c.id)) ?? [];
    const enVigueur = versions.includes(c.version);
    return {
      id: String(c.id),
      numero: Number(c.numero),
      titre: c.titre,
      icone: (c.icone ?? "").trim() || null,
      version: String(c.version),
      sections: parChapitre.get(String(c.id)) ?? [],
      accepte: enVigueur,
      versionAcceptee: enVigueur ? c.version : (versions.length ? versions[versions.length - 1] : null),
      aRelire: !enVigueur && versions.length > 0,
    };
  });

  type LigneProfil = {
    id: string; prenom: string | null; nom: string | null; role: string | null;
    telephone: string | null; actif: boolean | null;
  };
  const personnes: Personne[] = ((equipe.data ?? []) as unknown as LigneProfil[])
    .filter((p) => p.actif !== false)
    .map((p) => ({
      id: String(p.id),
      nom: [p.prenom, p.nom].filter(Boolean).join(" ").trim() || "Membre",
      role: p.role ?? null,
      // Mesuré : 5 numéros sur 18. Le bouton d'appel n'apparaît donc que quand il y a un numéro.
      telephone: (p.telephone ?? "").trim() || null,
    }));

  // L'OS prend LA première personne du rôle (`limit 1`). On les liste toutes : il y a deux
  // responsables de production et deux community managers en base, et sur un terrain le bon
  // interlocuteur est celui qui décroche, pas celui dont le prénom vient en premier.
  const contacts: Contact[] = CONTACTS.map((c) => ({
    ...c,
    personnes: personnes.filter((p) => p.role === c.role),
  }));

  return {
    ressources: fiches,
    chapitres,
    chapitresAcceptes: chapitres.filter((c) => c.accepte).length,
    chapitresARelire: chapitres.filter((c) => c.aRelire).length,
    contacts,
  };
}

/**
 * Accepter un chapitre du règlement.
 *
 * ON ENVOIE LA VERSION QU'ON A AFFICHÉE, et c'est le point entier de ce geste. Le déclencheur
 * `centre_validation_version_en_vigueur` (v381) refuse toute autre version, avec un message qui dit
 * quoi faire : « Version dépassée […] Rechargez le règlement pour lire le texte à jour. » On relaie
 * ce message tel quel plutôt que d'en écrire un autre : c'est la base qui sait ce qui est en
 * vigueur, et son texte est déjà juste.
 *
 * `.select("id")` ET ON LÈVE SI LE TABLEAU EST VIDE (règle 4). `validations_own` n'autorise que sa
 * propre ligne, et PostgREST rendrait zéro ligne sans erreur si elle refusait. Un « accepté » qui
 * n'est pas en base, sur un règlement, c'est le pire des faux succès.
 */
export async function accepterChapitre(
  moiId: string,
  chapitreId: string,
  version: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("centre_validations")
    .insert({ collaborateur_id: moiId, chapitre_id: chapitreId, version, type: "accepte" })
    .select("id");

  // Déjà accepté dans cette version : l'index unique (collaborateur, chapitre, version) refuse, et
  // l'état voulu est déjà celui-là. Un double appui n'est pas une faute.
  if (error && error.code === "23505") return;
  if (error) throw new Error(error.message);
  if (!data || !data.length) {
    throw new Error(
      "Acceptation non enregistrée : la base a refusé l'écriture. " +
      "Votre compte n'a peut-être plus accès à l'OS.",
    );
  }
}

/**
 * La recherche.
 *
 * SANS ACCENTS ET SANS CASSE, et ce n'est pas un détail de confort : on tape « veo » d'une main,
 * pas « Veo », et « colorimetrie » sans l'accent aigu. Une recherche qui exige l'accent ne trouve
 * rien et on croit que la fiche n'existe pas.
 */
export function normaliser(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function ressourceCorrespond(r: Ressource, requete: string): boolean {
  const q = normaliser(requete);
  if (!q) return true;
  // Le contenu compte autant que le titre : on cherche « batterie », et c'est dans le corps de
  // trois check-lists, dans le titre d'aucune.
  return normaliser(`${r.titre} ${r.description ?? ""} ${r.contenu ?? ""}`).includes(q);
}
