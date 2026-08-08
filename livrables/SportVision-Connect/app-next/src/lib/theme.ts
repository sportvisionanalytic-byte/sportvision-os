export type Theme = "dark" | "light";

const STORAGE_KEY = "sv-connect-theme";

// Sombre par défaut (CHARTE.md § Mode sombre). Le clair est un choix explicite persisté.
export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  window.localStorage.setItem(STORAGE_KEY, theme);
}
