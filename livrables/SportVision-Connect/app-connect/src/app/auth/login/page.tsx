"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { createClient } from "@/lib/supabase/client";
import { cheminInterne, consumePendingOnboarding } from "@/lib/signup/pending-onboarding";
import { consumePendingClaim } from "@/lib/gallery/pending-claim";
import { messageErreurAuth } from "@/lib/auth/messages";
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
  // « Rester connecté » retiré le 10/09/2026 (décision de Fouka) : la case n'avait aucun effet.
  // La session vit dans des cookies posés par @supabase/ssr (400 jours) et renouvelés à chaque
  // requête par le middleware : cochée ou non, la personne restait connectée. Lui donner un vrai
  // effet (cookies de session effacés à la fermeture du navigateur) demandait de changer la durée
  // des cookies à quatre endroits qui les réécrivent — client navigateur, client serveur,
  // middleware, /auth/callback — c'est-à-dire le mécanisme de session lui-même, celui dont une
  // erreur déconnecte tout le monde ou casse le lien de confirmation. Et le résultat n'aurait pas
  // été fiable là où Connect sert le plus : Safari iOS et Chrome Android restaurent les cookies de
  // session à la réouverture. Une case qui promet sans tenir est pire que pas de case : sur un
  // appareil partagé, c'est « Se déconnecter » qui protège (menu des Espaces joueur et particulier).
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
  // ?confirmation=failed — posé par auth/callback/route.ts quand exchangeCodeForSession()
  // échoue (lien de confirmation expiré ou déjà utilisé). Sans ce message, l'utilisateur
  // atterrissait silencieusement sur /auth/login sans comprendre pourquoi son clic sur le
  // mail ne l'avait pas connecté.
  const [confirmationFailed, setConfirmationFailed] = useState(false);
  // ?confirmation=ok — posé par auth/callback/route.ts quand le lien de confirmation a été ouvert
  // dans un autre navigateur que celui de l'inscription (10/09/2026) : l'adresse EST confirmée,
  // seule la session n'a pas pu être ouverte ici. La personne doit le lire, sinon elle recommence
  // son inscription et tombe sur « adresse déjà utilisée ».
  const [confirmationOk, setConfirmationOk] = useState(false);
  // `next` explicitement demandé dans l'URL (et non la valeur par défaut) : il l'emporte sur la
  // page mémorisée avec l'inscription.
  const [nextDansUrl, setNextDansUrl] = useState(false);
  // Erreur autre que « identifiants incorrects » : adresse pas encore confirmée, trop de
  // tentatives, réseau coupé. Toutes s'affichaient « Adresse e-mail ou mot de passe incorrect »
  // jusqu'au 10/09/2026 — mesuré en production avec un compte non confirmé : la personne, qui
  // avait le bon mot de passe, partait le réinitialiser.
  const [autreErreur, setAutreErreur] = useState<string | null>(null);
  const [nonConfirme, setNonConfirme] = useState(false);
  const [renvoi, setRenvoi] = useState<"idle" | "envoi" | "ok">("idle");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = cheminInterne(params.get("next"));
    if (next) {
      setNextPath(next);
      setNextDansUrl(true);
    }
    if (params.get("confirmation") === "failed") setConfirmationFailed(true);
    if (params.get("confirmation") === "ok") setConfirmationOk(true);
  }, []);

  const validEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
  const emailBad = touched && !validEmail(email);
  // À la connexion on ne juge pas la longueur (10/09/2026) : « 6 caractères minimum » contredisait
  // les 8 exigés à l'inscription, et un compte ancien peut très bien avoir un mot de passe plus
  // court que la règle actuelle. Seul Supabase sait s'il est bon.
  const pwBad = touched && !password;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setTouched(true);
    setAuthFailed(false);
    setAutreErreur(null);
    setNonConfirme(false);
    setRenvoi("idle");
    if (!validEmail(email) || !password) return;

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) {
      setBusy(false);
      if (error.code === "invalid_credentials" || (!error.code && error.status === 400)) {
        setAuthFailed(true);
      } else {
        // Supabase ne répond « non confirmée » qu'APRÈS avoir vérifié le mot de passe : le dire
        // ne révèle rien à qui ne connaît pas déjà le mot de passe.
        setNonConfirme(error.code === "email_not_confirmed");
        setAutreErreur(messageErreurAuth(error, "connexion"));
      }
      return;
    }

    // Filet de sécurité inscription (voir lib/signup/pending-onboarding.ts) : si ce compte
    // vient de confirmer son e-mail sans jamais avoir eu de session pour finaliser son
    // rattachement club, on le rejoue maintenant. Échec journalisé seulement, jamais bloquant
    // pour la connexion elle-même — même filet que app-next.
    let suiteInscription: string | null = null;
    try {
      const rejeu = await consumePendingOnboarding(supabase);
      suiteInscription = rejeu?.suite ?? null;
      // Rattachement des achats galerie, au meme moment et pour la meme raison : c'est
      // le premier instant ou une vraie session existe. Appele meme sans achat en
      // attente, pour recuperer les commandes invitees eligibles d'un compte existant.
      await consumePendingClaim(supabase).catch(() => null);
    } catch (e) {
      console.error("[login] rejeu de l'inscription en attente échoué :", e);
    }

    setBusy(false);
    router.push(nextDansUrl ? nextPath : suiteInscription || nextPath);
    router.refresh();
  }

  // Nouveau lien de confirmation, depuis l'écran de connexion (10/09/2026) : c'est ici qu'arrive
  // la personne dont le lien a expiré (24 h), a déjà servi, ou a été « consommé » par l'antivirus de
  // sa messagerie. Sans ce bouton, la seule issue proposée était de recommencer l'inscription —
  // qui échoue, l'adresse étant prise.
  async function renvoyerConfirmation() {
    if (renvoi === "envoi" || !validEmail(email)) return;
    setRenvoi("envoi");
    const { error } = await createClient().auth.resend({
      type: "signup",
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback${nextDansUrl ? `?next=${encodeURIComponent(nextPath)}` : ""}`,
      },
    });
    if (error) {
      setRenvoi("idle");
      setAutreErreur(messageErreurAuth(error, "renvoi"));
      return;
    }
    setRenvoi("ok");
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
            Réservez vos prestations SportVision, retrouvez vos contenus et suivez tout ce qui
            vous concerne depuis un seul espace personnel.
          </p>
          <p className="text-[15px] leading-relaxed text-[#AEAECB]">
            Votre club utilise SportVision ? Rattachez simplement votre profil à votre équipe.
            Pas de club partenaire ? Connect fonctionne aussi pour vos prestations personnelles
            et celles de vos proches.
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Pill icon="shield" color="#22D3EE" bg="rgba(34,211,238,.16)" label="Équipes & affiliations" />
            <Pill icon="photo_library" color="#C084FC" bg="rgba(168,85,247,.18)" label="Contenus" />
            <Pill icon="camera_alt" color="#8CA9FF" bg="rgba(79,125,255,.18)" label="Prestations" />
            <Pill icon="savings" color="#F472B6" bg="rgba(244,114,182,.16)" label="Paiement collectif" />
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

            {confirmationOk && !authFailed && !autreErreur && (
              <div role="status" className="flex items-start gap-2.5 rounded-sv border border-affiliations/30 bg-affiliations-bg px-4 py-3.5">
                <span className="material-symbols-rounded !text-[19px] text-affiliations" aria-hidden="true">check_circle</span>
                <span className="text-[13px] leading-relaxed text-text-secondary">
                  Votre adresse e-mail est confirmée. Connectez-vous avec le mot de passe choisi à
                  l&apos;inscription pour accéder à votre espace.
                </span>
              </div>
            )}

            {/* 10/09/2026 : l'ancien texte (« … recommencez votre inscription ») envoyait vers une
                impasse — l'adresse est déjà prise. Ce message s'affiche quand le lien a expiré ou
                a déjà servi : dans le second cas l'adresse est confirmée et il suffit de se
                connecter ; dans le premier, la connexion le dira et proposera un nouvel e-mail. */}
            {confirmationFailed && !confirmationOk && !authFailed && !autreErreur && !(touched && (emailBad || pwBad)) && (
              <div role="alert" className="flex items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
                <span className="material-symbols-rounded !text-[19px] text-danger" aria-hidden="true">error</span>
                <span className="text-[13px] leading-relaxed text-[#FBCFE8]">
                  Ce lien de confirmation a déjà servi ou a expiré. Si vous avez déjà confirmé votre
                  adresse, connectez-vous simplement. Sinon, connectez-vous quand même : nous vous
                  proposerons de recevoir un nouveau lien.
                </span>
              </div>
            )}

            {(authFailed || autreErreur || (touched && (emailBad || pwBad))) && (
              <div role="alert" className="flex items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
                <span className="material-symbols-rounded !text-[19px] text-danger" aria-hidden="true">error</span>
                <span className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-[#FBCFE8]">
                  <span>
                    {authFailed
                      ? "Adresse e-mail ou mot de passe incorrect."
                      : autreErreur
                        ? autreErreur
                        : "Vérifiez les champs signalés ci-dessous."}
                  </span>
                  {nonConfirme && (
                    <button
                      type="button"
                      onClick={renvoyerConfirmation}
                      disabled={renvoi !== "idle"}
                      className="self-start font-semibold text-white underline underline-offset-2 disabled:no-underline disabled:opacity-80"
                    >
                      {renvoi === "envoi"
                        ? "Envoi…"
                        : renvoi === "ok"
                          ? `Nouveau lien envoyé à ${email.trim().toLowerCase()}.`
                          : "Renvoyer l'e-mail de confirmation"}
                    </button>
                  )}
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
                    className={`h-[54px] w-full rounded-sv border bg-surface px-4 pr-[50px] text-[16px] text-text outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-text-label focus:border-[#8CA9FF] focus:shadow-[0_0_0_3px_rgba(79,125,255,.28)] ${
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
                {pwBad && <span className="text-[12px] text-danger">Renseignez votre mot de passe.</span>}
              </div>

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
                // `next` suit la personne dans le tunnel (10/09/2026) : le parent qui arrive de son
                // invitation (/auth/login?next=/mes-invitations) et n'a pas encore de compte doit
                // retrouver cette invitation une fois son adresse confirmée, pas un accueil vide.
                href={nextDansUrl ? `/signup?next=${encodeURIComponent(nextPath)}` : "/signup"}
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
                Conditions Générales de Vente
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
