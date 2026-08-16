"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { createClient } from "@/lib/supabase/client";
import { gradientFor } from "@/lib/avatarGradients";

// Écrit via create_user_group() (RPC SECURITY DEFINER, migration-connect-v50) : insère
// user_groups + la ligne créateur dans user_group_members de façon atomique — jamais deux
// appels client séparés qui pourraient laisser un groupe sans membre en cas d'échec partiel.
export function CreateGroupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setTouched(true);
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_user_group", {
      p_name: name.trim(),
      p_description: description.trim() || null,
    });
    setBusy(false);
    if (rpcError || !data) {
      setError("Impossible de créer le groupe pour le moment. Réessayez dans un instant.");
      return;
    }
    router.push(`/equipes/${data}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex items-center gap-4 rounded-sv-card border border-border bg-surface p-4">
        <span
          className="flex h-[60px] w-[60px] flex-none items-center justify-center rounded-sv font-sora text-[19px] font-semibold text-white"
          style={{ background: name.trim() ? gradientFor(name.trim()) : "linear-gradient(120deg,#A855F7,#4F7DFF 55%,#22D3EE)" }}
        >
          {(name.trim().slice(0, 1) || "?").toUpperCase()}
        </span>
        <div className="flex flex-col gap-1">
          <span className="font-sora text-[15px] font-semibold">Photo du groupe</span>
          <span className="text-[13px] text-text-tertiary">Facultative — les initiales sont utilisées par défaut.</span>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Field
          id="gr-name"
          label="Nom du groupe"
          placeholder="Les Frères"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={touched && !name.trim() ? "Le nom du groupe est obligatoire." : null}
        />
        <Field
          id="gr-desc"
          label="Description · facultatif"
          placeholder="Le five du vendredi soir"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
          <span className="material-symbols-rounded !text-[19px] text-danger">error</span>
          <span className="text-[13px] leading-relaxed text-[#FBCFE8]">{error}</span>
        </div>
      )}

      <Button onClick={handleCreate} loading={busy} className="self-start">
        Créer l&apos;équipe
      </Button>
    </div>
  );
}
