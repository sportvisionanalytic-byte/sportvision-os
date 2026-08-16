"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

const SPORTS = ["Football", "Futsal", "Basketball", "Handball", "Rugby", "Autre"];
const RELATIONS = ["Parent", "Responsable légal", "Famille / proche", "Accompagnant"];

export function ManagedAthleteForm() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [sport, setSport] = useState("");
  const [categorie, setCategorie] = useState("");
  const [club, setClub] = useState("");
  const [relation, setRelation] = useState("Parent");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // true seulement pour PAYWALL_AGENT_LIMIT : le CTA "Changer de palier" n'a de sens QUE là — un
  // compte agent a un palier payant vers lequel monter. PAYWALL_PARTICULIER_LIMIT (parent/tuteur/
  // autre, plafond dur à 3, migration-connect-v67 §4) n'a rien à proposer au-delà d'un contact
  // manuel avec SportVision, donc jamais de CTA pour ce cas.
  const [errorIsAgentLimit, setErrorIsAgentLimit] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const valid = firstName.trim() !== "" && lastName.trim() !== "";

  async function submit() {
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    setErrorIsAgentLimit(false);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("connect_create_managed_athlete", {
      p_prenom: firstName.trim(),
      p_nom: lastName.trim(),
      p_sport: sport || null,
      p_categorie: categorie.trim() || null,
      p_club: club.trim() || null,
      p_relation: relation,
    });
    setBusy(false);
    if (rpcError) {
      const msg = rpcError.message || "";
      if (msg.includes("PAYWALL_AGENT_LIMIT")) {
        setError("Vous avez atteint la limite de sportifs suivis de votre palier Agent actuel.");
        setErrorIsAgentLimit(true);
      } else if (msg.includes("PAYWALL_PARTICULIER_LIMIT")) {
        setError("Vous avez atteint votre limite de sportifs suivis. Contactez SportVision pour en suivre davantage.");
      } else {
        setError("Impossible de créer le profil pour le moment. Réessayez dans un instant.");
      }
      return;
    }
    setCreatedId(data as string);
  }

  if (createdId) {
    return (
      <div className="flex max-w-[620px] flex-col gap-6">
        <span
          className="flex h-[66px] w-[66px] items-center justify-center rounded-sv-card"
          style={{ background: "linear-gradient(140deg,rgba(168,85,247,.28),rgba(34,211,238,.22))" }}
        >
          <span className="material-symbols-rounded !text-[32px] text-affiliations" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
            check_circle
          </span>
        </span>
        <div className="flex flex-col gap-2.5">
          <h1 className="font-sora text-[28px] font-bold tracking-tight">Profil créé</h1>
          <p className="text-[15px] leading-relaxed text-text-tertiary">
            {firstName} {lastName} apparaît maintenant dans Mes sportifs. Vous pouvez réserver une prestation pour ce
            profil.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link
            href={`/particulier/sportifs/managed/${createdId}`}
            className="rounded-sv bg-sv-gradient px-5 py-3 font-sora text-[15px] font-semibold text-white hover:brightness-[1.12]"
          >
            Ouvrir sa fiche
          </Link>
          <button
            type="button"
            onClick={() => router.push("/particulier/sportifs")}
            className="rounded-sv border border-border-strong bg-surface px-5 py-3 font-sora text-[15px] font-semibold hover:bg-surface-hover"
          >
            Mes sportifs
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-[620px] flex-col gap-6">
      <Link href="/particulier/sportifs/ajouter" className="flex items-center gap-2 self-start text-[13px] font-medium text-text-tertiary hover:text-text">
        <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
        Retour
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[31px] font-bold tracking-tight">Créer un profil géré</h1>
        <p className="text-[15px] leading-relaxed text-text-tertiary">
          Ce profil est rattaché à votre compte. Nous ne demandons pas d&apos;adresse e-mail personnelle.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[180px] flex-1">
          <Field id="mg-fn" label="Prénom" placeholder="Noah" value={firstName} onChange={(e) => setFirstName(e.target.value)} error={touched && !firstName.trim() ? "Requis." : null} />
        </div>
        <div className="min-w-[180px] flex-1">
          <Field id="mg-ln" label="Nom" placeholder="Moreau" value={lastName} onChange={(e) => setLastName(e.target.value)} error={touched && !lastName.trim() ? "Requis." : null} />
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="text-[13px] font-medium text-text-secondary">Sport</span>
        <div className="flex flex-wrap gap-2">
          {SPORTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSport(s)}
              className={`rounded-sv-pill border px-4 py-2.5 text-[14px] font-medium transition-colors duration-150 ${
                sport === s ? "border-[rgba(140,169,255,.65)] bg-[rgba(79,125,255,.2)] text-text" : "border-border text-text-secondary hover:text-text"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[180px] flex-1">
          <Field id="mg-cat" label="Catégorie · facultatif" placeholder="U15" value={categorie} onChange={(e) => setCategorie(e.target.value)} />
        </div>
        <div className="min-w-[180px] flex-1">
          <Field id="mg-club" label="Club · facultatif" placeholder="FC Montereau" value={club} onChange={(e) => setClub(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="text-[13px] font-medium text-text-secondary">Votre lien avec ce sportif</span>
        <div className="flex flex-wrap gap-2">
          {RELATIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRelation(r)}
              className={`rounded-sv-pill border px-4 py-2.5 text-[14px] font-medium transition-colors duration-150 ${
                relation === r ? "border-[rgba(140,169,255,.65)] bg-[rgba(79,125,255,.2)] text-text" : "border-border text-text-secondary hover:text-text"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-sv border border-border bg-white/[.04] px-[18px] py-4">
        <span className="material-symbols-rounded !text-[19px] text-text-faint" aria-hidden="true">info</span>
        <span className="text-[13px] leading-relaxed text-text-tertiary">
          Un profil géré n&apos;est pas un compte autonome. La qualité de responsable légal doit être vérifiée avant
          toute mise en production.
        </span>
      </div>

      {error && (
        <div className="flex flex-col items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <span className="material-symbols-rounded !text-[19px] text-danger" aria-hidden="true">error</span>
            <span className="text-[13px] leading-relaxed text-[#FBCFE8]">{error}</span>
          </div>
          {errorIsAgentLimit && (
            <Link href="/particulier/abonnement" className="ml-[29px] text-[13px] font-semibold text-affiliations hover:underline">
              Changer de palier
            </Link>
          )}
        </div>
      )}

      <Button onClick={submit} loading={busy} className="self-start">
        Créer le profil
      </Button>
    </div>
  );
}
