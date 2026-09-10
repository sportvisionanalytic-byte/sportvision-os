import type { SupabaseClient } from "@supabase/supabase-js";
import { switchActiveSpace } from "@/lib/supabase/actions";

// Rejeu de l'inscription après confirmation d'e-mail — même filet de sécurité que l'app
// vanilla (livrables/SportVision-Connect/app/index.html, handleSignup/handleActivation/
// handleLogin) : sur ce projet Supabase, la confirmation d'e-mail est active, donc
// `auth.signUp()` ne renvoie AUCUNE session tant que le lien reçu par e-mail n'a pas été
// cliqué — impossible d'appeler une Edge Function authentifiée juste après l'inscription.
// On mémorise donc l'action prévue et on la rejoue au premier login réussi, une fois la
// session réelle disponible. `localStorage` (pas de cookie) : lu uniquement côté client,
// jamais transmis au serveur, purement un aide-mémoire pour CE navigateur.

const STORAGE_KEY = "sv_pending_signup";

// 12/08/2026 — la variante "clubplus" (appel direct de clubplus-onboarding juste après
// auth.signUp(), club actif + admin posés en dur sans aucune validation humaine) a été
// retirée d'ici : c'était la faille de sécurité corrigée par ce chantier (voir
// migration-connect-v44-club-signup-requests.sql et l'ancien /signup/club-request/*, qui créait
// une simple demande, jamais un compte ni un club).
//
// 17/08/2026 — le tunnel unifié /signup/request/* (SIGNUP-UNIFIE-MASTER-PROMPT.md) remplace
// /signup/club-request/* ET l'ancien /signup/type→.../checkout (seul appelant de
// savePendingOnboarding() pour les kinds "connect-org-signup"/"portal-onboarding"/
// "connect-signup-lead" ci-dessous, retiré). Plus AUCUN code de ce repo n'appelle
// savePendingOnboarding() désormais pour ces kinds : ce module ne sert plus qu'à rejouer, au
// prochain login, une entrée localStorage laissée par une inscription commencée avant ce
// déploiement (filet de compatibilité best-effort côté login.tsx/confirming/page.tsx, pas une
// voie active).
//
// 19/08/2026 — le kind "clubplus-free-signup" ci-dessous RÉINTRODUIT délibérément un appel
// direct à clubplus-onboarding juste après signUp(), club actif + admin posés sans validation
// humaine — exactement le type de flux retiré le 12/08. Décision explicite de Fouka : le plan
// Gratuit (1 utilisateur, 1 équipe, 0 crédit, aucun paiement) doit être une inscription
// instantanée en self-service, contrairement à Start/Performance qui restent uniquement
// accessibles via le tunnel de demande + validation staff, ou un abonnement Stripe. Scope
// STRICTEMENT limité au plan free : voir app/signup/free/page.tsx, seul appelant.
export type PendingOnboarding =
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
    }
  | {
      // 17/08/2026 — voir app/activation/page.tsx : lien d'activation Club+ privé (type "club"),
      // rejoué contre clubplus-activate une fois la session réelle disponible.
      kind: "clubplus-activation";
      token: string;
      clubNom: string;
      prenom: string;
      nom: string;
      telephone: string;
    }
  | {
      // 17/08/2026 — voir app/org-activation/page.tsx : lien d'activation Club+ privé pour les 6
      // types d'organisation autres que "club", rejoué contre connect-org-activate.
      kind: "connect-org-activation";
      token: string;
      nom: string;
    }
  | {
      // 19/08/2026 — voir app/signup/free/page.tsx : inscription Club+ Gratuit instantanée,
      // rejouée contre clubplus-onboarding (plan="free" forcé côté edge function).
      kind: "clubplus-free-signup";
      clubNom: string;
      prenom: string;
      nom: string;
      telephone: string;
    };

// ── L'autre appareil (audit des créations de compte, 10/09/2026) ──
// L'aide-mémoire ne vivait QUE dans le localStorage du navigateur qui avait rempli le formulaire.
// Or on s'inscrit souvent sur l'ordinateur du club et on ouvre l'e-mail de confirmation sur son
// téléphone : ce navigateur-là ne savait rien de l'inscription, le club n'était jamais créé et la
// personne tombait sur « Aucun espace disponible ». On recopie donc la même demande dans les
// métadonnées du compte (`options.data` de signUp), qui voyagent avec lui : le premier appareil
// qui obtient une session peut la rejouer.
//
// Aucune élévation possible : ces métadonnées sont modifiables par leur seul propriétaire, et
// chaque rejeu repasse par une edge function qui revérifie tout (jeton d'activation valide, formule
// gratuite imposée côté serveur). Elles ne portent que ce que la personne a elle-même saisi.
export const PENDING_METADATA_KEY = "sv_pending_signup";

/** À passer dans `options.data` de `auth.signUp()`, à côté de `savePendingOnboarding()`. */
export function pendingMetadata(pending: PendingOnboarding): Record<string, unknown> {
  return { [PENDING_METADATA_KEY]: pending };
}

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

/** `functions.invoke` réduit toute réponse non-2xx à « Edge Function returned a non-2xx status
 *  code » : le vrai message, rédigé en français par la fonction, reste dans la Response brute. */
