"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  ACTIVITE_TYPE_OPTIONS,
  REQUEST_ORG_TYPE_OPTIONS,
  SPORT_OPTIONS,
  STRUCTURE_NAME_LABEL,
  STRUCTURE_TITLE,
  STRUCTURE_TYPE_FIELD,
  STRUCTURE_TYPE_OPTIONS,
  useSignup,
} from "../../signup-context";
import { inputClass, selectClass } from "../../signup-styles";

// Nom de la structure au génitif, pour composer le message d'erreur §58 ("Veuillez renseigner
// le nom de votre club.") sans dupliquer STRUCTURE_NAME_LABEL (qui, lui, sert de libellé de
// champ, pas de fragment de phrase).
const NAME_ERROR_SUFFIX: Record<string, string> = {
  club: "de votre club",
  academie: "de votre académie",
  coach: "de votre activité",
  structure_coaching: "de votre structure",
  tournoi: "de votre organisation",
  stage: "de votre stage",
  projet: "de votre structure",
};

type FieldErrors = Partial<Record<"nom" | "structureType" | "ville" | "sport" | "sportAutre" | "activiteType" | "activiteTypeAutre", string>>;

// Écran 2 · Votre structure (master prompt §8-15). Titre et libellé du nom dynamiques selon le
// type choisi à l'écran 1 ; jamais de select "Type de structure" ici (§11) — juste un badge
// rappelant le choix déjà fait.
export default function RequestStructurePage() {
  const router = useRouter();
  const { state, patch } = useSignup();
  const [errors, setErrors] = useState<FieldErrors>({});

  // Accès direct par URL ou retour navigateur sans type choisi -> retour à l'écran 1 (§60-62 :
  // ne jamais planter, toujours retomber proprement sur un écran valide).
  useEffect(() => {
    if (state.organizationType === null) router.replace("/signup/request");
  }, [state.organizationType, router]);

  if (state.organizationType === null) return null;
  const orgType = state.organizationType;

  const badge = REQUEST_ORG_TYPE_OPTIONS.find((o) => o.type === orgType)?.label ?? "";
  const title = STRUCTURE_TITLE[orgType];
  const nameLabel = STRUCTURE_NAME_LABEL[orgType];
  const structureTypeMode = STRUCTURE_TYPE_FIELD[orgType];
  const isCoach = orgType === "coach";
  const isTournoi = orgType === "tournoi";
  const showActiviteAutre = state.activiteType === "Autre";
  const showSportAutre = state.sport === "Autre";

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!state.nom.trim()) next.nom = `Veuillez renseigner le nom ${NAME_ERROR_SUFFIX[orgType]}.`;
    if (!state.ville.trim()) next.ville = "Veuillez renseigner la ville.";
    if (!state.sport.trim()) next.sport = "Veuillez sélectionner le sport.";
    else if (showSportAutre && !state.sportAutre.trim()) next.sportAutre = "Veuillez préciser le sport.";
    if (structureTypeMode === "required" && !state.structureType.trim()) {
      next.structureType = "Veuillez sélectionner le statut juridique.";
    }
    if (isCoach) {
      if (!state.activiteType.trim()) next.activiteType = "Veuillez sélectionner votre type d'activité.";
      else if (showActiviteAutre && !state.activiteTypeAutre.trim()) {
        next.activiteTypeAutre = "Veuillez préciser votre type d'activité.";
      }
    }
    return next;
  }

  function handleContinue() {
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length === 0) router.push("/signup/request/contact");
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <span className="inline-flex w-fit rounded-full border border-border-strong bg-surface-alt px-3 py-1 text-[11.5px] font-bold text-text-soft">
          {badge}
        </span>
        <h1 className="mt-3 text-[28px] font-extrabold tracking-tight">{title}</h1>
        <p className="mt-2 text-[14px] text-text-soft">
          Renseignez les informations principales afin que SportVision puisse vérifier votre structure.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[12.5px] font-bold text-text-soft">{nameLabel} *</span>
          <input
            value={state.nom}
            onChange={(e) => patch({ nom: e.target.value })}
            className={cn(inputClass, errors.nom && "border-danger-fg")}
            placeholder="FC Fontainebleau"
            aria-invalid={!!errors.nom}
            aria-describedby={errors.nom ? "err-nom" : undefined}
          />
          {errors.nom && (
            <span id="err-nom" role="alert" className="text-[12px] font-semibold text-danger-fg">
              {errors.nom}
            </span>
          )}
        </label>

        {structureTypeMode !== "hidden" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">
              Statut juridique {structureTypeMode === "required" ? "*" : <span className="font-medium text-text-faint">(facultatif)</span>}
            </span>
            <select
              value={state.structureType}
              onChange={(e) => patch({ structureType: e.target.value })}
              className={cn(selectClass, errors.structureType && "border-danger-fg")}
              aria-invalid={!!errors.structureType}
              aria-describedby={errors.structureType ? "err-structureType" : undefined}
            >
              <option value="">Sélectionnez…</option>
              {STRUCTURE_TYPE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            {errors.structureType && (
              <span id="err-structureType" role="alert" className="text-[12px] font-semibold text-danger-fg">
                {errors.structureType}
              </span>
            )}
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Ville *</span>
          <input
            value={state.ville}
            onChange={(e) => patch({ ville: e.target.value })}
            className={cn(inputClass, errors.ville && "border-danger-fg")}
            placeholder="Fontainebleau"
            aria-invalid={!!errors.ville}
            aria-describedby={errors.ville ? "err-ville" : undefined}
          />
          {errors.ville && (
            <span id="err-ville" role="alert" className="text-[12px] font-semibold text-danger-fg">
              {errors.ville}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Sport *</span>
          <select
            value={state.sport}
            onChange={(e) => patch({ sport: e.target.value, sportAutre: e.target.value === "Autre" ? state.sportAutre : "" })}
            className={cn(selectClass, errors.sport && "border-danger-fg")}
            aria-invalid={!!errors.sport}
            aria-describedby={errors.sport ? "err-sport" : undefined}
          >
            <option value="">Sélectionnez…</option>
            {SPORT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {errors.sport && (
            <span id="err-sport" role="alert" className="text-[12px] font-semibold text-danger-fg">
              {errors.sport}
            </span>
          )}
        </label>

        {showSportAutre && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-text-soft">Précisez le sport *</span>
            <input
              value={state.sportAutre}
              onChange={(e) => patch({ sportAutre: e.target.value })}
              className={cn(inputClass, errors.sportAutre && "border-danger-fg")}
              placeholder="Volleyball de plage"
              aria-invalid={!!errors.sportAutre}
              aria-describedby={errors.sportAutre ? "err-sportAutre" : undefined}
            />
            {errors.sportAutre && (
              <span id="err-sportAutre" role="alert" className="text-[12px] font-semibold text-danger-fg">
                {errors.sportAutre}
              </span>
            )}
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Code postal</span>
          <input
            value={state.codePostal}
            onChange={(e) => patch({ codePostal: e.target.value })}
            className={inputClass}
            placeholder="77300"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">
            Site internet ou Instagram <span className="font-medium text-text-faint">(facultatif)</span>
          </span>
          <input
            value={state.siteWeb}
            onChange={(e) => patch({ siteWeb: e.target.value })}
            className={inputClass}
            placeholder="@fcfontainebleau"
          />
        </label>

        {isCoach && (
          <>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-[12.5px] font-bold text-text-soft">Type d&apos;activité *</span>
              <select
                value={state.activiteType}
                onChange={(e) => patch({ activiteType: e.target.value })}
                className={cn(selectClass, errors.activiteType && "border-danger-fg")}
                aria-invalid={!!errors.activiteType}
                aria-describedby={errors.activiteType ? "err-activiteType" : undefined}
              >
                <option value="">Sélectionnez…</option>
                {ACTIVITE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              {errors.activiteType && (
                <span id="err-activiteType" role="alert" className="text-[12px] font-semibold text-danger-fg">
                  {errors.activiteType}
                </span>
              )}
            </label>

            {showActiviteAutre && (
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-[12.5px] font-bold text-text-soft">Précisez votre type d&apos;activité *</span>
                <input
                  value={state.activiteTypeAutre}
                  onChange={(e) => patch({ activiteTypeAutre: e.target.value })}
                  className={cn(inputClass, errors.activiteTypeAutre && "border-danger-fg")}
                  placeholder="Préparateur mental"
                  aria-invalid={!!errors.activiteTypeAutre}
                  aria-describedby={errors.activiteTypeAutre ? "err-activiteTypeAutre" : undefined}
                />
                {errors.activiteTypeAutre && (
                  <span id="err-activiteTypeAutre" role="alert" className="text-[12px] font-semibold text-danger-fg">
                    {errors.activiteTypeAutre}
                  </span>
                )}
              </label>
            )}

            <label className="flex items-center gap-2.5 text-[13px] font-semibold text-text-soft sm:col-span-2">
              <input
                type="checkbox"
                checked={state.exerceSousPropreNom}
                onChange={(e) => patch({ exerceSousPropreNom: e.target.checked })}
                className="h-4 w-4 flex-none accent-brand-blue-electric"
              />
              J&apos;exerce sous mon propre nom
            </label>
          </>
        )}

        {isTournoi && (
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[12.5px] font-bold text-text-soft">
              Nom de l&apos;événement principal <span className="font-medium text-text-faint">(facultatif)</span>
            </span>
            <input
              value={state.nomEvenementPrincipal}
              onChange={(e) => patch({ nomEvenementPrincipal: e.target.value })}
              className={inputClass}
              placeholder="Tournoi de la Pentecôte"
            />
          </label>
        )}
      </div>

      <p className="text-[12.5px] text-text-faint">
        Ces informations nous permettent de vérifier l&apos;existence et le contexte de votre structure.
      </p>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="secondary" className="w-full sm:w-auto" onClick={() => router.push("/signup/request")}>
          Retour
        </Button>
        <Button className="w-full sm:w-auto" onClick={handleContinue}>
          Continuer
        </Button>
      </div>
    </div>
  );
}
