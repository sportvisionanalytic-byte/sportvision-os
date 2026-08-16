import type { Metadata, Viewport } from "next";
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
  title: "SportVision Connect",
  description: "Votre sport. Vos contenus. Votre équipe.",
  manifest: "/manifest.json",
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${sora.variable} ${dmSans.variable} ${ibmPlexMono.variable}`}>
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
