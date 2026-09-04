"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

// QR réel (migration-clubplus-v57 côté data, 03/09/2026) — encode uniquement le Smart Link
// (aucune donnée personnelle, voir buildJoinUrl dans data/club/invite-links.ts). Génération
// client-side en data URI, pas d'appel réseau externe.
export function QrCode({ value, size = 176 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size, margin: 1, color: { dark: "#0B0B12", light: "#FFFFFF" } })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) {
    return <div className="animate-pulse rounded-lg bg-surface-sunken" style={{ width: size, height: size }} aria-hidden />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={dataUrl} alt="QR code d'invitation" width={size} height={size} className="rounded-lg border border-border-strong bg-white p-2" />;
}
