"use client";

import { useState } from "react";

// Contenu figé, repris tel quel du prototype (Connect Espace Joueur.dc.html, helpFaq) —
// voir le commentaire de page.tsx.
const FAQ: { q: string; a: string }[] = [
  {
    q: "Quand mes contenus arrivent-ils ?",
    a: "Dès que SportVision les met à disposition, ils apparaissent dans Mes contenus et vous recevez une notification.",
  },
  {
    q: "Comment fonctionne une cotisation ?",
    a: "Vous créez une cotisation depuis une prestation, vous partagez le lien, et chaque coéquipier participe. La prestation est financée dès que l'objectif est atteint.",
  },
  {
    q: "Mon club n'est pas sur SportVision, puis-je utiliser Connect ?",
    a: "Oui. Vous pouvez ajouter votre club comme club déclaré et utiliser Connect normalement.",
  },
  {
    q: "Puis-je quitter une affiliation ?",
    a: "Oui, depuis la fiche de l'affiliation. Votre compte et vos contenus personnels sont conservés.",
  },
];

export function AideFaq() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div id="faq" className="flex scroll-mt-20 flex-col gap-2.5">
      <h2 className="font-sora text-[18px] font-semibold tracking-tight">Questions fréquentes</h2>
      <div className="flex flex-col gap-2.5">
        {FAQ.map((f, i) => {
          const isOpen = open === i;
          return (
            <button
              key={f.q}
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              className="flex flex-col gap-2 rounded-sv border border-border bg-surface px-[17px] py-[15px] text-left transition-colors duration-150 hover:bg-surface-hover"
            >
              <span className="flex items-center gap-3">
                <span className="text-[14px] font-medium">{f.q}</span>
                <span className="material-symbols-rounded ml-auto flex-none !text-[20px] text-text-faint" aria-hidden="true">
                  {isOpen ? "remove" : "add"}
                </span>
              </span>
              {isOpen && <span className="text-[13px] leading-relaxed text-text-tertiary">{f.a}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
