"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

// /auth/forgot — lien "Mot de passe oublié" pointait vers une route inexistante depuis le tout
// premier déploiement (trouvé en vérifiant le site réellement en ligne, pas juste en local).
// Même edge function que l'app vanilla (request-password-reset) : réponse volontairement
// identique que l'e-mail existe ou non, pas de fuite d'information sur les comptes existants.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(false);
    setSubmitting(true);
    const supabase = createClient();
    // basePath "/clubplus" (next.config.mjs, 17/08/2026) : window.location.origin est une API
    // navigateur brute, jamais réécrite par Next contrairement à next/link — le préfixe doit être
    // ajouté à la main ici, sinon le lien de reset pointerait vers /auth/reset (sans /clubplus),
    // une route qui n'existe plus une fois le basePath actif.
    const redirectTo = `${window.location.origin}/clubplus/auth/reset`;
    const { error: fnError } = await supabase.functions.invoke("request-password-reset", {
      body: { email, redirect_url: redirectTo },
    });
    setSubmitting(false);
    if (fnError) {
      setError(true);
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-alt p-8">
      <div className="w-full max-w-[396px]">
        <div className="flex items-center gap-3">
          <span className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-gradient-to-br from-brand-blue-electric to-brand-violet text-[15px] font-extrabold text-white">
            SV
          </span>
          <span className="text-[17px] font-extrabold tracking-tight">
            SportVision<span className="font-medium text-brand-blue-pale"> Connect</span>
          </span>
        </div>

        {sent ? (
          <>
            <h2 className="mt-7 text-[28px] font-extrabold tracking-tight">Vérifiez votre boîte mail</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-text-soft">
              Si un compte existe pour <strong className="text-text">{email}</strong>, un lien pour choisir un
              nouveau mot de passe vient d&apos;être envoyé.
            </p>
          </>
        ) : (
          <>
            <h2 className="mt-7 text-[28px] font-extrabold tracking-tight">Mot de passe oublié</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-text-soft">
              Indiquez votre e-mail, vous recevrez un lien pour choisir un nouveau mot de passe.
            </p>

            {error && (
              <div className="mt-5 flex gap-2.5 rounded-xl border border-[#FDA29B] bg-danger-bg px-3.5 py-3">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-danger-fg" aria-hidden />
                <p className="text-[13px] font-semibold leading-relaxed text-danger-fg">
                  Une erreur est survenue, réessayez.
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
                  placeholder="sophie.martin@fcfontainebleau.fr"
                  className="h-[46px] rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.12)]"
                />
              </label>

              <Button type="submit" disabled={submitting} className="h-12 w-full text-[15px]">
                {submitting ? "Envoi…" : "Envoyer le lien"}
              </Button>
            </form>
          </>
        )}

        <div className="mt-6 border-t border-border pt-5 text-center text-[13.5px] text-text-soft">
          <Link href="/auth/login" className="font-extrabold text-brand-blue-electric">
            ← Retour à la connexion
          </Link>
        </div>
      </div>
    </div>
  );
}
