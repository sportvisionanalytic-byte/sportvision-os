"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { CLUB_STRUCTURE_TYPE_OPTIONS, useSignup } from "../signup-context";
import { inputClass, selectClass } from "../signup-styles";

// Étape 1 · Votre club — tunnel dédié /signup/club-request/* (voir ClubSignupRequestState,
// signup-context.tsx). Contrairement au tunnel standard, ce parcours ne crée AUCUN compte : il
// aboutit à une "Demande d'ouverture Connect" transmise au staff SportVision pour validation
// manuelle (brief Fouka du 12/08/2026 — voir migration-connect-v44-club-signup-requests.sql).
export default function ClubRequestStep1Page() {
  const router = useRouter();
  const { state, patch } = useSignup();
  const { clubRequest } = state;

  // Seul orgType==='club' emprunte ce tunnel — un accès direct par URL avec un autre type (ou
  // aucun type choisi) renvoie au choix de structure.
  useEffect(() => {
    if (state.orgType !== "club") router.replace("/signup/type");
  }, [state.orgType, router]);

  const canContinue =
    clubRequest.clubNom.trim().length > 0 && clubRequest.structureType.trim().length > 0 && clubRequest.ville.trim().length > 0;

  function set<K extends keyof typeof clubRequest>(field: K, value: (typeof clubRequest)[K]) {
    patch({ clubRequest: { ...clubRequest, [field]: value } });
  }

  if (state.orgType !== "club") return null;

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Votre club</h1>
        <p className="mt-2 text-[14px] text-text-soft">
          Cette demande sera examinée par SportVision avant l&apos;ouverture de votre espace Connect — aucun compte
          n&apos;est créé à cette étape.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[12.5px] font-bold text-text-soft">Nom du club *</span>
          <input
            value={clubRequest.clubNom}
            onChange={(e) => set("clubNom", e.target.value)}
            className={inputClass}
            placeholder="FC Fontainebleau"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Type de structure *</span>
          <select value={clubRequest.structureType} onChange={(e) => set("structureType", e.target.value)} className={selectClass}>
            <option value="">Sélectionnez…</option>
            {CLUB_STRUCTURE_TYPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Ville *</span>
          <input value={clubRequest.ville} onChange={(e) => set("ville", e.target.value)} className={inputClass} placeholder="Fontainebleau" />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Code postal</span>
          <input
            value={clubRequest.codePostal}
            onChange={(e) => set("codePostal", e.target.value)}
            className={inputClass}
            placeholder="77300"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Site internet / Instagram</span>
          <input
            value={clubRequest.siteWeb}
            onChange={(e) => set("siteWeb", e.target.value)}
            className={inputClass}
            placeholder="@fcfontainebleau"
          />
        </label>
      </div>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => router.push("/signup/type")}>
          Retour
        </Button>
        <Button disabled={!canContinue} onClick={() => router.push("/signup/club-request/contact")}>
          Continuer
        </Button>
      </div>
    </div>
  );
}
