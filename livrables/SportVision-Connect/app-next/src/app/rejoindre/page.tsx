"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { switchActiveSpace } from "@/lib/supabase/actions";
import { ROLE_LABELS } from "@/lib/types/settings";
import { mapClubRole } from "@/lib/supabase/mappers";
import { inscriptionSurCompteExistant, messageErreurAuth } from "@/lib/supabase/erreurs-auth";
import {
  accepterInvitation,
  lireInvitation,
  marquerInvitationOuverte,
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
//
// ── Audit des créations de compte (10/09/2026) ──
// Ce que la page faisait mal, mesuré sur la production :
//  - le lien de confirmation d'une création d'accès renvoyait sur Connect (aucune adresse de
//    retour n'était donnée à Supabase, qui retombe alors sur l'URL du site = Connect) : le coach
//    confirmait son adresse et se retrouvait dans une autre application, invitation perdue ;
//  - un compte déjà existant (un parent inscrit sur Connect, typiquement) qui cliquait « Créer mon
//    accès » lisait « Compte créé, confirmez votre adresse » et attendait un e-mail qui ne part
//    jamais (Supabase ne dit pas qu'une adresse est prise, voir erreurs-auth.ts) ;
//  - les refus de Supabase s'affichaient en anglais ;
//  - le bouton s'activait dès 6 caractères quand Supabase en exige 8 ;
//  - connecté avec le mauvais compte, rien ne permettait d'en changer ;
//  - quelqu'un qui appartenait déjà à un autre espace était ramené dans CET espace-là, pas dans
//    le club qu'il venait de rejoindre.

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
    // Le club voit ainsi que l'invitation a été ouverte, pas seulement envoyée (v121).
    marquerInvitationOuverte(supabase, token);
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

  // Un double clic partait deux fois : deux connexions, deux acceptations, et la seconde échouait
  // (« déjà utilisée ») pendant que la première réussissait. L'état React ne suffit pas à l'empêcher
  // — il n'est relu qu'au rendu suivant, après le second clic.
  const enCours = useRef(false);

  function accepter() {
    setOccupe(true);
    setErreur(null);
    enCours.current = true;
    accepterInvitation(createClient(), token)
      .then(async () => {
        setEtat("acceptee");
        // L'espace mémorisé (cookie) l'emporte sur tout le reste à l'ouverture de Club+ : sans
        // cette ligne, quelqu'un qui appartenait déjà à un autre espace y était ramené, et ne
        // voyait pas le club qu'il venait de rejoindre. Un échec ici n'empêche pas d'entrer.
        await switchActiveSpace({ kind: "organization", id: invitation?.clubId ?? "" }).catch(() => undefined);
        // Un court instant sur l'écran de confirmation, pour que la personne comprenne ce qui
        // vient de se passer avant d'être posée dans son espace.
        setTimeout(() => {
          router.push("/dashboard");
          router.refresh();
        }, 1500);
      })
      .catch((e) => {
        enCours.current = false;
        setErreur(messageErreurInvitation(e, "Impossible d'accepter cette invitation."));
      })
      .finally(() => setOccupe(false));
  }

  function changerDeCompte() {
    setOccupe(true);
    createClient()
      .auth.signOut()
      .finally(() => {
        setConnecte(null);
        setErreur(null);
        setInfo(null);
        setMode("connexion");
        setOccupe(false);
      });
  }

  function soumettre() {
    if (enCours.current) return;
    enCours.current = true;
    setOccupe(true);
    setErreur(null);
    setInfo(null);
    const supabase = createClient();
    const adresse = email.trim();
    const promesse =
      mode === "connexion"
        ? supabase.auth.signInWithPassword({ email: adresse, password: motDePasse })
        : supabase.auth.signUp({
            email: adresse,
            password: motDePasse,
            options: {
              // Sans adresse de retour, Supabase utilise l'URL du site du projet, qui est Connect :
              // le coach confirmait son adresse et atterrissait dans une autre application, son
              // invitation perdue. On le ramène sur CETTE invitation, via l'échange de session.
              emailRedirectTo: `${window.location.origin}/clubplus/auth/callback?next=${encodeURIComponent(
                `/rejoindre?token=${token}`,
              )}`,
            },
          });

    promesse
      .then(({ data, error }) => {
        if (error) throw error;
        if (mode === "creation" && inscriptionSurCompteExistant(data.user)) {
          // Adresse déjà inscrite (Connect, Club+ ou l'OS) : aucun e-mail ne part. On bascule sur
          // la connexion, en gardant l'adresse saisie.
          enCours.current = false;
          setMode("connexion");
          setMotDePasse("");
          setInfo(
            "Un compte SportVision existe déjà avec cette adresse. Saisissez son mot de passe pour rejoindre le club (ou utilisez « Mot de passe oublié » depuis la page de connexion).",
          );
          setOccupe(false);
          return;
        }
        if (!data.session) {
          // Création de compte avec confirmation d'e-mail activée : aucune session n'existe
          // encore. On le dit, plutôt que de laisser un bouton tourner dans le vide.
          enCours.current = false;
          setInfo(
            `Dernière étape : ouvrez l'e-mail de confirmation que nous venons d'envoyer à ${adresse} (pensez aux courriers indésirables) et cliquez sur le lien. Vous reviendrez ici pour activer votre espace.`,
          );
          setOccupe(false);
          return;
        }
        setConnecte(data.session.user.email ?? adresse);
        accepter();
      })
      .catch((e) => {
        enCours.current = false;
        setErreur(
          messageErreurAuth(
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
          <Button
            onClick={() => {
              if (!enCours.current) accepter();
            }}
            disabled={occupe}
            loading={occupe}
            className="w-full"
          >
            Activer mon espace
          </Button>
          {/* Un ordinateur partagé, un compte Connect ouvert d'avance : la base refuse une
              invitation acceptée depuis une autre adresse, encore faut-il pouvoir en changer. */}
          <button
            type="button"
            onClick={changerDeCompte}
            disabled={occupe}
            className="text-[12.5px] font-bold text-brand-blue-electric hover:underline disabled:opacity-50"
          >
            Ce n&apos;est pas vous ? Changer de compte
          </button>
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
            {/* 8, la règle réelle du serveur (password_min_length). Annoncée avant la saisie,
                pas découverte par un refus. Pas de minimum imposé à la connexion : un compte
                ancien peut avoir un mot de passe créé sous une règle plus souple. */}
            {mode === "creation" && (
              <span className="text-[11.5px] text-text-faint">8 caractères minimum.</span>
            )}
          </label>

          <Button
            onClick={soumettre}
            disabled={occupe || !email.trim() || (mode === "creation" ? motDePasse.length < 8 : motDePasse.length === 0)}
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
