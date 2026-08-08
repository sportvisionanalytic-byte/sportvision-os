"use client";

import { useState } from "react";
import { ImagePlus, Plus, X } from "lucide-react";
import { useSession } from "@/lib/session-context";
import { canAccess } from "@/lib/permissions";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LockedModule } from "@/components/ui/LockedModule";

// /settings/organization — voir ACTIONS.md § 25 « Organisation ». Logo, nom, adresse, Instagram,
// SIRET, couleurs du club.
export default function OrganizationSettingsPage() {
  const { ctx } = useSession();

  if (!canAccess(ctx, "settings")) return <LockedModule title="Paramètres" />;

  const { organization } = ctx;
  const [name, setName] = useState(organization.name);
  const [address, setAddress] = useState(organization.address ?? "");
  const [instagram, setInstagram] = useState(organization.instagramHandle ?? "");
  const [siret, setSiret] = useState(organization.siret ?? "");
  const [colors, setColors] = useState<string[]>(organization.brandColors ?? ["#2454FF", "#832DFF"]);
  const [saved, setSaved] = useState(false);

  function addColor() {
    setColors((prev) => [...prev, "#2454FF"]);
  }

  function removeColor(index: number) {
    setColors((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 3200);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <Card className="flex items-center gap-4 p-5">
        <div className="flex h-16 w-16 flex-none items-center justify-center rounded-2xl border border-dashed border-border-strong bg-surface-alt text-text-faint">
          <ImagePlus className="h-6 w-6" aria-hidden />
        </div>
        <div>
          <div className="text-[13.5px] font-extrabold">Logo</div>
          <div className="text-[12px] text-text-soft">Utilisé dans le Studio, les documents et les e-mails.</div>
        </div>
        <Button variant="secondary" className="ml-auto h-9 px-3.5 text-[12.5px]">
          Changer le logo
        </Button>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div className="text-[13.5px] font-extrabold">Informations générales</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nom" full>
            <input value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
          </Field>
          <Field label="Adresse" full>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className={fieldClass} />
          </Field>
          <Field label="Instagram">
            <input value={instagram} onChange={(e) => setInstagram(e.target.value)} className={fieldClass} placeholder="@fcfontainebleau" />
          </Field>
          <Field label="SIRET">
            <input value={siret} onChange={(e) => setSiret(e.target.value)} className={fieldClass} />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <div className="text-[13.5px] font-extrabold">Couleurs du club</div>
          <button
            onClick={addColor}
            className="flex items-center gap-1.5 text-[12.5px] font-bold text-brand-blue-electric"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Ajouter une couleur
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {colors.map((color, i) => (
            <div key={`${color}-${i}`} className="flex items-center gap-2 rounded-xl border border-border-strong px-2.5 py-2">
              <span className="h-6 w-6 flex-none rounded-full border border-white/20" style={{ backgroundColor: color }} />
              <input
                value={color}
                onChange={(e) =>
                  setColors((prev) => prev.map((c, idx) => (idx === i ? e.target.value : c)))
                }
                className="w-24 bg-transparent font-mono text-[12.5px] outline-none"
              />
              <button aria-label="Retirer cette couleur" onClick={() => removeColor(i)} className="text-text-faint hover:text-danger-fg">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave}>Enregistrer</Button>
        {saved && <span className="text-[12.5px] font-bold text-success-fg">Modifications enregistrées.</span>}
      </div>
    </div>
  );
}

const fieldClass =
  "h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`flex flex-col gap-1.5 ${full ? "sm:col-span-2" : ""}`}>
      <span className="text-[12.5px] font-bold text-text-soft">{label}</span>
      {children}
    </label>
  );
}
