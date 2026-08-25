"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { createClient } from "@/lib/supabase/client";

// /auth/forgot — port de l'écran "Mot de passe oublié" du design de référence.
//
// 25/08/2026, audit complet : appelait resetPasswordForEmail() nativement (e-mail générique
// Supabase, pas de branding SportVision, pas de rate-limit dédié) au lieu de passer par la même
// edge function que Club+ (request-password-reset — e-mail brandé via le Communication Hub,
// rate-limit par e-mail+IP, et la fenêtre anti-doublon 30s corrigée le 23/08). Harmonisé ici pour
// que les deux apps partagent le même comportement.
export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
  const bad = touched && !validEmail(email);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setTouched(true);
    if (!validEmail(email)) return;
    setBusy(true);
    const supabase = createClient();
    // Ne jamais révéler si le compte existe — réponse toujours identique (cf. README design §
    // note sécurité), c'est déjà le comportement de request-password-reset lui-même.
    await supabase.functions.invoke("request-password-reset", {
      body: { email, redirect_url: `${window.location.origin}/auth/reset` },
    });
    setBusy(false);
    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6 font-sans text-text">
      <div className="w-full max-w-[404px]">
        {!sent ? (
          <div className="flex flex-col gap-6 animate-sv-in">
            <Link href="/auth/login" className="flex items-center gap-2 self-start text-[13px] font-medium text-text-tertiary hover:text-text">
              <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
              Retour à la connexion
            </Link>
            <div className="flex flex-col gap-2">
              <h1 className="font-sora text-[30px] font-bold tracking-tight">Mot de passe oublié</h1>
              <p className="text-[15px] leading-relaxed text-text-tertiary">
                Indiquez votre adresse e-mail, nous vous envoyons un lien de réinitialisation.
              </p>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <Field
                id="sv-fg"
                label="Adresse e-mail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="votre@email.com"
                error={bad ? "Saisissez une adresse e-mail valide." : null}
              />
              <Button type="submit" loading={busy} className="w-full">
                {busy ? "Envoi…" : "Envoyer le lien"}
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-5 animate-sv-in">
            <span className="flex h-[66px] w-[66px] items-center justify-center rounded-sv-card bg-affiliations-bg">
              <span className="material-symbols-rounded !text-[32px] text-affiliations" aria-hidden="true">mark_email_read</span>
            </span>
            <div className="flex flex-col gap-2.5">
              <h1 className="font-sora text-[28px] font-bold tracking-tight">Vérifiez votre boîte mail</h1>
              <p className="text-[15px] leading-relaxed text-text-tertiary">
                Si un compte existe pour <span className="font-medium text-text">{email}</span>, un
                lien de réinitialisation vient d&apos;être envoyé. Il expire dans 30 minutes.
              </p>
            </div>
            <Link
              href="/auth/login"
              className="mt-1 flex h-[54px] w-full items-center justify-center rounded-sv border border-border-strong bg-surface font-sora text-[16px] font-semibold hover:bg-surface-hover"
            >
              Retour à la connexion
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
