import type { SupabaseClient } from "@supabase/supabase-js";

// Rejeu de l'inscription après confirmation d'e-mail — même filet de sécurité que l'app
// vanilla (livrables/SportVision-Connect/app/index.html, handleSignup/handleActivation/
// handleLogin) : sur ce projet Supabase, la confirmation d'e-mail est active, donc
// `auth.signUp()` ne renvoie AUCUNE session tant que le lien reçu par e-mail n'a pas été
// cliqué — impossible d'appeler une Edge Function authentifiée juste après l'inscription.
// On mémorise donc l'action prévue et on la rejoue au premier login réussi, une fois la
// session réelle disponible. `localStorage` (pas de cookie) : lu uniquement côté client,
// jamais transmis au serveur, purement un aide-mémoire pour CE navigateur.

const STORAGE_KEY = "sv_pending_signup";

export type PendingOnboarding =
  | {
      kind: "clubplus";
      prenom: string;
      nom: string;
      telephone: string;
      orgName: string;
      ville: string;
      plan: "club" | "performance";
      engagement: "12mois" | "sans";
    }
  | {
      kind: "connect-org-signup";
      organizationType: "coach" | "academie";
      nom: string;
      prenom: string;
      nomContact: string;
      telephone: string;
      planLabel: string;
      message: string;
    }
  | {
      kind: "portal-onboarding";
      prenom: string;
      nom: string;
      telephone: string;
      profil?: string;
    }
  | {
      kind: "connect-signup-lead";
      reason: "club_plan_manuel" | "player_join_club" | "quote_followup";
      orgName: string;
      planLabel: string;
      clubSearch: string;
      message: string;
      prenom: string;
      nomContact: string;
      telephone: string;
    };

export function savePendingOnboarding(pending: PendingOnboarding) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Stockage indisponible (navigation privée stricte, etc.) : le filet de sécurité au
    // login ne pourra pas jouer, mais l'inscription elle-même n'est pas bloquée pour autant.
  }
}

export function hasPendingOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Rejoue l'action d'inscription en attente avec la session courante (réelle, donc appelable
 * juste après `signUp()` quand la confirmation d'e-mail est désactivée, ou juste après une
 * connexion réussie sinon). Contrairement à une version qui avalerait ses erreurs, celle-ci
 * les laisse remonter : l'appelant décide s'il doit les afficher (juste après l'inscription,
 * l'utilisateur est encore là pour voir un message et réessayer) ou seulement les journaliser
 * (au login, où un échec silencieux vaut mieux qu'un blocage — l'entrée reste alors en attente
 * pour un prochain essai, et l'utilisateur atterrit sur l'écran « Aucun espace disponible »,
 * qui explique déjà la marche à suivre). Retourne une URL de redirection Stripe quand
 * l'inscription en attente était un abonnement Club+ payant. Retourne `null` s'il n'y avait
 * rien en attente.
 */
export async function consumePendingOnboarding(supabase: SupabaseClient): Promise<{ redirectUrl?: string } | null> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let pending: PendingOnboarding;
  try {
    pending = JSON.parse(raw);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }

  if (pending.kind === "clubplus") {
    const { data: onboarding, error: onboardingError } = await supabase.functions.invoke("clubplus-onboarding", {
      body: {
        prenom: pending.prenom,
        nom: pending.nom,
        telephone: pending.telephone,
        club: { nom: pending.orgName, ville: pending.ville || undefined },
        plan: pending.plan,
        engagement: pending.engagement,
      },
    });
    if (onboardingError) throw onboardingError;
    if (onboarding?.error) throw new Error(onboarding.error);

    const { data: checkout, error: checkoutError } = await supabase.functions.invoke(
      "create-clubplus-subscription-checkout",
      { body: { club_id: onboarding.club_id, plan: pending.plan, engagement: pending.engagement } },
    );
    if (checkoutError) throw checkoutError;
    if (checkout?.error) throw new Error(checkout.error);

    localStorage.removeItem(STORAGE_KEY);
    return { redirectUrl: checkout.url };
  }

  if (pending.kind === "connect-org-signup") {
    const { data, error } = await supabase.functions.invoke("connect-org-signup", {
      body: {
        organization_type: pending.organizationType,
        nom: pending.nom,
        prenom: pending.prenom,
        nom_contact: pending.nomContact,
        telephone: pending.telephone,
        plan_label: pending.planLabel,
        message: pending.message || undefined,
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }

  if (pending.kind === "portal-onboarding") {
    const { data, error } = await supabase.functions.invoke("portal-onboarding", {
      body: { prenom: pending.prenom, nom: pending.nom, telephone: pending.telephone, profil: pending.profil },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }

  // connect-signup-lead
  const { data, error } = await supabase.functions.invoke("connect-signup-lead", {
    body: {
      reason: pending.reason,
      org_name: pending.orgName || undefined,
      plan_label: pending.planLabel || undefined,
      club_search: pending.clubSearch || undefined,
      message: pending.message || undefined,
      prenom: pending.prenom || undefined,
      nom_contact: pending.nomContact || undefined,
      telephone: pending.telephone || undefined,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  localStorage.removeItem(STORAGE_KEY);
  return null;
}
