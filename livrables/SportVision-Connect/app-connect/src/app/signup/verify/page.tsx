"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cheminInterne } from "@/lib/signup/pending-onboarding";
import { messageErreurAuth } from "@/lib/auth/messages";
import { useSignup } from "../signup-context";

// Écran "Vérifiez votre boîte mail" — voir README design § Inscription. Le rattachement club
// réel se joue au premier login (voir /auth/login + lib/signup/pending-onboarding.ts), pas ici.
//
// Trois défauts corrigés le 10/09/2026 :
//   - le renvoi ne précisait pas `emailRedirectTo` : le NOUVEAU lien menait à la racine du site
//     avec un `?code=` que personne ne lit — adresse confirmée, mais personne connecté, et plus
//     aucune trace de la page d'où l'on venait ;
//   - le résultat du renvoi était ignoré : « E-mail renvoyé » s'affichait même quand Supabase
//     avait refusé (plafond de 15 e-mails par heure, ou délai de 60 s entre deux envois à la
//     même adresse) ;
//   - le compte à rebours était de 30 s alors que Supabase exige 60 s : le second clic échouait
//     à coup sûr, en silence.
const DELAI_RENVOI_S = 60;

export default function SignupVerifyPage() {
  const { state } = useSignup();
  const [resendIn, setResendIn] = useState(0);
  const [resent, setResent] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const minuterie = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (minuterie.current) clearInterval(minuterie.current);
  }, []);

  function demarrerDecompte(secondes: number) {
    setResendIn(secondes);
    if (minuterie.current) clearInterval(minuterie.current);
    minuterie.current = setInterval(() => {
      setResendIn((v) => {
        if (v <= 1) {
          if (minuterie.current) clearInterval(minuterie.current);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
  }

  async function resend() {
    if (resendIn > 0 || envoi || !state.email) return;
    setEnvoi(true);
    setErreur(null);
    const supabase = createClient();
    const suite = cheminInterne(state.suite);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: state.email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback${suite ? `?next=${encodeURIComponent(suite)}` : ""}`,
      },
    });
    setEnvoi(false);
    if (error) {
      setResent(false);
      setErreur(messageErreurAuth(error, "renvoi"));
      const secondes = Number(error.message?.match(/after (\d+) seconds?/i)?.[1]);
      if (secondes > 0) demarrerDecompte(secondes);
      return;
    }
    setResent(true);
    demarrerDecompte(DELAI_RENVOI_S);
  }

  const suiteSure = cheminInterne(state.suite);

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
          pour activer votre espace Connect, depuis ce téléphone ou un autre appareil.
        </p>
        <p className="text-[13px] leading-relaxed text-text-label">
          Rien reçu après quelques minutes ? Regardez dans les courriers indésirables (spam).
        </p>
      </div>

      {/* Inscription reprise sur une adresse jamais confirmée : Supabase garde le mot de passe de
          la première fois (mesuré le 10/09/2026). Sans cet avertissement, la personne confirmait
          puis lisait « mot de passe incorrect » avec celui qu'elle venait de choisir. */}
      {state.reprise && (
        <div role="status" className="rounded-sv border border-border-strong bg-surface px-4 py-3.5 text-[13px] leading-relaxed text-text-secondary">
          Une inscription avait déjà été commencée avec cette adresse : nous vous avons renvoyé le lien
          de confirmation. Le mot de passe valable reste celui choisi la première fois. Vous ne vous en
          souvenez plus ?{" "}
          <Link href="/auth/forgot" className="font-semibold text-[#8CA9FF] underline underline-offset-2">
            Choisir un nouveau mot de passe
          </Link>
          .
        </div>
      )}

      {erreur && (
        <p role="alert" className="rounded-sv border border-danger-border bg-danger-bg px-4 py-3 text-[13px] leading-relaxed text-[#FBCFE8]">
          {erreur}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={resend}
          disabled={resendIn > 0 || envoi}
          className="flex items-center gap-3 rounded-sv-card border border-border bg-surface p-4 disabled:opacity-60"
        >
          <span className="material-symbols-rounded !text-[20px] text-[#C084FC]" aria-hidden="true">refresh</span>
          <span className="text-[14px] font-medium text-text">
            {envoi
              ? "Envoi…"
              : resendIn > 0
                ? `${resent ? "E-mail renvoyé. " : ""}Nouvel envoi possible dans ${resendIn} s`
                : resent
                  ? "E-mail renvoyé"
                  : "Renvoyer l'e-mail"}
          </span>
        </button>
        <Link
          href={`/auth/login${suiteSure ? `?next=${encodeURIComponent(suiteSure)}` : ""}`}
          className="flex h-[54px] items-center justify-center rounded-sv border border-border-strong bg-surface font-sora text-[16px] font-semibold text-text hover:bg-surface-hover"
        >
          Retour à la connexion
        </Link>
        {/* Une faute de frappe dans l'adresse était une impasse : cet écran n'offrait aucun retour
            vers le formulaire (la barre d'étapes y est masquée). */}
        <Link href="/signup" className="self-center text-[13px] font-medium text-text-tertiary underline underline-offset-2 hover:text-text">
          Ce n&apos;est pas la bonne adresse ? La corriger
        </Link>
      </div>
    </div>
  );
}
