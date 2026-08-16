"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { EditModal } from "@/components/ui/EditModal";
import { createClient } from "@/lib/supabase/client";

// Changement de mot de passe — le champ "Mot de passe actuel" est revérifié réellement (ré-
// authentification via signInWithPassword) avant l'appel updateUser() : Supabase Auth n'exige
// pas ce champ pour une session déjà active, mais le design le demande explicitement et c'est la
// bonne pratique de sécurité (une session laissée ouverte ne suffit pas à prouver qu'on connaît
// le mot de passe actuel).
export function SecuritySection({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function openModal() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setTouched(false);
    setError(null);
    setDone(false);
    setOpen(true);
  }

  const mismatch = touched && next !== confirm;
  const currentError = touched && !current ? "Champ requis." : null;
  const nextError = touched && next.length < 8 ? "8 caractères minimum." : null;
  const ok = !!current && next.length >= 8 && next === confirm;

  async function handleSave() {
    setTouched(true);
    if (!current || next.length < 8 || next !== confirm) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();

    const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: current });
    if (reauthError) {
      setBusy(false);
      setError("Mot de passe actuel incorrect.");
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (updateError) {
      setError("Impossible de modifier le mot de passe pour le moment.");
      return;
    }
    setDone(true);
  }

  return (
    <div className="flex flex-col gap-4 rounded-sv-card border border-border bg-surface p-5">
      <h2 className="font-sora text-[17px] font-semibold">Sécurité</h2>
      <div className="flex items-center gap-3">
        <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-sv bg-prestations-bg">
          <span className="material-symbols-rounded !text-[20px] text-prestations">lock</span>
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] font-medium">Mot de passe</span>
        </div>
        <button
          type="button"
          onClick={openModal}
          className="ml-auto flex h-[40px] flex-none items-center rounded-sv border border-border-strong bg-white/[.03] px-3.5 font-sora text-[13px] font-semibold hover:bg-white/[.08]"
        >
          Modifier
        </button>
      </div>

      {open && (
        <EditModal title="Modifier mon mot de passe" subtitle="8 caractères minimum." onClose={() => setOpen(false)} busy={busy} error={error}>
          {done ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-2.5 rounded-sv border border-affiliations/40 bg-affiliations-bg px-4 py-3.5">
                <span className="material-symbols-rounded !text-[19px] text-affiliations">check_circle</span>
                <span className="text-[13px] leading-relaxed text-text-secondary">Mot de passe modifié.</span>
              </div>
              <Button onClick={() => setOpen(false)} className="w-full">
                Fermer
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Field id="pw-cur" label="Mot de passe actuel" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} error={currentError} />
              <Field id="pw-next" label="Nouveau mot de passe" type="password" value={next} onChange={(e) => setNext(e.target.value)} error={nextError} />
              <Field
                id="pw-confirm"
                label="Confirmer le nouveau mot de passe"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                error={mismatch ? "Les deux mots de passe ne correspondent pas." : null}
              />
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
