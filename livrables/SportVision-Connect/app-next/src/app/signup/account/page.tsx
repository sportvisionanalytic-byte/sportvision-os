"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useSignup } from "../signup-context";
import { inputClass } from "../signup-styles";

// Étape 2 · Vous — voir ACTIONS.md § 2. Jauge de robustesse du mot de passe, unicité e-mail
// vérifiée côté serveur (hors périmètre du mock).
export default function SignupAccountPage() {
  const router = useRouter();
  const { state, patch } = useSignup();
  const { account } = state;
  const isPlayer = state.orgType === "player";

  // Un club ne crée plus de compte à cette étape — voir /signup/club-request/*. Ce garde
  // couvre l'accès direct par URL ou un retour navigateur, en plus du routage déjà corrigé
  // côté type/page.tsx.
  useEffect(() => {
    if (state.orgType === "club") router.replace("/signup/club-request");
  }, [state.orgType, router]);
  if (state.orgType === "club") return null;

  const strength = passwordStrength(account.password);
  const canContinue =
    account.firstName.trim() &&
    account.lastName.trim() &&
    /\S+@\S+\.\S+/.test(account.email) &&
    account.password.length >= 8;

  function set(field: keyof typeof account, value: string) {
    patch({ account: { ...account, [field]: value } });
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Parlez-nous de vous</h1>
        <p className="mt-2 text-[14px] text-text-soft">Ces informations créent votre compte personnel.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Prénom">
          <input
            value={account.firstName}
            onChange={(e) => set("firstName", e.target.value)}
            className={inputClass}
            placeholder="Sophie"
          />
        </Field>
        <Field label="Nom">
          <input
            value={account.lastName}
            onChange={(e) => set("lastName", e.target.value)}
            className={inputClass}
            placeholder="Martin"
          />
        </Field>
        <Field label="Adresse e-mail">
          <input
            type="email"
            value={account.email}
            onChange={(e) => set("email", e.target.value)}
            className={inputClass}
            placeholder="sophie.martin@monclub.fr"
          />
        </Field>
        <Field label="Téléphone">
          <input
            type="tel"
            value={account.phone}
            onChange={(e) => set("phone", e.target.value)}
            className={inputClass}
            placeholder="06 12 34 56 78"
          />
        </Field>
        {/* "Fonction" (poste au sein d'une organisation) n'a pas de sens pour un joueur
            individuel — masqué plutôt que laissé vide sans raison apparente (brief Fouka,
            cartographie du signup). */}
        {!isPlayer && (
          <Field label="Fonction">
            <input
              value={account.jobTitle}
              onChange={(e) => set("jobTitle", e.target.value)}
              className={inputClass}
              placeholder="Responsable communication"
            />
          </Field>
        )}
        <Field label="Mot de passe">
          <input
            type="password"
            value={account.password}
            onChange={(e) => set("password", e.target.value)}
            className={inputClass}
            placeholder="8 caractères minimum"
          />
        </Field>
      </div>

      {account.password.length > 0 && (
        <div className="max-w-sm">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300 ease-out",
                strength.pct < 40 && "bg-danger-fg",
                strength.pct >= 40 && strength.pct < 75 && "bg-warning-fg",
                strength.pct >= 75 && "bg-success-fg",
              )}
              style={{ width: `${strength.pct}%` }}
            />
          </div>
          <div className="mt-1.5 text-[12px] font-semibold text-text-soft">{strength.label}</div>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => router.push("/signup/type")}>
          Retour
        </Button>
        {/* Un joueur saute Organisation et Besoins (aucun champ pertinent pour lui, voir
            getSteps § signup-context.tsx) — direction directe vers Offre, pas juste une étape
            laissée vide. */}
        <Button disabled={!canContinue} onClick={() => router.push(isPlayer ? "/signup/plan" : "/signup/org")}>
          Continuer
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      {children}
    </label>
  );
}

function passwordStrength(password: string): { pct: number; label: string } {
  if (!password) return { pct: 0, label: "" };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  const pct = Math.min(100, (score / 5) * 100);
  const label = pct < 40 ? "Mot de passe faible" : pct < 75 ? "Mot de passe correct" : "Mot de passe robuste";
  return { pct, label };
}
