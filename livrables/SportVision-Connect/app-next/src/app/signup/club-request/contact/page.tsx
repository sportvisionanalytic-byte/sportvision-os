"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { CLUB_FONCTION_OPTIONS, useSignup } from "../../signup-context";
import { inputClass, selectClass } from "../../signup-styles";

// Étape 2 · Vous — tunnel /signup/club-request/*.
//
// "Fonction dans le club" est un champ DÉCLARATIF, purement informatif : il n'attribue jamais
// de rôle technique dans Connect. Brief Fouka du 12/08/2026 : "il faut simplement distinguer la
// fonction déclarée dans le club et le rôle technique/permissions dans Connect. C'est important
// pour ne jamais recréer la faille où quelqu'un pourrait se déclarer administrateur." Le rôle
// Connect réel est choisi séparément par le staff SportVision au moment de valider la demande
// (SportVision OS, connect-club-signup-review) — jamais déduit de ce choix.
export default function ClubRequestStep2Page() {
  const router = useRouter();
  const { state, patch } = useSignup();
  const { clubRequest } = state;

  useEffect(() => {
    if (state.orgType !== "club") router.replace("/signup/type");
  }, [state.orgType, router]);

  const showFonctionAutre = clubRequest.fonction === "Autre";
  const canContinue =
    clubRequest.contactPrenom.trim().length > 0 &&
    clubRequest.contactNom.trim().length > 0 &&
    /\S+@\S+\.\S+/.test(clubRequest.contactEmail) &&
    clubRequest.contactTelephone.trim().length > 0 &&
    clubRequest.fonction.trim().length > 0 &&
    (!showFonctionAutre || clubRequest.fonctionAutre.trim().length > 0);

  function set<K extends keyof typeof clubRequest>(field: K, value: (typeof clubRequest)[K]) {
    patch({ clubRequest: { ...clubRequest, [field]: value } });
  }

  if (state.orgType !== "club") return null;

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Vous</h1>
        <p className="mt-2 text-[14px] text-text-soft">Le contact que SportVision recontacte pour traiter cette demande.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Prénom *</span>
          <input value={clubRequest.contactPrenom} onChange={(e) => set("contactPrenom", e.target.value)} className={inputClass} placeholder="Sophie" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Nom *</span>
          <input value={clubRequest.contactNom} onChange={(e) => set("contactNom", e.target.value)} className={inputClass} placeholder="Martin" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Adresse e-mail professionnelle *</span>
          <input
            type="email"
            value={clubRequest.contactEmail}
            onChange={(e) => set("contactEmail", e.target.value)}
            className={inputClass}
            placeholder="sophie.martin@monclub.fr"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-text-soft">Téléphone *</span>
          <input
            type="tel"
            value={clubRequest.contactTelephone}
            onChange={(e) => set("contactTelephone", e.target.value)}
            className={inputClass}
            placeholder="06 12 34 56 78"
          />
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[12.5px] font-bold text-text-soft">Quelle est votre fonction au sein du club ? *</span>
          <select value={clubRequest.fonction} onChange={(e) => set("fonction", e.target.value)} className={selectClass}>
            <option value="">Sélectionnez…</option>
            {CLUB_FONCTION_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>

        {showFonctionAutre && (
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[12.5px] font-bold text-text-soft">Précisez votre fonction *</span>
            <input
              value={clubRequest.fonctionAutre}
              onChange={(e) => set("fonctionAutre", e.target.value)}
              className={inputClass}
              placeholder="Coordinateur de l'académie"
            />
          </label>
        )}
      </div>

      <div className="rounded-xl border border-border-strong bg-surface-alt p-4 text-[13px] text-text-soft">
        Cette fonction est informative : elle ne détermine pas votre rôle technique dans Connect. SportVision choisit et
        confirme séparément le rôle Connect initial du contact au moment de valider la demande.
      </div>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => router.push("/signup/club-request")}>
          Retour
        </Button>
        <Button disabled={!canContinue} onClick={() => router.push("/signup/club-request/needs")}>
          Continuer
        </Button>
      </div>
    </div>
  );
}
