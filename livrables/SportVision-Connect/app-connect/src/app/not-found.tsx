import Link from "next/link";

// Sans ce fichier, tout appel à `notFound()` (cotisation/[token], prestations/[id], équipes/[id],
// sportifs/[kind]/[id]...) retombe sur la page 404 par défaut de Next.js — en anglais, hors design
// system. Reprend le pattern visuel des cartes d'état vide/erreur déjà utilisé partout ailleurs
// (voir prestations/[id]/reserver/page.tsx) plutôt que d'inventer un nouveau style.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-5 py-10">
      <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 rounded-sv-card border border-dashed border-border-strong bg-surface p-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-sv bg-affiliations-bg">
          <span className="material-symbols-rounded !text-[24px] text-affiliations" aria-hidden="true">search_off</span>
        </span>
        <span className="font-sora text-[18px] font-semibold">Page introuvable</span>
        <p className="text-[14px] leading-relaxed text-text-tertiary">
          Ce contenu n&apos;existe pas ou n&apos;est plus disponible. Vérifiez le lien ou revenez à l&apos;accueil.
        </p>
        <Link href="/" className="rounded-sv bg-sv-gradient px-4 py-2.5 font-sora text-[14px] font-semibold text-white">
          Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  );
}
