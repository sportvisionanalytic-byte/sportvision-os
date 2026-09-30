// LA MESSAGERIE INTERNE DE L'OS (30/09/2026).
//
// UNE SEULE TABLE, `messages`, ET DEUX SORTES DE CONVERSATION. Mesuré en base : 6 colonnes,
// `expediteur_id`, `destinataire_id`, `contenu`, `lue`, `created_at`. Un `destinataire_id` NUL
// n'est pas une donnée manquante, c'est le message d'équipe — le « Broadcast » de l'OS, visible
// par tout le staff. C'est la seule règle métier de cette table, et elle est déjà écrite dans la
// RLS (`msg_select`) : on ne la réécrit pas ici.
//
// CE QUE LA BASE BORNE DÉJÀ, ET QU'ON NE BORNE PAS UNE SECONDE FOIS :
//   · `msg_select` = (je suis l'expéditeur) OU (je suis le destinataire) OU (message d'équipe et
//     `is_staff()`). Mesuré avec le jeton d'Antoine (opérateur, role='photo') : 6 lignes sur les
//     14 de la table. L'écran ne filtre donc rien sur l'identité.
//   · `msg_update` = je ne peux marquer « lu » que ce qui m'est adressé.
//   · `profiles` : « Staff lecture annuaire » = `is_staff() AND (is_admin_or_rh() OR
//     profile_shares_pole_with_caller(id))`. Mesuré avec le jeton d'Antoine : 18 profils sur 18.
//     Le périmètre est donc ouvert AUJOURD'HUI ; s'il se referme un jour, la liste des
//     correspondants se réduira toute seule, ce qui est le comportement voulu.
//
// PAS DE SONDAGE TOUTES LES 15 SECONDES. L'OS relit la conversation ET la liste ET les badges
// toutes les 15 s, sans arrêt, parce qu'un navigateur ouvert sur un bureau ne coûte rien. Sur un
// téléphone en 4G, au bord d'un terrain, c'est de la batterie et de la donnée dépensées toute la
// journée. `messages` est publiée dans `supabase_realtime` (vérifié dans
// `pg_publication_tables`) : on écoute les insertions, et on ne relit que quand il y a quelque
// chose à relire.
import { supabase } from "./supabase";

export interface Correspondant {
  id: string;
  nom: string;
  role: string | null;
  /** Le libellé du métier, jamais l'identifiant technique du rôle. */
  metier: string;
  telephone: string | null;
}

/** Les mêmes libellés que `session.tsx`, qui les tient pour la personne connectée. */
const METIERS: Record<string, string> = {
  admin: "Administration",
  prod: "Responsable production",
  photo: "Opérateur terrain",
  cm: "Community manager",
  com: "Communication",
  sec: "Secrétariat",
  compta: "Comptabilité",
};

export function metierDe(role: string | null | undefined): string {
  return (role && METIERS[role]) || "SportVision";
}

/** La clé d'une conversation : « equipe » pour le broadcast, sinon l'identifiant de la personne. */
export type CleConversation = string;
export const EQUIPE: CleConversation = "equipe";

export interface Message {
  id: string;
  expediteurId: string;
  destinataireId: string | null;
  contenu: string;
  lue: boolean;
  quand: string;
  /** Vrai quand c'est moi qui l'ai écrit : la bulle change de côté et de couleur. */
  demoi: boolean;
}

export interface Conversation {
  cle: CleConversation;
  nom: string;
  sousTitre: string;
  role: string | null;
  /** Combien de messages de cette conversation m'attendent. */
  nonLus: number;
  dernier: string | null;
  dernierQuand: string | null;
}

export interface Messagerie {
  equipe: Correspondant[];
  conversations: Conversation[];
  /** Le total, pour l'en-tête. Somme des `nonLus`, pas une seconde requête. */
  nonLus: number;
}

interface LigneMessage {
  id: string;
  expediteur_id: string;
  destinataire_id: string | null;
  contenu: string | null;
  lue: boolean | null;
  created_at: string | null;
}

