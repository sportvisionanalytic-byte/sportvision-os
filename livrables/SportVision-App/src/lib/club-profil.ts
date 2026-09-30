// MON PROFIL (30/09/2026).
//
// OÙ VIT L'IDENTITÉ D'UNE PERSONNE, ET OÙ ELLE NE VIT PAS.
//
// Club+ range prénom, nom, téléphone et langue dans `auth.users.user_metadata` — pas de table
// `profiles` pour cet usage — et les écrit par l'API Auth, qui ne laisse modifier que ses propres
// métadonnées. Aucune policy à prévoir, aucun droit à accorder.
//
// IL EXISTE UN SECOND PRÉNOM, ET C'EST LÀ QUE C'EST PIÉGEUX. `club_members.prenom` porte le nom
// que LE CLUB a saisi en invitant la personne. Mesuré en base le 30/09 : les trois comptes réels
// examinés ont un `club_members.prenom` rempli et des métadonnées VIDES. Tous les « Bonjour X » de
// l'application viennent donc aujourd'hui du club, pas du compte.
//
// ON LIT LES DEUX, DANS CET ORDRE : ce que la personne a écrit sur elle-même d'abord, ce que le
// club a saisi ensuite. Sans cet ordre, quelqu'un corrigerait son prénom et l'application
// continuerait de l'appeler autrement — le genre de défaut qui fait croire que rien n'a marché.
//
// ON N'ÉCRIT QUE LES MÉTADONNÉES, JAMAIS `club_members`. La policy `cm_self_update` laisse bien
// une personne modifier sa propre ligne, et le déclencheur `protect_sensitive_club_member_fields`
// verrouille le rôle, le statut, le périmètre d'équipes et le club — donc, techniquement, écrire
// le prénom là passerait. On s'en abstient quand même : `club_members` est la table qui porte les
// DROITS, et un formulaire de profil n'a rien à y faire. Le jour où ce verrou bouge, c'est tout
// l'écart entre un champ de texte et une élévation de privilège. Club+ ne l'écrit pas non plus.
import { supabase } from "./supabase";

export interface MonProfil {
  prenom: string;
  nom: string;
  telephone: string;
  /** Lu seulement : le changer est une procédure d'authentification, pas un champ de formulaire. */
  email: string;
}

/**
 * Mon profil, tel que je l'ai rempli.
 *
 * `secours` est ce que le club a saisi : il sert à pré-remplir le formulaire de quelqu'un qui n'a
 * jamais touché à son profil, pour qu'il n'ait pas à retaper ce que son club sait déjà.
 */
export async function lireMonProfil(secours?: { prenom?: string | null; nom?: string | null }): Promise<MonProfil | null> {
  const { data, error } = await supabase.auth.getUser();
  const u = data?.user;
  if (error || !u) return null;
  const m = (u.user_metadata ?? {}) as Record<string, unknown>;
  const texte = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    prenom: texte(m.prenom) || (secours?.prenom ?? "").trim(),
    nom: texte(m.nom) || (secours?.nom ?? "").trim(),
    telephone: texte(m.telephone),
    email: u.email ?? "",
  };
}

/**
 * Enregistrer mon profil.
 *
 * `updateUser` rend l'utilisateur mis à jour : on vérifie que les métadonnées sont bien celles
 * qu'on vient d'envoyer, plutôt que de faire confiance à l'absence d'erreur. Règle du 10/09 —
 * aucune action n'affiche un succès si la donnée n'a pas changé.
 */
export async function enregistrerMonProfil(p: { prenom: string; nom: string; telephone: string }): Promise<void> {
  const prenom = p.prenom.trim();
  const nom = p.nom.trim();
  const telephone = p.telephone.trim();

  const { data, error } = await supabase.auth.updateUser({
    // `locale` est posée avec le reste, comme le fait Club+ : l'application est en français, et
    // une métadonnée absente ferait retomber le site sur sa valeur par défaut au prochain calcul.
    data: { prenom, nom, telephone, locale: "fr" },
  });
  if (error) throw new Error(messageLisible(error.message));

  const m = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
  if (m.prenom !== prenom || m.nom !== nom || m.telephone !== telephone) {
    throw new Error("L'enregistrement n'a pas abouti. Réessayez dans un instant.");
  }
}

/** Les messages de l'API d'authentification sont en anglais : on ne les montre pas tels quels. */
function messageLisible(brut: string): string {
  if (/network|fetch/i.test(brut)) return "Pas de connexion. Réessayez une fois le réseau revenu.";
  if (/session|jwt|token/i.test(brut)) return "Votre session a expiré. Reconnectez-vous pour enregistrer.";
  return "L'enregistrement n'a pas abouti. Réessayez dans un instant.";
}
