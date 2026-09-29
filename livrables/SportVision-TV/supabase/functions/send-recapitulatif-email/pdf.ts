// Le RÉCAPITULATIF EN PDF, la pièce que le collaborateur garde.
//
// POURQUOI UN PDF, ET PAS SEULEMENT L'E-MAIL. Fouka, après avoir lu le premier envoi : « je veux
// que tu envoies un PDF, vraiment un PDF, comme les certifications, avec le logo, un beau truc ».
// Un e-mail se lit ; un PDF se classe, se transmet à un comptable, s'imprime. Pour quelqu'un qui
// facture ses prestations, c'est la forme qui sert.
//
// ══ CE QUE CE DOCUMENT N'EST PAS ════════════════════════════════════════════════════════════════
//
// Pas un bulletin de paie, et aucun mot ici ne doit le laisser croire. Les collaborateurs sont tous
// en `type_contrat = 'freelance'` (vérifié en base le 29/09/2026) : un bulletin de paie est le
// document d'un employeur à un salarié, et en envoyer un à un indépendant produit la preuve écrite
// d'un lien de subordination — la première pièce qu'un contrôle URSSAF demande. Interdits ici :
// « salaire » (on écrit « montant versé »), « fiche de paie » (« récapitulatif de prestations »),
// « pénalité » (« ajustement », parce que le pouvoir de sanctionner est aussi un critère
// d'employeur). Jamais « vous êtes payé » : « montant qui vous sera versé ».
//
// ══ DEUX CHOIX TECHNIQUES, ASSUMÉS ══════════════════════════════════════════════════════════════
//
// HELVETICA ET PAS UNE POLICE DE MARQUE. pdf-lib sait intégrer une police TrueType, mais il faudrait
// la télécharger à chaque envoi : une latence et un mode de panne de plus sur un document qui part
// chez de vraies personnes. Une police neutre bien composée vaut mieux qu'une belle police mal
// posée : le soin est dans le logo, la bande de couleur, l'air entre les blocs et l'alignement des
// chiffres.
//
// LES CHIFFRES SONT ALIGNÉS À DROITE AU CARACTÈRE PRÈS. Helvetica n'a pas de chiffres tabulaires,
// donc on ne peut pas se contenter d'une colonne : chaque montant est mesuré (`widthOfTextAtSize`)
// et posé depuis la droite. Sans ça, une colonne de montants ressemble à une colonne mal rangée, et
// c'est précisément ce qu'on regarde en premier sur ce genre de document.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "https://esm.sh/pdf-lib@1.17.1";
import type { LigneRecap, Recap } from "./document.ts";
import { moisEnClair } from "./document.ts";

const LOGO = "https://sportvision-an.fr/assets/brand/logo-mark.png";

// La charte : un bleu nuit pour le texte, un gris froid pour le secondaire, un vert sobre pour ce
// qui rassure (le virement). Repris du PDF de contrat pour que les documents de la maison se
// ressemblent.
const NUIT = rgb(0.105, 0.125, 0.200);
const GRIS = rgb(0.533, 0.580, 0.667);
const TRAIT = rgb(0.910, 0.922, 0.957);
const FOND = rgb(0.957, 0.965, 0.984);
const VERT = rgb(0.106, 0.369, 0.196);
const VERT_FOND = rgb(0.933, 0.969, 0.941);
const BLANC = rgb(1, 1, 1);

const MARGE = 52;
const LARGEUR = 595;
const HAUTEUR = 842;
const DROITE = LARGEUR - MARGE;

const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin",
                     "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** « 12 sept. » depuis « 2026-09-12 », sans passer par un fuseau. */
function jourCourt(iso: string | null): string {
  if (!iso) return "";
  const [, m, j] = iso.split("-");
  return `${Number(j)} ${MOIS_COURTS[Number(m) - 1]}`;
}

