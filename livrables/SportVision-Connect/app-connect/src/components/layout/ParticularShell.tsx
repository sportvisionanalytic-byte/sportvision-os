"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getAvatarAndProfilParticulier } from "@/lib/supabase/session";
import { particulierSportifsLabel, particulierSportifsShortLabel } from "@/lib/supabase/particulier";
import { Avatar } from "@/components/ui/Avatar";
import { gradientFor } from "@/lib/avatarGradients";
import { Topbar } from "./Topbar";
import { NotificationBell } from "./NotificationBell";
import { MobileSearchOverlay } from "./MobileSearchOverlay";

// Shell de l'Espace particulier — voir design-connect-personnel-12-08/README.md § Shell et
// navigation ("Espace particulier") + § Espace particulier. NE remplace PAS AppShell.tsx (shell
// joueur, non modifié — contrainte explicite de la mission) : composant entièrement séparé,
// choisi plutôt qu'une extension d'AppShell car le README documente une sidebar structurellement
// différente pour ce second espace (sélecteur de contexte sous le logo, section "MES SPORTIFS"
// au lieu de "MON UNIVERS", bottom nav mobile à 5 items différents) — assez de divergence pour
// justifier un composant dédié plutôt que des branches conditionnelles dans AppShell.
//
// Décision documentée (rapport final) : les DEUX espaces partagent volontairement les mêmes
// routes pour les modules communs (Prestations, Cotisations, Mes contenus, Mes commandes,
// Calendrier, Messages, Factures & paiements) côté Espace joueur — mais l'Espace particulier a
// SES PROPRES routes sous /particulier/** pour ces mêmes modules (au lieu de réutiliser tel
// quel /prestations, /commandes, etc.) : un compte est TOUJOURS l'un OU l'autre (jamais les
// deux), et les pages existantes sous /prestations etc. sont bâties autour de buildPlayerContext
// (player_profiles), qui n'existe jamais pour un particulier — les dupliquer sous /particulier
// évite de complexifier ces pages déjà construites avec des branches account_type, au prix d'une
// petite duplication de route, jugée plus sûre pour ne rien casser côté Espace joueur.
//
// Exception explicite à "NE remplace PAS AppShell.tsx" ci-dessus, pour la Topbar UNIQUEMENT
// (chantier du 14/08, migration-connect-v53-topbar-notifications-recherche.sql) : la topbar est
// un système transverse construit une fois (Topbar.tsx/NotificationBell.tsx/GlobalSearch.tsx/
// MobileSearchOverlay.tsx) et appliqué aux DEUX shells — contrairement au reste (sidebar, bottom
// nav), volontairement cloisonné par espace. Le `?` d'aide quitte la sidebar (même raison que
// AppShell.tsx : accès unique désormais dans Topbar.tsx).

