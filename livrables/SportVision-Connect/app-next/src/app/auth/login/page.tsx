"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { consumePendingOnboarding } from "@/lib/signup/pending-onboarding";

// /auth/login — voir ACTIONS.md § 1. Ne jamais préciser si c'est l'e-mail ou le mot de passe
// qui est faux dans le message d'erreur.
export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(false);
    setSubmitting(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setSubmitting(false);
      setError(true);
      return;
    }

    // Filet de sécurité inscription (voir lib/signup/pending-onboarding.ts) : si ce compte
    // vient de confirmer son e-mail sans jamais avoir eu de session pour finaliser son
    // inscription, on la rejoue maintenant. Échec journalisé seulement, jamais bloquant pour
    // la connexion elle-même.
    try {
      const result = await consumePendingOnboarding(supabase);
      if (result?.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }
    } catch (e) {
      console.error("[login] rejeu de l'inscription en attente échoué :", e);
    }

    setSubmitting(false);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-chrome p-11 lg:flex">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(900px 520px at 8% -10%, rgba(36,75,255,.55), transparent 60%), radial-gradient(700px 500px at 95% 100%, rgba(138,46,255,.42), transparent 62%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <span className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[15px] font-extrabold text-white">
            SV
          </span>
          <span className="text-[17px] font-extrabold tracking-tight text-white">
            SportVision<span className="font-medium text-brand-blue-pale"> Club+</span>
          </span>
        </div>

        <div className="relative max-w-lg">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 py-1.5 pl-1.5 pr-3 text-[11.5px] font-bold text-[#C6D3F0]">
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-gradient-to-br from-brand-cyan to-brand-violet">
              <span className="h-1.5 w-1.5 animate-svpulse rounded-full bg-white" />
            </span>
            L&apos;espace professionnel SportVision
          </div>
          <h1 className="mt-6 text-[40px] font-extrabold leading-[1.08] tracking-tight text-white">
            Votre structure.
            <br />
            Vos prestations.
            <br />
            <span className="bg-gradient-to-r from-brand-blue-electric via-brand-cyan to-brand-violet-light bg-clip-text text-transparent">
              Votre relation SportVision.
            </span>
          </h1>
          <p className="mt-5 max-w-[420px] text-[16px] leading-relaxed text-text-secondary">
            Retrouvez vos demandes, contenus, prestations et échéances dans un seul espace
            professionnel.
          </p>
        </div>

        {/* "Tous les services fonctionnent" (16/08/2026) retiré : texte statique non relié à un
            vrai système de statut — un jour un service tombe et la page continuerait d'afficher
            un badge vert. Ne réintroduire que si un vrai statut est branché derrière. */}
        <div className="relative border-t border-white/10 pt-5 text-[12px] text-[#8B9BBE]">
          Clubs · Académies · Coachs · Structures · Événements
        </div>
      </div>

      <div className="flex items-center justify-center bg-bg-alt p-8">
        <div className="w-full max-w-[396px]">
          <h2 className="text-[28px] font-extrabold tracking-tight">Connexion</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-text-soft">
            Accédez à votre espace professionnel SportVision.
          </p>

          {error && (
            <div className="mt-5 flex gap-2.5 rounded-xl border border-[#FDA29B] bg-danger-bg px-3.5 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-danger-fg" aria-hidden />
              <p className="text-[13px] font-semibold leading-relaxed text-danger-fg">
                Identifiants incorrects. Vérifiez votre adresse e-mail et votre mot de passe.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-bold text-text-soft">Adresse e-mail</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nom@structure.fr"
                className="h-[46px] rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none transition-colors focus-visible:border-brand-blue-electric focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.18)]"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-bold text-text-soft">Mot de passe</span>
              <span className="relative block">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  className="h-[46px] w-full rounded-xl border border-border-strong bg-surface px-3.5 pr-11 text-[14px] outline-none transition-colors focus-visible:border-brand-blue-electric focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.18)]"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-1.5 top-1.5 flex h-[34px] w-[34px] items-center justify-center rounded-lg text-text-soft hover:bg-surface-sunken"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </span>
            </label>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-[12.5px] font-medium text-text-faint">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-3.5 w-3.5 accent-brand-blue-electric"
                />
                Se souvenir de moi
              </label>
              <Link href="/auth/forgot" className="text-[13px] font-bold text-brand-blue-electric">
                Mot de passe oublié
              </Link>
            </div>

            <Button type="submit" disabled={submitting} className="h-12 w-full text-[15px]">
              {submitting ? "Connexion…" : "Se connecter"}
            </Button>
          </form>

          <div className="mt-6 border-t border-border pt-5 text-center text-[13.5px] text-text-soft">
            Votre structure n&apos;est pas encore sur Club+ ?{" "}
            <Link href="/signup/type" className="font-extrabold text-brand-blue-electric">
              Inscrire ma structure
            </Link>
            <p className="mt-1.5 text-[11.5px] text-text-faint">
              Chaque demande d&apos;ouverture est vérifiée par SportVision.
            </p>
          </div>

          <div className="mt-4 text-center text-[12.5px] text-text-faint">
            Vous cherchez votre espace personnel ?{" "}
            <a href="https://connect.sportvision-an.fr" className="font-bold text-text-soft hover:text-brand-blue-electric">
              Accéder à Connect
            </a>
          </div>

          <div className="mt-8 text-center">
            <a href="https://sportvision-an.fr" className="text-[11.5px] font-semibold text-text-faint hover:text-text-soft">
              ← Retour à sportvision-an.fr
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