function euros(n: number): string {
  const v = Math.abs(Number(n)).toFixed(2).replace(".", ",");
  // Séparateur de milliers en espace insécable étroit : une somme se lit par tranches de trois.
  const [e, d] = v.split(",");
  const avec = e.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${Number(n) < 0 ? "-" : ""}${avec},${d} €`;
}

/**
 * HELVETICA NE CONNAÎT PAS TOUT L'UNICODE, et pdf-lib LÈVE au lieu d'ignorer.
 *
 * Les polices standard sont encodées en WinAnsi : les accents français y sont, les guillemets
 * français aussi, mais pas l'espace insécable étroit ni l'apostrophe courbe. Un nom de lieu copié
 * depuis une feuille de match en contient, et le document entier échouerait à la génération — chez
 * une personne, un mois donné, sans qu'on comprenne pourquoi. On remplace donc ce qui n'existe pas
 * plutôt que de risquer l'exception.
 */
function pourHelvetica(s: string): string {
  return String(s ?? "")
    .replace(/[   ]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    // Tout ce qui reste hors du latin-1 imprimable est retiré : mieux vaut un caractere en moins
    // qu'un document qui ne se genere pas.
    .replace(/[^\x20-\x7E -ÿ€Œœ]/g, "");
}

interface Plume {
  page: PDFPage;
  y: number;
  gras: PDFFont;
  normal: PDFFont;
}

function ecrire(p: Plume, texte: string, x: number, taille: number,
                font: PDFFont, couleur = NUIT): void {
  p.page.drawText(pourHelvetica(texte), { x, y: p.y, size: taille, font, color: couleur });
}

/** Écrit en calant la FIN du texte sur `xDroite`. C'est ce qui aligne la colonne des montants. */
function ecrireADroite(p: Plume, texte: string, xDroite: number, taille: number,
                       font: PDFFont, couleur = NUIT): void {
  const t = pourHelvetica(texte);
  p.page.drawText(t, {
    x: xDroite - font.widthOfTextAtSize(t, taille),
    y: p.y, size: taille, font, color: couleur,
  });
}

/**
 * Le récapitulatif mensuel, en PDF A4.
 *
 * Exportée et sans effet de bord au chargement, pour la même raison que `rendreRecapitulatif` :
 * c'est ce qui permet de le RENDRE et de le REGARDER avant qu'il ne parte chez dix-huit personnes.
 */
export async function rendreRecapitulatifPdf(r: Recap, toutes: LigneRecap[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Recapitulatif de prestations - ${moisEnClair(r.mois)}`);
  doc.setProducer("SportVision");
  doc.setCreator("SportVision");

  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([LARGEUR, HAUTEUR]);

  // UNE BANDE DE MARQUE, BORD A BORD, EN HAUT DE PAGE. Six points de couleur : c'est le detail qui
  // fait la difference entre une page de texte et un document qu'on a voulu. Fouka : « je veux un
  // beau truc, comme les certifications ». Bord a bord et non dans la marge, sinon elle a l'air
  // d'un trait oublie.
  page.drawRectangle({ x: 0, y: HAUTEUR - 6, width: LARGEUR, height: 6, color: NUIT });

  const p: Plume = { page, y: HAUTEUR - MARGE, gras, normal };

  // ── L'EN-TÊTE. Le logo est téléchargé ; s'il n'arrive pas, on écrit la marque en lettres plutôt
  //    que de laisser un trou. Un document doit sortir même quand le site est indisponible.
  let hautDuTexte = p.y - 4;
  try {
    const rep = await fetch(LOGO);
    if (rep.ok) {
      const img = await doc.embedPng(new Uint8Array(await rep.arrayBuffer()));
      const t = 44;
      page.drawImage(img, { x: MARGE, y: p.y - t + 10, width: t, height: t });
      hautDuTexte = p.y - 6;
      p.y = hautDuTexte;
      ecrire(p, "SPORTVISION", MARGE + t + 14, 15, gras);
      p.y -= 14;
      ecrire(p, "Captation vidéo et photo sportive", MARGE + t + 14, 9, normal, GRIS);
      p.y = hautDuTexte;
    } else throw new Error("logo indisponible");
  } catch {
    ecrire(p, "SPORTVISION", MARGE, 18, gras);
    p.y -= 14;
    ecrire(p, "Captation vidéo et photo sportive", MARGE, 9, normal, GRIS);
    p.y += 14;
  }

  // Le titre et la période, cales a droite : l'oeil lit la marque a gauche, l'objet a droite.
  ecrireADroite(p, "Récapitulatif de prestations", DROITE, 13, gras);
  p.y -= 15;
  ecrireADroite(p, moisEnClair(r.mois), DROITE, 11, normal, GRIS);

  p.y -= 26;
  page.drawLine({ start: { x: MARGE, y: p.y }, end: { x: DROITE, y: p.y }, thickness: 1, color: TRAIT });

  // ── LE DESTINATAIRE
  p.y -= 30;
  ecrire(p, "ÉTABLI POUR", MARGE, 8, gras, GRIS);
  p.y -= 15;
  const nom = `${r.collaborateur?.prenom ?? ""} ${r.collaborateur?.nom ?? ""}`.trim();
  ecrire(p, nom || "Collaborateur", MARGE, 14, gras);
  if (r.collaborateur?.email) {
    p.y -= 14;
    ecrire(p, r.collaborateur.email, MARGE, 9, normal, GRIS);
  }

  // ── LE DÉTAIL, par nature. Une nature sans ligne ne laisse pas de titre vide derrière elle.
  const bloc = (titre: string, nature: string) => {
    const lignes = toutes.filter((x) => x.nature === nature);
    if (!lignes.length) return;
    p.y -= 30;
    ecrire(p, titre.toUpperCase(), MARGE, 8, gras, GRIS);
    p.y -= 6;
    page.drawLine({ start: { x: MARGE, y: p.y }, end: { x: DROITE, y: p.y }, thickness: 0.5, color: TRAIT });
    for (const l of lignes) {
      p.y -= 17;
      ecrire(p, jourCourt(l.date_prestation), MARGE, 9.5, normal, GRIS);
      ecrire(p, l.libelle, MARGE + 62, 9.5, normal);
      ecrireADroite(p, euros(l.montant), DROITE, 9.5, normal);
      if (l.motif) {
        p.y -= 11;
        ecrire(p, l.motif, MARGE + 62, 8, normal, GRIS);
      }
    }
  };
  bloc("Prestations", "prestation");
  bloc("Primes", "prime");
  bloc("Frais et déplacements", "frais");
  bloc("Ajustements", "ajustement");

  // ── LES TOTAUX
  p.y -= 34;
  const totaux: [string, number][] = [];
  if (Number(r.montant_prestations)) totaux.push([`Prestations (${r.nb_prestations})`, Number(r.montant_prestations)]);
  if (Number(r.montant_primes)) totaux.push(["Primes", Number(r.montant_primes)]);
  if (Number(r.montant_frais)) totaux.push(["Frais et déplacements", Number(r.montant_frais)]);
  if (Number(r.montant_ajustements)) totaux.push(["Ajustements", Number(r.montant_ajustements)]);
  for (const [lb, v] of totaux) {
    ecrireADroite(p, lb, DROITE - 110, 9.5, normal, GRIS);
    ecrireADroite(p, euros(v), DROITE, 9.5, normal);
    p.y -= 15;
  }

  // Le montant versé dans un cadre : c'est le chiffre qu'on cherche en ouvrant le document.
  p.y -= 6;
  const hCadre = 44;
  // EN BLANC SUR FOND SOMBRE, et pas en gris clair comme le reste. C'est le seul chiffre que la
  // personne cherche en ouvrant le document : tout le reste peut attendre qu'elle le lise, celui-ci
  // doit se voir avant d'etre lu. Une seule zone contrastee par page, sinon plus rien ne ressort.
  page.drawRectangle({ x: DROITE - 280, y: p.y - hCadre + 12, width: 280, height: hCadre, color: NUIT });
  const yTexte = p.y;
  p.y = yTexte - 12;
  ecrire(p, "Montant qui vous sera versé", DROITE - 264, 10, gras, BLANC);
  ecrireADroite(p, euros(Number(r.montant_verse)), DROITE - 16, 17, gras, BLANC);
  p.y = yTexte - hCadre + 4;

  // L'ÉCART SE DIT. Fouka décide du montant ; s'il diffère du total des lignes, le collaborateur
  // doit le voir ici plutôt que sur son relevé bancaire.
  const ecart = Number(r.montant_verse) - Number(r.montant_du);
  if (Math.abs(ecart) >= 0.01) {
    p.y -= 8;
    ecrireADroite(p,
      `Total des lignes ${euros(Number(r.montant_du))} · montant versé ${ecart > 0 ? "supérieur" : "inférieur"} de ${euros(Math.abs(ecart))}`,
      DROITE, 8, normal, GRIS);
  }

  // ── LE MOT DE FOUKA, s'il y en a un.
  if (r.note) {
    p.y -= 30;
    page.drawRectangle({ x: MARGE, y: p.y - 16, width: DROITE - MARGE, height: 34, color: FOND });
    p.y -= 4;
    ecrire(p, r.note, MARGE + 14, 9.5, normal);
    p.y -= 18;
  }

  // ── LE VIREMENT
  p.y -= 30;
  page.drawRectangle({ x: MARGE, y: p.y - 14, width: DROITE - MARGE, height: 32, color: VERT_FOND });
  p.y -= 2;
  ecrire(p, "Virement en cours", MARGE + 14, 10, gras, VERT);
  const quand = r.virement_annonce_le;
  if (quand) {
    const [a, m, j] = quand.split("-");
    ecrireADroite(p, `au plus tard le ${Number(j)} ${MOIS_COURTS[Number(m) - 1]} ${a}`, DROITE - 14, 10, normal, VERT);
  }

  // ── LE PIED. L'identité légale est celle d'Elkana Group, et le capital social n'y figure pas
  //    (décision de Fouka). La phrase sur la nature du document est la seule occurrence autorisée
  //    de « bulletin de paie » : c'est celle qui dit que ce document n'en est pas un.
  p.y = MARGE + 46;
  page.drawLine({ start: { x: MARGE, y: p.y }, end: { x: DROITE, y: p.y }, thickness: 0.5, color: TRAIT });
  p.y -= 13;
  ecrire(p, "Ce document récapitule des prestations réalisées en qualité d'indépendant. Il ne constitue ni un", MARGE, 7.5, normal, GRIS);
  p.y -= 9;
  ecrire(p, "bulletin de paie ni un contrat de travail.", MARGE, 7.5, normal, GRIS);
  p.y -= 12;
  ecrire(p, "SportVision — Elkana Group, SAS — 4 Place Pierre Sémard, 77130 Montereau-Fault-Yonne", MARGE, 7.5, normal, GRIS);
  p.y -= 9;
  ecrire(p, "SIREN 105 173 124 · SIRET 105 173 124 00014 · RCS Melun · APE 74.20Z · TVA FR15 105 173 124", MARGE, 7.5, normal, GRIS);

  return await doc.save();
}

/** Le nom du fichier joint, lisible dans une boîte mail et triable dans un dossier. */
export function nomFichierPdf(r: Recap): string {
  const nom = `${r.collaborateur?.prenom ?? ""}-${r.collaborateur?.nom ?? ""}`
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  // Le mois en tête : dans un dossier, les fichiers se rangent alors dans l'ordre des mois.
  return `SportVision-${r.mois.slice(0, 7)}-recapitulatif${nom ? "-" + nom : ""}.pdf`;
}
