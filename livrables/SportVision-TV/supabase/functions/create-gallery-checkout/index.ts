// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// create-gallery-checkout → coller ce code → Deploy.
//
// Supabase Edge Function — create-gallery-checkout
// 07/09/2026, chantier Galeries SportVision (Lot 3) : paiement d'une sélection de photos depuis
// une galerie publique, SANS COMPTE.
//
// ── Ce qui la distingue de create-guest-media-checkout ──
// L'ancienne fonction invité vend UN produit à UN bénéficiaire déjà connu, via un jeton que le
// staff génère à la main pour une famille précise. Ici il n'y a ni produit unique (un panier de
// 5 photos peut se payer en pack), ni bénéficiaire (un parent qui ouvre un lien WhatsApp n'est
// rattaché à aucun joueur). Elle ne pouvait donc pas être réutilisée telle quelle, et elle n'est
// pas modifiée : son parcours continue de fonctionner sans changement.
//
// ── Le point qui compte : le prix ne vient JAMAIS du client ──
// Le corps de la requête ne contient aucun montant. La fonction appelle media_gallery_quote(),
// qui revalide le jeton du lien, revérifie que chaque photo appartient bien à cette galerie et
// est bien publiable, puis recalcule le total avec les mêmes règles que la grille affichée à
// l'écran. Un client qui posterait sa propre requête ne peut ni choisir son prix, ni acheter les
// photos d'une autre galerie.
//
// media_download_grants n'est PAS écrit ici : c'est le webhook Stripe qui l'écrit, une fois le
// paiement réellement confirmé (même principe que media_entitlements pour le Pass Photo).
//
// Secrets requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, CONNECT_URL

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
/** Une galerie de 1 000 photos reste achetable, mais une requête qui en réclame davantage est du
 * bruit ou une tentative d'épuisement : on la refuse avant de faire travailler la base. */
