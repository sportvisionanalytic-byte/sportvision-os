import type { SupabaseClient } from "@supabase/supabase-js";

// Rattachement d'un achat galerie à un compte Connect — le maillon qui manquait.
//
// media_gallery_claim_all() existe en base et fonctionne, mais elle n'était appelée depuis nulle
// part : le bouton « Créer mon compte » envoyait `?commande=<jeton>` vers /signup, et aucun
// fichier ne lisait ce paramètre. Aucun achat n'a donc jamais été rattaché automatiquement.
//
// ── Pourquoi il faut mémoriser puis rejouer ──
// La confirmation d'e-mail est active sur ce projet : `auth.signUp()` ne renvoie AUCUNE session
// tant que le lien reçu par e-mail n'a pas été cliqué. Impossible d'appeler une fonction
// authentifiée juste après l'inscription. On mémorise donc le jeton de commande et on rejoue au
// premier moment où une vraie session existe.
//
// C'est exactement le mécanisme déjà utilisé pour le rattachement club
// (lib/signup/pending-onboarding.ts) et il est rejoué aux mêmes endroits : /auth/confirming,
// /auth/login, et la fin du tunnel. On ne construit pas un second système.
//
// localStorage et pas un cookie : lu uniquement côté client, jamais transmis au serveur.
//
// ── Ce que ce jeton NE donne PAS ──
// Il sert uniquement à savoir où renvoyer l'utilisateur. Le rattachement lui-même exige, côté
// base : une session, un e-mail CONFIRMÉ, et une adresse identique à celle de l'achat. Détenir le
// jeton ne suffit pas à s'approprier une commande.

const STORAGE_KEY = "sv_gallery_pending_claim";

export function savePendingClaim(token: string) {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Stockage bloqué (navigation privée stricte) : l'inscription n'est pas empêchée, seul le
    // rattachement automatique ne pourra pas se rejouer. L'utilisateur garde son lien par e-mail.
  }
}

export function hasPendingClaim(): boolean {
  try {
    return Boolean(localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

export interface ClaimResult {
  ok: boolean;
  /** 'email_non_verifie' n'est pas un échec : c'est une attente. L'écran le dit, et le
   *  rattachement se rejouera tout seul à la prochaine connexion. */
  raison: string | null;
  rattachees: number;
  orderToken: string | null;
}

/**
 * Rejoue le rattachement avec la session courante.
 *
 * Appelle media_gallery_claim_all(), qui rattache la commande d'origine ET toutes les autres
 * commandes invitées de la même adresse vérifiée : un parent achète souvent deux ou trois fois
 * avant de se décider à créer un compte, et ne récupérer que la dernière lui laisserait des
 * commandes orphelines — exactement ce qu'on veut supprimer.
 *
 * L'entrée n'est effacée QUE si le rattachement a réussi. Un e-mail pas encore confirmé, une
 * coupure réseau : la tentative reste disponible pour la prochaine connexion, plutôt que d'être
 * perdue en silence.
 *
 * Appelable sans jeton mémorisé : c'est le cas d'un compte existant qui se connecte normalement,
 * et dont on veut quand même récupérer les achats invités éligibles.
 */
export async function consumePendingClaim(supabase: SupabaseClient): Promise<ClaimResult | null> {
  let token: string | null = null;
  try {
    token = localStorage.getItem(STORAGE_KEY);
  } catch {
    token = null;
  }

  const { data, error } = await supabase.rpc("media_gallery_claim_all", { p_token: token });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row) return null;

  const result: ClaimResult = {
    ok: row.ok === true,
    raison: (row.raison as string) ?? null,
    rattachees: Number(row.rattachees ?? 0),
    orderToken: token,
  };

  if (result.ok) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignoré */
    }
  }
  return result;
}
