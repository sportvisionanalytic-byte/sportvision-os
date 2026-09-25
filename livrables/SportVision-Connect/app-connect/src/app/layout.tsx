import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Sora, DM_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sora",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  // metadataBase absent (audit de cohérence, 01/09/2026) : sans cette valeur, Next.js résout les
  // URL absolues d'Open Graph/Twitter (favicon, images de partage) sur http://localhost:3000 en
  // build, warning à chaque page — un lien Connect partagé (ex. ShareFundingButtons.tsx) sur
  // WhatsApp/iMessage/Slack pouvait donc afficher une prévisualisation cassée en production.
  metadataBase: new URL("https://connect.sportvision-an.fr"),
  title: "SportVision Connect",
  description: "Votre sport. Vos contenus. Votre équipe.",
  manifest: "/manifest.json",
  // Espace personnel authentifié : ne doit jamais être indexé par les moteurs de
  // recherche (audit SEO externe du 16/08/2026). Aucune balise noindex n'existait
  // avant, ni ici ni dans middleware.ts.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
    },
  },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  // Repris tel quel (même logo, mêmes couleurs) depuis livrables/SportVision-Connect/app/
  // manifest.json — jeu d'icônes déjà existant du 06/08, jamais branché dans app-connect après
  // la réécriture Next.js du 12/08. Aucune image à fournir par Fouka pour ce point.
  openGraph: {
    title: "SportVision Connect",
    description: "Votre sport. Vos contenus. Votre équipe.",
    siteName: "SportVision Connect",
    locale: "fr_FR",
    type: "website",
  },
};

// themeColor/colorScheme vivent dans un export `viewport` séparé depuis Next.js 14 (avant,
// dans `metadata` — dépréciation silencieuse sinon, jamais d'erreur mais jamais pris en compte
// par les navigateurs récents).
export const viewport: Viewport = {
  themeColor: "#09081A",
};

// OUVERT DEPUIS L'APPLICATION MOBILE (25/09/2026)
//
// L'application native ouvre certaines pages de Connect dans une fenetre : prestations, paiement
// collectif, commandes, factures, affiliation, equipes, messages. Elles arrivaient avec TOUTE la
// decoration du site — sa barre laterale, son en-tete, sa barre d'onglets du bas — par-dessus la
// barre d'onglets de l'application. Deux navigations empilees, et la personne ne sait plus ou
// elle est. Signale par Fouka : « ca me met au menu, c'est pas bon ».
//
// Le cookie est pose par /auth/app, c'est-a-dire uniquement quand la session vient de
// l'application. Il vaut pour toute la navigation qui suit dans la fenetre, et non pour la seule
// premiere page : un parametre d'adresse se serait perdu au premier lien clique.
//
// Le masquage se fait en CSS, depuis une marque posee sur <html> par le SERVEUR. Le faire cote
// client ferait apparaitre le menu une fraction de seconde avant de le cacher, et ce clignotement
// se voit d'autant plus que le fond est sombre.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const depuisApplication = (await cookies()).get("sv_app")?.value === "1";
  return (
    <html
      lang="fr"
      data-app={depuisApplication ? "1" : undefined}
      className={`${sora.variable} ${dmSans.variable} ${ibmPlexMono.variable}`}
    >
      <head>
        {/* Material Symbols Rounded — bibliothèque d'icônes unique du design de référence. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