/**
 * Les 400 derniers messages qui me concernent, et l'équipe.
 *
 * UNE SEULE LECTURE POUR LA LISTE ET LES COMPTEURS. L'OS pose trois requêtes (les non-lus, les
 * profils, puis la conversation ouverte) ; ici la liste des conversations, le dernier message et
 * le nombre de non-lus se déduisent tous du même tableau. Sur 14 messages en base ça ne change
 * rien ; sur 4 000 ça évite trois allers-retours en 4G.
 *
 * 400 est un plafond, pas une vérité : au-delà, les conversations les plus anciennes
 * n'apparaîtront plus dans la liste tant qu'on ne les rouvre pas. Mesuré aujourd'hui : 14 lignes
 * dans toute la table, on est loin du plafond.
 */
export async function lireMessagerie(moiId: string): Promise<Messagerie> {
  const [equipe, messages] = await Promise.all([lireEquipe(), lireDerniers()]);

  const parId = new Map(equipe.map((c) => [c.id, c]));

  // La conversation d'équipe existe TOUJOURS, même sans un seul message : c'est un canal, pas une
  // discussion qui commencerait à sa première phrase. Mesuré : zéro message d'équipe en base
  // aujourd'hui — l'afficher vide avec « Envoyez le premier ! » est justement ce qui la fera
  // exister.
  const equipeMsgs = messages.filter((m) => m.destinataire_id === null);
  const conversations: Conversation[] = [{
    cle: EQUIPE,
    nom: "Équipe",
    sousTitre: "Visible par toute l'équipe",
    role: null,
    nonLus: 0,
    dernier: equipeMsgs.length ? (equipeMsgs[0].contenu ?? "") : null,
    dernierQuand: equipeMsgs.length ? equipeMsgs[0].created_at : null,
  }];

  // Les conversations privées, dans l'ordre du dernier message. `messages` arrive déjà trié du
  // plus récent au plus ancien : le premier rencontré pour un interlocuteur est donc le dernier
  // échangé avec lui.
  const vues = new Set<string>();
  for (const m of messages) {
    if (m.destinataire_id === null) continue;
    const autre = m.expediteur_id === moiId ? m.destinataire_id : m.expediteur_id;
    if (!autre || autre === moiId || vues.has(autre)) continue;
    vues.add(autre);
    const p = parId.get(autre);
    // UN INTERLOCUTEUR SANS PROFIL VISIBLE, ÇA ARRIVE VRAIMENT — mesuré le 30/09. La policy
    // RESTRICTIVE `cm_hors_perimetre_profiles` ferme l'annuaire interne à tout compte
    // `role = 'cm'` (`est_cm_cloisonne()` est vrai pour eux tous) : Tony et chris, les deux
    // community managers, voient UN seul profil SportVision, le leur. Leurs messages, eux, restent
    // lisibles — `msg_select` ne regarde pas l'annuaire. Résultat : une conversation réelle dont on
    // ne connaît pas le nom de l'autre.
    //
    // L'OS la fait purement disparaître (il construit sa liste depuis les profils, pas depuis les
    // messages) : Tony ne peut pas rouvrir la conversation qu'Antoine a commencée avec lui. Ici on
    // la garde et on dit pourquoi le nom manque — un message reçu ne doit pas devenir injoignable.
    conversations.push({
      cle: autre,
      nom: p?.nom ?? "Membre de l'équipe",
      sousTitre: p ? p.metier : "Nom non visible depuis votre compte",
      role: p?.role ?? null,
      nonLus: messages.filter(
        (x) => x.destinataire_id === moiId && x.expediteur_id === autre && x.lue !== true,
      ).length,
      dernier: m.contenu ?? "",
      dernierQuand: m.created_at,
    });
  }

  return {
    equipe,
    conversations,
    nonLus: conversations.reduce((t, c) => t + c.nonLus, 0),
  };
}

async function lireDerniers(): Promise<LigneMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, expediteur_id, destinataire_id, contenu, lue, created_at")
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) throw error;
  return (data ?? []) as unknown as LigneMessage[];
}

