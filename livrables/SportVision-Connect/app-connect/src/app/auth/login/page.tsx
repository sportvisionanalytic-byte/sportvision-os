"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { createClient } from "@/lib/supabase/client";
import { consumePendingOnboarding } from "@/lib/signup/pending-onboarding";
import { LEGAL_URLS } from "@/lib/legal-links";

// /auth/login — port du design de référence design-connect-personnel-12-08/README.md
// (écran "Connexion" § Authentification) et de Connect Connexion Web.dc.html.
// Note de sécurité du design : ne jamais préciser si c'est l'e-mail ou le mot de passe qui
// est faux dans le message d'erreur (reprend la règle déjà en place sur l'ancien /auth/login).
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [touched, setTouched] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Redirection post-connexion vers ?next=... (ex. lien d'invitation à un groupe
  // /equipes/rejoindre/[id] — sans ça, un visiteur non connecté qui clique sur ce lien
  // atterrissait sur /dashboard après connexion, invitation perdue). Lu depuis
  // window.location plutôt que useSearchParams pour ne pas exiger de bornage <Suspense>
  // sur cette page. Restreint aux chemins internes ("/xxx", jamais "//" = protocole-relatif)
  // pour ne jamais devenir une redirection ouverte.
  const [nextPath, setNextPath] = useState("/dashboard");
  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) setNextPath(next);
  }, []);

  const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
  const emailBad = touched && !validEmail(email);
  const pwBad = touched && password.length < 6;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setTouched(true);
    setAuthFailed(false);
    if (!validEmail(email) || password.length < 6) return;

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      setAuthFailed(true);
      return;
    }

    // Filet de sécurité inscription (voir lib/signup/pending-onboarding.ts) : si ce compte
    // vient de confirmer son e-mail sans jamais avoir eu de session pour finaliser son
    // rattachement club, on le rejoue maintenant. Échec journalisé seulement, jamais bloquant
    // pour la connexion elle-même — même filet que app-next.
    try {
      await consumePendingOnboarding(supabase);
    } catch (e) {
      console.error("[login] rejeu de l'inscription en attente échoué :", e);
    }

    setBusy(false);
    router.push(nextPath);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-bg font-sans text-text">
      {/* ============ STORYTELLING · 55% ============ */}
      <div className="hidden flex-[1.22] flex-col bg-[#0C0A1E] lg:flex">
        <div className="relative min-h-[150px] flex-1 overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,#3B1E6E_0%,#22307A_55%,#0F4C63_100%)]" />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg,rgba(9,8,26,.34) 0%,rgba(12,10,30,0) 34%,rgba(12,10,30,.72) 84%,#0C0A1E 100%)",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(680px 460px at 88% -12%,rgba(168,85,247,.3),transparent 68%)" }}
          />
          <div className="absolute left-11 top-9 flex items-center gap-2.5">
            <Image src="/uploads/logo.png" alt="SportVision Connect" width={38} height={38} className="object-contain" />
            <div className="flex flex-col leading-tight">
              <span className="font-sora text-[17px] font-bold tracking-tight text-white">SportVision</span>
              <span className="bg-sv-gradient bg-clip-text text-[11px] font-medium uppercase tracking-[.14em] text-transparent">
                Connect
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-none flex-col gap-3.5 px-11 pb-8 pt-1">
          <h2 className="font-sora text-[42px] font-bold leading-[1.08] tracking-tight text-white">
            Votre sport.
            <br />
            Vos contenus.
            <br />
            Votre espace.
          </h2>
          <p className="text-[17px] leading-relaxed text-[#DCDCEC]">
            Rejoignez votre club, réservez vos prestations SportVision et cotisez avec vos
            coéquipiers depuis un seul espace.
          </p>
          <p className="text-[15px] leading-relaxed text-[#AEAECB]">
            Sans club aussi : réservez une prestation ou retrouvez les photos et vidéos de vos
            proches.
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Pill icon="shield" color="#22D3EE" bg="rgba(34,211,238,.16)" label="Clubs & équipes" />
            <Pill icon="photo_library" color="#C084FC" bg="rgba(168,85,247,.18)" label="Contenus" />
            <Pill icon="camera_alt" color="#8CA9FF" bg="rgba(79,125,255,.18)" label="Prestations" />
            <Pill icon="savings" color="#F472B6" bg="rgba(244,114,182,.16)" label="Cotisations" />
          </div>
        </div>
      </div>

      {/* ============ ACTION · 45% ============ */}
      <div className="flex flex-1 items-center justify-center px-8 py-11">
        <div className="w-full max-w-[404px]">
          <div className="flex flex-col gap-6 animate-sv-in">
            <div className="flex flex-col gap-2">
              <h1 className="font-sora text-[32px] font-bold tracking-tight">Bienvenue sur Connect</h1>
              <p className="text-[15px] text-text-tertiary">
                Connectez-vous à votre espace personnel SportVision.
              </p>
            </div>

            {(authFailed || (touched && (emailBad || pwBad))) && (
              <div className="flex items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
                <span className="material-symbols-rounded !text-[19px] text-danger" aria-hidden="true">error</span>
                <span className="text-[13px] leading-relaxed text-[#FBCFE8]">
                  {authFailed
                    ? "Adresse e-mail ou mot de passe incorrect."
                    : "Vérifiez les champs signalés ci-dessous."}
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
              <Field
                id="sv-email"
                label="Adresse e-mail"
                type="email"
                autoComplete="username"
                placeholder="votre@email.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setAuthFailed(false);
                }}
                error={emailBad ? (email.trim() ? "Saisissez une adresse e-mail valide." : "Renseignez votre adresse e-mail.") : null}
              />

              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="sv-pw" className="text-[13px] font-medium text-text-secondary">
                    Mot de passe
                  </label>
                  <Link href="/auth/forgot" className="text-[12px] font-medium text-[#8CA9FF] hover:text-[#B6C7FF]">
                    Mot de passe oublié ?
                  </Link>
                </div>
                <div className="relative flex">
                  <input
                    id="sv-pw"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Votre mot de passe"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setAuthFailed(false);
                    }}
                    className={`h-[54px] w-full rounded-sv border bg-surface px-4 pr-[50px] text-[15px] text-text outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-text-label focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.28)] ${
                      pwBad || authFailed ? "border-danger" : "border-border-strong"
                    }`}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1.5 top-1.5 flex h-[42px] w-[42px] items-center justify-center rounded-xl text-text-tertiary hover:bg-surface-hover hover:text-text"
                  >
                    <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">
                      {showPassword ? "visibility" : "visibility_off"}
                    </span>
                  </button>
                </div>
                {pwBad && (
                  <span className="text-[12px] text-danger">
                    {password ? "6 caractères minimum." : "Renseignez votre mot de passe."}
                  </span>
                )}
              </div>

              <label className="flex select-none items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="sr-only"
                />
                <span
                  onClick={() => setRemember((v) => !v)}
                  className={`flex h-5 w-5 cursor-pointer items-center justify-center rounded-md border transition-all duration-150 ${
                    remember ? "border-transparent bg-sv-gradient" : "border-border-strong"
                  }`}
                >
                  {remember && <span className="material-symbols-rounded !text-[15px] text-white" aria-hidden="true">check</span>}
                </span>
                <span className="cursor-pointer text-[13px] text-text-secondary" onClick={() => setRemember((v) => !v)}>
                  Rester connecté
                </span>
              </label>

              <Button type="submit" loading={busy} className="w-full">
                {busy ? "Connexion…" : "Se connecter"}
              </Button>
            </form>

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-[12px] text-text-label">Pas encore de compte ?</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>

            <div className="flex flex-col gap-2.5">
              <Link
                href="/signup"
                className="flex h-[54px] items-center justify-center rounded-sv border border-border-strong bg-surface font-sora text-[16px] font-semibold text-text hover:bg-surface-hover"
              >
                Créer mon compte
              </Link>
              <Link
                href="/aide"
                className="mt-2.5 flex items-center justify-center gap-1.5 self-center text-[13px] text-text-tertiary hover:text-text"
              >
                <span className="material-symbols-rounded !text-[17px]" aria-hidden="true">help</span>
                Besoin d&apos;aide ?
              </Link>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[12px] text-text-label">
              <a href={LEGAL_URLS.mentionsLegales} target="_blank" rel="noopener noreferrer" className="hover:text-text-tertiary">
                Mentions légales
              </a>
              <a href={LEGAL_URLS.confidentialite} target="_blank" rel="noopener noreferrer" className="hover:text-text-tertiary">
                Confidentialité
              </a>
              <a href={LEGAL_URLS.cgv} target="_blank" rel="noopener noreferrer" className="hover:text-text-tertiary">
                Conditions d&apos;utilisation
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Pill({ icon, color, bg, label }: { icon: string; color: string; bg: string; label: string }) {
  return (
    <span
      className="flex items-center gap-1.5 rounded-sv-pill px-3.5 py-1.5 text-[13px] font-medium"
      style={{ color, background: bg }}
    >
      <span className="material-symbols-rounded !text-[17px]" aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}
