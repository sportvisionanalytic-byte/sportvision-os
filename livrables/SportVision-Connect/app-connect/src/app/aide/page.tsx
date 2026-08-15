import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, resolveDisplayIdentity, getAccountType } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { AppShell } from "@/components/layout/AppShell";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { AideFaq } from "./AideFaq";

const SUPPORT_EMAIL = "contact@sportvision-an.fr";

// Aide — voir design-connect-personnel-12-08/README.md § Espace joueur → Aide et
// Connect Espace Joueur.dc.html (section "AIDE", helpCards/helpFaq). Reconstruit le 14/08 :
// cette page n'était qu'un stub sans AppShell ("Aide — à porter en Phase 2"), ce qui laissait
// l'utilisateur sans navigation possible dès qu'il cliquait sur le "?" de la sidebar/du header
// mobile (seul accès à cette page, voir AppShell.tsx). Contenu 100% statique et fidèle au
// prototype (FAQ figée, contact par e-mail, renvoi vers Messages) : aucune fonctionnalité
// nouvelle, aucun backend — la vraie FAQ complète et l'assistance compte restent "à connecter"
// (le prototype lui-même les marque flash()/à rédiger, jamais un vrai écran).
//
// Cas particulier dans le chantier "garde-fou account_type" du 15/08 : contrairement à toutes
// les autres routes de l'Espace joueur, cette page ne peut PAS appeler requireJoueurAccount() (qui
// redirigerait tout compte 'particulier' vers /particulier) — le `?` de Topbar.tsx est un
// composant PARTAGÉ entre AppShell et ParticularShell, avec un unique href="/aide" codé en dur
// (voir son commentaire de tête : "L'aide n'est PAS dans la sidebar (...) son unique accès").
// Aucune route /particulier/aide n'existe (vérifié avant d'écrire ce fichier) : /aide est donc le
// SEUL point d'entrée aide pour les deux espaces, par construction du design, pas un oubli. Cette
// page lit account_type elle-même et rend le bon shell (AppShell ou ParticularShell) autour du
// même contenu (HelpContent ci-dessous), au lieu de rediriger vers une route qui n'existe pas.
export default async function AidePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [player, accountType] = await Promise.all([
    buildPlayerContext(supabase, user.id),
    getAccountType(supabase, user.id),
  ]);

  if (accountType === "particulier") {
    const identity = resolveDisplayIdentity(user, player);
    const firstName = identity.firstName || user.email?.split("@")[0] || "";
    const athletes = await fetchMyAthletes(supabase).catch(() => []);

    return (
      <ParticularShell firstName={firstName} athletes={toNavItems(athletes)}>
        <HelpContent messagesHref="/particulier/messages" />
      </ParticularShell>
    );
  }

  const firstName = player?.firstName || user.email?.split("@")[0] || "";

  return (
    <AppShell firstName={firstName}>
      <HelpContent messagesHref="/messages" />
    </AppShell>
  );
}

// Contenu partagé par les deux espaces — factorisé pour ne jamais diverger entre AppShell et
// ParticularShell (même FAQ, même contact). Seul `messagesHref` change : chaque espace a sa
// propre route Messages (/messages côté joueur, /particulier/messages côté particulier — voir
// ParticularShell.tsx pour la décision documentée sur cette duplication de route volontaire).
function HelpContent({ messagesHref }: { messagesHref: string }) {
  return (
    <div className="flex max-w-[760px] flex-col gap-[22px] animate-sv-in">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[27px] font-bold tracking-tight lg:text-[33px]">
          Comment pouvons-nous vous aider ?
        </h1>
        <p className="text-[15px] text-text-tertiary">Choisissez le sujet le plus proche de votre besoin.</p>
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <HelpCard
          icon="support_agent"
          color="#22D3EE"
          bg="rgba(34,211,238,.14)"
          title="Contacter SportVision"
          sub="Une question précise ? Écrivez-nous."
          href={messagesHref}
        />
        <HelpCard
          icon="chat_bubble"
          color="#F472B6"
          bg="rgba(244,114,182,.14)"
          title="Messages"
          sub="Reprendre une conversation en cours."
          href={messagesHref}
        />
        <HelpCard
          icon="account_circle"
          color="#C084FC"
          bg="rgba(168,85,247,.16)"
          title="Problème avec mon compte"
          sub="Connexion, e-mail, mot de passe."
          href={`mailto:${SUPPORT_EMAIL}`}
        />
        <HelpCard
          icon="quiz"
          color="#8CA9FF"
          bg="rgba(79,125,255,.16)"
          title="Questions fréquentes"
          sub="Contenus, prestations, cotisations et affiliations."
          href="#faq"
        />
      </div>

      <AideFaq />

      <div className="flex flex-wrap items-center gap-4 rounded-sv-card border border-border bg-surface p-5">
        <div className="flex flex-col gap-0.5">
          <span className="font-sora text-[14.5px] font-semibold">Toujours besoin d&apos;aide ?</span>
          <span className="text-[13px] text-text-tertiary">L&apos;équipe SportVision vous répond rapidement.</span>
        </div>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="ml-auto flex-none rounded-sv border border-border-strong bg-bg-elevated px-4 py-2.5 font-sora text-[13px] font-semibold hover:bg-surface-hover"
        >
          {SUPPORT_EMAIL}
        </a>
      </div>
    </div>
  );
}

function HelpCard({
  icon,
  color,
  bg,
  title,
  sub,
  href,
}: {
  icon: string;
  color: string;
  bg: string;
  title: string;
  sub: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="flex flex-col gap-2.5 rounded-sv-card border border-border bg-surface p-5 transition-colors duration-150 hover:bg-surface-hover"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-sv" style={{ background: bg }}>
        <span className="material-symbols-rounded !text-[22px]" style={{ color }}>
          {icon}
        </span>
      </span>
      <span className="font-sora text-[16px] font-semibold">{title}</span>
      <span className="text-[13px] leading-relaxed text-text-tertiary">{sub}</span>
    </a>
  );
}
