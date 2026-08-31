"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, HelpCircle, Menu, Moon, Plus, Sun } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/theme";
import { filterClubRoleNav, resolveNavigation } from "@/lib/navigation";

// Barre supérieure — voir CHARTE.md et ACTIONS.md § 4. À partir de `lg` (voir Sidebar.tsx),
// tous les contrôles de droite portent une largeur fixe comme à l'origine ; seul le bloc titre
// s'étire. Sous `lg`, un bouton hamburger ouvre le drawer de navigation (état porté par
// AppShell.tsx), et les contrôles se replient pour tenir sur un écran de téléphone : la
// recherche devient une icône qui ouvre un champ plein écran sous `sm`, "Nouvelle demande" perd
// son libellé sous `sm`, "Aide" se replie sous `lg` (déjà atteignable via "Aide & support" dans
// la sidebar), le thème se replie sous `sm`.

// Routes jamais présentes dans la sidebar de l'espace courant (voir src/lib/navigation.ts) : soit
// jamais dans aucune nav (notifications, atteinte uniquement via la cloche), soit seulement dans
// la nav d'un autre type d'organisation (ex. /children et /authorizations, présentes uniquement
// pour l'espace Parent/Joueur — un admin de club qui y accède directement, par exemple depuis un
// lien partagé, ne doit pas voir le slug d'URL brut en titre). resolveNavigation() ne peut pas
// leur trouver de libellé pour l'espace actif : ce petit repli couvre ces cas précis.
//
// /billing, /contracts, /services (audit Finance/Contrats/Sponsors du 31/08/2026) : absentes de
// NAV_SPONSOR (et de la nav coach/académie/agence CM selon le type) — chacune de ces pages retombe
// honnêtement sur <LockedModule /> pour ces types (voir billing/page.tsx, contracts/page.tsx,
// services/page.tsx), mais AVANT ce correctif le titre au-dessus affichait le slug brut "billing"/
// "contracts"/"services" au lieu d'un libellé, contredisant directement l'intention documentée
// ci-dessus. Reproduit en testant un compte sponsor réel : "billing" et "contracts" affichés tels
// quels en tête de page. Mêmes libellés que ceux déjà utilisés par resolveNavigation() pour les
// types qui ont ces entrées dans leur menu (voir navigation.ts).
//
// "/presences" (audit complet Organisation/Équipe/Utilisateurs, 31/08/2026) : le module est gated
// par organization_entitlements (canAccess, permissions.ts), pas par le plan Full Communication
// directement — un club peut donc avoir l'entitlement "presences" actif sans que /presences fasse
// partie de la navigation résolue pour son plan actuel (resolveNavigation ne l'ajoute qu'en Full
// Communication), par exemple juste après l'activation manuelle du module par le staff, avant que
// le contrat Full Communication ne soit relié. Reproduit en réel : la page se charge et fonctionne
// (RLS + entitlement l'autorisent), seul ce titre d'en-tête retombait sur le slug d'URL brut
// "presences" en minuscules faute d'entrée dans ce repli, contrairement à toutes les autres pages.
// "/users" et "/team-requests" (même audit, 31/08/2026) : les deux pages posent déjà leur propre
// garde-fou de contenu pour un type d'organisation hors périmètre (LockedModule pour users/
// page.tsx — "users" hors READY_MODULES, verrouillé pour tout le monde tant que club_members
// n'est pas branché pour ce type ; "Ce module ne concerne pas cet espace" pour team-requests/
// page.tsx), mais aucune des deux n'apparaît dans la navigation résolue pour un tel espace : même
// repli sur le slug d'URL brut que /presences. Libellé repris de navigation.ts (item("users",
// "Membres & accès", ...), constant partout) ; "Affiliations" pour team-requests, le libellé le
// plus générique parmi ses variantes par type d'organisation (Bible/navigation.ts).
const TITLE_FALLBACKS: Record<string, string> = {
  "/notifications": "Notifications",
  "/children": "Profils associés",
  "/authorizations": "Autorisations",
  "/billing": "Factures",
  "/contracts": "Contrats",
  "/services": "Prestations",
  "/presences": "Présences",
  "/users": "Membres & accès",
  "/team-requests": "Affiliations",
};

interface HeaderProps {
  onOpenMobileNav: () => void;
}

