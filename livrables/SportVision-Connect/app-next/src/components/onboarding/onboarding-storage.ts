// Persistance locale de la progression de l'onboarding — voir ACTIONS.md § 3 (Reprise :
// bandeau sur le tableau de bord si interrompu, mémorisation de l'étape atteinte).
//
// Aucun backend n'est branché sur ce projet (voir README.md § Décision volontairement pas prise
// ici) : `User.onboardingStep` / `onboardingCompletedAt` existent dans le modèle de données mais
// `mock-data.ts` est un fichier partagé que je ne dois pas modifier. Le localStorage tient donc
// lieu de mémoire de progression pour la démo, indépendamment du mock user.

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

/** Appelé à la fin de l'inscription (voir /signup/done) pour déclencher l'onboarding au premier accès. */
export function resetOnboardingProgress() {
  setOnboardingProgress({ step: 0, completed: false });
}
