"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAvatarUrl } from "@/lib/supabase/session";
import { Avatar } from "@/components/ui/Avatar";
import { Topbar } from "./Topbar";
import { NotificationBell } from "./NotificationBell";
import { MobileSearchOverlay } from "./MobileSearchOverlay";

// Shell de l'espace joueur — voir design-connect-personnel-12-08/README.md § Shell et
// navigation. Structure consolidée le 14/08 une fois tous les écrans du design réellement
// construits (Mes affiliations, Mes équipes, Prestations, Cotisations, Mes contenus, Mes
// commandes, Calendrier, Messages, Factures & paiements, Mon profil) : reprend les 3 sections
// du design (MON UNIVERS / SPORTVISION / MON COMPTE) plutôt que la liste plate provisoire
// utilisée pendant la construction progressive. "Accès à mon profil" reste volontairement
// hors navigation (le design ne l'y met pas non plus — atteint depuis la carte dédiée dans Mon
// profil et une notification, cf. rapport de l'agent Accueil/Profil/Accès du 14/08).
//
// Topbar (desktop, 76 px) + notifications/recherche mobile ajoutées le 14/08 (chantier topbar
// transverse, voir migration-connect-v53-topbar-notifications-recherche.sql) : le `?` d'aide
// quitte la sidebar (unique accès désormais dans Topbar.tsx, README § Shell : "L'aide n'est pas
// dans la sidebar"), inchangé côté header mobile (pattern distinct, hors périmètre topbar 76 px).

interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Couleur de l'icône de nav — reprend la couleur déjà utilisée par CETTE section ailleurs
   * dans l'app (voir rapport de l'agent Couleurs sidebar, 15/08) plutôt qu'une couleur inventée.
   * Affiliations #22D3EE, Contenus #C084FC, Prestations #8CA9FF, Cotisations #F472B6 (piliers,
   * tailwind.config.ts) ; Factures #FBBF24 (attente) reprend la bannière "à régler" de
   * FacturesView.tsx, seul signal de couleur propre à cette page. */
  color: string;
}

// Connect V3 (04/09/2026) — navigation mobile ramenée à 5 entrées maximum : Accueil / Médias /
// Mon univers / Services / Profil. Les anciens onglets "Prestations"/"Paiement collectif" étaient
// 2 entrées mobiles séparées + "Mes contenus"/"Pass Photo"/"Mon affiliation"/"Mes équipes"/
// "Calendrier"/"Messages"/"Factures & paiements" ne vivaient que dans la feuille "Plus" — regroupés
// désormais sous 3 pages piliers (medias/mon-univers/services, voir HubTile.tsx), chaque écran
// d'origine reste inchangé, seul le point d'entrée change. La sidebar desktop suit le même
// regroupement (plus de place n'y change rien : la cohérence entre les deux vaut mieux qu'une
// sidebar "riche" et une nav mobile "pauvre" qui ne se ressembleraient plus).
const NAV_SECTIONS: { title: string | null; items: NavItem[] }[] = [
  { title: null, items: [{ href: "/dashboard", label: "Accueil", icon: "home", color: "#8CA9FF" }] },
  {
    title: "Médias",
    items: [
      { href: "/contenus", label: "Mes contenus", icon: "photo_library", color: "#C084FC" },
      { href: "/photos", label: "Pass Photo", icon: "photo_camera", color: "#34D399" },
    ],
  },
  {
    title: "Mon univers",
    items: [
      { href: "/affiliations", label: "Mon affiliation", icon: "shield", color: "#22D3EE" },
      { href: "/equipes", label: "Mes équipes", icon: "groups", color: "#22D3EE" },
      { href: "/calendrier", label: "Calendrier", icon: "calendar_month", color: "#8CA9FF" },
      { href: "/messages", label: "Messages", icon: "forum", color: "#22D3EE" },
    ],
  },
  {
    title: "Services",
    items: [
      { href: "/prestations", label: "Prestations", icon: "camera_alt", color: "#8CA9FF" },
      { href: "/cotisations", label: "Paiement collectif", icon: "savings", color: "#F472B6" },
      { href: "/commandes", label: "Mes commandes", icon: "receipt_long", color: "#8CA9FF" },
      { href: "/factures", label: "Factures & paiements", icon: "payments", color: "#FBBF24" },
    ],
  },
  {
    title: "Mon compte",
    items: [{ href: "/profil", label: "Mon profil", icon: "person", color: "#22D3EE" }],
  },
];