async function erreurDeFonction(error: unknown): Promise<Error & { definitive?: boolean }> {
  const contexte = (error as { context?: unknown } | null)?.context;
  let message = "La finalisation de votre inscription a échoué. Réessayez dans quelques instants.";
  let definitive = false;
  if (contexte instanceof Response) {
    // 400/403/404/409 : le serveur a tranché (lien expiré, déjà utilisé, retiré…). Rejouer à
    // chaque connexion ne changerait rien, et bloquerait la personne sur la même erreur. 401, 429
    // et 5xx restent rejouables : une session qui se pose, une limite qui se lève, une panne.
    definitive = [400, 403, 404, 409].includes(contexte.status);
    try {
      const corps = await contexte.clone().json();
      if (typeof corps?.error === "string" && corps.error.trim()) message = corps.error;
    } catch {
      // corps non JSON : le message général ci-dessus suffit.
    }
  }
  const e = new Error(message) as Error & { definitive?: boolean };
  e.definitive = definitive;
  return e;
}

async function lirePending(supabase: SupabaseClient): Promise<{ pending: PendingOnboarding | null; depuisCompte: boolean }> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      return { pending: JSON.parse(raw) as PendingOnboarding, depuisCompte: false };
    } catch {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* rien à nettoyer */
      }
    }
  }
  const { data } = await supabase.auth.getUser();
  const meta = data.user?.user_metadata?.[PENDING_METADATA_KEY];
  if (meta && typeof meta === "object" && typeof (meta as { kind?: unknown }).kind === "string") {
    return { pending: meta as PendingOnboarding, depuisCompte: true };
  }
  return { pending: null, depuisCompte: false };
}

async function oublierPending(supabase: SupabaseClient) {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* rien à nettoyer */
  }
  // Même effacement côté compte, sinon l'autre appareil rejouerait une inscription déjà faite.
  const { data } = await supabase.auth.getUser();
  if (data.user?.user_metadata?.[PENDING_METADATA_KEY]) {
    await supabase.auth.updateUser({ data: { [PENDING_METADATA_KEY]: null } });
  }
}

async function appeler(supabase: SupabaseClient, fonction: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(fonction, { body });
  if (error) throw await erreurDeFonction(error);
  if (data?.error) throw new Error(data.error);
  return data;
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
 *
 * L'erreur levée porte `definitive: true` quand le serveur a refusé pour de bon (lien expiré,
 * déjà utilisé…) : l'entrée est alors oubliée, pour ne pas renvoyer la même erreur à chaque
 * connexion.
 */
export async function consumePendingOnboarding(supabase: SupabaseClient): Promise<{ redirectUrl?: string } | null> {
  const { pending } = await lirePending(supabase);
  if (!pending) return null;

  // L'espace que l'inscription vient de créer (ou de rattacher). Voir plus bas.
  let espaceCree: string | null = null;

  try {
    switch (pending.kind) {
      case "connect-org-signup":
        await appeler(supabase, "connect-org-signup", {
          organization_type: pending.organizationType,
          nom: pending.nom,
          prenom: pending.prenom,
          nom_contact: pending.nomContact,
          telephone: pending.telephone,
          plan_label: pending.planLabel,
          message: pending.message || undefined,
        });
        break;
      case "clubplus-activation": {
        const r = await appeler(supabase, "clubplus-activate", {
          token: pending.token,
          club_nom: pending.clubNom,
          prenom: pending.prenom || undefined,
          nom: pending.nom || undefined,
          telephone: pending.telephone || undefined,
        });
        espaceCree = typeof r?.club_id === "string" ? r.club_id : null;
        break;
      }
      case "clubplus-free-signup": {
        const r = await appeler(supabase, "clubplus-onboarding", {
          plan: "free",
          club: { nom: pending.clubNom },
          prenom: pending.prenom || undefined,
          nom: pending.nom || undefined,
          telephone: pending.telephone || undefined,
        });
        espaceCree = typeof r?.club_id === "string" ? r.club_id : null;
        break;
      }
      case "connect-org-activation": {
        const r = await appeler(supabase, "connect-org-activate", { token: pending.token, nom: pending.nom });
        espaceCree = typeof r?.organization_id === "string" ? r.organization_id : null;
        break;
      }
      case "portal-onboarding":
        await appeler(supabase, "portal-onboarding", {
          prenom: pending.prenom,
          nom: pending.nom,
          telephone: pending.telephone,
          profil: pending.profil,
        });
        break;
      case "connect-signup-lead":
        await appeler(supabase, "connect-signup-lead", {
          reason: pending.reason,
          org_name: pending.orgName || undefined,
          plan_label: pending.planLabel || undefined,
          club_search: pending.clubSearch || undefined,
          message: pending.message || undefined,
          prenom: pending.prenom || undefined,
          nom_contact: pending.nomContact || undefined,
          telephone: pending.telephone || undefined,
        });
        break;
      default:
        // Type inconnu (entrée corrompue ou d'une version retirée) : rien à rejouer.
        break;
    }
  } catch (e) {
    if ((e as { definitive?: boolean }).definitive) await oublierPending(supabase);
    throw e;
  }

  await oublierPending(supabase);
  // L'espace mémorisé (cookie) l'emporte à l'ouverture de Club+ : quelqu'un qui appartenait déjà
  // à un autre espace y était ramené, et ne voyait pas celui qu'il venait de créer. Échec sans
  // conséquence : au pire, le sélecteur d'espaces s'affiche.
  if (espaceCree) {
    await switchActiveSpace({ kind: "organization", id: espaceCree }).catch(() => undefined);
  }
  return null;
}
