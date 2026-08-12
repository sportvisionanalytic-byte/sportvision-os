"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// État du tunnel d'inscription Connect personnel — voir design-connect-personnel-12-08/README.md
// § Inscription. Persisté en localStorage (clé sv-connect-signup-v1) pour reprendre un parcours
// interrompu, exactement comme documenté dans le design de référence. Le mot de passe n'est
// PAS persisté (jamais en clair dans localStorage) — voir STORAGE_KEYS ci-dessous.

export type SignupProfile = "joueur" | "sportif" | "particulier" | "parent" | "autre";

export interface SignupState {
  // Étape 1 · Identité
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  // Étape 2 · Profil
  profile: SignupProfile | null;
  otherProfile: string;
  // Étape 3 · Sport / Besoin / Parent
  sport: string;
  otherSport: string;
  position: string;
  category: string;
  dateNaissance: string;
  city: string;
  need: string;
  // Étape 4 · Club
  clubMode: "search" | "declare" | "none" | null;
  selectedClubId: string | null;
  selectedClubName: string;
  declareName: string;
  declareCity: string;
  declareTeam: string;
}

const EMPTY_STATE: SignupState = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  profile: null,
  otherProfile: "",
  sport: "",
  otherSport: "",
  position: "",
  category: "",
  dateNaissance: "",
  city: "",
  need: "",
  clubMode: null,
  selectedClubId: null,
  selectedClubName: "",
  declareName: "",
  declareCity: "",
  declareTeam: "",
};

const STORAGE_KEY = "sv-connect-signup-v1";

function loadStored(): Partial<SignupState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Le mot de passe n'est jamais lu depuis le stockage — voir note de sécurité ci-dessus.
    delete parsed.password;
    return parsed;
  } catch {
    return {};
  }
}

interface SignupContextValue {
  state: SignupState;
  patch: (partial: Partial<SignupState>) => void;
  reset: () => void;
}

const SignupContext = createContext<SignupContextValue | null>(null);

export function SignupProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SignupState>(EMPTY_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState((prev) => ({ ...prev, ...loadStored() }));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const { password, ...persisted } = state;
      void password;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // Stockage indisponible (navigation privée stricte) : le tunnel fonctionne quand même,
      // juste sans reprise possible après fermeture de l'onglet.
    }
  }, [state, hydrated]);

  const value = useMemo<SignupContextValue>(
    () => ({
      state,
      patch: (partial) => setState((prev) => ({ ...prev, ...partial })),
      reset: () => {
        setState(EMPTY_STATE);
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignoré
        }
      },
    }),
    [state],
  );

  return <SignupContext.Provider value={value}>{children}</SignupContext.Provider>;
}

export function useSignup(): SignupContextValue {
  const value = useContext(SignupContext);
  if (!value) throw new Error("useSignup must be used within a SignupProvider");
  return value;
}

export const PROFILES: { id: SignupProfile; label: string; sub: string; icon: string }[] = [
  { id: "joueur", label: "Joueur / Joueuse", sub: "Je pratique dans un club, une équipe ou individuellement.", icon: "sports_soccer" },
  { id: "sportif", label: "Sportif / Sportive", sub: "Je pratique un autre sport ou j'utilise SportVision personnellement.", icon: "fitness_center" },
  { id: "particulier", label: "Particulier", sub: "Je souhaite réserver ou suivre une prestation SportVision.", icon: "person" },
  { id: "parent", label: "Parent / Responsable légal", sub: "J'utilise SportVision pour moi ou pour accompagner un jeune sportif.", icon: "family_restroom" },
  { id: "autre", label: "Autre", sub: "Mon profil ne correspond pas exactement aux choix proposés.", icon: "more_horiz" },
];

export const SPORTS = ["Football", "Futsal", "Basketball", "Handball", "Rugby", "Volleyball", "Athlétisme", "Tennis", "Autre"];
export const POSITIONS = ["Gardien", "Défenseur", "Milieu", "Attaquant", "Polyvalent"];
export const CATEGORIES = ["Senior", "U20", "U19", "U18", "U17", "U16", "Autre"];
export const NEEDS = [
  { id: "reserver", label: "Réserver une prestation", icon: "camera_alt" },
  { id: "suivre", label: "Suivre une prestation existante", icon: "event_available" },
  { id: "contenus", label: "Récupérer mes contenus", icon: "photo_library" },
  { id: "decouvrir", label: "Découvrir SportVision", icon: "explore" },
  { id: "plustard", label: "Plus tard", icon: "schedule" },
];

export const STEPS: { href: string; label: string }[] = [
  { href: "/signup", label: "Compte" },
  { href: "/signup/profil", label: "Profil" },
  { href: "/signup/sport", label: "Sport" },
  { href: "/signup/club", label: "Club" },
];
