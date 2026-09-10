"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS } from "@/lib/types/settings";
import { mapClubRole } from "@/lib/supabase/mappers";
import {
  accepterInvitation,
  lireInvitation,
  messageErreurInvitation,
  type InvitationPubliee,
} from "@/lib/data/club/invitations";

// /clubplus/rejoindre?token=… — l'atterrissage d'une invitation nominative Club+.
//
// ── Ce que cette page ne fait pas ──
// Elle ne demande jamais « quel est votre club ? », ni « quelle équipe ? ». L'invitation le sait,
// et elle est la seule à le savoir : l'URL ne porte qu'un jeton, tout le reste est résolu par
// `lire_invitation_club` côté serveur. Un lien de la forme `?club=…&role=coach` laisserait
// n'importe qui se nommer coach de n'importe quoi.
//
// ── Pourquoi la connexion se fait ICI et pas dans le tunnel d'inscription ──
// `/signup` sert à créer un CLUB. Y envoyer un coach invité lui ferait fonder une organisation
// dont il n'a que faire. Ce qu'il lui faut est bien plus simple : un compte, puis l'acceptation.
// Les deux tiennent sur cet écran, sans jamais lui faire perdre son invitation en route.
//
// ── L'adresse doit correspondre ──
// La base refuse une invitation acceptée depuis une autre adresse que celle qui l'a reçue (voir
// migration v101) : une invitation de coach accorde l'administration d'une équipe, un lien
// transféré ne doit pas suffire à la prendre. Le message de refus le dit en toutes lettres.

export default function RejoindrePage() {
  return (
    <Suspense fallback={null}>
      <RejoindreContent />
    </Suspense>
  );
}

type Etat = "chargement" | "pret" | "introuvable" | "acceptee";