const MAX_PHOTOS = 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Même RPC que create-guest-media-checkout et les autres fonctions publiques du projet : la
// limitation de débit est un mécanisme déjà en place, il n'y en a pas deux.
// deno-lint-ignore no-explicit-any
async function checkRateLimit(admin: any, identifiant: string): Promise<boolean> {
  const { data, error } = await admin.rpc("check_and_record_rate_limit", {
    p_identifiant: identifiant,
    p_max: RATE_LIMIT_MAX,
    p_window_seconds: RATE_LIMIT_WINDOW_MS / 1000,
  });
  if (error) return false;
  return data === true;
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
    const slug: string = (body.slug || "").trim();
    const token: string = (body.token || "").trim();
    const password: string | null = body.password ? String(body.password) : null;
    const email: string = (body.email || "").trim().toLowerCase();
    const nom: string = (body.nom || "").trim();
    const assetIds: string[] = Array.isArray(body.assetIds) ? body.assetIds : [];

    if (!slug || !token) return json({ error: "Lien de galerie manquant." }, 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "Adresse e-mail invalide." }, 400);
    if (nom.length < 2) return json({ error: "Merci d'indiquer votre nom." }, 400);
    if (assetIds.length === 0) return json({ error: "Aucune photo sélectionnée." }, 400);
    if (assetIds.length > MAX_PHOTOS) return json({ error: "Sélection trop grande." }, 400);
    // Filtrage de forme avant d'envoyer quoi que ce soit à la base : un identifiant mal formé
    // ferait échouer la requête entière avec une erreur technique illisible pour l'utilisateur.
    if (!assetIds.every((id) => typeof id === "string" && UUID_RE.test(id))) {
      return json({ error: "Sélection invalide." }, 400);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "inconnu";
    if (!(await checkRateLimit(admin, `gallery_checkout:${ip}`))) {
      return json({ error: "Trop de tentatives. Réessayez dans une heure." }, 429);
    }

    // ── LE prix, calculé en base et nulle part ailleurs ────────────────────────────────────
    const { data: quoteRows, error: quoteError } = await admin.rpc("media_gallery_quote", {
      p_slug: slug,
      p_token: token,
      p_asset_ids: assetIds,
      p_password: password,
    });
    const quote = Array.isArray(quoteRows) ? quoteRows[0] : quoteRows;
    if (quoteError) {
      console.error("[create-gallery-checkout] media_gallery_quote :", quoteError);
      return json({ error: "Impossible de calculer le prix de votre sélection." }, 500);
    }
    if (!quote || !quote.total_cents) {
      // Lien invalide, galerie dépubliée, photos retirées entre-temps, ou galerie qui ne vend
      // rien. On ne détaille pas : le visiteur n'a rien à apprendre de plus, et détailler
      // renseignerait quelqu'un qui teste des jetons.
      return json({ error: "Cette sélection n'est plus disponible à l'achat." }, 409);
    }

    const validIds: string[] = quote.valid_asset_ids ?? [];
    const totalCents: number = quote.total_cents;
    const currency: string = quote.currency || "eur";
    const lines: { product_id: string; unit_price_cents: number; quantity: number; covers_photos: number }[] =
      quote.lines ?? [];

    // ── Commande ──────────────────────────────────────────────────────────────────────────
    const { data: order, error: orderError } = await admin
      .from("media_orders")
      .insert({
        club_id: quote.club_id,
        album_id: quote.album_id,
        guest_email: email,
        guest_name: nom,
        amount_cents: totalCents,
        currency,
        status: "pending",
      })
      .select("id")
      .single();
    if (orderError || !order) {
      console.error("[create-gallery-checkout] media_orders :", orderError);
      return json({ error: "Impossible d'enregistrer votre commande." }, 500);
    }

    // Une ligne par photo achetée : c'est elle qui donnera le droit de télécharger CETTE photo.
    // Le produit et le prix unitaire sont recopiés depuis le devis, jamais relus plus tard — un
    // tarif qui change en cours de saison ne doit pas réécrire une vente passée.
    const perPhotoProduct = lines[0]?.product_id ?? null;
    const items = validIds.map((assetId) => ({
      order_id: order.id,
      product_id: perPhotoProduct,
      asset_id: assetId,
      album_id: quote.album_id,
      // Le prix se porte sur la commande, pas sur chaque photo : une combinaison pack + unité ne
      // se répartit pas photo par photo sans mentir. 0 ici, le montant réel est sur media_orders.
      unit_price_cents: 0,
      quantity: 1,
    }));

    // L'album complet donne droit à TOUTES les photos, pas seulement à la sélection : c'est ce
    // que le client a acheté et ce que l'écran lui a annoncé.
    if (quote.whole_album) {
      const { data: allAssets } = await admin
        .from("media_assets")
        .select("id")
        .eq("album_id", quote.album_id)
        .eq("status", "ready");
      const already = new Set(validIds);
      for (const a of (allAssets ?? []) as { id: string }[]) {
        if (!already.has(a.id)) {
          items.push({
            order_id: order.id,
            product_id: perPhotoProduct,
            asset_id: a.id,
            album_id: quote.album_id,
            unit_price_cents: 0,
            quantity: 1,
          });
        }
      }
    }

    const { error: itemsError } = await admin.from("media_order_items").insert(items);
    if (itemsError) {
      console.error("[create-gallery-checkout] media_order_items :", itemsError);
      await admin.from("media_orders").delete().eq("id", order.id);
      return json({ error: "Impossible d'enregistrer votre commande." }, 500);
    }

    // ── Paiement ──────────────────────────────────────────────────────────────────────────
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2023-10-16" });
    const connectUrl = Deno.env.get("CONNECT_URL") ?? "https://connect.sportvision-an.fr";
    const { data: album } = await admin
      .from("media_albums")
      .select("title, clubs(nom)")
      .eq("id", quote.album_id)
      .maybeSingle();
    type AlbumRow = { title: string; clubs: { nom: string } | { nom: string }[] | null };
    const a = album as AlbumRow | null;
    const clubNom = Array.isArray(a?.clubs) ? a?.clubs[0]?.nom : a?.clubs?.nom;

    const photoCount = quote.whole_album ? items.length : validIds.length;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [{
        price_data: {
          currency,
          unit_amount: totalCents,
          product_data: {
            name: `${a?.title ?? "Galerie"} — ${photoCount} photo${photoCount > 1 ? "s" : ""}`,
            description: clubNom ? `Photographies SportVision · ${clubNom}` : "Photographies SportVision",
          },
        },
        quantity: 1,
      }],
      // Le jeton de téléchargement n'existe pas encore (il naîtra dans le webhook) : on renvoie
      // vers la page de commande, qui le retrouve par l'identifiant de commande.
      success_url: `${connectUrl}/gallery/commande?order=${order.id}&paiement=succes`,
      cancel_url: `${connectUrl}/gallery/${slug}?k=${encodeURIComponent(token)}&paiement=annule`,
      // `product` distingue cette session de toutes les autres dans le webhook. order_id porte
      // tout le reste : rien n'est redupliqué dans les metadata Stripe.
      metadata: { product: "gallery_order", order_id: order.id },
    });

    if (!session.url) return json({ error: "Le paiement n'a pas pu démarrer." }, 500);
    return json({ url: session.url });
  } catch (e) {
    console.error("[create-gallery-checkout] erreur inattendue :", e);
    return json({ error: "Une erreur est survenue. Réessayez dans un instant." }, 500);
  }
});
