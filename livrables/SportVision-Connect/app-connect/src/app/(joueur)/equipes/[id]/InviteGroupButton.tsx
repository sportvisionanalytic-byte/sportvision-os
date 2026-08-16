"use client";

import { useState } from "react";

// Modale d'invitation — voir design-connect-personnel-12-08/README.md § Mes équipes. Le lien
// pointe vers /equipes/rejoindre/[id] : rejoindre est un simple insert (RLS "ugm_self_insert",
// migration-connect-v50) déclenché sur cette page, cohérent avec la copie du design
// ("Toute personne avec ce lien peut rejoindre le groupe.").
export function InviteGroupButton({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const link = typeof window !== "undefined" ? `${window.location.origin}/equipes/rejoindre/${groupId}` : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible (permissions navigateur) — le lien reste affiché et
      // sélectionnable manuellement, pas d'erreur bloquante pour si peu.
    }
  }

  function shareWhatsapp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(`Rejoins « ${groupName} » sur SportVision Connect : ${link}`)}`, "_blank");
  }

  async function shareNative() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Rejoindre ${groupName}`, url: link });
      } catch {
        // Partage annulé par l'utilisateur — rien à faire.
      }
    } else {
      copyLink();
    }
  }

  function shareEmail() {
    window.location.href = `mailto:?subject=${encodeURIComponent(`Rejoins « ${groupName} » sur SportVision Connect`)}&body=${encodeURIComponent(link)}`;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-[46px] items-center gap-2 rounded-sv bg-sv-gradient px-[18px] font-sora text-[14px] font-semibold text-white hover:brightness-[1.12]"
      >
        <span className="material-symbols-rounded !text-[19px]">person_add</span>
        Inviter
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex w-full max-w-[460px] flex-col gap-[18px] rounded-sv-modal border border-border bg-bg-elevated p-[22px] shadow-[0_30px_70px_-20px_rgba(0,0,0,.75)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-sora text-[19px] font-semibold tracking-tight">Inviter dans {groupName}</span>
                <span className="text-[13px] text-text-tertiary">Toute personne avec ce lien peut rejoindre le groupe.</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto flex h-10 w-10 flex-none items-center justify-center rounded-sv bg-white/[.06] text-text-secondary hover:bg-white/[.12]"
              >
                <span className="material-symbols-rounded !text-[20px]">close</span>
              </button>
            </div>

            <div className="flex items-center gap-2.5 rounded-sv border border-border-strong bg-surface px-4 py-3.5">
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12px] text-text-secondary">
                {link}
              </span>
              <button
                type="button"
                onClick={copyLink}
                className="flex h-9 flex-none items-center gap-1.5 rounded-sv bg-white/[.09] px-3.5 font-sora text-[13px] font-semibold hover:bg-white/[.16]"
              >
                <span className="material-symbols-rounded !text-[17px]">{copied ? "check" : "content_copy"}</span>
                {copied ? "Copié" : "Copier"}
              </button>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={shareWhatsapp}
                className="flex h-[52px] items-center justify-center gap-2 rounded-sv bg-sv-gradient font-sora text-[15px] font-semibold text-white hover:brightness-[1.12]"
              >
                <span className="material-symbols-rounded !text-[20px]">chat</span>
                Partager sur WhatsApp
              </button>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={shareNative}
                  className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-sv border border-border-strong bg-white/[.06] font-sora text-[14px] font-semibold hover:bg-white/[.12]"
                >
                  <span className="material-symbols-rounded !text-[19px]">ios_share</span>
                  Partager
                </button>
                <button
                  type="button"
                  onClick={shareEmail}
                  className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-sv border border-border-strong bg-white/[.06] font-sora text-[14px] font-semibold hover:bg-white/[.12]"
                >
                  <span className="material-symbols-rounded !text-[19px]">mail</span>
                  E-mail
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
