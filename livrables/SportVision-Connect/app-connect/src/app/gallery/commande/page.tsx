import { OrderExchange } from "./OrderExchange";

// Retour de Stripe — /gallery/commande?order=<id>
//
// Au moment de créer la session de paiement, le jeton de téléchargement n'existait pas encore :
// il naît dans le webhook, quand le paiement est confirmé. Stripe nous ramène donc avec
// l'identifiant de commande, qu'on échange une seule fois contre le vrai jeton.
//
// Cet échange est borné à deux heures après le paiement (voir l'Edge Function gallery-download) :
// passé ce délai, l'identifiant de commande cesse d'être une clé et seul le lien reçu par e-mail
// fonctionne.
export default async function OrderReturnPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order } = await searchParams;
  return <OrderExchange orderId={order ?? null} />;
}
