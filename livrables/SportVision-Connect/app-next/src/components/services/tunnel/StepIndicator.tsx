import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { TUNNEL_STEPS } from "./types";

export function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2">
      {TUNNEL_STEPS.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex h-7 w-7 flex-none items-center justify-center rounded-full text-[12px] font-extrabold transition-colors duration-sv",
                done && "bg-gradient-to-br from-brand-blue to-brand-violet text-white",
                active && !done && "border-2 border-brand-blue text-brand-blue",
                !active && !done && "border border-border-strong text-text-faint",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : step}
            </span>
            <span
              className={cn(
                "hidden text-[12px] font-bold sm:block",
                active || done ? "text-text" : "text-text-faint",
              )}
            >
              {label}
            </span>
            {step < TUNNEL_STEPS.length && <span className="h-px flex-1 bg-border" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
