// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
//
// Supabase Edge Function — gallery-download
// 07/09/2026, chantier Galeries SportVision (Lot 3) : remise des fichiers ACHETÉS.
//
// C'est le seul endroit de tout l'écosystème qui produit une URL vers un original de galerie.
// Trois raisons d'être ici plutôt que dans une route Next :
//   * signer une URL de bucket privé demande la clé de service, qui vit déjà chez Supabase — la
//     dupliquer côté Netlify multiplierait les endroits où elle peut fuiter ;
//   * le webhook qui crée le droit est au même endroit ;
//   * une signature courte (5 minutes) doit être émise au clic, jamais pré-calculée dans une page.
//
// Le jeton EST le droit. Il n'est jamais lisible depuis une table : media_download_grants n'a
// aucune policy de lecture pour un humain, et cette fonction revérifie à CHAQUE appel que la
// commande est payée, que le droit n'a pas expiré, et que la photo demandée fait bien partie de
// cette commande. Détenir le jeton d'une commande ne donne accès qu'à ses photos.
//
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** 5 minutes : le temps de cliquer et que le fichier parte. Assez court pour qu'une URL recopiée
 * dans une conversation ne serve plus à rien quelques minutes plus tard. */
const SIGNED_URL_TTL = 300;

/** Fenêtre pendant laquelle l'identifiant de commande, présent dans l'URL de retour de Stripe,
 * peut être échangé contre le vrai jeton de téléchargement. Passé ce délai, seul le jeton reçu
 * par e-mail fonctionne — l'identifiant de commande cesse d'être une clé. */
