"use client";

// Modale d'édition générique — voir design-connect-personnel-12-08/README.md § Mon profil.
// Même patron que la modale de confirmation déjà en place (affiliations/LeaveAffiliationButton.tsx) :
// voile plein écran, clic dehors = fermeture (sauf pendant une sauvegarde), Échap non géré ici
// volontairement (formulaires courts, la fermeture au clic suffit et évite une perte de saisie
// accidentelle sur un champ texte).

export function EditModal({
  title,
  subtitle,
  onClose,
  busy,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/66 p-4 animate-sv-fade"
      onClick={() => !busy && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-[480px] flex-col gap-5 overflow-y-auto rounded-sv-modal border border-border bg-bg-elevated p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-sora text-[19px] font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex h-8 w-8 flex-none items-center justify-center rounded-sv text-text-tertiary hover:bg-white/5 hover:text-text"
              aria-label="Fermer"
            >
              <span className="material-symbols-rounded !text-[20px]" aria-hidden="true">close</span>
            </button>
          </div>
          {subtitle && <p className="text-[14px] leading-relaxed text-text-tertiary lg:text-[13px]">{subtitle}</p>}
        </div>

        {children}

        {error && (
          <div className="flex items-start gap-2.5 rounded-sv border border-danger-border bg-danger-bg px-4 py-3.5">
            <span className="material-symbols-rounded !text-[19px] text-danger" aria-hidden="true">error</span>
            <span className="text-[14px] leading-relaxed text-[#FBCFE8] lg:text-[13px]">{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
