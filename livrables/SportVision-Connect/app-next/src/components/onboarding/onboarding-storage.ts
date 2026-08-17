// Persistance locale de la progression de l'onboarding — voir ACTIONS.md § 3 (Reprise :
// bandeau sur le tableau de bord si interrompu, mémorisation de l'étape atteinte).
//
// Aucun backend n'est branché sur ce projet (voir README.md § Décision volontairement pas prise
// ici) : le localStorage tient lieu de mémoire de progression pour la démo. Le mock user a déjà
// `onboardingCompletedAt` renseigné (voir mock-data.ts) : c'est le repli par défaut tant
// qu'aucune progression locale n'a été enregistrée, pour ne pas rouvrir l'onboarding à chaque
// premier chargement (navigation privée, localStorage vidé...). « Revoir le tutoriel de
// bienvenue » (ACTIONS.md § 24) reste le seul moyen de le relancer explicitement.

import { mockUser } from "@/lib/mock-data";

const STORAGE_KEY = "sv-connect-onboarding";

export interface OnboardingProgress {
  step: number;
  completed: boolean;
}

const DEFAULT_PROGRESS: OnboardingProgress = mockUser.onboardingCompletedAt
  ? { step: mockUser.onboardingStep, completed: true }
  : { step: 0, completed: false };

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
