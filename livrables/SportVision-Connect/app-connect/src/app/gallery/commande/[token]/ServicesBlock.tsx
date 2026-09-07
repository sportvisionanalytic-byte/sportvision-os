import Link from "next/link";
import { SERVICES_SPORTVISION } from "@/lib/gallery/services";

// « Découvrez aussi SportVision », tout en bas de la page de commande.
//
// Après les photos et après Connect, jamais avant : quelqu'un qui vient de payer doit d'abord
// obtenir ce qu'il a acheté. Ce bloc est une porte ouverte, pas une relance.
//
// Les services viennent d'une configuration unique (lib/gallery/services.ts) et non de textes
// écrits en dur ici : le jour où SportVision veut en ajouter un, en changer l'ordre ou en retirer
// un, il y a un seul endroit à modifier — et cette configuration pourra plus tard venir de l'OS
// sans toucher à cet écran.

export function ServicesBlock() {
  const services = SERVICES_SPORTVISION.filter((s) => s.actif);
  if (services.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="font-sora text-[15px] font-extrabold tracking-tight">Découvrez aussi SportVision</h2>
      <div className="mt-3 flex flex-col gap-2">
        {services.map((s) => (
          <Link
            key={s.id}
            href={s.href}
            className="flex items-center justify-between gap-3 rounded-sv border border-border bg-surface px-4 py-3.5 transition hover:bg-surface-hover"
          >
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold">{s.titre}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-text-tertiary">{s.texte}</span>
            </span>
            <span className="flex-none text-[13px] text-text-faint" aria-hidden>
              →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
