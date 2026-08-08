import { redirect } from "next/navigation";

// `/settings` n'est pas un écran en soi (voir README.md § Arborescence des routes :
// /settings/profile /settings/organization /settings/integrations) mais la sidebar pointe vers
// `/settings` (voir src/components/layout/Sidebar.tsx, fichier partagé que je ne dois pas
// modifier) : cette redirection évite un lien mort vers l'onglet par défaut.
export default function SettingsIndexPage() {
  redirect("/settings/profile");
}