/** Tout le monde à qui je peux écrire. La RLS de `profiles` décide, pas cette fonction. */
export async function lireEquipe(): Promise<Correspondant[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, prenom, nom, role, telephone, actif")
    .order("prenom", { ascending: true });
  if (error) throw error;

  type L = { id: string; prenom: string | null; nom: string | null; role: string | null; telephone: string | null; actif: boolean | null };
  return ((data ?? []) as unknown as L[])
    // Un compte désactivé ne doit pas apparaître comme un correspondant : le message partirait
    // vers une boîte que personne ne relève.
    .filter((p) => p.actif !== false)
    .map((p) => ({
      id: String(p.id),
      nom: [p.prenom, p.nom].filter(Boolean).join(" ").trim() || "Membre",
      role: p.role ?? null,
      metier: metierDe(p.role),
      // Mesuré le 30/09 : 5 numéros sur 18. Un bouton « Appeler » n'apparaît donc que quand le
      // numéro existe vraiment, sinon c'est une promesse cassée treize fois sur dix-huit.
      telephone: (p.telephone ?? "").trim() || null,
    }));
}

/**
 * Le fil d'une conversation, du plus ancien au plus récent.
 *
 * Le `or(...)` des conversations privées est celui de l'OS, mot pour mot : les deux sens de
 * l'échange. Il n'ajoute aucune sécurité — la RLS a déjà tranché — il choisit UN interlocuteur
 * parmi ceux que j'ai le droit de lire.
 */
export async function lireFil(moiId: string, cle: CleConversation): Promise<Message[]> {
  const base = supabase
    .from("messages")
    .select("id, expediteur_id, destinataire_id, contenu, lue, created_at")
    .order("created_at", { ascending: true })
    .limit(200);

  const { data, error } = cle === EQUIPE
    ? await base.is("destinataire_id", null)
    : await base.or(
        `and(expediteur_id.eq.${moiId},destinataire_id.eq.${cle}),` +
        `and(expediteur_id.eq.${cle},destinataire_id.eq.${moiId})`,
      );
  if (error) throw error;

  return ((data ?? []) as unknown as LigneMessage[]).map((m) => ({
    id: String(m.id),
    expediteurId: String(m.expediteur_id),
    destinataireId: m.destinataire_id ?? null,
    contenu: m.contenu ?? "",
    lue: m.lue === true,
    quand: m.created_at ?? "",
    demoi: String(m.expediteur_id) === moiId,
  }));
}

/**
 * Marquer comme lus les messages reçus d'une personne.
 *
 * ON NE L'APPELLE QUE S'IL Y A QUELQUE CHOSE À MARQUER, et c'est délibéré. La règle 4 du contrat
 * exige de lever quand un `update` ne rend aucune ligne, parce que la RLS refuse en silence. Mais
 * « aucune ligne » veut aussi dire « il n'y avait rien de non lu », ce qui est le cas normal et
 * fréquent. L'appelant sait déjà combien de non-lus il a comptés : à lui de ne pas appeler pour
 * rien, et alors zéro ligne est bien un refus.
 */
export async function marquerLu(moiId: string, expediteurId: string): Promise<void> {
  const { data, error } = await supabase
    .from("messages")
    .update({ lue: true })
    .eq("destinataire_id", moiId)
    .eq("expediteur_id", expediteurId)
    .eq("lue", false)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || !data.length) {
    throw new Error("Ces messages n'ont pas pu être marqués comme lus : ils ne vous sont pas adressés.");
  }
}

/**
 * Envoyer un message.
 *
 * `.select("id")` n'est pas une coquetterie : `msg_insert` vérifie `auth.uid() = expediteur_id`,
 * et une politique RESTRICTIVE ferme la table aux comptes OS désactivés. Dans les deux cas
 * PostgREST rend zéro ligne et zéro erreur — le message semblerait parti.
 */
