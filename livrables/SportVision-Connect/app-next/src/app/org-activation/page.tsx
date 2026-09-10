"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { consumePendingOnboarding, pendingMetadata, savePendingOnboarding } from "@/lib/signup/pending-onboarding";
import { inscriptionSurCompteExistant, messageErreurAuth } from "@/lib/supabase/erreurs-auth";

// 10/09/2026 (audit des créations de compte) — mêmes corrections que /activation, pour les mêmes
// raisons : un compte déjà existant ne pouvait pas utiliser son lien (« Vérifiez vos e-mails » sans
// e-mail), les refus de Supabase s'affichaient en anglais, et l'activation ne suivait pas le compte
// quand le lien de confirmation était ouvert sur un autre appareil.

// /clubplus/org-activation?token=… — variante générique de /activation (lire ce fichier
// d'abord : même raisonnement) pour les 6 types d'organisation autres que "club" (académie,
// coach, structure de coaching, tournoi, stage, association/projet), servie par
// connect-org-check-activation-token / connect-org-activate. Même correctif du 17/08/2026 :
// remplace l'ancienne route morte en hash (#/org-activation?token=…).
const ORG_TYPE_LABELS: Record<string, string> = {
  academie: "académie",
  coach: "coach / préparateur",
  structure_coaching: "structure de coaching",
  tournoi: "tournoi / événement",
  stage: "stage / camp",
  cm_agency: "agence CM",
  projet: "association / structure",
};

type CheckStatus = "loading" | "valid" | "invalid" | "expired" | "used" | "revoked" | "error";

export default function OrgActivationPage() {
  return (
    <Suspense fallback={null}>
      <OrgActivationContent />
    </Suspense>
  );
}

function OrgActivationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = (searchParams.get("token") || "").trim();

  const [status, setStatus] = useState<CheckStatus>("loading");
  const [nomPrefill, setNomPrefill] = useState("");
  const [organizationType, setOrganizationType] = useState("");

  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [compteExistant, setCompteExistant] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke("connect-org-check-activation-token", {
        body: { token },
      });
      if (error || !data) {
        setStatus("error");
        return;
      }
      setStatus(data.status as CheckStatus);
      if (data.status === "valid") {
        setNomPrefill(data.nom_prefill || "");
        setNom(data.nom_prefill || "");
        setOrganizationType(data.organization_type || "");
      }
    })();
  }, [token]);

  // Double clic : deux inscriptions, donc un second e-mail de confirmation sur un quota de 15 par
  // heure pour tout SportVision (voir signup-free/page.tsx).
  const enCours = useRef(false);
  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (enCours.current) return;
    enCours.current = true;
    try {
      await soumettre();
    } finally {
      enCours.current = false;
    }
  }

  async function soumettre() {
    setSubmitError(null);
    if (!nom.trim()) {
      setSubmitError("Le nom de la structure est obligatoire.");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const adresse = email.trim();
    const pending = { kind: "connect-org-activation" as const, token, nom: nom.trim() };

    if (compteExistant) {
      const { error } = await supabase.auth.signInWithPassword({ email: adresse, password });
      if (error) {
        setSubmitting(false);
        setSubmitError(messageErreurAuth(error, "Connexion impossible. Vérifiez votre mot de passe."));
        return;
      }
      savePendingOnboarding(pending);
      try {
        await consumePendingOnboarding(supabase);
        router.push("/dashboard");
        router.refresh();
      } catch (e) {
        setSubmitting(false);
        setSubmitError(e instanceof Error ? e.message : "L'activation a échoué. Réessayez.");
      }
      return;
    }

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: adresse,
      password,
      options: {
        // Même correctif que signup-free/page.tsx (audit du 30/08/2026) : sans emailRedirectTo,
        // le lien de confirmation atterrit sur l'origine nue au lieu de /auth/callback, le code
        // PKCE n'est jamais échangé et le lien finit en "otp_expired" au second clic.
        emailRedirectTo: `${window.location.origin}/clubplus/auth/callback`,
        data: pendingMetadata(pending),
      },
    });
    if (signUpError) {
      setSubmitting(false);
      setSubmitError(messageErreurAuth(signUpError, "La création de votre compte a échoué. Réessayez."));
      return;
    }

    if (inscriptionSurCompteExistant(signUpData.user)) {
      setSubmitting(false);
      setCompteExistant(true);
      setPassword("");
      setInfo(
        "Un compte SportVision existe déjà avec cette adresse. Saisissez son mot de passe : votre espace sera activé dès la connexion.",
      );
      return;
    }

    if (!signUpData.session) {
      savePendingOnboarding(pending);
      setSubmitting(false);
      setAwaitingConfirmation(true);
      return;
    }

    try {
      await consumePendingOnboarding(supabase);
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setSubmitting(false);
      setSubmitError(e instanceof Error ? e.message : "L'activation a échoué. Réessayez.");
    }
  }

  if (status === "loading") {
    return (
      <CenteredShell>
        <Loader2 className="h-6 w-6 animate-spin text-brand-blue-electric" aria-hidden />
        <p className="mt-3 text-[13.5px] text-text-soft">Vérification du lien…</p>
      </CenteredShell>
    );
  }

  if (status !== "valid") {
    return (
      <CenteredShell>
        <StatusMessage status={status} />
      </CenteredShell>
    );
  }

  if (awaitingConfirmation) {
    return (
      <CenteredShell>
        <h2 className="text-[22px] font-extrabold tracking-tight">Vérifiez vos e-mails</h2>
        <p className="mt-3 max-w-sm text-[13.5px] leading-relaxed text-text-soft">
          Un e-mail de confirmation a été envoyé à <strong className="text-text">{email}</strong>. Cliquez sur le lien
          qu&apos;il contient pour finaliser l&apos;activation de {nom.trim() || "votre espace"}.
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

        <h2 className="mt-7 text-[26px] font-extrabold tracking-tight">Activer votre espace Club+</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-text-soft">
          {nomPrefill ? (
            <>
              SportVision vous invite à activer l&apos;espace {ORG_TYPE_LABELS[organizationType] || "Club+"} de{" "}
              <strong className="text-text">{nomPrefill}</strong>.
            </>
          ) : (
            <>Créez votre compte pour activer votre espace Club+.</>
          )}
        </p>

        {info && !submitError && (
          <div className="mt-5 flex gap-2.5 rounded-xl border border-border-strong bg-surface-alt px-3.5 py-3">
            <Info className="mt-0.5 h-4 w-4 flex-none text-brand-blue-electric" aria-hidden />
            <p className="text-[13px] font-semibold leading-relaxed text-text-soft">{info}</p>
          </div>
        )}

        {submitError && (
          <div role="alert" className="mt-5 flex gap-2.5 rounded-xl border border-[#FDA29B] bg-danger-bg px-3.5 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-danger-fg" aria-hidden />
            <p className="text-[13px] font-semibold leading-relaxed text-danger-fg">{submitError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <Field label="Nom de la structure" value={nom} onChange={setNom} required />
          <Field label="Adresse e-mail" value={email} onChange={setEmail} type="email" required />
          <Field
            label={compteExistant ? "Mot de passe de votre compte" : "Mot de passe"}
            value={password}
            onChange={setPassword}
            type="password"
            required
            minLength={compteExistant ? undefined : 8}
            aide={compteExistant ? undefined : "8 caractères minimum."}
          />

          <Button type="submit" disabled={submitting} className="mt-2 h-12 w-full text-[15px]">
            {submitting ? "Activation…" : compteExistant ? "Me connecter et activer" : "Activer mon espace Club+"}
          </Button>
          <button
            type="button"
            onClick={() => {
              setCompteExistant((v) => !v);
              setSubmitError(null);
              setInfo(null);
            }}
            className="text-[13px] font-bold text-brand-blue-electric hover:underline"
          >
            {compteExistant ? "Je n'ai pas encore de compte" : "J'ai déjà un compte SportVision"}
          </button>
        </form>
      </div>
    </div>
  );
}

function StatusMessage({ status }: { status: CheckStatus }) {
  const MESSAGES: Record<string, string> = {
    invalid: "Ce lien d'activation n'est pas valide.",
    expired: "Ce lien d'activation a expiré. Contactez SportVision pour en obtenir un nouveau.",
    used: "Ce lien d'activation a déjà été utilisé. Si c'est vous qui avez activé l'espace, connectez-vous.",
    revoked: "Ce lien d'activation a été retiré par SportVision.",
    error: "Impossible de vérifier ce lien pour le moment. Réessayez dans quelques instants.",
  };
  return (
    <>
      <AlertCircle className="h-8 w-8 text-danger-fg" aria-hidden />
      <p className="mt-3 max-w-sm text-[14px] font-semibold text-text">{MESSAGES[status] || MESSAGES.invalid}</p>
      <Link href="/auth/login" className="mt-4 text-[13.5px] font-bold text-brand-blue-electric hover:underline">
        Aller à la connexion
      </Link>
    </>
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
  aide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  minLength?: number;
  aide?: string;
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
      {aide && <span className="text-[11.5px] text-text-faint">{aide}</span>}
    </label>
  );
}
