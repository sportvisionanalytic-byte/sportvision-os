"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

// /auth/reset — cible de redirect_url envoyée par request-password-reset (voir /auth/forgot).
// Le client Supabase navigateur (createBrowserClient) détecte automatiquement la session de
// récupération dans l'URL au chargement (code PKCE ou #access_token, comportement par défaut de
// @supabase/ssr) et déclenche l'évènement PASSWORD_RECOVERY — pas de token à lire manuellement.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError("Le lien a peut-être expiré. Redemandez un nouveau lien.");
      return;
    }
    setDone(true);
    setTimeout(() => {
      router.push("/dashboard");
      router.refresh();
    }, 1200);
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

        <h2 className="mt-7 text-[28px] font-extrabold tracking-tight">Choisir un nouveau mot de passe</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-text-soft">
          Ce lien est à usage unique, valable une durée limitée.
        </p>

        {!ready && !done && (
          <p className="mt-5 text-[13.5px] text-text-soft">Vérification du lien…</p>
        )}

        {done && (
          <p className="mt-5 text-[13.5px] font-bold text-success-fg">Mot de passe enregistré. Vous êtes connecté.</p>
        )}

        {ready && !done && (
          <>
            {error && (
              <div className="mt-5 flex gap-2.5 rounded-xl border border-[#FDA29B] bg-danger-bg px-3.5 py-3">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-danger-fg" aria-hidden />
                <p className="text-[13px] font-semibold leading-relaxed text-danger-fg">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-bold text-text-soft">Nouveau mot de passe</span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  className="h-[46px] rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.12)]"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-bold text-text-soft">Confirmer le mot de passe</span>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••"
                  className="h-[46px] rounded-xl border border-border-strong bg-surface px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,75,255,.12)]"
                />
              </label>

              <Button type="submit" disabled={submitting} className="h-12 w-full text-[15px]">
                {submitting ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
