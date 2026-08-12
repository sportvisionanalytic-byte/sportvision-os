// Classes partagées entre les 7 écrans d'inscription — reprend exactement les tokens utilisés
// par src/app/auth/login/page.tsx pour rester visuellement cohérent avec les écrans d'accès.

export const inputClass =
  "h-[46px] w-full rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";

export const textareaClass =
  "min-h-[110px] w-full resize-none rounded-xl border border-border-strong bg-input-bg px-3.5 py-3 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";

export const selectClass =
  "h-[46px] w-full rounded-xl border border-border-strong bg-input-bg px-3.5 text-[14px] outline-none focus-visible:border-brand-blue focus-visible:ring-4 focus-visible:ring-[rgba(36,84,255,.12)]";
