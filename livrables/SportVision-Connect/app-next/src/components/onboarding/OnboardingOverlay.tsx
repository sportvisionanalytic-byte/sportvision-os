"use client";

import { useEffect, useState } from "react";
import {
  Award,
  Building2,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  ImageIcon,
  LayoutDashboard,
  type LucideIcon,
  Palette,
  PartyPopper,
  Radio,
  Share2,
  Sparkles,
  Target,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useSession } from "@/lib/session-context";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { getOnboardingProgress, setOnboardingProgress } from "./onboarding-storage";

// Onboarding guidé — voir ACTIONS.md § 3. Affiché en overlay par-dessus le tableau de bord après
// la première connexion (pas une route séparée dans la maquette d'origine). Monté depuis
// src/app/(app)/dashboard/page.tsx — seule exception de montage autorisée pour ce module, voir
// le README.md de app-next § Conventions et la consigne de la tâche.
//
// Trois parcours selon l'offre active (README.md § Logique d'abonnement) : Full Communication a
// son propre parcours, Club+ (Gratuit, Start ou Performance) un autre, tout le reste (Accès via
// le club, Prestation unique) le parcours générique. La détection se fait sur l'offre de la
// session active plutôt que sur un paramètre transmis depuis /signup : après un `router.push`
// vers /dashboard, on quitte le groupe de routes /signup (et son contexte en mémoire) — la
// session résolue est la source de vérité la plus simple et la plus robuste ici.

interface StepContent {
  icon: LucideIcon;
  title: string;
  body: string;
}

const GENERIC_STEPS: StepContent[] = [
  { icon: Sparkles, title: "Bienvenue sur SportVision Club+", body: "Votre espace centralise vos demandes, vos contenus et vos échéances. Ce guide prend 3 minutes." },
  { icon: ClipboardCheck, title: "Vos informations", body: "Vérifiez votre profil : nom, fonction et coordonnées serviront pour toutes vos demandes." },
  { icon: Building2, title: "Votre organisation", body: "Nom, adresse et réseaux sociaux — ces informations personnalisent vos contenus." },
  { icon: CreditCard, title: "Votre abonnement", body: "Retrouvez à tout moment votre offre, vos quotas et votre facturation depuis « Gérer mon offre »." },
  { icon: ImageIcon, title: "Votre logo", body: "Ajoutez votre logo pour qu'il apparaisse automatiquement dans vos créations Studio." },
  // 25/08/2026, audit complet : "depuis « Utilisateurs »" retiré — /users reste verrouillé pour
  // tout type d'organisation hors club (READY_MODULES), ce parcours générique s'adressant aussi
  // à coach/académie/sponsor/tournoi/stage promettait donc un lien mort. Reformulé sans pointer
  // vers un écran inatteignable, en attendant que ce module soit ouvert pour ces types.
  { icon: UserPlus, title: "Votre équipe", body: "Votre interlocuteur SportVision peut ajouter d'autres personnes à votre espace si besoin." },
  { icon: Share2, title: "Vos réseaux", body: "Connectez Instagram, TikTok ou Meta Business depuis Paramètres → Intégrations." },
  { icon: LayoutDashboard, title: "Votre tableau de bord", body: "Il regroupe ce qui attend votre attention : validations, échéances, dernières créations." },
  { icon: Sparkles, title: "Votre première demande", body: "Lancez votre première demande de visuel depuis le Studio ou le bouton « Nouvelle demande »." },
  { icon: CheckCircle2, title: "À vous de jouer", body: "Vous êtes prêt. Retrouvez ce guide à tout moment depuis Aide → Revoir le tutoriel de bienvenue." },
];

const CLUB_PLUS_STEPS: StepContent[] = [
  { icon: Sparkles, title: "Bienvenue dans Club+", body: "Studio, crédits, équipes et demandes avancées : voici comment démarrer avec Club+." },
  { icon: Building2, title: "Votre club", body: "Vérifiez le nom, l'adresse et le nombre d'équipes renseignés à l'inscription." },
  { icon: Palette, title: "Logo et couleurs", body: "Vos couleurs de club habillent automatiquement vos créations Studio." },
  { icon: Users, title: "Vos équipes", body: "Ajoutez vos équipes pour retrouver leurs effectifs, calendriers et contenus au même endroit." },
  { icon: UserPlus, title: "Votre staff", body: "Invitez coachs et responsables : chacun ne voit que son périmètre." },
  { icon: Award, title: "Vos sponsors", body: "Suivez leurs livrables et leur visibilité directement depuis Club+." },
  { icon: ImageIcon, title: "Votre brand kit", body: "Le Studio préremplit vos créations avec votre logo, vos couleurs et vos sponsors." },
  { icon: PartyPopper, title: "Tout est prêt", body: "Votre espace Club+ est configuré. Lancez votre première demande depuis le Studio." },
];

