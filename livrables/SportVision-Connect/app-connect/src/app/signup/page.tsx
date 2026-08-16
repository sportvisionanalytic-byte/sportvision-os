"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { LEGAL_URLS } from "@/lib/legal-links";
import { useSignup } from "./signup-context";

// Étape 1 · Identité — voir design-connect-personnel-12-08/README.md § Inscription.
// Ne crée PAS le compte ici : auth.signUp() n'est appelé qu'à la toute fin du tunnel (étape
// Club), une fois toutes les informations réunies — même séquencement que app-next
// (app/signup/checkout/page.tsx), pour ne poser qu'un seul compte réel même si l'utilisateur
// abandonne en cours de route.
export default function SignupIdentityPage() {
  const router = useRouter();
  const { state, patch } = useSignup();
  const [pw2, setPw2] = useState("");
  const [touched, setTouched] = useState(false);

  const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
  const score = passwordScore(state.password);

  const canContinue =
    state.firstName.trim() &&
    state.lastName.trim() &&
    validEmail(state.email) &&
    state.password.length >= 8 &&
    state.password === pw2;

  function handleContinue() {
    setTouched(true);
    if (!canContinue) return;
    router.push("/signup/profil");
  }

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[32px] font-bold tracking-tight">Créons votre espace Connect</h1>
        <p className="text-[15px] text-text-tertiary">Quelques informations suffisent pour commencer.</p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <div className="flex-1">
            <Field
              id="su-fn"
              label="Prénom"
              placeholder="Lucas"
              value={state.firstName}
              onChange={(e) => patch({ firstName: e.target.value })}
              error={touched && !state.firstName.trim() ? "Renseignez votre prénom." : null}
            />
          </div>
          <div className="flex-1">
            <Field
              id="su-ln"
              label="Nom"
              placeholder="Moreau"
              value={state.lastName}
              onChange={(e) => patch({ lastName: e.target.value })}
              error={touched && !state.lastName.trim() ? "Renseignez votre nom." : null}
            />
          </div>
        </div>

        <Field
          id="su-em"
          label="Adresse e-mail"
          type="email"
          autoComplete="email"
          placeholder="votre@email.com"
          value={state.email}
          onChange={(e) => patch({ email: e.target.value })}
          error={touched && !validEmail(state.email) ? "Saisissez une adresse e-mail valide." : null}
        />

        <div className="flex flex-col gap-2">
          <Field
            id="su-pw"
            label="Mot de passe"
            type="password"
            autoComplete="new-password"
            placeholder="8 caractères minimum"
            value={state.password}
            onChange={(e) => patch({ password: e.target.value })}
          />
          {state.password.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="h-1 flex-1 overflow-hidden rounded-sv-pill bg-white/10">
                <div
                  className="h-full rounded-sv-pill transition-[width] duration-300"
                  style={{ width: `${score.pct}%`, background: score.color }}
                />
              </div>
              <span className="flex-none text-[11px] text-text-tertiary">{score.label}</span>
            </div>
          )}
        </div>

        <Field
          id="su-pw2"
          label="Confirmer le mot de passe"
          type="password"
          autoComplete="new-password"
          placeholder="Retapez votre mot de passe"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          error={touched && pw2 !== state.password ? "Les deux mots de passe ne correspondent pas." : null}
        />
      </div>

      <p className="text-[12px] leading-relaxed text-text-label">
        En créant votre compte, vous acceptez les{" "}
        <a href={LEGAL_URLS.cgv} target="_blank" rel="noopener noreferrer" className="font-medium text-[#8CA9FF] hover:text-[#B6C7FF] underline">
          Conditions d&apos;utilisation
        </a>{" "}
        et reconnaissez avoir pris connaissance de la{" "}
        <a href={LEGAL_URLS.confidentialite} target="_blank" rel="noopener noreferrer" className="font-medium text-[#8CA9FF] hover:text-[#B6C7FF] underline">
          Politique de confidentialité
        </a>
        .
      </p>

      <Button onClick={handleContinue} className="w-full">
        Continuer
      </Button>
    </div>
  );
}

function passwordScore(pw: string): { pct: number; label: string; color: string } {
  if (!pw) return { pct: 0, label: "8 caractères minimum", color: "#F472B6" };
  let n = 0;
  if (pw.length >= 8) n++;
  if (/[A-Z]/.test(pw)) n++;
  if (/[0-9]/.test(pw)) n++;
  if (/[^A-Za-z0-9]/.test(pw)) n++;
  const pct = Math.min(100, n * 25);
  const color = pw.length >= 8 && /[0-9]/.test(pw) ? "#22D3EE" : "#FBBF24";
  const label = pw.length < 8 ? "Trop court" : "Correct";
  return { pct, label, color };
}
