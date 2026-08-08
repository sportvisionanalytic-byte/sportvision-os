import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-sv-card border border-border bg-surface shadow-sv-card transition-[transform,box-shadow,border-color] duration-sv",
        className,
      )}
      {...props}
    />
  );
}

export function CardPremium({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-sv-panel p-5 text-white",
        "bg-[linear-gradient(135deg,#111735_0%,#1B2A6B_55%,#4A1E9E_100%)]",
        className,
      )}
      {...props}
    />
  );
}
