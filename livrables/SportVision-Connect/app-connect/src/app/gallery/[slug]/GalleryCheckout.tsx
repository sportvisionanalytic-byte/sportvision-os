"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { startGalleryCheckout } from "@/lib/gallery/data";
import { formatMontant } from "@/lib/gallery/pricing";

// ── Protéger l'adresse e-mail ──
// Paiement réel de validation du 10/09/2026 : l'adresse a été saisie « sportvisionalytic@gmail.com »
// au lieu de « sportvisionanalytic@gmail.com ». Le paiement est passé, l'e-mail de livraison est
// parti — vers une boîte qui n'était pas la bonne. Pour un parent, c'est des photos payées qu'il ne
// reçoit jamais, et un lien de téléchargement dans la boîte d'un inconnu.
//
// Deux protections, parce qu'elles n'attrapent pas les mêmes fautes :
//   • un second champ de confirmation, qui doit correspondre au premier. C'est le seul moyen
//     d'attraper une faute AVANT le @, comme celle du 10/09 — aucun correcteur ne peut deviner
//     qu'il manquait « an » dans un identifiant ;
//   • une suggestion quand le DOMAINE ressemble à un fournisseur connu sans l'être (« gmial.com »).
//     Elle propose, elle ne corrige jamais d'office : « gmail.fr » ou un domaine d'entreprise
//     peuvent être parfaitement réels.
const DOMAINES_COURANTS = [
  "gmail.com", "hotmail.fr", "hotmail.com", "outlook.fr", "outlook.com", "live.fr", "yahoo.fr",
  "yahoo.com", "icloud.com", "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "laposte.net",
  "bbox.fr", "neuf.fr", "me.com", "msn.com",
];

/** Nombre minimal de lettres a ajouter, retirer ou remplacer pour passer de a a b. */
function distance(a: string, b: string): number {
  let precedente = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const courante = [i];
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      courante[j] = Math.min((precedente[j] ?? 0) + 1, (courante[j - 1] ?? 0) + 1, (precedente[j - 1] ?? 0) + cout);
    }
    precedente = courante;
  }
  return precedente[b.length] ?? 0;
}

/** « camille@gmial.com » → « camille@gmail.com » ; rien si le domaine est connu ou trop différent. */
function suggestionAdresse(adresse: string): string | null {
  const [local, domaine] = adresse.trim().toLowerCase().split("@");
  if (!local || !domaine || !domaine.includes(".")) return null;
  if (DOMAINES_COURANTS.includes(domaine)) return null;
  let meilleur: string | null = null;
  let ecart = 3;
  for (const connu of DOMAINES_COURANTS) {
    const e = distance(domaine, connu);
    if (e < ecart) { ecart = e; meilleur = connu; }
  }
  return meilleur ? `${local}@${meilleur}` : null;
}

// Checkout invité — le §14 du prompt : « demander uniquement les informations nécessaires ».
// Prénom/nom et e-mail, rien d'autre. Pas de mot de passe, pas de compte, pas d'adresse : une
// photo se télécharge, elle ne se livre pas.
//
// L'e-mail sert à trois choses, et l'écran le dit plutôt que de le faire deviner : recevoir le
// lien de téléchargement, retrouver la commande plus tard, et la rattacher à un compte Connect si
// le client en crée un. C'est aussi pour ça qu'on ne le rend pas facultatif.

