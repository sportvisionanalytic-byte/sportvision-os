"use server";

import { cookies } from "next/headers";
import { ACTIVE_SPACE_COOKIE, spaceKey, type Space } from "./session";

/** Remplace localStorage.svc_space_key (app vanilla) — mémorise l'espace actif côté serveur. */
export async function switchActiveSpace(space: Pick<Space, "kind" | "id">): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_SPACE_COOKIE, spaceKey(space), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
