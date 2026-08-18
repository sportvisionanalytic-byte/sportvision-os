"use client";

import { useState } from "react";

export function ShareFundingButtons({ shareToken, titre }: { shareToken: string; titre: string }) {
  const [copied, setCopied] = useState(false);
  const link = typeof window !== "undefined" ? `${window.location.origin}/cotisation/${shareToken}` : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // presse-papiers indisponible — lien affiché sur la page publique, pas bloquant.
    }
  }

  async function shareNative() {
    if (navigator.share) {
      try {
        await navigator.share({ title: titre, url: link });
        return;
      } catch {
        return;
      }
    }
    copyLink();
  }

  return (
    <>
      <button
        type="button"
        onClick={shareNative}
        className="flex h-[50px] items-center gap-2 rounded-sv bg-sv-gradient px-5 font-sora text-[15px] font-semibold text-white hover:brightness-[1.12]"
      >
        <span className="material-symbols-rounded !text-[19px]" aria-hidden="true">ios_share</span>
        Partager le paiement collectif
      </button>
      <button
        type="button"
        onClick={copyLink}
        className="flex h-[50px] items-center gap-2 rounded-sv border border-border-strong bg-white/[.06] px-[18px] font-sora text-[15px] font-semibold hover:bg-white/[.12]"
      >
        <span className="material-symbols-rounded !text-[19px]" aria-hidden="true">{copied ? "check" : "content_copy"}</span>
        {copied ? "Copié" : "Copier le lien"}
      </button>
    </>
  );
}
