"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { EditModal } from "@/components/ui/EditModal";
import { createClient } from "@/lib/supabase/client";

export function SportProfileSection({
  sport,
  poste,
  categorie,
  ville,
}: {
  sport: string;
  poste: string;
  categorie: string;
  ville: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sp, setSp] = useState(sport);
  const [po, setPo] = useState(poste);
  const [ca, setCa] = useState(categorie);
  const [vi, setVi] = useState(ville);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    setSp(sport);
    setPo(poste);
    setCa(categorie);
    setVi(ville);
    setTouched(false);
    setError(null);
    setOpen(true);
  }

  const spError = touched && !sp.trim() ? "Renseignez votre sport." : null;

  async function handleSave() {
    setTouched(true);
    if (!sp.trim()) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setBusy(false);
      setError("Session expirée, reconnectez-vous.");
      return;
    }
    const { error: upsertError } = await supabase.from("connect_profile_settings").upsert(
      {
        user_id: userId,
        sport: sp.trim(),
        poste: po.trim() || null,
        categorie: ca.trim() || null,
        ville: vi.trim() || null,
      },
      { onConflict: "user_id" },
    );
    setBusy(false);
    if (upsertError) {
      setError("Impossible d'enregistrer votre profil sportif pour le moment.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 rounded-sv-card border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <h2 className="font-sora text-[17px] font-semibold">Profil sportif</h2>
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
        <InfoField label="Sport" value={sport || "—"} />
        <InfoField label="Poste" value={poste || "—"} />
        <InfoField label="Catégorie" value={categorie || "—"} />
        <InfoField label="Ville" value={ville || "—"} />
      </div>

      {open && (
        <EditModal
          title="Profil sportif"
          subtitle="Utilisé pour personnaliser votre espace et vos prestations."
          onClose={() => setOpen(false)}
          busy={busy}
          error={error}
        >
          <div className="flex flex-col gap-4">
            <Field id="sp-sp" label="Sport" placeholder="Football" value={sp} onChange={(e) => setSp(e.target.value)} error={spError} />
            <Field id="sp-po" label="Poste" placeholder="Milieu" value={po} onChange={(e) => setPo(e.target.value)} />
            <Field id="sp-ca" label="Catégorie" placeholder="U18" value={ca} onChange={(e) => setCa(e.target.value)} />
            <Field id="sp-vi" label="Ville" placeholder="Montereau-Fault-Yonne" value={vi} onChange={(e) => setVi(e.target.value)} />
            <Button onClick={handleSave} loading={busy} className="w-full">
              Enregistrer
            </Button>
          </div>
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
