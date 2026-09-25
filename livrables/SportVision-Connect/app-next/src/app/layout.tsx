import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cookies } from "next/headers";

// next/font télécharge et sert les polices depuis notre propre domaine au build : aucune
// requête à fonts.googleapis.com au runtime, donc pas d'assouplissement de la CSP nécessaire
// (voir la politique déjà posée sur l'app vanilla : ../app/netlify.toml).
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SportVision Club+",
  description: "Le portail professionnel SportVision : votre structure, votre relation SportVision.",
  // Espace professionnel authentifié : ne doit jamais être indexé par les moteurs de recherche
  // (même raisonnement que app-connect/src/app/layout.tsx, audit SEO externe du 16/08/2026, jamais
  // appliqué ici car app-next n'était pas encore identifié comme Club+ à ce moment-là).
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

// OUVERT DEPUIS L'APPLICATION MOBILE (25/09/2026)
//
// L'application ouvre l'espace club dans une fenetre. Sans cette marque, Club+ y arrive avec
// toute sa navigation — barre laterale, en-tete — par-dessus la barre d'onglets de
// l'application. Deux navigations empilees, et la personne ne sait plus ou elle est.
//
// Le cookie est pose par /auth/app, donc uniquement quand la session vient de l'application. Il
// vaut pour toute la navigation qui suit, et non pour la seule premiere page : un parametre
// d'adresse se serait perdu au premier lien clique.
//
// La marque est posee par le SERVEUR. Le faire en JavaScript ferait apparaitre le menu une
// fraction de seconde avant de le cacher, et ce clignotement se voit d'autant plus que le fond
// est sombre.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const depuisApplication = (await cookies()).get("sv_app")?.value === "1";
  return (
    <html
      lang="fr"
      data-theme="dark"
      data-app={depuisApplication ? "1" : undefined}
      className={`${plusJakartaSans.variable} ${jetBrainsMono.variable}`}
    >
      <head>
        {/* Applique le thème persisté avant le premier paint pour éviter le flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('sv-connect-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
