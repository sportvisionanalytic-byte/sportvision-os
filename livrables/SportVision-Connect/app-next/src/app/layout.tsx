import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

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
  title: "SportVision Connect",
  description: "Votre sport. Vos contenus. Votre espace.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" data-theme="dark" className={`${plusJakartaSans.variable} ${jetBrainsMono.variable}`}>
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
