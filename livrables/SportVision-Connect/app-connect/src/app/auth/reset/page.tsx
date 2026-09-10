"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { createClient } from "@/lib/supabase/client";
import { consumePendingOnboarding } from "@/lib/signup/pending-onboarding";
import { consumePendingClaim } from "@/lib/gallery/pending-claim";

// /auth/reset — page atteinte via le lien reçu par e-mail (resetPasswordForEmail).
// Port de l'écran "Nouveau mot de passe" du design de référence.
//
// 25/08/2026, audit complet : cette page appelait updateUser() à l'aveugle, sans jamais lire le
// hash d'URL ni afficher d'erreur — un lien expiré/déjà utilisé faisait échouer updateUser()
// silencieusement (aucun state d'erreur n'existait dans tout le composant), pire que le bug
// équivalent déjà corrigé côté Club+ (qui restait au moins visiblement bloqué). Porté ici le même
// correctif : lecture explicite du hash (#error=... ou #access_token=...), setSession()
// déterministe, message d'erreur visible en cas d'échec de mise à jour du mot de passe.
//
// 31/08/2026, audit complet : le hash n'était lu qu'au montage (deps [] ), jamais rejoué. Cas
// réel confirmé par test Playwright (event "load" du navigateur ne se déclenche qu'une fois) :
// deux URL /auth/reset qui ne diffèrent QUE par le fragment (#...) — typiquement un lien expiré
// suivi du clic sur un lien fraîchement redemandé dans le MÊME onglet (lien collé dans la barre
// d'adresse déjà ouverte sur /auth/reset, ou onglet réutilisé par le client mail) — ne déclenchent
// qu'une navigation "same-document" côté navigateur : aucun remount React, donc l'ancien message
// "Ce lien a expiré" restait affiché indéfiniment même si le nouveau lien, valide, venait d'arriver
// dans l'URL. Corrigé en réexécutant le traitement du hash à chaque "hashchange", pas seulement au
// montage.
export default function ResetPage() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    function processHash() {
      // Repart d'un état propre à chaque traitement (montage ou hashchange) — sans ça, un
      // ancien linkError/ready resterait affiché par-dessus le nouveau résultat.
      setReady(false);
      setLinkError(null);

      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const hashError = hash.get("error_description") || hash.get("error");
      if (hashError) {
        setLinkError(
          hash.get("error_code") === "otp_expired"
            ? "Ce lien a expiré. Demandez-en un nouveau ci-dessous."
            : "Ce lien n'est plus valide. Demandez-en un nouveau ci-dessous.",
        );
        return;
      }

      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");

      if (accessToken && refreshToken) {
        supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
          if (cancelled) return;
          if (error) {
            setLinkError("Ce lien n'est plus valide. Demandez-en un nouveau ci-dessous.");
          } else {
            setReady(true);
          }
        });
        return;
      }

      supabase.auth.getSession().then(({ data }) => {
        if (!cancelled && data.session) setReady(true);
      });
    }

    processHash();
    window.addEventListener("hashchange", processHash);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });

    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", processHash);
      subscription.unsubscribe();
    };
  }, []);

  const ok = pw.length >= 8 && pw === pw2;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setSubmitError(null);
    if (!ok || busy) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (!error) {
      // Ce lien est parfois la PREMIÈRE session du compte (10/09/2026) : quelqu'un qui n'a jamais
      // cliqué sa confirmation, ou qui a repris son inscription avec un autre mot de passe que
      // Supabase n'a pas retenu, passe par « Mot de passe oublié » — le lien de réinitialisation
      // confirme l'adresse au passage. Sans ce rejeu, il atterrissait dans l'Espace joueur avec
      // son choix de profil et de club perdu. Même filet que /auth/confirming et /auth/login.
      let suite: string | null = null;
      try {
        suite = (await consumePendingOnboarding(supabase))?.suite ?? null;
        await consumePendingClaim(supabase).catch(() => null);
      } catch (e) {
        console.error("[auth/reset] rejeu de l'inscription en attente échoué :", e);
      }
      setBusy(false);
      router.push(suite || "/dashboard");
      router.refresh();
    } else {
      setBusy(false);
      setSubmitError(
        error.code === "same_password"
          ? "Ce mot de passe est déjà le vôtre : choisissez-en un différent, ou connectez-vous directement avec lui."
          : error.code === "weak_password"
            ? "Ce mot de passe est trop faible. Choisissez-en un d'au moins 8 caractères."
            : "Impossible d'enregistrer ce mot de passe. Réessayez ou demandez un nouveau lien.",
      );
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6 font-sans text-text">
      <div className="flex w-full max-w-[404px] flex-col gap-6 animate-sv-in">
        <div className="flex flex-col gap-2">
          <h1 className="font-sora text-[30px] font-bold tracking-tight">Nouveau mot de passe</h1>
          <p className="text-[15px] leading-relaxed text-text-tertiary">Choisissez un mot de passe sécurisé.</p>
        </div>

        {linkError && (
          <div className="flex flex-col gap-3">
            <p className="rounded-xl border border-[#FDA29B] bg-danger-bg px-3.5 py-3 text-[13px] font-semibold text-danger-fg">
              {linkError}
            </p>
            <Link href="/auth/forgot" className="text-[13px] font-medium text-[#8CA9FF] hover:text-[#B6C7FF]">
              Demander un nouveau lien →
            </Link>
          </div>
        )}

        {!ready && !linkError && <p className="text-[13.5px] text-text-tertiary">Vérification du lien…</p>}

        {ready && !linkError && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
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
            {submitError && <p className="text-[13px] font-semibold text-danger-fg">{submitError}</p>}
            <Button type="submit" loading={busy} className="w-full">
              Enregistrer et me connecter
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
