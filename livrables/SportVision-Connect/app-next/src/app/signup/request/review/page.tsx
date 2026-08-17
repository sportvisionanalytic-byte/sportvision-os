"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";
import { LEGAL_URLS } from "@/lib/legal-links";
import { isRequestComplete, REQUEST_ORG_TYPE_OPTIONS, useSignup } from "../../signup-context";

// Écran 5 · Validation (master prompt §31-41). Récapitulatif + certification + envoi.
//
// APPELLE connect-club-signup-request DIRECTEMENT, SANS auth.signUp() préalable : ce tunnel ne
// crée jamais de compte Supabase Auth. C'est le cœur de la demande de Fouka du 17/08/2026 — une
// inscription publique (club, académie, coach, structure de coaching, tournoi, stage,
// association) crée toujours une DEMANDE vérifiée par SportVision, jamais un compte ni une
// organisation active. supabase.functions.invoke() fonctionne sans session (même pattern que
// /auth/forgot) : le client Supabase utilise la clé publique (anon), l'Edge Function elle-même
// est publique et rate-limitée par IP (voir son code réel, livrables/SportVision-TV/supabase/
// functions/connect-club-signup-request/index.ts).
export default function RequestReviewPage() {
  const router = useRouter();
  const { state, patch } = useSignup();
  const [certifie, setCertifie] = useState(state.certificationAcceptee);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.organizationType === null) router.replace("/signup/request");
  }, [state.organizationType, router]);

  if (state.organizationType === null) return null;
  const orgType = state.organizationType;

  const orgLabel = REQUEST_ORG_TYPE_OPTIONS.find((o) => o.type === orgType)?.label ?? "";
  const canSubmit = certifie && isRequestComplete(state) && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: fnError } = await supabase.functions.invoke("connect-club-signup-request", {
        body: {
          organization_type: orgType,
          club_nom: state.nom,
          structure_type: state.structureType || undefined,
          ville: state.ville,
          code_postal: state.codePostal || undefined,
          site_web: state.siteWeb || undefined,
          activite_type: orgType === "coach" ? state.activiteType || undefined : undefined,
          activite_type_autre: orgType === "coach" && state.activiteType === "Autre" ? state.activiteTypeAutre : undefined,
          exerce_sous_propre_nom: orgType === "coach" ? state.exerceSousPropreNom : undefined,
          nom_evenement_principal: orgType === "tournoi" ? state.nomEvenementPrincipal || undefined : undefined,
          contact_prenom: state.contactPrenom,
          contact_nom: state.contactNom,
          contact_email: state.contactEmail,
          contact_telephone: state.contactTelephone,
          fonction: state.fonction,
          fonction_autre: state.fonction === "Autre" ? state.fonctionAutre : undefined,
          besoins: state.besoins,
          besoin_autre_precision: state.besoinAutrePrecision || undefined,
          certification_acceptee: true,
        },
      });
      if (fnError) throw fnError;
      if (data?.error) {
        // Doublon (17/08/2026) : message déjà rédigé côté serveur pour être montré tel quel — pas
        // de détail technique dedans, contrairement aux autres erreurs (§59) qui restent avalées
        // dans le message générique ci-dessous.
        if (data.duplicate) {
          setError(data.error);
          setSubmitting(false);
          return;
        }
        throw new Error(data.error);
      }
      patch({ certificationAcceptee: true });
      const requestId = data?.request_id as string | null | undefined;
      router.push(requestId ? `/signup/request/sent?ref=${encodeURIComponent(requestId)}` : "/signup/request/sent");
    } catch {
      // Texte exact §59 : ne jamais révéler de détail technique, et le formulaire reste intact
      // (aucun `patch` de réinitialisation ci-dessus tant que la requête n'a pas réussi).
      setError("Nous n'avons pas pu transmettre votre demande. Vos informations ont été conservées.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-[28px] font-extrabold tracking-tight">Vérifiez votre demande</h1>
        <p className="mt-2 text-[14px] text-text-soft">Relisez les informations avant de transmettre votre demande à SportVision.</p>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-extrabold">Votre structure</div>
          <button
            type="button"
            onClick={() => router.push("/signup/request/structure")}
            className="text-[12.5px] font-bold text-brand-blue-electric hover:underline"
          >
            Modifier
          </button>
        </div>
        <dl className="mt-3 flex flex-col gap-2.5 text-[13px]">
          <Row label="Type" value={orgLabel || "—"} />
          <Row label="Nom" value={state.nom || "—"} />
          <Row label="Ville" value={state.ville || "—"} />
          <Row label="Code postal" value={state.codePostal || "—"} />
          <Row label="Site / Instagram" value={state.siteWeb || "—"} />
        </dl>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-extrabold">Vous</div>
          <button
            type="button"
            onClick={() => router.push("/signup/request/contact")}
            className="text-[12.5px] font-bold text-brand-blue-electric hover:underline"
          >
            Modifier
          </button>
        </div>
        <dl className="mt-3 flex flex-col gap-2.5 text-[13px]">
          <Row label="Nom complet" value={`${state.contactPrenom} ${state.contactNom}`.trim() || "—"} />
          <Row label="E-mail" value={state.contactEmail || "—"} />
          <Row label="Téléphone" value={state.contactTelephone || "—"} />
          <Row label="Fonction déclarée" value={(state.fonction === "Autre" ? state.fonctionAutre : state.fonction) || "—"} />
        </dl>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-extrabold">Votre besoin</div>
          <button
            type="button"
            onClick={() => router.push("/signup/request/needs")}
            className="text-[12.5px] font-bold text-brand-blue-electric hover:underline"
          >
            Modifier
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {state.besoins.length > 0 ? (
            state.besoins.map((b) => (
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
        <div className="font-extrabold text-text">Que se passe-t-il ensuite ?</div>
        <ol className="mt-2.5 flex flex-col gap-1.5 text-[13px] leading-relaxed">
          <li>1. Votre demande est transmise à l&apos;équipe SportVision.</li>
          <li>2. Nous vérifions les informations de votre structure.</li>
          <li>3. Si votre demande est validée, vous recevez un e-mail sécurisé.</li>
          <li>4. Vous pourrez ensuite activer votre accès Club+.</li>
        </ol>
        <p className="mt-2.5">SportVision reviendra vers vous après vérification de votre demande.</p>
      </div>

      <div className="rounded-xl border border-border-strong bg-surface-alt p-4 text-[13px] text-text-soft">
        Votre demande n&apos;entraîne pas encore la création d&apos;un accès Club+. Si elle est validée, SportVision vous
        enverra un lien sécurisé pour activer votre espace.
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

      <p className="text-[12px] text-text-faint">
        Les informations transmises sont utilisées par SportVision pour traiter votre demande.{" "}
        <a href={LEGAL_URLS.confidentialite} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-blue-electric hover:underline">
          En savoir plus.
        </a>
      </p>

      {error && (
        <div className="flex gap-2.5 rounded-xl border border-[#FDA29B] bg-danger-bg px-3.5 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-danger-fg" aria-hidden />
          <p className="text-[13px] font-semibold leading-relaxed text-danger-fg">{error}</p>
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="secondary" className="w-full sm:w-auto" onClick={() => router.push("/signup/request/needs")} disabled={submitting}>
          Retour
        </Button>
        <Button disabled={!canSubmit} loading={submitting} className="w-full sm:w-auto" onClick={handleSubmit}>
          {submitting ? "Envoi en cours…" : error ? "Réessayer" : "Envoyer ma demande"}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-divider pb-2.5 last:border-0 last:pb-0">
      <dt className="text-text-soft">{label}</dt>
      <dd className="text-right font-bold">{value}</dd>
    </div>
  );
}
