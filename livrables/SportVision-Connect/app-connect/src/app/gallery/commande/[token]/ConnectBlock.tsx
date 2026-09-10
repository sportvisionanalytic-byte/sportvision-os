"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { savePendingClaim } from "@/lib/gallery/pending-claim";
import { savePendingOnboarding } from "@/lib/signup/pending-onboarding";

// Conversion vers Connect, APRÈS les téléchargements.
//
// Le client vient de payer : il veut ses fichiers, pas un formulaire. Ce bloc est donc sous les
// boutons de téléchargement, et il reste sobre — c'est une proposition, pas un péage.
//
// ── Un seul écran, pas le tunnel en quatre étapes ──
// Le tunnel Connect habituel demande profil, sport et club : trois écrans qui n'ont aucun sens
// pour quelqu'un qui veut juste garder ses photos. Ici l'e-mail et le nom viennent déjà de
// l'achat, il ne reste qu'un mot de passe. Le tunnel complet n'est pas touché pour qui arrive
// normalement, et sport/club restent proposés plus tard depuis le profil.
//
// ── L'e-mail affiché ne donne aucun droit ──
// Il est pré-rempli et non modifiable parce que c'est celui de la commande, mais le rattachement
// exige côté base une session, un e-mail CONFIRMÉ, et une adresse identique à celle de l'achat.
// Voir media_gallery_claim_all().

export function ConnectBlock({
  token,
  email,
  dejaRattachee,
  albumId,
  expiration,
}: {
  token: string;
  email: string;
  dejaRattachee: boolean;
  /** Pour renvoyer directement vers CETTE galerie plutôt que vers la liste. */
  albumId: string | null;
  expiration: string;
}) {
  const [mdp, setMdp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [envoye, setEnvoye] = useState(false);

  // Achat deja rattache a un compte : soit l'acheteur etait connecte au moment de payer, soit il
  // a cree son compte depuis cette page. Dans les deux cas, lui proposer « Creer mon compte »
  // serait absurde — on lui montre la porte vers ses photos.
  if (dejaRattachee) {
    return (
      <section className="mt-10 rounded-sv-card border border-border bg-surface p-6">
        <h2 className="font-sora text-[17px] font-extrabold tracking-tight">
          Cet achat est dans votre espace SportVision
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-text-tertiary">
          Vos photos y restent disponibles sans limite de durée, avec vos prochaines galeries.
        </p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          {albumId && (
            <Link
              href={`/galeries/${albumId}`}
              className="inline-flex rounded-sv-pill bg-sv-gradient px-6 py-3 text-[14px] font-bold text-white"
            >
              Voir mes photos
            </Link>
          )}
          <Link
            href="/galeries"
            className="inline-flex rounded-sv-pill border border-border-strong px-6 py-3 text-[14px] font-bold text-text-secondary"
          >
            Mes galeries
          </Link>
        </div>
      </section>
    );
  }

  if (envoye) {
    return (
      <section className="mt-10 rounded-sv-card border border-affiliations/30 bg-affiliations-bg p-6">
        <h2 className="font-sora text-[17px] font-extrabold tracking-tight">Vérifiez votre adresse e-mail</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
          Nous venons d&apos;envoyer un message à <strong>{email}</strong>. Votre achat sera ajouté
          automatiquement à votre espace SportVision dès que votre adresse sera confirmée — vous
          n&apos;aurez rien à saisir.
        </p>
        <p className="mt-2 text-[12.5px] text-text-tertiary">
          En attendant, cette page continue de fonctionner : vos photos restent téléchargeables ici.
        </p>
      </section>
    );
  }

  async function creerCompte(e: React.FormEvent) {
    e.preventDefault();
    if (mdp.length < 8 || busy) return;
    setBusy(true);
    setError(null);

    // Mémorisé AVANT l'inscription : signUp ne renvoie aucune session tant que l'e-mail n'est pas
    // confirmé, le rattachement ne peut donc pas se faire maintenant. Il se rejouera au retour.
    savePendingClaim(token);
    // Type de compte, rejoué par le même mécanisme que le tunnel normal : un acheteur de photos
    // est un particulier, pas un joueur affilié à un club.
    savePendingOnboarding({ action: "skip", accountType: "particulier" });

    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password: mdp,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (signUpError) {
      // Adresse déjà inscrite : ce n'est pas une erreur pour l'utilisateur, c'est qu'il a déjà un
      // compte. On l'oriente vers la connexion plutôt que de lui opposer un message technique.
      const dejaInscrit = /already|registered|exist/i.test(signUpError.message);
      setError(
        dejaInscrit
          ? "Vous avez déjà un compte avec cette adresse. Connectez-vous, votre achat sera rattaché automatiquement."
          : "La création du compte a échoué. Réessayez dans un instant.",
      );
      setBusy(false);
      return;
    }
    setEnvoye(true);
    setBusy(false);
  }

  return (
    <section className="mt-10 rounded-sv-card border border-border bg-surface p-6">
      <h2 className="font-sora text-[17px] font-extrabold tracking-tight">
        Gardez vos photos dans SportVision Connect
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-text-tertiary">
        Ce lien reste actif jusqu&apos;au {expiration}. Créez gratuitement votre espace SportVision
        pour conserver cet achat sans limite de durée et retrouver vos prochaines galeries au même
        endroit.
      </p>

      <form onSubmit={creerCompte} className="mt-4">
        <label htmlFor="cx-email" className="mb-1 block text-[11px] font-bold uppercase tracking-[.04em] text-text-label">
          Votre adresse
        </label>
        <input
          id="cx-email"
          value={email}
          readOnly
          className="mb-3 w-full rounded-sv border border-border bg-bg px-4 py-3 text-[16px] text-text-tertiary"
        />

        <label htmlFor="cx-mdp" className="mb-1 block text-[11px] font-bold uppercase tracking-[.04em] text-text-label">
          Choisissez un mot de passe
        </label>
        <input
          id="cx-mdp"
          type="password"
          value={mdp}
          onChange={(e) => setMdp(e.target.value)}
          autoComplete="new-password"
          placeholder="8 caractères minimum"
          className="w-full rounded-sv border border-border-strong bg-surface px-4 py-3 text-[16px] outline-none focus:border-white/35"
        />

        {error && <p className="mt-3 text-[12.5px] font-semibold text-danger">{error}</p>}

        <button
          type="submit"
          disabled={mdp.length < 8 || busy}
          className="mt-4 w-full rounded-sv-pill bg-sv-gradient py-3.5 text-[14.5px] font-bold text-white disabled:opacity-50"
        >
          {busy ? "Création…" : "Créer mon compte gratuitement"}
        </button>
      </form>

      <Link
        // `next` et non un parametre invente : c'est celui que /auth/login sait lire. Le
        // rattachement, lui, passe par le jeton memorise juste avant (savePendingClaim) — il n'a
        // pas besoin de transiter par l'URL, et un jeton n'a rien a faire dans une adresse de
        // connexion.
        href={`/auth/login?next=${encodeURIComponent(`/gallery/commande/${token}`)}`}
        onClick={() => savePendingClaim(token)}
        className="mt-3 block w-full py-2 text-center text-[12.5px] text-text-tertiary underline underline-offset-2"
      >
        J&apos;ai déjà un compte
      </Link>
    </section>
  );
}
