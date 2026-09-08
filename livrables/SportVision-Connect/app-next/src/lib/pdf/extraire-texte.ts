// Extraction du texte d'un PDF, avec les coordonnées de chaque fragment.
//
// Délégué à pdf.js plutôt qu'écrit à la main. Un PDF encode son texte selon la police : encodage
// WinAnsi, CID, sous-ensemble de police avec table ToUnicode... Un extracteur maison lirait
// correctement les cas simples et produirait du charabia sur le reste, ou pire, du texte
// plausible mais faux. C'est exactement le genre d'erreur silencieuse qu'on refuse ici.
//
// pdf.js est chargé en import dynamique : le module ne pèse sur personne tant qu'aucun PDF n'est
// déposé, et le dossier src/lib/calendar/ reste du TypeScript pur, exécutable par le harnais de
// tests.

import type { ElementTexte } from "@/lib/calendar/pdf-lignes";

/** Au-delà, on refuse : un calendrier de club fait quelques pages, pas deux cents. */
const PAGES_MAX = 40;

export class PdfIllisibleError extends Error {}

export async function extraireElementsTexte(bytes: ArrayBuffer): Promise<ElementTexte[]> {
  const pdfjs = await import("pdfjs-dist");

  // Le worker est servi comme fichier statique depuis public/, copié à chaque build par
  // scripts/copier-worker-pdf.mjs. Le laisser empaqueter par Next échoue : son compilateur traite
  // le fichier .mjs déjà minifié comme du script classique et refuse ses `import`. Servi depuis
  // notre propre domaine, il reste couvert par `default-src 'self'` de la CSP — aucun CDN.
  pdfjs.GlobalWorkerOptions.workerSrc = "/clubplus/pdf.worker.min.mjs";

  let document;
  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      // Un calendrier n'a aucune raison d'aller chercher quoi que ce soit en ligne : tout est
      // dans les octets déposés.
      disableAutoFetch: true,
    }).promise;
  } catch (e) {
    throw new PdfIllisibleError(
      e instanceof Error && /password/i.test(e.message)
        ? "Ce PDF est protégé par un mot de passe. Enregistrez-le sans protection puis réessayez."
        : "Ce fichier ne s'ouvre pas comme un PDF.",
    );
  }

  if (document.numPages > PAGES_MAX) {
    throw new PdfIllisibleError(
      `Ce PDF fait ${document.numPages} pages. Déposez seulement les pages du calendrier (${PAGES_MAX} au maximum).`,
    );
  }

  const elements: ElementTexte[] = [];
  for (let numero = 1; numero <= document.numPages; numero++) {
    const page = await document.getPage(numero);
    const contenu = await page.getTextContent();
    for (const item of contenu.items) {
      if (!("str" in item)) continue;
      const texte = item.str;
      if (texte.trim() === "") continue;
      // transform = [a, b, c, d, e, f] : e et f portent la position, d la hauteur de caractère.
      const [, , , d, e, f] = item.transform as number[];
      elements.push({
        texte,
        x: e ?? 0,
        y: f ?? 0,
        largeur: item.width ?? 0,
        hauteur: Math.abs(d ?? 0) || item.height || 10,
        page: numero,
      });
    }
    page.cleanup();
  }

  if (elements.length === 0) {
    throw new PdfIllisibleError(
      "Ce PDF ne contient aucun texte : c'est probablement une image scannée. Demandez le calendrier en .csv, .xlsx ou .ics, ou recopiez-le.",
    );
  }

  return elements;
}