const MOBILE_TABS: NavItem[] = [
  { href: "/dashboard", label: "Accueil", icon: "home", color: "#8CA9FF" },
  { href: "/medias", label: "Médias", icon: "photo_library", color: "#C084FC" },
  { href: "/mon-univers", label: "Mon univers", icon: "groups", color: "#22D3EE" },
  { href: "/services", label: "Services", icon: "camera_alt", color: "#8CA9FF" },
  { href: "/profil", label: "Profil", icon: "person", color: "#22D3EE" },
];
// Les 5 onglets mobiles pointent vers des pages piliers distinctes des items de la sidebar
// desktop (medias/mon-univers/services vs. leurs pages de destination) — plus rien à reléguer
// dans une feuille "Plus" (bouton flottant retiré, voir plus bas).

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  firstName,
  lastName,
  email,
  children,
}: {
  firstName: string;
  lastName?: string;
  email?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Photo de profil (migration-connect-v55-photo-profil.sql) — chargée une fois côté client
  // (le shell ne reçoit que firstName/lastName/email en props depuis les ~20 pages qui le
  // rendent ; ajouter avatarUrl à chacune aurait été un changement mécanique bien plus large
  // pour le même résultat). getAvatarUrl fonctionne aussi bien avec le client navigateur
  // qu'avec le client serveur (aucune dépendance à next/headers), voir lib/supabase/session.ts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId) return;
      const url = await getAvatarUrl(supabase, userId);
      if (!cancelled) setAvatarUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }


  return (
    <div className="flex min-h-screen bg-bg font-sans text-text">
      {/* ============ SIDEBAR DESKTOP ============ */}
      <aside className="sticky top-0 hidden h-screen w-[252px] flex-none flex-col gap-5 overflow-y-auto border-r border-border p-3.5 lg:flex">
        <div className="flex items-center gap-2.5 px-2">
          <Link href="/dashboard" className="flex flex-1 items-center gap-2.5">
            <Image src="/uploads/logo.png" alt="SportVision Connect" width={32} height={32} className="object-contain" />
            <div className="flex flex-col leading-tight">
              <span className="font-sora text-[15px] font-bold tracking-tight">SportVision</span>
              <span className="bg-sv-gradient bg-clip-text text-[10px] font-medium uppercase tracking-[.14em] text-transparent">
                Connect
              </span>
            </div>
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-4">
          {NAV_SECTIONS.map((section, i) => (
            <div key={section.title ?? `section-${i}`} className="flex flex-col gap-1">
              {section.title && (
                <span className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[.1em] text-text-faint">
                  {section.title}
                </span>
              )}
              {section.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex h-[42px] items-center gap-2.5 rounded-sv px-3 text-[14px] transition-colors duration-150 ${
                      active ? "bg-white/8 font-medium text-text" : "text-text-secondary hover:bg-white/[.05]"
                    }`}
                  >
                    <span
                      className="material-symbols-rounded !text-[21px]"
                      style={{ color: item.color, opacity: active ? 1 : 0.62 }}
                    >
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-2.5 rounded-sv border border-border bg-surface px-3 py-2.5 text-left hover:bg-surface-hover"
        >
          <Avatar url={avatarUrl} label={firstName} size={36} className="text-[13px]" />
          <span className="flex flex-col gap-0.5 leading-tight">
            <span className="font-sora text-[13px] font-semibold">{firstName}</span>
            <span className="text-[11px] text-text-tertiary">Se déconnecter</span>
          </span>
        </button>
      </aside>

      {/* ============ HEADER MOBILE ============ */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-3 border-b border-border bg-bg/90 px-4 py-3.5 backdrop-blur-md lg:hidden">
        <Image src="/uploads/logo.png" alt="SportVision Connect" width={28} height={28} className="object-contain" />
        <span className="bg-sv-gradient bg-clip-text text-[10px] font-medium uppercase tracking-[.14em] text-transparent">
          Connect
        </span>
        <button
          type="button"
          onClick={() => setMobileSearchOpen(true)}
          aria-label="Rechercher"
          className="ml-auto flex h-10 w-10 items-center justify-center rounded-sv text-text-tertiary hover:bg-surface"
        >
          <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">search</span>
        </button>
        <NotificationBell />
        <Link
          href="/aide"
          aria-label="Aide"
          className="flex h-10 w-10 items-center justify-center rounded-sv text-text-tertiary hover:bg-surface"
        >
          <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">help</span>
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-sv bg-surface"
        >
          <Avatar url={avatarUrl} label={firstName} size={32} className="text-[12px]" />
        </button>
      </div>

      {mobileSearchOpen && <MobileSearchOverlay space="joueur" onClose={() => setMobileSearchOpen(false)} />}

      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="absolute right-3 top-16 flex max-h-[calc(100vh-88px)] w-64 flex-col gap-3 overflow-y-auto rounded-sv-card border border-border bg-bg-elevated p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {NAV_SECTIONS.map((section, i) => (
              <div key={section.title ?? `msection-${i}`} className="flex flex-col gap-1">
                {section.title && (
                  <span className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[.1em] text-text-faint">
                    {section.title}
                  </span>
                )}
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className="flex h-11 items-center gap-2.5 rounded-sv px-3 text-[14px] text-text-secondary hover:bg-white/5"
                  >
                    <span className="material-symbols-rounded !text-[20px]" style={{ color: item.color }} aria-hidden="true">
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}
            <button
              type="button"
              onClick={handleLogout}
              className="flex h-11 items-center gap-2.5 rounded-sv px-3 text-left text-[14px] text-danger hover:bg-white/5"
            >
              <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">logout</span>
              Se déconnecter
            </button>
          </div>
        </div>
      )}

      {/* ============ COLONNE DE CONTENU (topbar desktop + contenu) ============ */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar space="joueur" firstName={firstName} lastName={lastName} email={email} avatarUrl={avatarUrl} profileHref="/profil" />
        <main className="flex-1 pb-16 pt-[68px] lg:pb-0 lg:pt-0">
          <div className="mx-auto max-w-[1160px] px-5 py-7 lg:px-8">{children}</div>
        </main>
      </div>

      {/* ============ BOTTOM NAV MOBILE (5 onglets + feuille "Plus") ============ */}
      <div className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-bg/95 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md lg:hidden">
        {MOBILE_TABS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-h-[48px] flex-col items-center justify-center gap-1"
            >
              <span
                className="material-symbols-rounded !text-[22px]"
                style={{ color: item.color, opacity: active ? 1 : 0.62 }}
              >
                {item.icon}
              </span>
              <span className="text-[10px]" style={{ color: active ? "#8CA9FF" : "#7A7A9C" }}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Connect V3 : plus de bouton "Plus" flottant — les 5 onglets couvrent directement ou via
          leur page pilier tout ce qui vivait auparavant dans cette feuille ; l'aide reste
          accessible depuis l'icône dédiée du header mobile ci-dessus. */}
    </div>
  );
}