export function GalleryCheckout({
  slug,
  token,
  password,
  offerId,
  assetIds,
  libelle,
  totalCents,
  currency,
  onClose,
}: {
  slug: string;
  token: string;
  password?: string;
  /** L'offre choisie. Le serveur revérifie qu'elle appartient bien à ce lien. */
  offerId?: string | null;
  /** Vide quand le lien vend une formule : le prix ne dépend alors pas de la sélection, et pour un
   * pack l'acheteur n'a encore rien choisi. C'est le serveur qui retrouve ce qui est vendu. */
  assetIds: string[];
  /** Ce que l'acheteur voit résumé au-dessus du bouton : « Galerie complète », « 5 photos au
   * choix », « 3 photos »… Calculé par l'appelant, qui sait dans quel parcours on est. */
  libelle: string;
  totalCents: number;
  currency: string;
  onClose: () => void;
}) {
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValide = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const identiques = email.trim().toLowerCase() === confirmation.trim().toLowerCase();
  // On ne signale la difference qu'une fois la confirmation assez avancee : afficher « les adresses
  // ne correspondent pas » des la premiere lettre tapee serait un reproche, pas une aide.
  const differenceVisible = confirmation.trim().length > 0 &&
    (confirmation.trim().length >= email.trim().length || confirmation.includes("@") && confirmation.includes("."))
    && !identiques;
  const suggestion = emailValide ? suggestionAdresse(email) : null;
  const pret = nom.trim().length >= 2 && emailValide && identiques;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pret || busy) return;
    setBusy(true);
    setError(null);
    const result = await startGalleryCheckout(createClient(), {
      slug,
      token,
      password: password ?? null,
      offerId: offerId ?? null,
      assetIds,
      email: email.trim(),
      nom: nom.trim(),
    });
    if ("error" in result) {
      setError(result.error);
      setBusy(false);
      return;
    }
    // Redirection pleine page vers Stripe : jamais un iframe, comme partout ailleurs dans le
    // projet (la CSP n'autorise aucun domaine Stripe en frame-src, et c'est voulu).
    window.location.href = result.url;
  }

  return (
    // Le voile ne ferme PAS le formulaire : seule la croix le fait. Signale par Fouka le
    // 10/09/2026, en payant depuis son iPhone : « quand j'ecris mon mail, ca me quitte ». Deux
    // causes s'additionnaient. Les champs etaient en 14 px, et Safari iOS zoome sur tout champ en
    // dessous de 16 px : l'ecran se decalait sous le doigt. Et ce voile fermait tout au moindre
    // clic : le toucher suivant — une suggestion d'adresse du clavier, un curseur replace — tombait
    // dessus. Resultat, un parent perdait sa saisie au moment de payer. C'est la regle deja posee
    // pour les modales de Club+ : sur un formulaire, un clic maladroit qui efface la saisie est
    // pire que pas de raccourci du tout.
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60">
      <form
        onSubmit={submit}
        className="w-full max-w-[520px] rounded-t-sv-card border-t border-border-strong bg-bg-elevated px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-sora text-[17px] font-extrabold tracking-tight">Vos coordonnées</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-10 w-10 items-center justify-center rounded-full text-[18px] leading-none text-text-tertiary hover:bg-surface-hover"
          >
            ✕
          </button>
        </div>

        <p className="mb-4 text-[12.5px] leading-relaxed text-text-tertiary">
          Vos photos vous seront envoyées à cette adresse. Aucun compte n&apos;est nécessaire.
        </p>

        <label htmlFor="co-nom" className="mb-1 block text-[11px] font-bold uppercase tracking-[.04em] text-text-label">
          Prénom et nom
        </label>
        <input
          id="co-nom"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          autoComplete="name"
          className="mb-3 w-full rounded-sv border border-border-strong bg-surface px-4 py-3 text-[16px] outline-none focus:border-white/35"
          placeholder="Camille Martin"
        />

        <label htmlFor="co-email" className="mb-1 block text-[11px] font-bold uppercase tracking-[.04em] text-text-label">
          Adresse e-mail
        </label>
        <input
          id="co-email"
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="w-full rounded-sv border border-border-strong bg-surface px-4 py-3 text-[16px] outline-none focus:border-white/35"
          placeholder="camille@exemple.fr"
        />

        {suggestion && (
          <button
            type="button"
            onClick={() => setEmail(suggestion)}
            className="mt-1.5 text-left text-[12.5px] text-text-secondary underline underline-offset-2"
          >
            Vouliez-vous dire <strong className="font-semibold text-text">{suggestion}</strong> ?
          </button>
        )}

        <label htmlFor="co-email-confirmation" className="mb-1 mt-3 block text-[11px] font-bold uppercase tracking-[.04em] text-text-label">
          Confirmez l&apos;adresse e-mail
        </label>
        <input
          id="co-email-confirmation"
          type="email"
          inputMode="email"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          // Pas de saisie automatique ici : le navigateur reproduirait la meme adresse, faute
          // comprise, et la confirmation ne confirmerait plus rien.
          autoComplete="off"
          aria-invalid={differenceVisible}
          aria-describedby={differenceVisible ? "co-email-difference" : undefined}
          className={`w-full rounded-sv border bg-surface px-4 py-3 text-[16px] outline-none focus:border-white/35 ${
            differenceVisible ? "border-danger" : "border-border-strong"
          }`}
          placeholder="Retapez votre adresse"
        />
        {differenceVisible && (
          <p id="co-email-difference" className="mt-1.5 text-[12.5px] font-semibold text-danger">
            Les deux adresses ne correspondent pas. Vos photos seront envoyées à cette adresse :
            vérifiez-la lettre par lettre.
          </p>
        )}

        {error && <p className="mt-3 text-[12.5px] font-semibold text-danger">{error}</p>}

        <div className="mt-4 flex items-center justify-between border-t border-border pt-3.5">
          <span className="text-[13px] text-text-secondary">{libelle}</span>
          <span className="font-sora text-[20px] font-extrabold tabular-nums">
            {formatMontant(totalCents, currency)}
          </span>
        </div>

        <button
          type="submit"
          disabled={!pret || busy}
          className="mt-4 w-full rounded-sv-pill bg-sv-gradient py-3.5 text-[14.5px] font-bold text-white disabled:opacity-50"
        >
          {busy ? "Redirection vers le paiement…" : "Payer"}
        </button>
        <p className="mt-2 text-center text-[11px] leading-relaxed text-text-faint">
          Paiement sécurisé par Stripe. Téléchargement immédiat après paiement, disponible 30 jours.
        </p>
      </form>
    </div>
  );
}
