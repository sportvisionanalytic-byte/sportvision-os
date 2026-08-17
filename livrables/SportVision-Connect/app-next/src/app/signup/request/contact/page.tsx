"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { FONCTION_OPTIONS, useSignup } from "../../signup-context";
import { inputClass, selectClass } from "../../signup-styles";

type FieldErrors = Partial<Record<"contactPrenom" | "contactNom" | "contactEmail" | "contactTelephone" | "fonction" | "fonctionAutre", string>>;

// Écran 3 · Vous (master prompt §16-21).
//
// La fonction déclarée est purement informative : elle n'attribue jamais de rôle/permission
// Club+ (encadré §20, texte exact ci-dessous). Le rôle réel est choisi séparément par le staff
// SportVision au moment de valider la demande (connect-club-signup-review) — jamais déduit de
// ce choix.
export default function RequestContactPage() {
  const router = useRouter();
  const { state, patch } = useSignup();
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (state.organizationType === null) router.replace("/signup/request");
  }, [state.organizationType, router]);

  if (state.organizationType === null) return null;

  const showFonctionAutre = state.fonction === "Autre";

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!state.contactPrenom.trim()) next.contactPrenom = "Veuillez renseigner votre prénom.";
    if (!state.contactNom.trim()) next.contactNom = "Veuillez renseigner votre nom.";
    if (!/\S+@\S+\.\S+/.test(state.contactEmail)) next.contactEmail = "Veuillez saisir une adresse e-mail valide.";
    if (!state.contactTelephone.trim()) next.contactTelephone = "Veuillez renseigner votre téléphone.";
    if (!state.fonction.trim()) next.fonction = "Veuillez sélectionner votre fonction.";
    else if (showFonctionAutre && !state.fonctionAutre.trim()) next.fonctionAutre = "Veuillez préciser votre fonction.";
    return next;
  }

  function handleContinue() {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length === 0) router.push("/signup/request/needs");
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Vous</h1>
        <p className="mt-2 text-[14px] text-text-soft">
          Indiquez les coordonnées de la personne que SportVision pourra contacter au sujet de cette demande.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Prénom *</span>
          <input
            value={state.contactPrenom}
            onChange={(e) => patch({ contactPrenom: e.target.value })}
            className={cn(inputClass, errors.contactPrenom && "border-danger-fg")}
            placeholder="Sophie"
            aria-invalid={!!errors.contactPrenom}
            aria-describedby={errors.contactPrenom ? "err-contactPrenom" : undefined}
          />
          {errors.contactPrenom && (
            <span id="err-contactPrenom" role="alert" className="text-[12px] font-semibold text-danger-fg">
              {errors.contactPrenom}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Nom *</span>
          <input
            value={state.contactNom}
            onChange={(e) => patch({ contactNom: e.target.value })}
            className={cn(inputClass, errors.contactNom && "border-danger-fg")}
            placeholder="Martin"
            aria-invalid={!!errors.contactNom}
            aria-describedby={errors.contactNom ? "err-contactNom" : undefined}
          />
          {errors.contactNom && (
            <span id="err-contactNom" role="alert" className="text-[12px] font-semibold text-danger-fg">
              {errors.contactNom}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[12.5px] font-bold text-text-soft">Adresse e-mail professionnelle *</span>
          <input
            type="email"
            value={state.contactEmail}
            onChange={(e) => patch({ contactEmail: e.target.value })}
            className={cn(inputClass, errors.contactEmail && "border-danger-fg")}
            placeholder="sophie.martin@monclub.fr"
            aria-invalid={!!errors.contactEmail}
            aria-describedby={errors.contactEmail ? "err-contactEmail" : "hint-contactEmail"}
          />
          {errors.contactEmail ? (
            <span id="err-contactEmail" role="alert" className="text-[12px] font-semibold text-danger-fg">
              {errors.contactEmail}
            </span>
          ) : (
            <span id="hint-contactEmail" className="text-[12px] text-text-faint">
              Utilisez de préférence une adresse liée à votre structure.
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Téléphone *</span>
          <input
            type="tel"
            value={state.contactTelephone}
            onChange={(e) => patch({ contactTelephone: e.target.value })}
            className={cn(inputClass, errors.contactTelephone && "border-danger-fg")}
            placeholder="06 12 34 56 78"
            aria-invalid={!!errors.contactTelephone}
            aria-describedby={errors.contactTelephone ? "err-contactTelephone" : undefined}
          />
          {errors.contactTelephone && (
            <span id="err-contactTelephone" role="alert" className="text-[12px] font-semibold text-danger-fg">
              {errors.contactTelephone}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Fonction dans la structure *</span>
          <select
            value={state.fonction}
            onChange={(e) => patch({ fonction: e.target.value })}
            className={cn(selectClass, errors.fonction && "border-danger-fg")}
            aria-invalid={!!errors.fonction}
            aria-describedby={errors.fonction ? "err-fonction" : undefined}
          >
            <option value="">Sélectionnez…</option>
            {FONCTION_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {errors.fonction && (
            <span id="err-fonction" role="alert" className="text-[12px] font-semibold text-danger-fg">
              {errors.fonction}
            </span>
          )}
        </label>

        {showFonctionAutre && (
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[12.5px] font-bold text-text-soft">Précisez votre fonction *</span>
            <input
              value={state.fonctionAutre}
              onChange={(e) => patch({ fonctionAutre: e.target.value })}
              className={cn(inputClass, errors.fonctionAutre && "border-danger-fg")}
              placeholder="Coordinateur de l'académie"
              aria-invalid={!!errors.fonctionAutre}
              aria-describedby={errors.fonctionAutre ? "err-fonctionAutre" : undefined}
            />
            {errors.fonctionAutre && (
              <span id="err-fonctionAutre" role="alert" className="text-[12px] font-semibold text-danger-fg">
                {errors.fonctionAutre}
              </span>
            )}
          </label>
        )}
      </div>

      <div className="rounded-xl border border-border-strong bg-surface-alt p-4 text-[13px] text-text-soft">
        Votre fonction est déclarative. Elle nous aide à vérifier votre demande, mais ne détermine pas automatiquement vos droits
        dans Club+. SportVision confirme séparément les accès accordés lors de l&apos;activation.
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="secondary" className="w-full sm:w-auto" onClick={() => router.push("/signup/request/structure")}>
          Retour
        </Button>
        <Button className="w-full sm:w-auto" onClick={handleContinue}>
          Continuer
        </Button>
      </div>
    </div>
  );
}
