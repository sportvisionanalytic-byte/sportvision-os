import type { Metadata } from "next";
import { DemoShell } from "@/components/layout/DemoShell";
import { DEMO_FIRST_NAME } from "@/lib/demo/mock-data";

// Layout /demo — voir DemoShell.tsx et lib/demo/mock-data.ts pour le contexte complet.
// Temporaire (demandé par Fouka le 19/08).
//
// `robots` réécrit ici : le layout racine (src/app/layout.tsx) applique noindex+NOFOLLOW+nocache
// à toute l'app (espace authentifié réel, jamais destiné aux moteurs de recherche). Un outil de
// crawl/audit qui respecte nofollow s'interdit lui-même d'extraire le contenu d'une page ainsi
// marquée — confirmé le 19/08 : le HTML réel contient bien tout le contenu (vérifié en curl brut,
// aucun rendu JS requis), seule cette balise faisait croire à une page vide. /demo ne contient
// aucune donnée réelle (voir mock-data.ts) : on peut se permettre de l'exempter de nofollow sans
// risque, tout en gardant index:false pour ne jamais apparaître dans une recherche Google.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <DemoShell firstName={DEMO_FIRST_NAME}>{children}</DemoShell>;
}
