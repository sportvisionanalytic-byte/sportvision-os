"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { consumePendingOnboarding, savePendingOnboarding } from "@/lib/signup/pending-onboarding";

// /signup-free — inscription Club+ Gratuit instantanée, sans validation staff (décision Fouka,
// 19/08/2026 — voir lib/signup/pending-onboarding.ts § "clubplus-free-signup"). Volontairement
// une route à plat, hors du tunnel /signup/request/* (5 étapes, demande + revue staff) : ce
// dernier reste le seul chemin pour Start/Performance et les autres types de structure. Même
// gabarit que /activation (page autonome, pas de layout partagé), sans étape de vérification de
// token puisqu'il n'y a ici aucun lien privé à valider.
export default function SignupFreePage() {
  const [clubNom, setClubNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    if (!clubNom.trim()) {
      setSubmitError("Le nom du club est obligatoire.");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Sans ça, le lien du mail de confirmation redirige vers l'origine nue
        // ("https://clubplus.sportvision-an.fr/") plutôt que vers /auth/callback : le code PKCE
        // n'est alors jamais échangé (exchangeCodeForSession jamais appelé), le lien atterrit sur
        // /auth/login avec un ?code= mort puis "otp_expired" au clic suivant — même bug que celui
        // corrigé le 14/08/2026 côté app-connect (voir signup/club/page.tsx et auth/callback/
        // route.ts), jamais reproduit ici jusqu'à cet audit du 30/08/2026 : personne n'avait encore
        // testé en réel le clic sur le lien reçu par e-mail pour ce parcours self-service.
        emailRedirectTo: `${window.location.origin}/clubplus/auth/callback`,
      },
    });
    if (signUpError) {
      setSubmitting(false);
      setSubmitError(
        signUpError.message.toLowerCase().includes("already registered")
          ? "Un compte existe déjà avec cette adresse e-mail. Connectez-vous, votre club sera créé automatiquement."
          : signUpError.message,
      );
      return;
    }

    const pending = { kind: "clubplus-free-signup" as const, clubNom: clubNom.trim(), prenom, nom, telephone };

    if (!signUpData.session) {
      // Confirmation d'e-mail active sur ce projet : pas de session tant que le lien reçu par
      // e-mail n'a pas été cliqué — la création du club se joue depuis /auth/confirming, juste
      // après, quand une session réelle existe (voir consumePendingOnboarding).
      savePendingOnboarding(pending);
      setSubmitting(false);
      setAwaitingConfirmation(true);
      return;
    }

    try {
      await consumePendingOnboarding(supabase);
      window.location.href = "/dashboard";
    } catch (e) {
      setSubmitting(false);
      setSubmitError(e instanceof Error ? e.message : "La création de votre espace a échoué. Réessayez.");
    }
  }

  if (awaitingConfirmation) {
    return (
      <CenteredShell>
        <h2 className="text-[22px] font-extrabold tracking-tight">Vérifiez vos e-mails</h2>
        <p className="mt-3 max-w-sm text-[13.5px] leading-relaxed text-text-soft">
          Un e-mail de confirmation a été envoyé à <strong className="text-text">{email}</strong>. Cliquez sur le lien
          qu&apos;il contient pour créer votre espace Club+ Gratuit.
        </p>
      </CenteredShell>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-alt p-8">
      <div className="w-full max-w-[420px]">
        <div className="flex items-center gap-3">
          <span className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[15px] font-extrabold text-white">
            SV
          </span>
          <span className="text-[17px] font-extrabold tracking-tight">
            SportVision<span className="font-medium text-brand-blue-pale"> Club+</span>
          </span>
        </div>

        <h2 className="mt-7 text-[26px] font-extrabold tracking-tight">Créez votre espace Club+ Gratuit</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-text-soft">
          1 utilisateur, 1 équipe, réservation de prestations SportVision au tarif standard. Sans engagement, sans
          carte bancaire.
        </p>

        {submitError && (
          <div className="mt-5 flex gap-2.5 rounded-xl border border-[#FDA29B] bg-danger-bg px-3.5 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-danger-fg" aria-hidden />
            <p className="text-[13px] font-semibold leading-relaxed text-danger-fg">{submitError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <Field label="Nom du club" value={clubNom} onChange={setClubNom} required />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prénom" value={prenom} onChange={setPrenom} />
            <Field label="Nom" value={nom} onChange={setNom} />
          </div>
          <Field label="Téléphone" value={telephone} onChange={setTelephone} type="tel" />
          <Field label="Adresse e-mail" value={email} onChange={setEmail} type="email" required />
          <Field label="Mot de passe" value={password} onChange={setPassword} type="password" required minLength={8} />

          <Button type="submit" disabled={submitting} className="mt-2 h-12 w-full text-[15px]">
            {submitting ? "Création…" : "Créer mon espace Club+ Gratuit"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function CenteredShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-alt p-8 text-center">{children}</div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  minLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-bold text-text-soft">{label}</span>
      <input
        type={type}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[46px] rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none focus-visible:border-brand-blue-electric focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.18)]"
      />
    </label>
  );
}
