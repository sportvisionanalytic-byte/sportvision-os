"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { createClient } from "@/lib/supabase/client";

// /auth/reset — page atteinte via le lien reçu par e-mail (resetPasswordForEmail).
// Port de l'écran "Nouveau mot de passe" du design de référence.
export default function ResetPage() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const ok = pw.length >= 8 && pw === pw2;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!ok || busy) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (!error) {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6 font-sans text-text">
      <form onSubmit={handleSubmit} className="flex w-full max-w-[404px] flex-col gap-6 animate-sv-in">
        <div className="flex flex-col gap-2">
          <h1 className="font-sora text-[30px] font-bold tracking-tight">Nouveau mot de passe</h1>
          <p className="text-[15px] leading-relaxed text-text-tertiary">Choisissez un mot de passe sécurisé.</p>
        </div>
        <Field
          id="sv-np"
          label="Nouveau mot de passe"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="8 caractères minimum"
          error={touched && pw.length < 8 ? "8 caractères minimum." : null}
        />
        <Field
          id="sv-np2"
          label="Confirmer le mot de passe"
          type="password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          placeholder="Retapez votre mot de passe"
          error={touched && pw2 !== pw ? "Les deux mots de passe ne correspondent pas." : null}
        />
        <Button type="submit" loading={busy} className="w-full">
          Enregistrer et me connecter
        </Button>
      </form>
    </div>
  );
}