export async function envoyer(moiId: string, cle: CleConversation, texte: string): Promise<Message> {
  const contenu = texte.trim();
  if (!contenu) throw new Error("Message vide.");

  const ligne = {
    expediteur_id: moiId,
    destinataire_id: cle === EQUIPE ? null : cle,
    contenu,
    lue: false,
  };

  const { data, error } = await supabase
    .from("messages")
    .insert(ligne)
    .select("id, expediteur_id, destinataire_id, contenu, lue, created_at");
  if (error) throw new Error(error.message);
  if (!data || !data.length) {
    throw new Error("Message non envoyé : la base a refusé l'écriture. Votre compte est peut-être désactivé.");
  }

  const m = (data as unknown as LigneMessage[])[0];
  return {
    id: String(m.id),
    expediteurId: String(m.expediteur_id),
    destinataireId: m.destinataire_id ?? null,
    contenu: m.contenu ?? contenu,
    lue: false,
    quand: m.created_at ?? new Date().toISOString(),
    demoi: true,
  };
}

/**
 * Être prévenu d'un nouveau message, sans sonder.
 *
 * `messages` fait partie de la publication `supabase_realtime`, vérifié dans
 * `pg_publication_tables`. Le flux respecte la RLS : on ne reçoit que ce qu'on aurait pu lire.
 *
 * SI LE TEMPS RÉEL NE PASSE PAS — réseau d'entreprise, coupure, quota — l'écran ne se met plus à
 * jour tout seul. C'est pour ça que l'écran garde aussi le glisser-pour-rafraîchir et relit en
 * rouvrant : une messagerie qui n'affiche jamais rien de neuf serait pire qu'un sondage.
 *
 * `nom` N'EST PAS DÉCORATIF. La liste et le fil ouvert écoutent en même temps — le fil est monté
 * par-dessus la liste, qui reste vivante derrière. Deux canaux de même nom sur la même connexion
 * se marchent dessus : le second abonnement n'aboutit pas, et c'est l'écran ouvert qui perd le
 * temps réel, donc exactement celui qu'on regarde. Chaque appelant donne donc son propre nom.
 */
export function ecouterMessages(nom: string, surNouveau: () => void): () => void {
  const canal = supabase
    .channel(`os-messagerie:${nom}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => surNouveau())
    .subscribe();
  return () => { supabase.removeChannel(canal); };
}

/**
 * « 14h32 » — l'heure du message, comptée à Paris.
 *
 * PAS L'HEURE DU TÉLÉPHONE, et c'est une leçon déjà payée ailleurs dans cet écosystème : un
 * « aujourd'hui » calculé sur le fuseau de l'appareil avait coupé l'accès d'un CM à son club entre
 * minuit et 2 h. Ici l'équipe travaille en France ; deux personnes qui relisent le même échange, une
 * en déplacement, doivent y voir la même heure, sinon le séparateur de journée et l'heure se
 * contredisent.
 */
export function heureDe(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris", hourCycle: "h23",
  }).format(d).replace(":", "h");
}

/**
 * Le repère de la LISTE des conversations : « 14h32 » aujourd'hui, « hier », sinon « 13 sept. ».
 *
 * VU À L'ÉCRAN LE 30/09 : la liste affichait « 02h13 » sur un message qui ne datait pas du jour.
 * Dans le fil ouvert, `heureDe` suffit — un séparateur de journée porte la date juste au-dessus.
 * Dans la liste il n'y en a aucun, et « 02h13 » tout seul se lit « cette nuit ». On ne rappelle pas
 * quelqu'un à 6 h du matin pour un message qui a trois semaines.
 *
 * « Aujourd'hui » se compte à Paris, comme partout dans cet écosystème.
 */
export function quandCourt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const aParis = (x: Date) =>
    new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const jour = aParis(d);
  const aujourdhui = aParis(new Date());
  if (jour === aujourdhui) return heureDe(iso);
  const hier = aParis(new Date(Date.now() - 86400000));
  if (jour === hier) return "hier";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric", month: "short", timeZone: "Europe/Paris",
  }).format(d);
}

/** « lundi 1 septembre » — le séparateur de journée, comme dans l'OS. */
export function jourDe(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris",
  }).format(d);
}
