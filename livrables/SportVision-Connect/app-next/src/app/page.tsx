import { redirect } from "next/navigation";

// Racine technique : renvoie vers le tableau de bord. Une fois l'authentification réelle
// branchée, ce sera un middleware qui décidera entre /dashboard et /auth/login selon la
// session — pas cette page.
export default function RootPage() {
  redirect("/dashboard");
}
