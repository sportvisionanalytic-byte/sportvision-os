"use client";

import { useRouter } from "next/navigation";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useSignup } from "../signup-context";
import { inputClass } from "../signup-styles";

// Étape 3 · Organisation — voir ACTIONS.md § 2. Libellés adaptés au type ; nombre d'équipes et
// de licenciés uniquement pour club ou académie.
const NAME_LABEL: Record<string, string> = {
  club: "Nom du club",
  academy: "Nom de l'académie",
  coach: "Nom de votre activité",
  player: "Nom de votre projet",
  generic: "Nom de la structure",
  event: "Nom de l'événement",
};

export default function SignupOrgPage() {
  const router = useRouter();
  const { state, patch } = useSignup();
  const { org } = state;
  const showTeamFields = state.orgType === "club" || state.orgType === "academy";
  const canContinue = org.name.trim().length > 0;

  function set(field: keyof typeof org, value: string) {
    patch({ org: { ...org, [field]: value } });
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Présentez votre organisation</h1>
        <p className="mt-2 text-[14px] text-text-soft">
          Ces informations personnalisent votre espace et vos futurs contenus.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 flex-none items-center justify-center rounded-2xl border border-dashed border-border-strong bg-surface-alt text-text-faint">
          <ImagePlus className="h-6 w-6" aria-hidden />
        </div>
        <div>
          <div className="text-[13px] font-bold">Logo</div>
          <div className="text-[12px] text-text-soft">Optionnel pour l&apos;instant, à ajouter plus tard.</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[12.5px] font-bold text-text-soft">{NAME_LABEL[state.orgType ?? "generic"]}</span>
          <input value={org.name} onChange={(e) => set("name", e.target.value)} className={inputClass} placeholder="FC Fontainebleau" />
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[12.5px] font-bold text-text-soft">Adresse</span>
          <input
            value={org.address}
            onChange={(e) => set("address", e.target.value)}
            className={inputClass}
            placeholder="Stade Pierre-Bardin, 77300 Fontainebleau"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Instagram</span>
          <input
            value={org.instagram}
            onChange={(e) => set("instagram", e.target.value)}
            className={inputClass}
            placeholder="@fcfontainebleau"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">SIRET</span>
          <input value={org.siret} onChange={(e) => set("siret", e.target.value)} className={inputClass} placeholder="812 456 789 00021" />
        </label>

        {showTeamFields && (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-text-soft">Nombre d&apos;équipes</span>
              <input
                type="number"
                min={0}
                value={org.teamCount}
                onChange={(e) => set("teamCount", e.target.value)}
                className={inputClass}
                placeholder="6"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-text-soft">Nombre de licenciés</span>
              <input
                type="number"
                min={0}
                value={org.memberCount}
                onChange={(e) => set("memberCount", e.target.value)}
                className={inputClass}
                placeholder="142"
              />
            </label>
          </>
        )}
      </div>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => router.push("/signup/account")}>
          Retour
        </Button>
        <Button disabled={!canContinue} onClick={() => router.push("/signup/needs")}>
          Continuer
        </Button>
      </div>
    </div>
  );
}
