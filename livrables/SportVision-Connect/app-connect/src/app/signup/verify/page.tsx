"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useSignup } from "../signup-context";

// Écran "Vérifiez votre boîte mail" — voir README design § Inscription. Le rattachement club
// réel se joue au premier login (voir /auth/login + lib/signup/pending-onboarding.ts), pas ici.
export default function SignupVerifyPage() {
  const { state } = useSignup();
  const [resendIn, setResendIn] = useState(0);
  const [resent, setResent] = useState(false);

  async function resend() {
    if (resendIn > 0 || !state.email) return;
    const supabase = createClient();
    await supabase.auth.resend({ type: "signup", email: state.email });
    setResent(true);
    setResendIn(30);
    const t = setInterval(() => {
      setResendIn((v) => {
        if (v <= 1) {
          clearInterval(t);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
  }

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <span className="flex h-[70px] w-[70px] items-center justify-center rounded-sv-card bg-[rgba(79,125,255,.16)]">
        <span className="material-symbols-rounded !text-[34px] text-[#8CA9FF]" aria-hidden="true">mail</span>
      </span>
      <div className="flex flex-col gap-2.5">
        <h1 className="font-sora text-[30px] font-bold tracking-tight">Vérifiez votre boîte mail</h1>
        <p className="text-[15px] leading-relaxed text-text-tertiary">
          Nous avons envoyé un lien de confirmation à{" "}
          <span className="font-medium text-text">{state.email || "votre adresse"}</span>. Ouvrez-le
          pour activer votre espace Connect.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={resend}
          className="flex items-center gap-3 rounded-sv-card border border-border bg-surface p-4"
        >
          <span className="material-symbols-rounded !text-[20px] text-[#C084FC]" aria-hidden="true">refresh</span>
          <span className="text-[14px] font-medium text-text">
            {resendIn > 0 ? `Renvoyer l'e-mail dans ${resendIn}s` : resent ? "E-mail renvoyé" : "Renvoyer l'e-mail"}
          </span>
        </button>
        <Link
          href="/auth/login"
          className="flex h-[54px] items-center justify-center rounded-sv border border-border-strong bg-surface font-sora text-[16px] font-semibold text-text hover:bg-surface-hover"
        >
          Retour à la connexion
        </Link>
      </div>
    </div>
  );
}
