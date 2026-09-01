// Persistance locale de la progression de l'onboarding — voir ACTIONS.md § 3 (Reprise :
// bandeau sur le tableau de bord si interrompu, mémorisation de l'étape atteinte).
//
// FIX 01/09/2026 (audit de cohérence) : le repli par défaut se basait sur
// `mockUser.onboardingCompletedAt` (toujours vrai dans mock-data.ts) — commentaire hérité de
// l'époque "aucun backend n'est branché" (voir README.md), devenue fausse depuis que ce module
// est réellement utilisé par de vrais comptes Club+ connectés à Supabase. Conséquence : tout
// nouveau vrai admin de club, sans progression déjà enregistrée dans son localStorage (premier
// login sur un appareil), héritait silencieusement de l'état "onboarding déjà terminé" du compte
// de démo — l'overlay de bienvenue ne s'affichait donc jamais pour un vrai nouvel utilisateur.
// Le mock user (`/demo/*`) ne passe jamais par ce module : `OnboardingOverlay` n'est monté que
// depuis `(app)/dashboard/page.tsx`, hors du groupe de routes démo.
const STORAGE_KEY = "sv-connect-onboarding";

export interface OnboardingProgress {
  step: number;
  completed: boolean;
}

const DEFAULT_PROGRESS: OnboardingProgress = { step: 0, completed: false };

export function getOnboardingProgress(): OnboardingProgress {
  if (typeof window === "undefined") return DEFAULT_PROGRESS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROGRESS;
    const parsed = JSON.parse(raw);
    return { step: Number(parsed.step) || 0, completed: Boolean(parsed.completed) };
  } catch {
    return DEFAULT_PROGRESS;
  }
}

export function setOnboardingProgress(progress: OnboardingProgress) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

/** Déclenche l'onboarding au premier accès à l'espace (ex. support/page.tsx). L'ancien
 * /signup/done, qui l'appelait à la fin d'une inscription self-service, a été retiré le
 * 17/08/2026 — ce tunnel ne crée plus jamais de compte/organisation active à la volée. */
export function resetOnboardingProgress() {
  setOnboardingProgress({ step: 0, completed: false });
}
