import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildPlayerContext, resolveDisplayIdentity, getAccountType } from "@/lib/supabase/session";
import { fetchMyAthletes, toNavItems } from "@/lib/supabase/particulier";
import { AppShell } from "@/components/layout/AppShell";
import { ParticularShell } from "@/components/layout/ParticularShell";
import { LEGAL_URLS } from "@/lib/legal-links";
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
  // Un visiteur non connecté (typiquement bloqué à la connexion) doit pouvoir obtenir de l'aide
  // sans compte — auparavant cette page redirigeait vers /auth/login, ce qui renvoyait droit à
  // l'écran que la personne n'arrivait justement pas à passer (trouvé par audit externe le
  // 16/08, confirmé dans le code). PublicHelpContent ne lit aucune donnée de compte.
  if (!user) return <PublicHelpContent />;

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

// Écran d'aide public (aucune session) — pas de AppShell/ParticularShell, ces deux shells ont
// besoin de données de compte (firstName, athlètes…) qu'un visiteur non connecté n'a pas. Reprend
// le sujet exact d'un utilisateur bloqué avant la connexion (mot de passe oublié, création de
// compte, etc.), voir audit externe du 16/08.
function PublicHelpContent() {
  return (
    <div className="flex min-h-screen flex-col bg-bg font-sans text-text">
      <div className="flex flex-none items-center justify-between gap-5 px-7 py-[22px]">
        <Link href="/auth/login" className="flex items-center gap-2.5 text-text">
          <Image src="/uploads/logo.png" alt="SportVision Connect" width={32} height={32} className="object-contain" />
          <div className="flex flex-col leading-tight">
            <span className="font-sora text-[15px] font-bold tracking-tight">SportVision</span>
            <span className="bg-sv-gradient bg-clip-text text-[10px] font-medium uppercase tracking-[.14em] text-transparent">
              Connect
            </span>
          </div>
        </Link>
        <Link href="/auth/login" className="flex items-center gap-2 text-[13px] font-medium text-text-tertiary hover:text-text">
          <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
          Retour à la connexion
        </Link>
      </div>

      <div className="flex flex-1 justify-center px-6 pb-10 pt-2">
        <div className="flex w-full max-w-[560px] flex-col gap-[26px]">
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[31px] font-bold tracking-tight">Comment pouvons-nous vous aider ?</h1>
            <p className="text-[15px] text-text-tertiary">Choisissez le sujet le plus proche de votre besoin.</p>
          </div>

          <div className="flex flex-col gap-3">
            <PublicHelpRow
              icon="lock"
              color="#22D3EE"
              bg="rgba(34,211,238,.14)"
              title="Problème de connexion"
              sub="E-mail ou mot de passe incorrect, compte bloqué."
              href={`mailto:${SUPPORT_EMAIL}`}
            />
            <PublicHelpRow
              icon="key"
              color="#F472B6"
              bg="rgba(244,114,182,.14)"
              title="Mot de passe oublié"
              sub="Recevoir un lien de réinitialisation."
              href="/auth/forgot"
            />
            <PublicHelpRow
              icon="person_add"
              color="#C084FC"
              bg="rgba(168,85,247,.16)"
              title="Problème lors de la création du compte"
              sub="E-mail déjà utilisé, e-mail de confirmation jamais reçu…"
              href={`mailto:${SUPPORT_EMAIL}`}
            />
            <PublicHelpRow
              icon="groups"
              color="#8CA9FF"
              bg="rgba(79,125,255,.16)"
              title="Je n&apos;arrive pas à rejoindre mon club"
              sub="Club introuvable, affiliation en attente…"
              href={`mailto:${SUPPORT_EMAIL}`}
            />
            <PublicHelpRow
              icon="help"
              color="#9A9AB8"
              bg="rgba(154,154,184,.16)"
              title="Autre problème"
              sub="Décrivez-nous votre situation."
              href={`mailto:${SUPPORT_EMAIL}`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-4 rounded-sv-card border border-border bg-surface p-5">
            <div className="flex flex-col gap-0.5">
              <span className="font-sora text-[14.5px] font-semibold">Contacter SportVision</span>
              <span className="text-[13px] text-text-tertiary">L&apos;équipe SportVision vous répond rapidement.</span>
            </div>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="ml-auto flex-none rounded-sv border border-border-strong bg-bg-elevated px-4 py-2.5 font-sora text-[13px] font-semibold hover:bg-surface-hover"
            >
              {SUPPORT_EMAIL}
            </a>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-text-label">
            <a href={LEGAL_URLS.mentionsLegales} target="_blank" rel="noopener noreferrer" className="hover:text-text-tertiary">
              Mentions légales
            </a>
            <a href={LEGAL_URLS.confidentialite} target="_blank" rel="noopener noreferrer" className="hover:text-text-tertiary">
              Confidentialité
            </a>
            <a href={LEGAL_URLS.cgv} target="_blank" rel="noopener noreferrer" className="hover:text-text-tertiary">
              Conditions d&apos;utilisation
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function PublicHelpRow({
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
      className="flex items-center gap-3.5 rounded-sv-card border border-border bg-surface p-4 text-left transition-colors duration-150 hover:bg-surface-hover"
    >
      <span className="flex h-11 w-11 flex-none items-center justify-center rounded-sv" style={{ background: bg }}>
        <span className="material-symbols-rounded !text-[21px]" style={{ color }} aria-hidden="true">
          {icon}
        </span>
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-sora text-[15px] font-semibold text-text">{title}</span>
        <span className="text-[13px] leading-snug text-text-tertiary">{sub}</span>
      </span>
      <span className="material-symbols-rounded ml-auto flex-none !text-[20px] text-text-label" aria-hidden="true">
        chevron_right
      </span>
    </a>
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
        <span className="material-symbols-rounded !text-[22px]" style={{ color }} aria-hidden="true">
          {icon}
        </span>
      </span>
      <span className="font-sora text-[16px] font-semibold">{title}</span>
      <span className="text-[13px] leading-relaxed text-text-tertiary">{sub}</span>
    </a>
  );
}