export function Header({ onOpenMobileNav }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { ctx } = useSession();
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  // Même source que la sidebar (resolveNavigation) : garantit le même libellé qu'elle affiche
  // pour la page courante (ex. "Mon espace" pour un joueur, "Accueil" pour un club — jamais un
  // "Tableau de bord" générique qui contredirait la sidebar). Repli sur TITLE_FALLBACKS pour les
  // routes volontairement absentes de la navigation, puis sur le segment d'URL brut en dernier
  // recours plutôt que de laisser le titre vide.
  const firstSegment = `/${pathname?.split("/")[1] ?? ""}`;
  let navEntries = resolveNavigation(ctx.organization.type, ctx.subscription.planCode);
  if (ctx.organization.type === "club") navEntries = filterClubRoleNav(navEntries, ctx.membership.role, ctx.membership.teamScope);
  const navLabel = navEntries.find((e) => e.kind === "item" && e.href === firstSegment)?.label;
  const title = navLabel ?? TITLE_FALLBACKS[firstSegment] ?? (pathname?.slice(1) || "Accueil");
  const initials = `${ctx.user.firstName[0] ?? ""}${ctx.user.lastName[0] ?? ""}`.toUpperCase() || "?";

  return (
    <header className="sticky top-0 z-30 flex h-[60px] items-center gap-2 border-b border-divider bg-bg/85 px-4 backdrop-blur-xl sm:h-[66px] sm:gap-3 sm:px-5 lg:gap-4 lg:px-7">
      {/* 17/08/2026 — la recherche (icône + champ desktop) a été retirée : ni value/onChange
          ni soumission, aucune saisie n'y déclenchait jamais rien (trouvé lors de l'audit
          complet). Mieux vaut son absence qu'une fausse promesse de fonctionnalité — même
          principe que le bouton "Continuer avec Google" retiré plus tôt cette nuit. */}
      <button
        aria-label="Ouvrir le menu"
        onClick={onOpenMobileNav}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] border border-border-strong bg-input-bg text-text-soft lg:hidden"
      >
        <Menu className="h-4 w-4" aria-hidden />
      </button>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-bold text-text-faint">{ctx.organization.name}</div>
        <div className="truncate text-[16px] font-extrabold tracking-tight sm:text-[18px]">{title}</div>
      </div>

      {/* "Nouvelle demande" (17/08/2026) : n'apparaît désormais que si "Mes demandes"/
          "Demandes de visuels" (module visual_requests) fait bien partie du menu du rôle actif
          — trouvé lors de l'audit complet : ce raccourci s'affichait pour tout le monde, y
          compris Trésorier/Secrétaire/Administratif dont le menu exclut délibérément ce module
          ("aucun contenu sportif parasite", Bible §10) — un Trésorier pouvait donc créer une
          demande de visuel via ce bouton alors que rien dans son menu n'y mène. */}
      {navEntries.some((e) => e.kind === "item" && e.module === "visual_requests") && (
        <button
          aria-label="Nouvelle demande"
          onClick={() => router.push("/requests/new")}
          className="flex h-9 flex-none items-center justify-center gap-1.5 rounded-[11px] bg-gradient-to-br from-brand-blue-electric to-brand-violet px-2.5 text-[13px] font-bold text-white shadow-sv-button sm:px-3.5"
        >
          <Plus className="h-3.5 w-3.5 flex-none" aria-hidden />
          <span className="hidden sm:inline">Nouvelle demande</span>
        </button>
      )}

      <button
        aria-label="Notifications"
        onClick={() => router.push("/notifications")}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] border border-border-strong bg-input-bg text-text-soft"
      >
        <Bell className="h-4 w-4" aria-hidden />
      </button>

      <button
        aria-label={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
        onClick={toggleTheme}
        className="hidden h-9 w-9 flex-none items-center justify-center rounded-[11px] border border-border-strong bg-input-bg text-text-soft sm:flex"
      >
        {theme === "dark" ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
      </button>

      <button
        aria-label="Aide"
        onClick={() => router.push("/support")}
        className="hidden h-9 w-9 flex-none items-center justify-center rounded-[11px] border border-border-strong bg-input-bg text-text-soft lg:flex"
      >
        <HelpCircle className="h-4 w-4" aria-hidden />
      </button>

      <button
        aria-label="Mon profil"
        onClick={() => router.push("/settings/profile")}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-violet to-brand-blue-electric text-[12px] font-extrabold text-white"
      >
        {initials}
      </button>
    </header>
  );
}