const ORDER_EXCHANGE_WINDOW_MINUTES = 120;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const body = await req.json().catch(() => ({}));

    // ── Échange identifiant de commande → jeton, juste après le paiement ──────────────────
    // Stripe nous ramène avec l'identifiant de commande dans l'URL, pas avec le jeton (qui
    // n'existait pas encore au moment de créer la session). On l'échange une fois, dans une
    // fenêtre courte.
    if (body.orderId) {
      const { data: grant } = await admin
        .from("media_download_grants")
        .select("token, media_orders!inner(status, paid_at)")
        .eq("order_id", String(body.orderId))
        .maybeSingle();
      type GrantRow = { token: string; media_orders: { status: string; paid_at: string | null } | { status: string; paid_at: string | null }[] };
      const g = grant as GrantRow | null;
      const order = Array.isArray(g?.media_orders) ? g?.media_orders[0] : g?.media_orders;
      if (!g || !order || order.status !== "paid" || !order.paid_at) {
        // Le webhook Stripe peut avoir quelques secondes de retard sur la redirection : ce n'est
        // pas une erreur, c'est une attente. La page réessaie.
        return json({ pending: true }, 202);
      }
      const ageMinutes = (Date.now() - new Date(order.paid_at).getTime()) / 60000;
      if (ageMinutes > ORDER_EXCHANGE_WINDOW_MINUTES) {
        return json({ error: "Ce lien de retour a expiré. Utilisez celui reçu par e-mail." }, 410);
      }
      return json({ token: g.token });
    }

    const token: string = (body.token || "").trim();
    const assetId: string = (body.assetId || "").trim();

    // ── Chemin CONNECT : l'acheteur est connecté, il n'a pas de jeton sous la main ─────────
    // Depuis « Mes galeries », le navigateur ne connaît pas le jeton de la commande qui couvre
    // cette photo — et il n'a pas à le connaître. On identifie l'appelant par sa session, puis on
    // vérifie que l'une de SES commandes payées contient bien cette photo. Le contrôle est le
    // même que pour un invité, seule la façon de prouver qui on est change.
    if (!token && assetId) {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!jwt) return json({ error: "Requête incomplète." }, 400);

      const { data: { user } } = await admin.auth.getUser(jwt);
      if (!user) return json({ error: "Connectez-vous pour télécharger cette photo." }, 401);

      const { data: possede } = await admin
        .from("media_order_items")
        .select("asset_id, media_orders!inner(purchased_by_user_id, status)")
        .eq("asset_id", assetId)
        .eq("media_orders.purchased_by_user_id", user.id)
        .eq("media_orders.status", "paid")
        .limit(1)
        .maybeSingle();
      if (!possede) return json({ error: "Cette photo ne fait pas partie de vos achats." }, 403);

      const { data: a } = await admin
        .from("media_assets")
        .select("storage_bucket, original_path, original_filename")
        .eq("id", assetId)
        .maybeSingle();
      if (!a?.original_path) return json({ error: "Fichier introuvable." }, 404);

      // Signature de cinq minutes, comme partout ailleurs : un droit permanent n'est PAS une URL
      // permanente, c'est le droit d'en redemander une.
      const { data: sig, error: sigErr } = await admin.storage
        .from((a.storage_bucket as string) || "sportvision-media-prive")
        .createSignedUrl(a.original_path as string, SIGNED_URL_TTL, {
          download: (a.original_filename as string) || "photo.jpg",
        });
      if (sigErr || !sig?.signedUrl) {
        console.error("[gallery-download] signature Connect impossible :", sigErr);
        return json({ error: "Téléchargement momentanément indisponible." }, 500);
      }
      return json({ url: sig.signedUrl });
    }

    // ── Signature d'un original acheté, par jeton (invité) ─────────────────────────────────
    if (!token || !assetId) return json({ error: "Requête incomplète." }, 400);

    const { data: grant } = await admin
      .from("media_download_grants")
      .select("id, order_id, expires_at, claimed_by_user_id, download_count, max_downloads")
      .eq("token", token)
      .maybeSingle();
    if (!grant) return json({ error: "Lien de téléchargement invalide." }, 404);

    if (grant.expires_at && new Date(grant.expires_at as string).getTime() < Date.now()) {
      // Un droit expire et un droit REVOQUE par remboursement se ressemblent en base (les deux ont
      // une date passee), mais ne se disent pas pareil. Inviter quelqu'un qu'on vient de rembourser
      // a « creer un compte pour retrouver ses photos » est faux : il ne les aura pas, et il
      // ecrira au support en croyant a un bug.
      const { data: cmd } = await admin
        .from("media_orders")
        .select("status")
        .eq("id", grant.order_id as string)
        .maybeSingle();
      if (cmd?.status === "refunded") {
        return json({
          error: "Cette commande a été remboursée. L'accès aux photos a été retiré.",
          refunded: true,
        }, 410);
      }
      return json({
        error: "Ce lien a expiré. Créez votre compte SportVision Connect pour retrouver vos photos.",
        expired: true,
      }, 410);
    }
    if (grant.max_downloads && (grant.download_count as number) >= (grant.max_downloads as number)) {
      return json({ error: "Nombre de téléchargements atteint." }, 429);
    }

    const { data: order } = await admin
      .from("media_orders")
      .select("id, status")
      .eq("id", grant.order_id as string)
      .maybeSingle();
    if (!order || order.status !== "paid") return json({ error: "Cette commande n'est pas payée." }, 402);

    // La photo demandée doit appartenir À CETTE commande. Sans cette vérification, un jeton
    // valide permettrait de télécharger n'importe quelle photo de n'importe quelle galerie.
    const { data: item } = await admin
      .from("media_order_items")
      .select("asset_id")
      .eq("order_id", order.id)
      .eq("asset_id", assetId)
      .maybeSingle();
    if (!item) return json({ error: "Cette photo ne fait pas partie de votre commande." }, 403);

    const { data: asset } = await admin
      .from("media_assets")
      .select("storage_bucket, original_path, original_filename")
      .eq("id", assetId)
      .maybeSingle();
    if (!asset?.original_path) return json({ error: "Fichier introuvable." }, 404);

    const { data: signed, error: signError } = await admin.storage
      .from((asset.storage_bucket as string) || "sportvision-media-prive")
      .createSignedUrl(asset.original_path as string, SIGNED_URL_TTL, {
        download: (asset.original_filename as string) || "photo.jpg",
      });
    if (signError || !signed?.signedUrl) {
      console.error("[gallery-download] signature impossible :", signError);
      return json({ error: "Téléchargement momentanément indisponible." }, 500);
    }

    // Compteur informatif (combien de fois le client a récupéré ses fichiers) : il ne bloque rien
    // tant que max_downloads est NULL, ce qui est le cas par défaut. Un parent qui télécharge deux
    // fois parce que son téléphone a coupé ne doit pas se retrouver bloqué.
    await admin
      .from("media_download_grants")
      .update({ download_count: (grant.download_count as number) + 1 })
      .eq("id", grant.id as string);

    return json({ url: signed.signedUrl });
  } catch (e) {
    console.error("[gallery-download] erreur inattendue :", e);
    return json({ error: "Une erreur est survenue." }, 500);
  }
});
