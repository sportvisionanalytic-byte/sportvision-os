import type { SupabaseClient } from "@supabase/supabase-js";

// Rejeu de l'inscription après confirmation d'e-mail — même filet de sécurité que app-next
// (src/lib/signup/pending-onboarding.ts) : la confirmation d'e-mail est active sur ce projet
// Supabase, donc `auth.signUp()` ne renvoie AUCUNE session tant que le lien reçu par e-mail
// n'a pas été cliqué — impossible d'appeler une Edge Function authentifiée juste après
// l'inscription. On mémorise donc l'action prévue et on la rejoue au premier login réussi,
// une fois la session réelle disponible.
//
// localStorage (pas de cookie) : lu uniquement côté client, jamais transmis au serveur.

const STORAGE_KEY = "sv_connect_pending_signup";

export interface PendingPlayerOnboarding {
  action: "join" | "declare" | "skip";
  orgId?: string;
  orgName?: string;
  name?: string;
  city?: string;
  team?: string;
  prenom?: string;
  nom?: string;
  dateNaissance?: string;
}

export function savePendingOnboarding(pending: PendingPlayerOnboarding) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Stockage indisponible (navigation privée stricte, etc.) : l'inscription elle-même
    // n'est pas bloquée, seul le rattachement club ne pourra pas se rejouer automatiquement.
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
 * Rejoue l'action de club en attente avec la session courante (réelle, disponible juste après
 * la confirmation d'e-mail au premier login). Ne supprime PAS l'entrée du stockage tant que
 * l'appel n'a pas réussi — un échec (fonction pas encore déployée, réseau) laisse la tentative
 * disponible pour un prochain login plutôt que de la perdre silencieusement.
 */
export async function consumePendingOnboarding(
  supabase: SupabaseClient,
): Promise<{ ok: boolean; hasClub?: boolean; orgNom?: string } | null> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let pending: PendingPlayerOnboarding;
  try {
    pending = JSON.parse(raw);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }

  const { data, error } = await supabase.functions.invoke("connect-player-onboarding", {
    body: {
      action: pending.action,
      orgId: pending.orgId,
      name: pending.name,
      city: pending.city,
      team: pending.team,
      prenom: pending.prenom,
      nom: pending.nom,
      dateNaissance: pending.dateNaissance,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignoré
  }
  return { ok: true, hasClub: data?.hasClub, orgNom: data?.orgNom ?? pending.orgName };
}