export interface AthleteNavItem {
  kind: "linked" | "managed";
  refId: string;
  firstName: string;
  lastName: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

// NAV_SECTIONS/MOBILE_TABS sont des FONCTIONS de `sportifsLabel` (et non des constantes figées)
// depuis la migration-connect-v67-distinction-parent-agent.sql §1 : le libellé "Mes sportifs"
// devient "Mes enfants" pour un parent/tuteur, "Mes sportifs suivis" pour un agent — voir
// particulierSportifsLabel()/particulierSportifsShortLabel() dans lib/supabase/particulier.ts.
function buildNavSections(sportifsLabel: string, profilParticulier: string | null): { title: string | null; items: NavItem[] }[] {
  return [
    { title: null, items: [{ href: "/particulier", label: "Accueil", icon: "home" }] },
    {
      title: sportifsLabel,
      items: [{ href: "/particulier/sportifs", label: sportifsLabel, icon: "group" }],
    },
    {
      title: "SportVision",
      items: [
        { href: "/particulier/prestations", label: "Prestations", icon: "camera_alt" },
        { href: "/particulier/cotisations", label: "Cotisations", icon: "savings" },
        { href: "/particulier/contenus", label: "Mes contenus", icon: "photo_library" },
        { href: "/particulier/commandes", label: "Mes commandes", icon: "receipt_long" },
        { href: "/particulier/calendrier", label: "Calendrier", icon: "calendar_month" },
        { href: "/particulier/messages", label: "Messages", icon: "forum" },
      ],
    },
    {
      title: "Mon compte",
      items: [
        { href: "/particulier/factures", label: "Factures & paiements", icon: "payments" },
        // Abonnement Agent (migration-connect-v57-abonnement-agent.sql) — réservé aux comptes
        // profil_particulier='agent' (migration-connect-v67) depuis le 15/08 : un parent/tuteur/
        // autre est plafonné à 3 sportifs de façon DURE, jamais payante (voir connect_particulier_
        // limit() en base) — cet onglet n'a donc plus aucune utilité pour lui, contrairement à
        // l'ancien raisonnement (repris ci-dessous par cohérence historique) qui datait d'avant
        // cette distinction, quand le plafond payant s'appliquait uniquement via relation_type
        // ='agent' sur chaque relation, indépendamment du compte. Retiré à la demande de Fouka.
        ...(profilParticulier === "agent"
          ? [{ href: "/particulier/abonnement", label: "Mon abonnement", icon: "workspace_premium" }]
          : []),
        { href: "/particulier/profil", label: "Mon profil", icon: "person" },
      ],
    },
  ];
}

// 5 onglets mobiles (README § Mobile → "Particulier : Accueil · Sportifs · Prestations ·
// Contenus · Profil"), le reste dans la feuille "Plus".
function buildMobileTabs(sportifsShortLabel: string): NavItem[] {
  return [
    { href: "/particulier", label: "Accueil", icon: "home" },
    { href: "/particulier/sportifs", label: sportifsShortLabel, icon: "group" },
    { href: "/particulier/prestations", label: "Prestations", icon: "camera_alt" },
    { href: "/particulier/contenus", label: "Contenus", icon: "photo_library" },
    { href: "/particulier/profil", label: "Profil", icon: "person" },
  ];
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ParticularShell({
  firstName,
  lastName,
  email,
  athletes,
  children,
}: {
  firstName: string;
  lastName?: string;
  email?: string;
  athletes: AthleteNavItem[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [profilParticulier, setProfilParticulier] = useState<string | null>(null);

  // Photo de profil (migration-connect-v55-photo-profil.sql) + profil_particulier (migration-
  // connect-v67-distinction-parent-agent.sql §1, pour le vocabulaire "Mes sportifs"/"Mes
  // enfants"/"Mes sportifs suivis" de la sidebar) — même chargement client que AppShell.tsx pour
  // l'avatar, voir son commentaire pour le détail ; une seule requête pour les deux colonnes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId) return;
      const info = await getAvatarAndProfilParticulier(supabase, userId);
      if (!cancelled) {
        setAvatarUrl(info.avatarUrl);
        setProfilParticulier(info.profilParticulier);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sportifsLabel = useMemo(() => particulierSportifsLabel(profilParticulier), [profilParticulier]);
  const sportifsShortLabel = useMemo(() => particulierSportifsShortLabel(profilParticulier), [profilParticulier]);
  const NAV_SECTIONS = useMemo(() => buildNavSections(sportifsLabel, profilParticulier), [sportifsLabel, profilParticulier]);
  const ALL_ITEMS = useMemo(() => NAV_SECTIONS.flatMap((s) => s.items), [NAV_SECTIONS]);
  const MOBILE_TABS = useMemo(() => buildMobileTabs(sportifsShortLabel), [sportifsShortLabel]);
  const MOBILE_MORE_ITEMS = useMemo(
    () => ALL_ITEMS.filter((item) => !MOBILE_TABS.some((t) => t.href === item.href)),
    [ALL_ITEMS, MOBILE_TABS],
  );

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  // Le sélecteur de contexte (README § Shell et navigation) reflète où l'on se trouve : "Vous
  // consultez : Lucas" sur la fiche de Lucas, "Tous mes sportifs" partout ailleurs — jamais un
  // libellé figé (bug corrigé le 14/08, cf. rapport de l'agent Design review). Il reste un
  // raccourci de NAVIGATION vers la fiche du sportif (pas un filtre global in-place répercuté sur
  // toutes les pages) : les listes multi-sportifs (commandes, contenus, calendrier) filtrent via
  // leur propre sélecteur `?sportif=`, déjà couvert par chaque vue.
  const activeAthleteMatch = pathname.match(/^\/particulier\/sportifs\/(linked|managed)\/([^/]+)/);
  const activeAthlete = activeAthleteMatch
    ? athletes.find((a) => a.kind === activeAthleteMatch[1] && a.refId === activeAthleteMatch[2]) || null
    : null;
  const contextLabel = activeAthlete
    ? `${activeAthlete.firstName} ${activeAthlete.lastName}`.trim()
    : athletes.length
      ? "Tous mes sportifs"
      : "Aucun sportif";

  const contextSelector = (
    <div className="relative">
      <button
        type="button"
        onClick={() => setContextOpen((v) => !v)}
        className="flex h-10 w-full items-center gap-2 rounded-sv border border-border-strong bg-surface px-3 text-left text-[13px] font-medium text-text-secondary hover:bg-surface-hover"
      >
        {activeAthlete ? (
          <span
            className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full font-sora text-[8px] font-semibold text-white"
            style={{ background: gradientFor(`${activeAthlete.kind}:${activeAthlete.refId}`) }}
          >
            {(activeAthlete.firstName[0] || "?").toUpperCase()}
          </span>
        ) : (
          <span className="material-symbols-rounded !text-[18px] text-text-tertiary">group</span>
        )}
        <span className="truncate">Vous consultez : {contextLabel}</span>
        <span className="material-symbols-rounded ml-auto !text-[18px] text-text-faint">expand_more</span>
      </button>
      {contextOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setContextOpen(false)}>
          <div
            className="absolute left-3.5 right-3.5 top-[130px] z-50 flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto rounded-sv-card border border-border bg-bg-elevated p-2 lg:left-auto lg:top-auto lg:mt-2 lg:w-[260px]"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[.1em] text-text-faint">
              Vous consultez
            </span>
            <Link
              href="/particulier"
              onClick={() => setContextOpen(false)}
              className={`flex h-11 items-center gap-2.5 rounded-sv px-3 text-[14px] ${
                !activeAthlete ? "bg-white/8 text-text" : "text-text-secondary hover:bg-white/5"
              }`}
            >
              <span className="material-symbols-rounded !text-[19px]">apps</span>
              Tous mes sportifs
              {!activeAthlete && (
                <span className="material-symbols-rounded ml-auto !text-[19px] text-affiliations" style={{ fontVariationSettings: "'FILL' 1" }}>
                  check_circle
                </span>
              )}
            </Link>
            {athletes.map((a) => {
              const isActive = activeAthlete?.kind === a.kind && activeAthlete?.refId === a.refId;
              return (
                <Link
                  key={`${a.kind}:${a.refId}`}
                  href={`/particulier/sportifs/${a.kind}/${a.refId}`}
                  onClick={() => setContextOpen(false)}
                  className={`flex h-11 items-center gap-2.5 rounded-sv px-3 text-[14px] ${
                    isActive ? "bg-white/8 text-text" : "text-text-secondary hover:bg-white/5"
                  }`}
                >
                  <span
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-full font-sora text-[10px] font-semibold text-white"
                    style={{ background: gradientFor(`${a.kind}:${a.refId}`) }}
                  >
                    {(a.firstName[0] || "?").toUpperCase()}
                  </span>
                  {a.firstName} {a.lastName}
                  {isActive && (
                    <span className="material-symbols-rounded ml-auto !text-[19px] text-affiliations" style={{ fontVariationSettings: "'FILL' 1" }}>
                      check_circle
                    </span>
                  )}
                </Link>
              );
            })}
            {athletes.length === 0 && (
              <span className="px-3 py-2.5 text-[13px] text-text-faint">Aucun sportif ajouté pour le moment.</span>
            )}
            <Link
              href="/particulier/sportifs/ajouter"
              onClick={() => setContextOpen(false)}
              className="mt-1.5 flex h-11 items-center gap-2.5 rounded-sv border-t border-border px-3 pt-2.5 text-[14px] text-text-secondary hover:bg-white/5"
            >
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-white/[.07]">
                <span className="material-symbols-rounded !text-[15px] text-affiliations">add</span>
              </span>
              Ajouter un sportif
            </Link>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-bg font-sans text-text">
      {/* ============ SIDEBAR DESKTOP ============ */}
      <aside className="sticky top-0 hidden h-screen w-[252px] flex-none flex-col gap-4 overflow-y-auto border-r border-border p-3.5 lg:flex">
        <div className="flex items-center gap-2.5 px-2">
          <Link href="/particulier" className="flex flex-1 items-center gap-2.5">
            <Image src="/uploads/logo.png" alt="SportVision Connect" width={32} height={32} className="object-contain" />
            <div className="flex flex-col leading-tight">
              <span className="font-sora text-[15px] font-bold tracking-tight">SportVision</span>
              <span className="bg-sv-gradient bg-clip-text text-[10px] font-medium uppercase tracking-[.14em] text-transparent">
                Connect
              </span>
            </div>
          </Link>
        </div>

        {contextSelector}

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
                      style={{ color: active ? "#8CA9FF" : undefined }}
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
      <div className="fixed inset-x-0 top-0 z-30 flex flex-col gap-2.5 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="flex items-center gap-3">
          <Image src="/uploads/logo.png" alt="SportVision Connect" width={28} height={28} className="object-contain" />
          <span className="bg-sv-gradient bg-clip-text text-[10px] font-medium uppercase tracking-[.14em] text-transparent">
            Connect
          </span>
          <button
            type="button"
            onClick={() => setMobileSearchOpen(true)}
            aria-label="Rechercher"
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-sv text-text-tertiary hover:bg-surface"
          >
            <span className="material-symbols-rounded !text-[20px]">search</span>
          </button>
          <NotificationBell />
          <Link
            href="/aide"
            aria-label="Aide"
            className="flex h-9 w-9 items-center justify-center rounded-sv text-text-tertiary hover:bg-surface"
          >
            <span className="material-symbols-rounded !text-[20px]">help</span>
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-sv bg-surface"
          >
            <Avatar url={avatarUrl} label={firstName} size={32} className="text-[12px]" />
          </button>
        </div>
        {contextSelector}
      </div>

      {mobileSearchOpen && <MobileSearchOverlay space="particulier" onClose={() => setMobileSearchOpen(false)} />}

      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="absolute right-3 top-[120px] flex max-h-[calc(100vh-140px)] w-64 flex-col gap-3 overflow-y-auto rounded-sv-card border border-border bg-bg-elevated p-2"
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
                    <span className="material-symbols-rounded !text-[20px]">{item.icon}</span>
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
              <span className="material-symbols-rounded !text-[20px]">logout</span>
              Se déconnecter
            </button>
          </div>
        </div>
      )}

      {/* ============ COLONNE DE CONTENU (topbar desktop + contenu) ============ */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar space="particulier" firstName={firstName} lastName={lastName} email={email} avatarUrl={avatarUrl} profileHref="/particulier/profil" />
        <main className="flex-1 pb-16 pt-[112px] lg:pb-0 lg:pt-0">
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
                style={{ color: active ? "#8CA9FF" : "#7A7A9C" }}
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

      <button
        type="button"
        onClick={() => setMoreOpen(true)}
        aria-label="Plus d'options"
        className="fixed bottom-[calc(66px+env(safe-area-inset-bottom))] right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-sv-gradient text-white shadow-lg lg:hidden"
      >
        <span className="material-symbols-rounded !text-[22px]">apps</span>
      </button>

      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 flex max-h-[70vh] flex-col gap-1 overflow-y-auto rounded-t-sv-card border-t border-border bg-bg-elevated p-3 pb-[max(16px,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-white/15" />
            <span className="px-2 pb-1 font-sora text-[15px] font-semibold">Plus</span>
            {MOBILE_MORE_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className="flex h-12 items-center gap-3 rounded-sv px-3 text-[14px] text-text-secondary hover:bg-white/5"
              >
                <span className="material-symbols-rounded !text-[21px]">{item.icon}</span>
                {item.label}
              </Link>
            ))}
            <Link
              href="/aide"
              onClick={() => setMoreOpen(false)}
              className="flex h-12 items-center gap-3 rounded-sv px-3 text-[14px] text-text-secondary hover:bg-white/5"
            >
              <span className="material-symbols-rounded !text-[21px]">help</span>
              Aide
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
