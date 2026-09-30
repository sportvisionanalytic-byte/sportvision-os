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
// LE RÈGLEMENT : L'ÉTAT, PAS LE TEXTE, ET PAS DE BOUTON « ACCEPTER ». C'est le choix le plus
// discutable de cet écran, donc il est motivé ici. La base accepterait l'écriture
// (`validations_own` permet à chacun d'insérer sa propre validation), et le bouton marcherait. Mais
// le texte des neuf chapitres n'est pas en base : il faudrait en garder une copie dans
// l'application. Or ce texte est celui qu'on ACCEPTE — sanctions, exclusion, confidentialité, et
// une version figée à « 1.0 ». Une copie qui dérive, c'est quelqu'un qui accepte un texte qui n'est
// plus celui en vigueur, sans le savoir. On affiche donc où chacun en est, on nomme les chapitres
// avec les mots de l'OS, et on dit où se lit et s'accepte le texte. Une case cochée sur un texte
// qu'on ne peut pas lire n'est pas un consentement.
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
// Les neuf chapitres de `SV_REGLEMENT`, leurs identifiants et leurs titres, mot pour mot. Rien
// d'autre : pas une ligne de leur contenu. Les identifiants sont ceux que `centre_validations`
// enregistre — vérifié : les 9 `chapitre_id` distincts en base sont exactement ceux-là.
const CHAPITRES: { id: string; titre: string }[] = [
  { id: "comportement", titre: "Chapitre 1 — Respect et comportement" },
  { id: "ponctualite", titre: "Chapitre 2 — Ponctualité" },
  { id: "disponibilites", titre: "Chapitre 3 — Disponibilités et absences" },
  { id: "tenue", titre: "Chapitre 4 — Tenue et présentation" },
  { id: "clients", titre: "Chapitre 5 — Relation avec les clients" },
  { id: "confidentialite", titre: "Chapitre 6 — Confidentialité et propriété" },
  { id: "materiel", titre: "Chapitre 7 — Matériel et kits" },
  { id: "communication", titre: "Chapitre 8 — Communication interne" },
  { id: "sanctions", titre: "Chapitre 9 — Sanctions & Pénalités" },
];

export interface Chapitre {
  id: string;
  titre: string;
  accepte: boolean;
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
  const [ressources, validations, equipe] = await Promise.all([
    supabase
      .from("centre_ressources")
      .select("id, type, titre, description, contenu, url, icone, actif, ordre")
      .order("ordre", { ascending: true, nullsFirst: false }),
    supabase
      .from("centre_validations")
      .select("chapitre_id")
      .eq("collaborateur_id", moiId)
      .eq("type", "accepte"),
    supabase
      .from("profiles")
      .select("id, prenom, nom, role, telephone, actif")
      .order("prenom", { ascending: true }),
  ]);

  for (const r of [ressources, validations, equipe]) if (r.error) throw r.error;

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

  const acceptes = new Set(
    ((validations.data ?? []) as unknown as { chapitre_id: string | null }[])
      .map((v) => v.chapitre_id)
      .filter((x): x is string => !!x),
  );
  const chapitres: Chapitre[] = CHAPITRES.map((c) => ({ ...c, accepte: acceptes.has(c.id) }));

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
    contacts,
  };
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
