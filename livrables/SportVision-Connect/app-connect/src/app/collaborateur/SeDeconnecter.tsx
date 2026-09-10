"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SeDeconnecter() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await createClient().auth.signOut({ scope: "local" });
        router.push("/auth/login");
        router.refresh();
      }}
      className="text-[13px] font-semibold text-text-tertiary underline-offset-2 hover:underline"
    >
      Se déconnecter de Connect
    </button>
  );
}