const FULL_COM_STEPS: StepContent[] = [
  { icon: Sparkles, title: "Bienvenue", body: "Full Communication vous accompagne de bout en bout : brief, création, validation, publication." },
  { icon: Building2, title: "Votre structure", body: "Confirmez les informations de votre organisation transmises à votre conseiller." },
  { icon: Target, title: "Vos objectifs", body: "Notoriété, recrutement, sponsoring : vos priorités orientent le planning éditorial." },
  { icon: Share2, title: "Vos réseaux", body: "Connectez vos comptes pour permettre la programmation directe des publications." },
  { icon: Palette, title: "Votre identité", body: "Logo, couleurs et ton éditorial : la base de toutes vos créations." },
  { icon: Users, title: "Vos équipes et sponsors", body: "Un aperçu complet permet à votre Community Manager de mieux vous représenter." },
  { icon: Calendar, title: "Votre calendrier", body: "Matchs, événements et échéances à anticiper pour les prochaines semaines." },
  { icon: ClipboardCheck, title: "Vos attentes", body: "Fréquence de publication, formats prioritaires, tonalité : précisez ce qui compte pour vous." },
  { icon: Radio, title: "Votre Community Manager prépare votre stratégie", body: "Vous recevrez votre premier planning éditorial sous 48h, à valider depuis « À valider »." },
];

function useOnboardingVariant() {
  const { ctx } = useSession();
  if (ctx.subscription.planCode === "full_communication") {
    return { steps: FULL_COM_STEPS, heading: "Onboarding Full Communication" };
  }
  if (
    ctx.subscription.planCode === "club_plus_free" ||
    ctx.subscription.planCode === "club_plus_start" ||
    ctx.subscription.planCode === "club_plus_performance"
  ) {
    return { steps: CLUB_PLUS_STEPS, heading: "Onboarding Club+" };
  }
  return { steps: GENERIC_STEPS, heading: "Bienvenue sur Club+" };
}

export function OnboardingOverlay() {
  const { steps, heading } = useOnboardingVariant();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    const progress = getOnboardingProgress();
    setCompleted(progress.completed);
    setStepIndex(Math.min(progress.step, steps.length - 1));
    setOpen(!progress.completed && progress.step === 0);
    setReady(true);
    // Ne dépend que du montage initial : la variante ne doit pas relancer l'overlay si elle
    // change après coup (changement d'organisation active en cours de tutoriel).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready || completed) return null;

  const isLast = stepIndex === steps.length - 1;
  const step = steps[stepIndex]!;
  const Icon = step.icon;

  function persist(next: { step: number; completed: boolean }) {
    setOnboardingProgress(next);
  }

  function handleContinue() {
    if (isLast) {
      setCompleted(true);
      setOpen(false);
      persist({ step: stepIndex, completed: true });
      return;
    }
    const next = stepIndex + 1;
    setStepIndex(next);
    persist({ step: next, completed: false });
  }

  function handleBack() {
    const prev = Math.max(0, stepIndex - 1);
    setStepIndex(prev);
    persist({ step: prev, completed: false });
  }

  function handleLater() {
    setOpen(false);
    persist({ step: stepIndex, completed: false });
  }

  if (!open) {
    if (bannerDismissed || stepIndex === 0) return null;
    const pct = Math.round((stepIndex / (steps.length - 1)) * 100);
    return (
      <div className="animate-svfade mb-5 flex flex-wrap items-center gap-3.5 rounded-sv-card border border-brand-blue/30 bg-info-bg px-4 py-3.5">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-blue to-brand-violet text-white">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-extrabold">Votre tutoriel de bienvenue n&apos;est pas terminé</div>
          <div className="text-[12px] text-text-soft">
            {pct}% complété · étape {stepIndex + 1} sur {steps.length}
          </div>
        </div>
        <Button variant="secondary" className="h-8 px-3 text-[12px]" onClick={() => setBannerDismissed(true)}>
          Plus tard
        </Button>
        <Button className="h-8 px-3 text-[12px]" onClick={() => setOpen(true)}>
          Reprendre
        </Button>
      </div>
    );
  }

  const pct = ((stepIndex + 1) / steps.length) * 100;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(7,10,23,.65)] p-4">
      <Card className="animate-svfade relative flex w-full max-w-[520px] flex-col gap-5 rounded-sv-modal p-7 shadow-sv-modal">
        <button
          aria-label="Terminer plus tard"
          onClick={handleLater}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-faint hover:bg-surface-sunken hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <div className="flex items-center justify-between pr-8">
          <span className="text-[11px] font-extrabold uppercase tracking-[.09em] text-text-faint">{heading}</span>
          <span className="text-[11.5px] font-bold text-text-soft">
            Étape {stepIndex + 1} / {steps.length}
          </span>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-cyan to-brand-violet transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex flex-col items-center gap-3.5 py-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-blue to-brand-violet text-white">
            <Icon className="h-6 w-6" aria-hidden />
          </span>
          <h2 className="text-[20px] font-extrabold tracking-tight">{step.title}</h2>
          <p className="max-w-[380px] text-[13.5px] leading-relaxed text-text-soft">{step.body}</p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            {stepIndex > 0 && (
              <Button variant="secondary" onClick={handleBack}>
                Retour
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleLater}
              className={cn("text-[12.5px] font-bold text-text-soft hover:text-text", isLast && "hidden")}
            >
              Terminer plus tard
            </button>
            <Button onClick={handleContinue}>{isLast ? "Accéder à mon tableau de bord" : "Continuer"}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
