"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";
import { useSignup } from "../../signup-context";

// Étape 4 · Validation — tunnel /signup/club-request/*. Récapitulatif + certification + envoi.
//
// APPELLE connect-club-signup-request DIRECTEMENT, SANS auth.signUp() préalable : contrairement
// au tunnel standard (checkout/page.tsx), aucun compte Supabase Auth n'est créé ici. C'est
// exactement le point du correctif de sécurité du 12/08/2026 — une inscription publique de club
// crée une DEMANDE, jamais un compte ni un club actif. supabase.functions.invoke() fonctionne
// sans session (même pattern que /auth/forgot, request-password-reset) : le client Supabase
// utilise la clé publique (anon), l'Edge Function elle-même est publique et rate-limitée par IP.
export default function ClubRequestStep4Page() {
  const router = useRouter();
  const { state, patch } = useSignup();
  const { clubRequest } = state;
  const [certifie, setCertifie] = useState(clubRequest.certificationAcceptee);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.orgType !== "club") router.replace("/signup/type");
  }, [state.orgType, router]);

  async function handleSubmit() {
    if (!certifie || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: fnError } = await supabase.functions.invoke("connect-club-signup-request", {
        body: {
          club_nom: clubRequest.clubNom,
          structure_type: clubRequest.structureType,
          ville: clubRequest.ville,
          code_postal: clubRequest.codePostal || undefined,
          site_web: clubRequest.siteWeb || undefined,
          contact_prenom: clubRequest.contactPrenom,
          contact_nom: clubRequest.contactNom,
          contact_email: clubRequest.contactEmail,
          contact_telephone: clubRequest.contactTelephone,
          fonction: clubRequest.fonction,
          fonction_autre: clubRequest.fonction === "Autre" ? clubRequest.fonctionAutre : undefined,
          besoins: clubRequest.besoins,
          besoin_autre_precision: clubRequest.besoinAutrePrecision || undefined,
          certification_acceptee: true,
        },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      patch({ clubRequest: { ...clubRequest, certificationAcceptee: true } });
      router.push("/signup/club-request/sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Une erreur est survenue, réessayez.");
      setSubmitting(false);
    }
  }

  if (state.orgType !== "club") return null;

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Validation</h1>
        <p className="mt-2 text-[14px] text-text-soft">
          Vérifiez les informations avant l&apos;envoi. SportVision examine chaque demande avant l&apos;ouverture d&apos;un
          espace Connect.
        </p>
      </div>

      <Card className="p-5">
        <div className="text-[13px] font-extrabold">Votre club</div>
        <dl className="mt-3 flex flex-col gap-2.5 text-[13px]">
          <Row label="Nom du club" value={clubRequest.clubNom || "—"} />
          <Row label="Type de structure" value={clubRequest.structureType || "—"} />
          <Row label="Ville" value={clubRequest.ville || "—"} />
          <Row label="Code postal" value={clubRequest.codePostal || "—"} />
          <Row label="Site / Instagram" value={clubRequest.siteWeb || "—"} />
        </dl>
      </Card>

      <Card className="p-5">
        <div className="text-[13px] font-extrabold">Vous</div>
        <dl className="mt-3 flex flex-col gap-2.5 text-[13px]">
          <Row label="Nom" value={`${clubRequest.contactPrenom} ${clubRequest.contactNom}`.trim() || "—"} />
          <Row label="E-mail" value={clubRequest.contactEmail || "—"} />
          <Row label="Téléphone" value={clubRequest.contactTelephone || "—"} />
          <Row
            label="Fonction déclarée"
            value={(clubRequest.fonction === "Autre" ? clubRequest.fonctionAutre : clubRequest.fonction) || "—"}
          />
        </dl>
      </Card>

      <Card className="p-5">
        <div className="text-[13px] font-extrabold">Votre besoin</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {clubRequest.besoins.length > 0 ? (
            clubRequest.besoins.map((b) => (
              <span key={b} className="rounded-full border border-border-strong bg-surface-alt px-3 py-1 text-[12px] font-semibold">
                {b}
              </span>
            ))
          ) : (
            <span className="text-[13px] text-text-soft">—</span>
          )}
        </div>
      </Card>

      <div className="rounded-xl border border-border-strong bg-surface-alt p-4 text-[13px] text-text-soft">
        Aucun compte n&apos;est créé à cette étape. Si votre demande est validée, SportVision vous transmettra un lien
        d&apos;activation sécurisé pour créer votre espace Connect.
      </div>

      <label className="flex items-start gap-2.5 text-[13px] font-semibold text-text-soft">
        <input
          type="checkbox"
          checked={certifie}
          onChange={(e) => setCertifie(e.target.checked)}
          className="mt-0.5 h-4 w-4 flex-none accent-brand-blue-electric"
        />
        Je certifie être autorisé(e) à effectuer cette demande au nom de cette structure. *
      </label>

      {error && (
        <div className="flex gap-2.5 rounded-xl border border-[#FDA29B] bg-danger-bg px-3.5 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-danger-fg" aria-hidden />
          <p className="text-[13px] font-semibold leading-relaxed text-danger-fg">{error}</p>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => router.push("/signup/club-request/needs")} disabled={submitting}>
          Retour
        </Button>
        <Button disabled={!certifie || submitting} loading={submitting} onClick={handleSubmit}>
          Envoyer ma demande
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-divider pb-2.5 last:border-0 last:pb-0">
      <dt className="text-text-soft">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}
