"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { CATEGORIES, NEEDS, POSITIONS, SPORTS, useSignup } from "../signup-context";

// Étape 3 · Sport (joueur/sportif) / Besoin (particulier) / simplifiée (parent) — voir README
// design § Inscription. `date_naissance` est ici parce que player_profiles.date_naissance est
// NOT NULL en base (vérifié en direct le 12/08/2026) — pas dans la maquette d'origine, ajouté
// pour que l'étape Club puisse réellement créer le profil joueur en cas de "Rejoindre".
export default function SignupSportPage() {
  const router = useRouter();
  const { state, patch } = useSignup();

  useEffect(() => {
    if (!state.profile) router.replace("/signup/profil");
  }, [state.profile, router]);

  const isSportLike = state.profile === "joueur" || state.profile === "sportif";
  const isParticulier = state.profile === "particulier";
  // "agent" rejoint la variante simplifiée (comme "parent") plutôt que "particulier" : un agent
  // gère l'activité d'autres sportifs, pas une prestation pour lui-même — même logique que le
  // regroupement déjà en place pour "parent"/"autre".
  const isParent = state.profile === "parent" || state.profile === "agent" || state.profile === "autre";

  const canContinue = isSportLike
    ? !!state.sport && (state.sport !== "Autre" || !!state.otherSport.trim()) && !!state.dateNaissance
    : isParticulier
      ? !!state.need
      : true;

  function handleContinue() {
    if (!canContinue) return;
    router.push("/signup/club");
  }

  return (
    <div className="flex flex-col gap-6 animate-sv-in">
      {isSportLike && (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[31px] font-bold tracking-tight">Parlez-nous de votre sport</h1>
            <p className="text-[15px] text-text-tertiary">Quelques informations pour personnaliser votre expérience.</p>
          </div>

          <Chips label="Sport" options={SPORTS} value={state.sport} onSelect={(v) => patch({ sport: v, position: "" })} />
          {state.sport === "Autre" && (
            <Field id="su-sport-other" label="Précisez votre sport" value={state.otherSport} onChange={(e) => patch({ otherSport: e.target.value })} />
          )}

          {(state.sport === "Football" || state.sport === "Futsal") && (
            <Chips label="Poste · facultatif" options={POSITIONS} value={state.position} onSelect={(v) => patch({ position: state.position === v ? "" : v })} />
          )}

          <Chips label="Catégorie · facultatif" options={CATEGORIES} value={state.category} onSelect={(v) => patch({ category: state.category === v ? "" : v })} />

          <Field
            id="su-birth"
            label="Date de naissance"
            type="date"
            value={state.dateNaissance}
            onChange={(e) => patch({ dateNaissance: e.target.value })}
          />

          <Field id="su-city" label="Ville · facultatif" placeholder="Montereau-Fault-Yonne" value={state.city} onChange={(e) => patch({ city: e.target.value })} />
        </>
      )}

      {isParticulier && (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[31px] font-bold tracking-tight">Que souhaitez-vous faire avec SportVision ?</h1>
            <p className="text-[15px] text-text-tertiary">Nous adaptons votre accueil en conséquence.</p>
          </div>
          <div className="flex flex-col gap-3">
            {NEEDS.map((n) => {
              const selected = state.need === n.id;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => patch({ need: n.id })}
                  className={`flex min-h-[66px] items-center gap-3.5 rounded-sv-card border p-4 text-left transition-colors duration-150 ${
                    selected ? "border-[#8CA9FF]/60 bg-[rgba(79,125,255,.12)]" : "border-border bg-surface hover:bg-surface-hover"
                  }`}
                >
                  <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-sv bg-white/5">
                    <span className="material-symbols-rounded !text-[21px] text-[#8CA9FF]" aria-hidden="true">{n.icon}</span>
                  </span>
                  <span className="font-sora text-[15px] font-semibold text-text">{n.label}</span>
                  {selected && <span className="material-symbols-rounded filled ml-auto !text-[21px] text-affiliations" aria-hidden="true">check_circle</span>}
                </button>
              );
            })}
          </div>
        </>
      )}

      {isParent && (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="font-sora text-[31px] font-bold tracking-tight">Votre espace personnel</h1>
            <p className="text-[15px] leading-relaxed text-text-tertiary">
              Connect crée d&apos;abord votre espace personnel. Vous pourrez y suivre vos
              prestations, vos contenus et vos paiements collectifs.
            </p>
          </div>
          <Field id="su-city-p" label="Ville · facultatif" placeholder="Montereau-Fault-Yonne" value={state.city} onChange={(e) => patch({ city: e.target.value })} />
        </>
      )}

      <Button onClick={handleContinue} disabled={!canContinue} className="w-full">
        Continuer
      </Button>
    </div>
  );
}

function Chips({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: string[];
  value: string;
  onSelect: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[13px] font-medium text-text-secondary">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const selected = value === o;
          return (
            <button
              key={o}
              type="button"
              onClick={() => onSelect(o)}
              className={`rounded-sv-pill px-4 py-2.5 text-[14px] font-medium transition-colors duration-150 ${
                selected ? "bg-[rgba(79,125,255,.2)] text-text border border-[#8CA9FF]/65" : "bg-surface text-text-secondary border border-border-strong"
              }`}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}