function RejoindreContent() {
  const router = useRouter();
  const token = (useSearchParams().get("token") || "").trim();

  const [etat, setEtat] = useState<Etat>("chargement");
  const [invitation, setInvitation] = useState<InvitationPubliee | null>(null);
  const [connecte, setConnecte] = useState<string | null>(null);
  const [mode, setMode] = useState<"connexion" | "creation">("connexion");
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setEtat("introuvable");
      return;
    }
    const supabase = createClient();
    let annule = false;
    Promise.all([lireInvitation(supabase, token), supabase.auth.getUser()])
      .then(([inv, { data }]) => {
        if (annule) return;
        setInvitation(inv);
        setConnecte(data.user?.email ?? null);
        setEtat(inv ? "pret" : "introuvable");
      })
      .catch(() => {
        if (!annule) setEtat("introuvable");
      });
    return () => {
      annule = true;
    };
  }, [token]);

  function accepter() {
    setOccupe(true);
    setErreur(null);
    accepterInvitation(createClient(), token)
      .then(() => {
        setEtat("acceptee");
        // Un court instant sur l'écran de confirmation, pour que la personne comprenne ce qui
        // vient de se passer avant d'être posée dans son espace.
        setTimeout(() => router.push("/"), 1500);
      })
      .catch((e) => setErreur(messageErreurInvitation(e, "Impossible d'accepter cette invitation.")))
      .finally(() => setOccupe(false));
  }

  function soumettre() {
    setOccupe(true);
    setErreur(null);
    setInfo(null);
    const supabase = createClient();
    const promesse =
      mode === "connexion"
        ? supabase.auth.signInWithPassword({ email: email.trim(), password: motDePasse })
        : supabase.auth.signUp({ email: email.trim(), password: motDePasse });

    promesse
      .then(({ data, error }) => {
        if (error) throw error;
        if (!data.session) {
          // Création de compte avec confirmation d'e-mail activée : aucune session n'existe
          // encore. On le dit, plutôt que de laisser un bouton tourner dans le vide.
          setInfo(
            "Compte créé. Confirmez votre adresse depuis l'e-mail que vous venez de recevoir, puis rouvrez ce lien d'invitation.",
          );
          setOccupe(false);
          return;
        }
        setConnecte(data.session.user.email ?? email.trim());
        accepter();
      })
      .catch((e) => {
        setErreur(
          messageErreurInvitation(
            e,
            mode === "connexion" ? "Connexion impossible. Vérifiez vos identifiants." : "Création du compte impossible.",
          ),
        );
        setOccupe(false);
      });
  }

  if (etat === "chargement") {
    return (
      <Cadre>
        <Loader2 className="h-6 w-6 animate-spin text-text-faint" aria-hidden />
        <p className="text-[13.5px] text-text-soft">Vérification de votre invitation…</p>
      </Cadre>
    );
  }

  if (etat === "introuvable" || !invitation) {
    return (
      <Cadre>
        <AlertCircle className="h-7 w-7 text-danger-fg" aria-hidden />
        <h1 className="text-[19px] font-extrabold tracking-tight">Ce lien n&apos;est pas valide</h1>
        <p className="text-[13.5px] leading-relaxed text-text-soft">
          Il a peut-être été remplacé par un plus récent. Demandez au club de vous en renvoyer un.
        </p>
      </Cadre>
    );
  }

  if (etat === "acceptee") {
    return (
      <Cadre>
        <CheckCircle2 className="h-7 w-7 text-success-fg" aria-hidden />
        <h1 className="text-[19px] font-extrabold tracking-tight">C&apos;est fait</h1>
        <p className="text-[13.5px] text-text-soft">Vous rejoignez {invitation.clubNom}…</p>
      </Cadre>
    );
  }

  if (!invitation.valide) {
    const explication =
      invitation.statut === "acceptee"
        ? "Cette invitation a déjà été utilisée. Connectez-vous simplement à votre espace."
        : invitation.statut === "revoquee"
          ? "Cette invitation a été annulée par le club."
          : "Cette invitation a expiré. Demandez au club de vous en renvoyer une.";
    return (
      <Cadre>
        <AlertCircle className="h-7 w-7 text-warning-fg" aria-hidden />
        <h1 className="text-[19px] font-extrabold tracking-tight">Invitation inutilisable</h1>
        <p className="text-[13.5px] leading-relaxed text-text-soft">{explication}</p>
        <Button variant="secondary" onClick={() => router.push("/auth/login")}>
          Aller à la connexion
        </Button>
      </Cadre>
    );
  }

  const roleLisible = ROLE_LABELS[mapClubRole(invitation.role)] ?? invitation.role;

  return (
    <Cadre>
      <div className="text-[12px] font-bold uppercase tracking-[.08em] text-text-faint">SportVision Club+</div>
      <h1 className="text-[22px] font-extrabold leading-tight tracking-tight">
        {invitation.prenom ? `${invitation.prenom}, vous êtes invité` : "Vous êtes invité"} à rejoindre{" "}
        {invitation.clubNom}
      </h1>

      <dl className="w-full rounded-xl bg-surface-sunken px-4 py-3.5 text-left">
        <div className="flex items-baseline justify-between gap-3 py-1">
          <dt className="text-[12px] font-bold text-text-soft">Rôle</dt>
          <dd className="text-[13.5px] font-extrabold">{roleLisible}</dd>
        </div>
        {invitation.teams.length > 0 && (
          <div className="flex items-baseline justify-between gap-3 py-1">
            <dt className="text-[12px] font-bold text-text-soft">
              {invitation.teams.length > 1 ? "Équipes" : "Équipe"}
            </dt>
            <dd className="text-right text-[13.5px] font-extrabold">{invitation.teams.join(", ")}</dd>
          </div>
        )}
      </dl>

      {connecte ? (
        <>
          <p className="text-[12.5px] text-text-soft">
            Connecté en tant que <span className="font-bold text-text">{connecte}</span>
          </p>
          <Button onClick={accepter} disabled={occupe} loading={occupe} className="w-full">
            Activer mon espace
          </Button>
        </>
      ) : (
        <>
          <div className="flex w-full gap-2 rounded-xl bg-surface-sunken p-1">
            <button
              type="button"
              onClick={() => setMode("connexion")}
              className={`flex-1 rounded-lg py-2 text-[12.5px] font-bold transition-colors ${mode === "connexion" ? "bg-brand-blue-electric text-white" : "text-text-soft"}`}
            >
              J&apos;ai déjà un compte
            </button>
            <button
              type="button"
              onClick={() => setMode("creation")}
              className={`flex-1 rounded-lg py-2 text-[12.5px] font-bold transition-colors ${mode === "creation" ? "bg-brand-blue-electric text-white" : "text-text-soft"}`}
            >
              Créer mon accès
            </button>
          </div>

          <p className="text-[12px] leading-relaxed text-text-faint">
            Utilisez l&apos;adresse à laquelle le club a envoyé cette invitation.
          </p>

          <label className="flex w-full flex-col gap-1.5 text-left">
            <span className="text-[12.5px] font-bold text-text-soft">Adresse e-mail</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[16px] outline-none focus-visible:border-brand-blue"
            />
          </label>
          <label className="flex w-full flex-col gap-1.5 text-left">
            <span className="text-[12.5px] font-bold text-text-soft">Mot de passe</span>
            <input
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              autoComplete={mode === "connexion" ? "current-password" : "new-password"}
              className="h-11 rounded-xl border border-border-strong bg-input-bg px-3.5 text-[16px] outline-none focus-visible:border-brand-blue"
            />
          </label>

          <Button
            onClick={soumettre}
            disabled={occupe || !email.trim() || motDePasse.length < 6}
            loading={occupe}
            className="w-full"
          >
            {mode === "connexion" ? "Se connecter et rejoindre" : "Créer mon espace Club+"}
          </Button>
        </>
      )}

      {info && <p className="text-[12.5px] font-semibold text-info-fg">{info}</p>}
      {erreur && <p className="text-[12.5px] font-bold text-danger-fg">{erreur}</p>}
    </Cadre>
  );
}

function Cadre({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-sv-modal border border-border bg-elevated p-7 text-center shadow-sv-modal">
        {children}
      </div>
    </main>
  );
}
