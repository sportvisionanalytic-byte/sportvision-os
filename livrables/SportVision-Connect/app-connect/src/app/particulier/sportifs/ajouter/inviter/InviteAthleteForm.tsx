"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

// Relations affichées (README, RELATIONS) mappées sur les 5 valeurs réellement acceptées par
// connect_access_relationships.relation_type (CHECK en base — migration-connect-personnel-
// accueil-profil-acces.sql §2) : "Famille / proche"→proche, "Accompagnant"→autre (le libellé
// précis reste visible dans le message envoyé au sportif, la contrainte serveur ne connaît que
// ces 5 catégories).
const RELATIONS: { label: string; value: "parent" | "tuteur_legal" | "proche" | "agent" | "autre" }[] = [
  { label: "Parent", value: "parent" },
  { label: "Responsable légal", value: "tuteur_legal" },
  { label: "Famille / proche", value: "proche" },
  { label: "Agent / représentant", value: "agent" },
  { label: "Accompagnant", value: "autre" },
];

export function InviteAthleteForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [relation, setRelation] = useState<(typeof RELATIONS)[number]["value"]>("parent");
  const [message, setMessage] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  async function submit() {
    setTouched(true);
    if (!validEmail || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("connect_request_profile_access", {
      p_owner_email: email.trim(),
      p_relation_type: relation,
      p_message: message.trim() || null,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message || "Impossible d'envoyer la demande pour le moment.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex max-w-[620px] flex-col gap-6">
        <span
          className="flex h-[66px] w-[66px] items-center justify-center rounded-sv-card"
          style={{ background: "linear-gradient(140deg,rgba(168,85,247,.28),rgba(34,211,238,.22))" }}
        >
          <span className="material-symbols-rounded !text-[32px] text-affiliations" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">
            send
          </span>
        </span>
        <div className="flex flex-col gap-2.5">
          <h1 className="font-sora text-[28px] font-bold tracking-tight">Demande envoyée</h1>
          <p className="text-[15px] leading-relaxed text-text-tertiary">
            {email} doit accepter votre demande depuis son espace Connect (page « Accès à mon profil »). Vous serez
            prévenu dès sa réponse.
          </p>
        </div>
        <div className="flex items-center gap-4 rounded-sv-card border border-border bg-surface p-[18px]">
          <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-sv bg-white/[.07]">
            <span className="material-symbols-rounded !text-[22px] text-text-tertiary" aria-hidden="true">hourglass_top</span>
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-sora text-[15px] font-semibold">{email}</span>
            <span className="text-[14px] text-text-tertiary lg:text-[13px]">Relation déclarée : {RELATIONS.find((r) => r.value === relation)?.label}</span>
          </div>
          <span className="ml-auto flex-none rounded-sv-pill bg-attente-bg px-2.5 py-1 text-[12px] font-medium text-attente">En attente</span>
        </div>
        <button
          type="button"
          onClick={() => router.push("/particulier/sportifs")}
          className="self-start rounded-sv border border-border-strong bg-surface px-5 py-3 font-sora text-[15px] font-semibold hover:bg-surface-hover"
        >
          Retour à mes sportifs
        </button>
      </div>
    );
  }

  return (
    <div className="flex max-w-[620px] flex-col gap-6">
      <Link href="/particulier/sportifs/ajouter" className="flex items-center gap-2 self-start text-[14px] font-medium text-text-tertiary hover:text-text lg:text-[13px]">
        <span className="material-symbols-rounded !text-[18px]" aria-hidden="true">arrow_back</span>
        Retour
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="font-sora text-[31px] font-bold tracking-tight">Inviter un sportif</h1>
        <p className="text-[15px] leading-relaxed text-text-tertiary">
          Nous lui envoyons une demande dans Connect. Il l&apos;accepte et choisit ce que vous pouvez consulter.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="iv-email" className="text-[14px] font-medium text-text-secondary lg:text-[13px]">
          Adresse e-mail du sportif
        </label>
        <input
          id="iv-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="lucas@email.com"
          className={`h-[52px] w-full rounded-sv border bg-surface px-4 text-[16px] text-text outline-none focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.28)] ${
            touched && !validEmail ? "border-danger" : "border-border-strong"
          }`}
        />
        {touched && !validEmail && <span className="text-[14px] text-danger lg:text-[12px]">Saisissez une adresse e-mail valide.</span>}
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="text-[14px] font-medium text-text-secondary lg:text-[13px]">Quel est votre lien avec ce sportif ?</span>
        <div className="flex flex-wrap gap-2">
          {RELATIONS.map((r) => {
            const active = relation === r.value;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => setRelation(r.value)}
                className={`rounded-sv-pill border px-4 py-2.5 text-[14px] font-medium transition-colors duration-150 ${
                  active ? "border-[rgba(140,169,255,.65)] bg-[rgba(79,125,255,.2)] text-text" : "border-border text-text-secondary hover:text-text"
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="iv-msg" className="text-[14px] font-medium text-text-secondary lg:text-[13px]">
          Message <span className="font-normal text-text-faint">· facultatif</span>
        </label>
        <input
          id="iv-msg"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Bonjour Lucas, je souhaite suivre tes prestations SportVision."
          className="h-[52px] w-full rounded-sv border border-border-strong bg-surface px-4 text-[16px] text-text outline-none focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.28)]"
        />
      </div>

      <div className="flex items-start gap-2.5 rounded-sv border border-border bg-white/[.04] px-[18px] py-4">
        <span className="material-symbols-rounded !text-[19px] text-text-faint" aria-hidden="true">lock</span>
        <span className="text-[14px] leading-relaxed text-text-tertiary lg:text-[13px]">
          Aucun annuaire public : le sportif est invité par e-mail et reste seul à décider des accès accordés.
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-danger" aria-hidden="true">error</span>
          <span className="text-[14px] leading-relaxed text-[#FBCFE8] lg:text-[13px]">{error}</span>
        </div>
      )}

      <Button onClick={submit} loading={busy} className="self-start">
        Envoyer la demande
      </Button>
    </div>
  );
}
