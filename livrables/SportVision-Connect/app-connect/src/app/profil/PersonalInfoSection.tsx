"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { EditModal } from "@/components/ui/EditModal";
import { createClient } from "@/lib/supabase/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function PersonalInfoSection({
  firstName,
  lastName,
  email,
  telephone,
  playerId,
}: {
  firstName: string;
  lastName: string;
  email: string;
  telephone: string;
  playerId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fn, setFn] = useState(firstName);
  const [ln, setLn] = useState(lastName);
  const [em, setEm] = useState(email);
  const [ph, setPh] = useState(telephone);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailPending, setEmailPending] = useState(false);

  function openModal() {
    setFn(firstName);
    setLn(lastName);
    setEm(email);
    setPh(telephone);
    setTouched(false);
    setError(null);
    setEmailPending(false);
    setOpen(true);
  }

  const fnError = touched && !fn.trim() ? "Renseignez votre prénom." : null;
  const lnError = touched && !ln.trim() ? "Renseignez votre nom." : null;
  const emError = touched && !EMAIL_RE.test(em.trim()) ? "Adresse e-mail invalide." : null;
  const ok = !!fn.trim() && !!ln.trim() && EMAIL_RE.test(em.trim());

  async function handleSave() {
    setTouched(true);
    if (!fn.trim() || !ln.trim() || !EMAIL_RE.test(em.trim())) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();

    const emailChanged = em.trim().toLowerCase() !== email.trim().toLowerCase();
    const { error: authError } = await supabase.auth.updateUser({
      ...(emailChanged ? { email: em.trim() } : {}),
      data: { first_name: fn.trim(), last_name: ln.trim() },
    });
    if (authError) {
      setBusy(false);
      setError("Impossible de mettre à jour vos informations pour le moment.");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (userId) {
      await supabase.from("connect_profile_settings").upsert(
        { user_id: userId, telephone: ph.trim() || null },
        { onConflict: "user_id" },
      );
      // Garde player_profiles (roster Club+) cohérent avec l'identité éditée ici, quand une
      // ligne existe — voir migration §1, "une seule identité" (MASTER-CONNECT-V1.md §5).
      if (playerId) {
        await supabase.from("player_profiles").update({ prenom: fn.trim(), nom: ln.trim() }).eq("id", playerId);
      }
    }

    setBusy(false);
    if (emailChanged) {
      setEmailPending(true);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 rounded-sv-card border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <h2 className="font-sora text-[17px] font-semibold">Informations personnelles</h2>
        <button
          type="button"
          onClick={openModal}
          className="ml-auto flex h-[38px] flex-none items-center gap-1.5 rounded-sv border border-border-strong bg-white/[.03] px-3.5 font-sora text-[13px] font-semibold hover:bg-white/[.08]"
        >
          <span className="material-symbols-rounded !text-[17px]">edit</span>
          Modifier
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3.5">
        <InfoField label="Prénom" value={firstName || "—"} />
        <InfoField label="Nom" value={lastName || "—"} />
        <InfoField label="E-mail" value={email || "—"} />
        <InfoField label="Téléphone" value={telephone || "—"} />
      </div>

      {open && (
        <EditModal
          title="Informations personnelles"
          subtitle="Ces informations servent à vos réservations et à vos factures."
          onClose={() => setOpen(false)}
          busy={busy}
          error={error}
        >
          {emailPending ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-2.5 rounded-sv border border-affiliations/40 bg-affiliations-bg px-4 py-3.5">
                <span className="material-symbols-rounded !text-[19px] text-affiliations">mark_email_read</span>
                <span className="text-[13px] leading-relaxed text-text-secondary">
                  Vérifiez votre boîte mail pour confirmer votre nouvelle adresse e-mail. Vos autres
                  informations ont bien été mises à jour.
                </span>
              </div>
              <Button
                onClick={() => {
                  setOpen(false);
                  router.refresh();
                }}
                className="w-full"
              >
                Fermer
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Field id="pi-fn" label="Prénom" value={fn} onChange={(e) => setFn(e.target.value)} error={fnError} />
              <Field id="pi-ln" label="Nom" value={ln} onChange={(e) => setLn(e.target.value)} error={lnError} />
              <Field id="pi-em" label="Adresse e-mail" type="email" value={em} onChange={(e) => setEm(e.target.value)} error={emError} />
              <Field id="pi-ph" label="Téléphone" type="tel" placeholder="06 12 34 56 78" value={ph} onChange={(e) => setPh(e.target.value)} />
              <Button onClick={handleSave} loading={busy} disabled={!ok && touched} className="w-full">
                Enregistrer
              </Button>
            </div>
          )}
        </EditModal>
      )}
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-[.1em] text-text-label">{label}</span>
      <span className="text-[15px] font-medium">{value}</span>
    </div>
  );
}
