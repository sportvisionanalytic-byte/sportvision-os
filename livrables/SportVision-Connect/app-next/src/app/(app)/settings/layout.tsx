"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session-context";
import { isClubNonBureauRole } from "@/lib/permissions";

// Coque des 3 écrans Paramètres — voir ACTIONS.md § 25. Fichier nouveau (aucun `settings/
// layout.tsx` n'existait), propre à mon périmètre : il ne touche à aucun layout partagé.
const TABS = [
  { href: "/settings/profile", label: "Personnel" },
  { href: "/settings/organization", label: "Organisation" },
  { href: "/settings/integrations", label: "Intégrations" },
];

// player/parent sont des espaces personnels (organization.name reprend le nom de la personne,
// voir buildPlayerActiveContext/buildParentActiveContext, session.ts) — pas une vraie
// organisation. L'onglet "Organisation" y affichait un formulaire club (SIRET, couleurs du club,
// logo « utilisé dans le Studio ») avec le nom de la personne à la place du nom du club : trouvé
// en testant le switch d'espace en réel. Masqué ici plutôt que laissé sous un onglet qui n'a pas
// de sens pour ces deux espaces.
//
// "Intégrations" masqué pour les deux mêmes espaces depuis le 11/08/2026 (brief Fouka § 16,
// espace Joueur : "Intégrations probablement non") — aucune intégration (Instagram, Stripe...) ne
// concerne un compte personnel, seulement une organisation.
const PERSONAL_ORG_TYPES = new Set(["player", "parent"]);

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { ctx } = useSession();
  const isPersonal = PERSONAL_ORG_TYPES.has(ctx.organization.type);
  // §31 du master doc (Communication/Éducateur) + Bible §7-§10 (Coach, Directeur sportif,
  // Secrétaire, Trésorier, Administratif, 17/08/2026) : "Personnel, Notifications, Mot de passe/
  // sécurité. Pas d'onglet organisation complet par défaut." pour les 6 rôles club "opérationnels"
  // — isClubNonBureauRole() étend l'ancien filtre (isClubCommunicationOrEducateur, 2 des 6 rôles
  // réellement concernés) sans changer son comportement pour Communication/Coach. Même traitement
  // que player/parent ci-dessus, casse séparée pour garder le commentaire d'origine intact.
  const hideOrgTabs = isPersonal || isClubNonBureauRole(ctx);
  const tabs = TABS.filter(
    (tab) => !hideOrgTabs || (tab.href !== "/settings/organization" && tab.href !== "/settings/integrations"),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[29px] font-extrabold tracking-tight">Paramètres</h1>
        <p className="mt-1 text-[13.5px] text-text-soft">
          {hideOrgTabs ? "Votre profil et votre club." : "Votre profil, votre organisation et vos intégrations."}
        </p>
      </div>

      {/* Un seul onglet réel (cas Joueur/Parent) : rien à choisir, la frise d'onglets n'apporte
          rien et encombre l'écran (même principe que le brief § 1 sur la navigation). */}
      {tabs.length > 1 && (
        <div className="flex gap-1.5 border-b border-divider">
          {tabs.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "relative px-3.5 pb-3 text-[13.5px] font-bold transition-colors duration-sv",
                  active ? "text-text" : "text-text-soft hover:text-text",
                )}
              >
                {tab.label}
                {active && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-gradient-to-r from-brand-blue to-brand-violet" />}
              </Link>
            );
          })}
        </div>
      )}

      {children}
    </div>
  );
}
