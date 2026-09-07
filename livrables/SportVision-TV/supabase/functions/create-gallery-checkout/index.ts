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
// ── 07/09/2026 : les deux modèles cohabitent ──
// Depuis la v6, un lien peut porter une FORMULE (galerie complète, ou pack de N photos). Dans ce
// cas la sélection du client n'entre pas dans le prix : c'est le lien qui fixe le tarif, et deux
// liens vers le même album peuvent le vendre à deux prix différents. Cette fonction ne décide
// rien de tout cela — media_gallery_quote lui répond, et elle se contente d'enregistrer ce que la
// base a calculé.
//
// Un lien propose désormais PLUSIEURS formules (v14/v15) : 10 photos à 10 €, 20 à 15 €, toute la
// galerie à 50 €. Le client envoie l'identifiant de celle qu'il a choisie, et la base revérifie
// qu'elle appartient bien à CE lien — sinon il suffirait d'envoyer l'identifiant de l'offre à
// 10 € trouvée sur un autre lien pour obtenir cette galerie au tarif du voisin.
//
// La sélection d'un pack se fait AVANT le paiement (décision du 07/09 au soir) : sur un tournoi,
// personne ne met 10 € sans avoir vérifié qu'il y a bien dix photos de son enfant. Les photos
// retenues par le devis sont donc figées dans la commande dès l'achat.
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
    // L'offre choisie parmi celles du lien. Le serveur revérifie qu'elle appartient bien à CE
    // lien : sans ça, il suffirait d'envoyer l'identifiant de l'offre à 10 € trouvée sur un autre
    // lien pour obtenir cette galerie au tarif du voisin.
    const offerId: string | null = body.offerId && UUID_RE.test(String(body.offerId))
      ? String(body.offerId)
      : null;

    if (!slug || !token) return json({ error: "Lien de galerie manquant." }, 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "Adresse e-mail invalide." }, 400);
    if (nom.length < 2) return json({ error: "Merci d'indiquer votre nom." }, 400);
    // NB : quand l'acheteur est connecte, c'est l'adresse VERIFIEE de son compte qui sera retenue
    // plus bas, pas celle saisie dans le formulaire. Un compte connecte ne peut donc pas se
    // rattacher une commande a une adresse qui n'est pas la sienne.
    // Une sélection vide n'est plus une erreur en soi : un lien qui vend une formule se paie sans
    // que rien n'ait été coché. C'est le devis qui tranchera, plus bas — lui seul sait ce que ce
    // lien vend.
    if (assetIds.length > MAX_PHOTOS) return json({ error: "Sélection trop grande." }, 400);
    // Filtrage de forme avant d'envoyer quoi que ce soit à la base : un identifiant mal formé
    // ferait échouer la requête entière avec une erreur technique illisible pour l'utilisateur.
    if (!assetIds.every((id) => typeof id === "string" && UUID_RE.test(id))) {
      return json({ error: "Sélection invalide." }, 400);
    }

    // ── L'acheteur est-il deja connecte a Connect ? ───────────────────────────────────────
    // On ne lit AUCUN identifiant envoye par le navigateur : on relit le jeton de session que le
    // client SDK joint deja a l'appel, et on demande a Supabase qui c'est. Faire confiance a un
    // user_id poste dans le corps de la requete reviendrait a laisser n'importe qui s'attribuer
    // la commande de quelqu'un d'autre.
    //
    // Et il faut que son adresse soit CONFIRMEE : une session sur une adresse non verifiee ne
    // prouve pas qu'elle lui appartient. Dans ce cas on retombe sur le parcours invite, qui est
    // sur — le rattachement se fera apres verification, comme pour tout le monde.
    let acheteur: { id: string; email: string } | null = null;
    {
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      // La cle anonyme est envoyee dans le meme en-tete par le SDK quand personne n'est connecte :
      // getUser la rejette, on ne fait donc rien de special pour la distinguer.
      if (jwt) {
        const { data: { user } } = await admin.auth.getUser(jwt).catch(() => ({ data: { user: null } }));
        if (user?.email && user.email_confirmed_at) {
          acheteur = { id: user.id, email: user.email.toLowerCase() };
        }
      }
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "inconnu";
    if (!(await checkRateLimit(admin, `gallery_checkout:${ip}`))) {
      return json({ error: "Trop de tentatives. Réessayez dans une heure." }, 429);
    }

    // ── LE prix, calculé en base et nulle part ailleurs ────────────────────────────────────
    const { data: quoteRows, error: quoteError } = await admin.rpc("media_gallery_quote", {
      p_slug: slug,
      p_token: token,
      p_asset_ids: assetIds.length > 0 ? assetIds : null,
      p_password: password,
      p_offer_id: offerId,
    });
    const quote = Array.isArray(quoteRows) ? quoteRows[0] : quoteRows;
    if (quoteError) {
      console.error("[create-gallery-checkout] media_gallery_quote :", quoteError);
      return json({ error: "Impossible de calculer le prix de votre sélection." }, 500);
    }
    // `!quote.total_cents` traitait 0 comme un devis absent : une offre gratuite aurait ete
    // refusee alors qu'elle est parfaitement valide. On teste l'ABSENCE de devis, pas sa nullite.
    if (!quote || quote.total_cents === null || quote.total_cents === undefined) {
      // Un devis vide a deux causes très différentes, et les confondre donne un message faux :
      // un lien cassé s'entendrait dire « aucune photo sélectionnée », ce qui envoie le visiteur
      // cocher des photos alors que son lien ne vaut plus rien. On demande donc à la base ce
      // qu'il en est, uniquement sur ce chemin d'erreur.
      const { data: openRows } = await admin.rpc("media_gallery_open", {
        p_slug: slug,
        p_token: token,
        p_password: password,
      });
      const open = Array.isArray(openRows) ? openRows[0] : openRows;
      const lienValide = open?.valide === true;
      // `offres` au pluriel depuis la v15 : un lien porte plusieurs formules. Lire `offre` au
      // singulier renverrait toujours undefined.
      type Offre = { offer_id: string | null; photos_allowance: number | null };
      const offres: Offre[] = Array.isArray(open?.offres) ? open.offres : [];

      if (lienValide) {
        // On répond dans l'ordre où les choses tournent mal, du plus précis au plus général.
        // Renvoyer « galerie indisponible » à quelqu'un qui a simplement coché une photo de trop
        // l'envoie fermer l'onglet alors qu'il lui suffisait d'en décocher une.
        const choisie = offerId ? offres.find((o) => o.offer_id === offerId) : null;

        if (offerId && !choisie) {
          return json({ error: "Cette formule n'est plus proposée. Rechargez la page." }, 409);
        }
        if (choisie?.photos_allowance != null) {
          if (assetIds.length === 0) {
            return json({ error: "Choisissez vos photos avant de payer." }, 400);
          }
          if (assetIds.length > choisie.photos_allowance) {
            return json({
              error: `Vous avez choisi ${assetIds.length} photos, cette formule en couvre ${choisie.photos_allowance}.`,
            }, 400);
          }
        }
        // Galerie au catalogue : sans sélection, elle ne sait pas quoi facturer. Le dire.
        if (offres.length === 0 && assetIds.length === 0) {
          return json({ error: "Aucune photo sélectionnée." }, 400);
        }
        // Plusieurs formules et aucune choisie : on ne devine pas laquelle il voulait.
        if (offres.length > 1 && !offerId) {
          return json({ error: "Choisissez une formule avant de payer." }, 400);
        }
      }
      // Lien invalide, galerie dépubliée, formule retirée de la vente, photos supprimées entre
      // temps. On ne détaille pas davantage : le visiteur n'a rien à en apprendre, et détailler
      // renseignerait quelqu'un qui teste des jetons au hasard.
      return json({ error: "Cette galerie n'est plus disponible à l'achat." }, 409);
    }

    const validIds: string[] = quote.valid_asset_ids ?? [];
    const totalCents: number = quote.total_cents;
    const currency: string = quote.currency || "eur";
    const lines: { name?: string; product_id: string; unit_price_cents: number; quantity: number; covers_photos: number }[] =
      quote.lines ?? [];
    const allowance: number | null = quote.photos_allowance ?? null;
    // Depuis le 07/09 au soir, un pack se choisit AVANT de payer : sur un tournoi, personne ne
    // met 10 € sans avoir vérifié qu'il y a bien dix photos de son enfant. Les photos retenues
    // par le devis sont donc figées dans la commande tout de suite, quota compris.
    // media_gallery_order_select reste en place pour les commandes de packs passées avant ce
    // changement, qui attendent encore leur sélection.
    const selectionFaite = validIds.length > 0;

    // ── Commande ──────────────────────────────────────────────────────────────────────────
    // link_id, product_id et photos_allowance sont écrits ici et pas ailleurs : c'est ce qui
    // permettra de savoir que le lien à 15 € a fait 25 ventes et celui à 30 € seulement 8, et
    // c'est ce que media_gallery_order_select relit pour vérifier le quota après paiement.
    const { data: order, error: orderError } = await admin
      .from("media_orders")
      .insert({
        club_id: quote.club_id,
        album_id: quote.album_id,
        link_id: quote.link_id ?? null,
        offer_id: quote.offer_id ?? null,
        product_id: quote.product_id ?? lines[0]?.product_id ?? null,
        photos_allowance: allowance,
        // Commande rattachee au compte des le depart quand l'acheteur est connecte et verifie :
        // le droit sera permanent d'emblee, sans passer par 30 jours puis un claim de sa propre
        // commande. Un seul type de commande pour autant — c'est la meme table, la meme colonne.
        purchased_by_user_id: acheteur?.id ?? null,
        guest_email: acheteur?.email ?? email,
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
    //
    // Cas du PACK : on n'écrit AUCUNE ligne maintenant. Les photos n'ont pas encore été choisies,
    // et media_gallery_order_select refuse de choisir dès qu'une ligne existe (le choix est
    // définitif). Écrire ici une ligne « en attendant » fermerait la sélection avant qu'elle
    // n'ait eu lieu.
    const perPhotoProduct = quote.product_id ?? lines[0]?.product_id ?? null;
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

    // Un pack part sans aucune ligne : c'est normal, pas une erreur à signaler.
    if (items.length > 0) {
      const { error: itemsError } = await admin.from("media_order_items").insert(items);
      if (itemsError) {
        console.error("[create-gallery-checkout] media_order_items :", itemsError);
        await admin.from("media_orders").delete().eq("id", order.id);
        return json({ error: "Impossible d'enregistrer votre commande." }, 500);
      }
    }

    // ── Offre gratuite : aucune session Stripe ────────────────────────────────────────────
    // Stripe refuse un paiement a 0, et il n'y aurait de toute facon rien a encaisser. Mais RIEN
    // n'est allege pour autant : le lien, l'offre, le quota et les photos ont ete valides plus
    // haut exactement comme pour un achat payant, et le montant vient du DEVIS, jamais du client
    // — envoyer price:0 depuis le navigateur ne rend pas une offre payante gratuite.
    const connectUrlBase = Deno.env.get("CONNECT_URL") ?? "https://connect.sportvision-an.fr";
    if (totalCents === 0) {
      const { error: freeError } = await admin
        .from("media_orders")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", order.id)
        .eq("status", "pending");
      if (freeError) {
        console.error("[create-gallery-checkout] commande gratuite :", freeError);
        return json({ error: "Impossible de finaliser votre commande." }, 500);
      }
      // Le droit de telechargement est cree par le webhook pour un paiement Stripe ; ici il n'y
      // aura pas de webhook, donc on l'ecrit tout de suite. Meme table, meme duree, meme suite du
      // parcours : la page de commande ne fait aucune difference entre gratuit et payant.
      const { data: grant } = await admin
        .from("media_download_grants")
        .insert({
          order_id: order.id,
          email: acheteur?.email ?? email,
          // Acheteur connecte et verifie : le droit est permanent tout de suite. Rien a reclamer,
          // la galerie apparait dans « Mes galeries » des le retour.
          ...(acheteur
            ? {
                claimed_by_user_id: acheteur.id,
                claimed_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000).toISOString(),
              }
            : {}),
        })
        .select("token")
        .single();
      if (!grant?.token) {
        console.error("[create-gallery-checkout] droit gratuit non cree pour", order.id);
        return json({ error: "Impossible de finaliser votre commande." }, 500);
      }
      // Meme e-mail que pour un achat payant : sans lui, quelqu'un qui ferme l'onglet perd
      // l'acces a ses photos, gratuites ou non. Le webhook ne passera pas ici, on l'envoie donc
      // nous-memes, avec le meme gabarit et la meme cle d'idempotence.
      try {
        const { data: albumGratuit } = await admin
          .from("media_albums").select("title").eq("id", quote.album_id).maybeSingle();
        await admin.rpc("enqueue_notification", {
          p_event_type: "galerie.commande_prete",
          p_template_key: "galerie.commande_prete",
          p_channel: "EMAIL",
          p_idempotency_key: "galerie.commande_prete:v1:" + order.id,
          p_recipient_email: email,
          p_entity_type: "media_order",
          p_entity_id: order.id,
          p_payload: {
            prenom: nom.split(" ")[0] ?? "",
            album: albumGratuit?.title ?? "votre galerie",
            consigne: `Vos ${validIds.length} photo${validIds.length > 1 ? "s" : ""} sont disponibles. Telechargez-les en pleine qualite, sans filigrane.`,
            cta: "Telecharger mes photos",
            lien: `${connectUrlBase}/gallery/commande/${encodeURIComponent(grant.token)}`,
            expiration: "dans 30 jours",
            numero: String(order.id).slice(0, 8).toUpperCase(),
            montant: "Offert",
          },
          p_scheduled_at: new Date().toISOString(),
        });
      } catch (e) {
        // Un e-mail qui ne part pas ne doit pas priver le client de ses photos : il est deja
        // redirige vers sa commande.
        console.error("[create-gallery-checkout] e-mail commande gratuite :", e);
      }

      return json({ url: `${connectUrlBase}/gallery/commande/${encodeURIComponent(grant.token)}` });
    }

    // ── Paiement ──────────────────────────────────────────────────────────────────────────
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", { apiVersion: "2023-10-16" });
    const connectUrl = connectUrlBase;
    const { data: album } = await admin
      .from("media_albums")
      .select("title, clubs(nom)")
      .eq("id", quote.album_id)
      .maybeSingle();
    type AlbumRow = { title: string; clubs: { nom: string } | { nom: string }[] | null };
    const a = album as AlbumRow | null;
    const clubNom = Array.isArray(a?.clubs) ? a?.clubs[0]?.nom : a?.clubs?.nom;

    // Ce que le client verra sur sa page Stripe et sur son reçu. Un pack ne se décrit pas par un
    // nombre de photos achetées (il n'en a encore choisi aucune) mais par son intitulé commercial,
    // celui-là même qui était affiché à l'écran.
    const photoCount = quote.whole_album ? items.length : validIds.length;
    const libelle = quote.offer_name
      ? `${a?.title ?? "Galerie"} — ${quote.offer_name}${allowance !== null && selectionFaite ? ` (${validIds.length} photo${validIds.length > 1 ? "s" : ""})` : ""}`
      : `${a?.title ?? "Galerie"} — ${photoCount} photo${photoCount > 1 ? "s" : ""}`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: acheteur?.email ?? email,
      line_items: [{
        price_data: {
          currency,
          unit_amount: totalCents,
          product_data: {
            name: libelle,
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
