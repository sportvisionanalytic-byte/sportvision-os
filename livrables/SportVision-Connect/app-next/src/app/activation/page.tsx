"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { consumePendingOnboarding, pendingMetadata, savePendingOnboarding } from "@/lib/signup/pending-onboarding";
import { inscriptionSurCompteExistant, messageErreurAuth } from "@/lib/supabase/erreurs-auth";

// 10/09/2026 (audit des créations de compte) — la page n'offrait QUE la création d'un compte.
// Un dirigeant déjà inscrit (parent sur Connect, ancien client du Portail…) recevait « Vérifiez
// vos e-mails » et n'en recevait aucun : Supabase ne crée ni n'écrit rien pour une adresse déjà
// prise (voir erreurs-auth.ts). Le lien d'activation était donc inutilisable pour lui. La page
// reconnaît désormais ce cas et propose de se connecter avec ce compte, puis active le club dans la
// foulée. Les refus de Supabase s'affichaient aussi en anglais.

// /clubplus/activation?token=… — écran d'atterrissage réel d'un lien d'activation Club+ (type
// "club") généré par clubplus-generate-activation ou connect-club-signup-review. Remplace, à
// partir du 17/08/2026, l'ancienne route en fragment de hash (#/activation?token=…) héritée de
// l'app vanilla (SportVision-Connect/app/index.html) : ni app-connect ni app-next (routeur App
// Router, aucune route en hash) ne l'ont jamais lue — trouvé lors de l'audit complet Club+, tout
// lien d'activation généré depuis fin de fusion Connect/Club+ (12/08/2026) atterrissait sur une
// page blanche.
//
// Le token est revérifié intégralement côté serveur par clubplus-activate (voir ce fichier) :
// clubplus-check-activation-token, appelée ici, ne sert qu'à décider quel écran afficher.
const PLAN_LABELS: Record<string, string> = { free: "Club+ Gratuit", club: "Club+ Start", performance: "Club+ Performance" };

type CheckStatus = "loading" | "valid" | "invalid" | "expired" | "used" | "revoked" | "error";

export default function ActivationPage() {
  return (
    <Suspense fallback={null}>
      <ActivationContent />
    </Suspense>
  );
}

function ActivationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = (searchParams.get("token") || "").trim();

  const [status, setStatus] = useState<CheckStatus>("loading");
  const [clubNomPrefill, setClubNomPrefill] = useState("");
  const [plan, setPlan] = useState("club");

  const [clubNom, setClubNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
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
      const { data, error } = await supabase.functions.invoke("clubplus-check-activation-token", {
        body: { token },
      });
      if (error || !data) {
        setStatus("error");
        return;
      }
      setStatus(data.status as CheckStatus);
      if (data.status === "valid") {
        setClubNomPrefill(data.club_nom_prefill || "");
        setClubNom(data.club_nom_prefill || "");
        setPlan(data.plan || "club");
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
    if (!clubNom.trim()) {
      setSubmitError("Le nom du club est obligatoire.");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const adresse = email.trim();
    const pending = { kind: "clubplus-activation" as const, token, clubNom: clubNom.trim(), prenom, nom, telephone };

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
        // L'activation suit le compte, pas le navigateur : le lien de confirmation peut être
        // ouvert sur un autre appareil (voir pending-onboarding.ts).
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
        "Un compte SportVision existe déjà avec cette adresse. Saisissez son mot de passe : votre espace Club+ sera activé dès la connexion.",
      );
      return;
    }

    if (!signUpData.session) {
      // Confirmation d'e-mail active sur ce projet (cas normal) : pas de session tant que le lien
      // reçu par e-mail n'a pas été cliqué — voir lib/signup/pending-onboarding.ts. L'activation
      // réelle du club se joue depuis /auth/confirming, juste après.
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
          qu&apos;il contient pour finaliser l&apos;activation de {clubNom.trim() || "votre club"}.
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
          {clubNomPrefill ? (
            <>
              SportVision vous invite à activer l&apos;espace Club+ de <strong className="text-text">{clubNomPrefill}</strong>
              , formule {PLAN_LABELS[plan] || plan}.
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
          <Field label="Nom du club" value={clubNom} onChange={setClubNom} required />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prénom" value={prenom} onChange={setPrenom} />
            <Field label="Nom" value={nom} onChange={setNom} />
          </div>
          <Field label="Téléphone" value={telephone} onChange={setTelephone} type="tel" />
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
    // Le cas le plus fréquent d'un lien déjà utilisé : c'est la personne elle-même, qui rouvre
    // l'e-mail d'activation au lieu de la page de connexion. On lui montre la porte.
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
