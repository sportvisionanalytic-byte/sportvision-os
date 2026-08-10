// ⚠️  REDÉPLOIEMENT MANUEL REQUIS après toute modification de ce fichier.
// Ce code ne se déploie PAS automatiquement sur Supabase depuis le repo.
// Étape à faire à chaque édition : Supabase Dashboard → Edge Functions →
// send-signature-request → coller ce code → Deploy.
// Oublier cette étape est la cause la plus fréquente de "le code est bon
// mais ça ne marche pas en prod" sur ce projet (déjà arrivé sur au moins
// 5 fonctions : clubplus-billing-portal, create-clubplus-subscription-
// checkout, dispatch-notifications, create-guest-rdv, create-guest-request).

// Supabase Edge Function — send-signature-request
// Envoie un devis ou un contrat en signature électronique réelle via Youtrust
// (ex-Yousign), en remplacement du statut "signée" auto-déclaré par le client
// dans le Portail. Génère un PDF du document, crée la demande de signature,
// l'active (Youtrust envoie alors un e-mail au client avec un lien pour signer).
// Le webhook youtrust-webhook confirme automatiquement la signature une fois faite.
// Deploy via Supabase dashboard > Edge Functions > New Function (name: send-signature-request)
// Secrets requis : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (déjà présents),
//                  YOUTRUST_API_KEY, YOUTRUST_API_URL (optionnel, défaut = sandbox)
//
// ── Correction 2026-08 (audit Contrats/Signature) ──────────────────────────
// Youtrust attend un FICHIER PDF déjà généré (upload multipart, nature
// "signable_document") : il ne rend aucun HTML lui-même, donc tout ce que le
// client doit pouvoir lire doit être présent DANS ce PDF. Avant cette
// correction, le PDF envoyé pour un contrat ne contenait qu'un résumé (type,
// montant, dates) — le Socle commun (25 articles) et les Conditions
// particulières par type, pourtant montrés au staff dans l'aperçu
// (genererContratPDF / contratSocleCommunHTML / contratConditionsParticulieresHTML
// dans SportVision-OS-Full.html), n'étaient JAMAIS transmis au client : il
// signait un document différent de celui qui lui avait été présenté. Le texte
// ci-dessous est la copie exacte (mot pour mot) de celui de ces fonctions —
// SOURCE DE VÉRITÉ = SportVision-OS-Full.html. Si le Socle ou une Condition
// particulière est modifié là-bas, reporter le changement ici à l'identique.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

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

const fmtMoney = (n: number | null | undefined) =>
  (n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const fmtNum = (n: number | null | undefined) =>
  (n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "—";

// Découpe un texte en lignes qui tiennent dans maxWidth, pour une police/taille donnée.
function wrapText(text: string, font: any, size: number, maxWidth: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Libellés des catégories de la Banque de contrats (migration-contrats-v2-types-banque.sql).
// Copie de CONTRAT_TYPES_BANQUE_LB (SportVision-OS-Full.html).
const CONTRAT_TYPES_LB: Record<string, string> = {
  ponctuel: "Prestation ponctuelle",
  full_communication: "Full Communication",
  club_plus: "Abonnement Club+",
  coach_academie: "Coach / Académie",
  evenement: "Événement",
  joueur: "Joueur",
  sponsoring: "Sponsoring",
  pilote: "Contrat pilote",
  autre: "Autre",
};

// Socle commun — 25 articles, texte intégral de la Banque de contrats.
// COPIE EXACTE de contratSocleCommunHTML(x) dans SportVision-OS-Full.html —
// seule la variable {{CONFIDENTIALITY_DURATION}} (article 18) est substituée.
function contratSocleCommunArticles(x: Record<string, string>): [string, string][] {
  return [
    ['Article 1 - Définitions', '« Contrat » désigne les Conditions particulières, le présent Socle, les annexes et tout avenant signé. « Prestations » désigne les services décrits dans le périmètre. « Livrables » désigne les fichiers, créations, rapports ou accès remis au Client. « Présence » désigne une intervention planifiée sur site selon la durée et le périmètre indiqués. « Plateforme » désigne SportVision OS, Club+ ou tout espace client mis à disposition. « Jour ouvré » désigne un jour normalement travaillé en France métropolitaine, hors samedi, dimanche et jour férié.'],
    ['Article 2 - Objet et périmètre', 'SportVision fournit les Prestations définies dans les Conditions particulières et l\'annexe de périmètre. Toute prestation non expressément incluse fait l\'objet d\'un devis, d\'une commande complémentaire ou d\'un avenant.'],
    ['Article 3 - Documents contractuels et hiérarchie', 'Les documents contractuels sont, par ordre de priorité : les avenants les plus récents ; les Conditions particulières ; l\'échéancier signé ; les annexes spécifiques ; le présent Socle. Les échanges commerciaux ne modifient pas le Contrat sauf accord écrit des personnes habilitées.'],
    ['Article 4 - Entrée en vigueur et conditions', 'Le Contrat est conclu à la date de finalisation des signatures requises. Le démarrage opérationnel intervient à la date indiquée, sous réserve des conditions suivantes : signature complète, pièces et accès nécessaires, expiration ou traitement du délai applicable, et configuration du paiement lorsqu\'elle est requise.'],
    ['Article 5 - Obligations de SportVision', 'SportVision s\'engage à exécuter les Prestations avec diligence, selon les usages professionnels et le périmètre convenu. Sauf engagement express de résultat, ses obligations sont des obligations de moyens.'],
    ['Article 6 - Obligations du Client', 'Le Client fournit dans les délais les informations, validations, accès, autorisations, éléments de marque, plannings et contacts nécessaires. Tout retard ou blocage imputable au Client peut entraîner un report des délais sans engager la responsabilité de SportVision.'],
    ['Article 7 - Planning, disponibilité et validation', 'Le planning est préparé conjointement. Les urgences, demandes hors calendrier ou modifications tardives sont traitées selon disponibilité et peuvent être facturées.'],
    ['Article 8 - Modifications et corrections', 'Le nombre de corrections incluses est défini dans le périmètre. Les demandes supplémentaires font l\'objet d\'un devis ou consomment des crédits selon l\'offre.'],
    ['Article 9 - Prix, taxes et facturation', 'Les prix et la TVA figurent dans les Conditions particulières. Les factures sont émises selon l\'échéancier. Le Client professionnel supporte les pénalités et indemnités légales mentionnées sur les factures et CGV.'],
    ['Article 10 - Paiement Stripe et échéancier', 'Le moyen de paiement peut être enregistré sans débit immédiat. Les dates, montants et phases sont ceux de l\'échéancier signé.'],
    ['Article 11 - Retard, impayé et suspension', 'En cas d\'impayé, SportVision adresse une notification et laisse au Client un délai de régularisation adapté. À défaut, SportVision peut suspendre tout ou partie des Prestations et accès, dans les limites du Contrat et de la loi.'],
    ['Article 12 - Droit de rétractation et délai commercial', 'Le régime applicable est indiqué dans les Conditions particulières. Lorsque le Client bénéficie d\'un droit légal, les informations, le formulaire et la fonctionnalité en ligne sont fournis.'],
    ['Article 13 - Exécution anticipée', 'Le commencement avant la fin d\'un délai de rétractation n\'a lieu qu\'après demande expresse du Client.'],
    ['Article 14 - Annulation, report et indisponibilité', 'Les conditions d\'annulation et de report figurent dans le contrat spécifique. Les parties recherchent prioritairement un report en cas de force majeure.'],
    ['Article 15 - Propriété intellectuelle', 'Sauf cession expresse, SportVision conserve ses méthodes, modèles, outils, fichiers sources, rushes, bibliothèques, savoir-faire et éléments antérieurs. Après paiement complet, le Client reçoit les droits d\'utilisation des Livrables définis dans l\'annexe.'],
    ['Article 16 - Droit à l\'image et autorisations', 'Le Client informe les participants de la captation et obtient les autorisations nécessaires, notamment pour les mineurs, lorsque cette responsabilité lui incombe.'],
    ['Article 17 - Accès aux réseaux et sécurité', 'Les accès aux comptes sont fournis par des moyens sécurisés. Le Client reste propriétaire de ses comptes. SportVision n\'utilise les accès que pour le périmètre autorisé.'],
    ['Article 18 - Confidentialité', 'Chaque partie protège les informations confidentielles reçues et ne les utilise que pour exécuter le Contrat. Cette obligation survit pendant ' + x.CONFIDENTIALITY_DURATION + ' après la fin du contrat.'],
    ['Article 19 - Données personnelles', 'Chaque partie respecte la réglementation applicable. SportVision met en œuvre des mesures appropriées et notifie les incidents.'],
    ['Article 20 - Responsabilité et assurance', 'Chaque partie répond de ses manquements prouvés. SportVision ne répond pas des conséquences d\'informations erronées, d\'une absence d\'autorisation, d\'un accès retiré, d\'une décision de plateforme sociale, d\'une panne externe ou d\'un événement hors de son contrôle.'],
    ['Article 21 - Absence de garantie de performance marketing', 'SportVision ne garantit ni un nombre de vues, ni un chiffre d\'affaires, ni une croissance d\'abonnés, ni un classement algorithmique.'],
    ['Article 22 - Force majeure', 'Aucune partie n\'est responsable d\'un manquement causé par un événement de force majeure au sens du droit français.'],
    ['Article 23 - Durée, résiliation et sortie', 'La durée, l\'engagement et le préavis sont indiqués dans les Conditions particulières. En cas de manquement remédiable, la résiliation intervient après mise en demeure et délai raisonnable.'],
    ['Article 24 - Signature électronique et preuve', 'Les parties acceptent la signature électronique via Youtrust et reconnaissent la valeur des documents, horodatages, journaux et certificats.'],
    ['Article 25 - Notifications, droit applicable et litiges', 'Le Contrat est soumis au droit français. Le consommateur est informé du médiateur compétent. Entre professionnels, une clause attributive de compétence ne peut être utilisée que dans les conditions légales.'],
  ];
}

// Conditions particulières par type de contrat (Banque de contrats modulables).
// COPIE EXACTE de contratConditionsParticulieresHTML(type,x) dans SportVision-OS-Full.html
// (texte français, y compris le repli générique). SV-CL-001/002/003 : texte fourni par
// le fondateur. SV-CL-004 à 009 : rédigés par Claude le 2026-08-07 à la demande du
// fondateur — non relus par un professionnel du droit à ce jour (même mise en garde que
// dans le fichier source).
function contratConditionsParticulieres(
  type: string,
  x: Record<string, string>
): { ref: string | null; titre: string; texte: string; generique: boolean } {
  if (type === "ponctuel") {
    return {
      ref: "SV-CL-001", titre: "Conditions particulières — Prestation ponctuelle", generique: false,
      texte: 'Le prix est fixé à ' + x.PRICE_EXCL_TAX + ' € HT, soit ' + x.PRICE_INCL_TAX + ' € TTC. Le moyen de paiement est collecté via Stripe. Un acompte peut être demandé, le solde étant dû après livraison. Après paiement complet, le Client bénéficie de la licence d\'utilisation définie en annexe. Toute utilisation publicitaire payante, revente, transmission à un diffuseur ou cession à un sponsor doit être expressément incluse ou fait l\'objet d\'un accord écrit séparé. En cas d\'annulation par le Client, les frais déjà engagés et la mobilisation de l\'équipe sont dus au prorata du préavis. Le prestataire exécute avec l\'équipe et le matériel nécessaires, dans les conditions météo et de sécurité permettant l\'intervention ; en cas d\'impossibilité (météo, sécurité, indisponibilité du lieu), un report est proposé prioritairement à une annulation.',
    };
  }
  if (type === "full_communication") {
    return {
      ref: "SV-CL-002", titre: "Conditions particulières — Full Communication", generique: false,
      texte: 'Le Client souscrit un accompagnement récurrent de communication incluant production terrain et gestion éditoriale, selon le périmètre mensuel défini (présences, volume de publications, réseaux gérés). Prix : ' + x.PRICE_EXCL_TAX + ' € HT/mois, soit ' + x.PRICE_INCL_TAX + ' € TTC/mois. Durée d\'engagement : ' + x.COMMITMENT_MONTHS + ' mois. Préavis de résiliation : ' + x.NOTICE_DAYS + ' jours avant l\'échéance. Le Client transmet ses priorités éditoriales avant le brief mensuel ; SportVision propose un calendrier soumis à validation. Les contenus urgents, résultats, reports et annonces sensibles suivent un circuit de validation accéléré. Le Client fournit des accès sécurisés aux comptes concernés ; SportVision n\'utilise ces accès que pour les missions convenues et ne modifie jamais le propriétaire, les coordonnées de récupération ni les paramètres de facturation publicitaire des comptes sans autorisation expresse écrite.',
    };
  }
  if (type === "club_plus") {
    return {
      ref: "SV-CL-003", titre: "Conditions particulières — Abonnement Club+", generique: false,
      texte: 'L\'abonnement porte sur l\'offre logicielle Club+ (formule Club+ ou Club+ Performance selon le contrat signé), incluant un nombre d\'utilisateurs, de crédits mensuels et de fonctionnalités définis dans l\'annexe. Prix : ' + x.PRICE_EXCL_TAX + ' € HT/mois, soit ' + x.PRICE_INCL_TAX + ' € TTC/mois. Le Client est responsable des utilisateurs qu\'il invite et de la confidentialité de leurs identifiants. Les crédits sont consommés selon le barème de la plateforme ; ils ne sont ni remboursables ni convertibles en argent sauf disposition légale impérative contraire. SportVision peut réaliser des opérations de maintenance et faire évoluer le service sans supprimer les caractéristiques essentielles de l\'offre en cours. À la fin du contrat, les fonctionnalités premium sont désactivées et le Client dispose d\'un délai raisonnable pour exporter les données disponibles, sous réserve des règles de conservation légale.',
    };
  }
  if (type === "coach_academie") {
    return {
      ref: "SV-CL-004", titre: "Conditions particulières — Coach / Académie", generique: false,
      texte: 'Le Client (coach indépendant ou académie) bénéficie d\'un accompagnement de captation et de valorisation de contenus portant sur le suivi individuel des joueurs ou stagiaires inscrits dans sa structure (séances, stages, progression, bilans). Prix : ' + x.PRICE_EXCL_TAX + ' € HT/mois, soit ' + x.PRICE_INCL_TAX + ' € TTC/mois. Durée d\'engagement : ' + x.COMMITMENT_MONTHS + ' mois. Préavis de résiliation : ' + x.NOTICE_DAYS + ' jours avant l\'échéance. Le Client communique le calendrier des séances et stages concernés avant chaque période de captation, dans la limite du volume convenu en annexe ; toute séance non communiquée dans ce délai n\'est couverte que sous réserve de disponibilité et peut faire l\'objet d\'un ajustement tarifaire. Les contenus individuels (portraits, séquences de progression, bilans) peuvent être remis au Client pour diffusion à chaque joueur ou représentant légal concerné, selon les modalités définies en annexe ; le Client garantit avoir recueilli auprès de chaque joueur, ou de son représentant légal lorsqu\'il est mineur, l\'autorisation nécessaire à la captation et à la diffusion de ces contenus individuels, et s\'engage à en justifier à première demande de SportVision. En cas de départ d\'un joueur ou stagiaire en cours de contrat, seuls les contenus déjà produits à la date du départ restent dus, sans séance de rattrapage. L\'usage des contenus par le Client à des fins de recrutement ou de communication de sa structure est inclus dans le présent contrat ; toute cession à un tiers extérieur à la structure (sponsor, média, agent) fait l\'objet d\'un accord écrit séparé.',
    };
  }
  if (type === "evenement") {
    return {
      ref: "SV-CL-005", titre: "Conditions particulières — Événement", generique: false,
      texte: 'Le prestataire assure la couverture de l\'événement désigné en annexe (tournoi, stage, journée média, gala ou manifestation équivalente), à la date, au lieu et sur la durée qui y sont précisés, avec le nombre d\'opérateurs et le matériel adaptés à l\'ampleur de l\'événement. Prix : ' + x.PRICE_EXCL_TAX + ' € HT, soit ' + x.PRICE_INCL_TAX + ' € TTC. Un acompte peut être demandé à la commande, le solde étant dû après livraison des contenus. Le Client communique le programme détaillé (horaires, lieux, intervenants, points de rendez-vous, contact sur place) au plus tard 15 jours avant la tenue de l\'événement ; toute modification tardive du programme, tout changement de lieu ou toute extension de périmètre communiqués après ce délai peuvent entraîner un ajustement du prix, du nombre d\'opérateurs mobilisés ou des délais de livraison. Le Client obtient, s\'il y a lieu, les accréditations et autorisations d\'accès nécessaires à l\'équipe SportVision et informe l\'organisateur ou le lieu de sa présence. Lorsque l\'événement rassemble un public dont l\'identité n\'est pas connue à l\'avance (spectateurs, tribunes, grand public), il appartient au Client ou à l\'organisateur de l\'informer de la captation par les moyens usuels (affichage, annonce) ; SportVision ne recueille pas individuellement le consentement de ce public. En cas d\'annulation ou de report non imputable à SportVision, les frais déjà engagés et la mobilisation de l\'équipe sont dus au prorata du délai restant avant la date prévue initialement. La livraison intervient dans le délai indiqué en annexe, pouvant être allongé au-delà du délai standard des prestations ponctuelles compte tenu du volume propre aux événements de plusieurs jours.',
    };
  }
  if (type === "joueur") {
    return {
      ref: "SV-CL-006", titre: "Conditions particulières — Joueur", generique: false,
      texte: 'Le présent contrat porte sur une prestation individuelle réalisée pour le Client en tant que joueur ou représentant légal d\'un joueur mineur, sans rattachement à un club, une académie ou une structure tierce. Prix : ' + x.PRICE_EXCL_TAX + ' € HT, soit ' + x.PRICE_INCL_TAX + ' € TTC. Le moyen de paiement est collecté via Stripe. Les contenus produits (portraits, séquences de jeu, montages de mise en valeur) sont destinés à un usage personnel et à la mise en valeur sportive du joueur (réseaux personnels, book, dossier de recrutement) ; toute utilisation à des fins publicitaires ou commerciales pour le compte d\'un tiers, ou toute cession à un agent, un club ou un sponsor, doit faire l\'objet d\'un accord écrit séparé et, le cas échéant, d\'une rémunération distincte. Lorsque le joueur est mineur, le Client atteste être son représentant légal et consent expressément, en cette qualité, à la captation et à l\'usage des contenus tels que définis au présent contrat ; ce consentement est révocable à tout moment par écrit, sans effet rétroactif sur les contenus déjà livrés et utilisés conformément au présent contrat avant la révocation. SportVision ne transmet ni ne discute des contenus ou de leur usage avec un agent sportif, un recruteur ou tout intermédiaire tiers sans mandat écrit exprès du Client ou de son représentant légal. Sauf mention contraire en annexe, les fichiers sources et rushes non retenus dans la livraison finale restent la propriété de SportVision et ne sont pas remis au Client.',
    };
  }
  if (type === "sponsoring") {
    return {
      ref: "SV-CL-007", titre: "Conditions particulières — Sponsoring", generique: false,
      texte: 'Le Client, en qualité de partenaire ou sponsor, bénéficie d\'une valorisation de sa marque dans les contenus produits par SportVision pour le compte du club, de l\'académie ou de la structure désignée en annexe, selon les engagements de visibilité qui y sont précisés (nombre de mentions, emplacements, supports concernés, durée d\'exposition). Montant : ' + x.PRICE_EXCL_TAX + ' € HT, soit ' + x.PRICE_INCL_TAX + ' € TTC, facturé selon l\'échéancier défini en annexe. Durée : ' + x.COMMITMENT_MONTHS + ' mois. SportVision rend compte périodiquement, selon la fréquence indiquée en annexe, de la visibilité effectivement livrée au regard des engagements convenus. Le Client fournit les éléments de marque nécessaires (logo, chartes graphiques, consignes d\'usage) et garantit détenir les droits nécessaires sur ces éléments ; SportVision les utilise strictement dans le cadre des supports convenus et ne les cède à aucun tiers. Le présent contrat ne crée aucune exclusivité sectorielle au bénéfice du Client, sauf mention contraire expresse en annexe. Le présent contrat dépend de l\'existence d\'un contrat actif entre SportVision et le club, l\'académie ou la structure désignée en annexe ; si ce contrat prend fin avant le terme du présent sponsoring, SportVision en informe le Client sans délai et les parties conviennent soit d\'un aménagement des engagements de visibilité restants, soit d\'une résiliation anticipée avec remboursement au prorata des engagements non honorés.',
    };
  }
  if (type === "pilote") {
    return {
      ref: "SV-CL-008", titre: "Conditions particulières — Contrat pilote", generique: false,
      texte: 'Le présent contrat constitue une phase pilote, destinée à permettre au Client de découvrir les services de SportVision avant tout engagement de plus longue durée. Il porte sur le périmètre, la durée et, le cas échéant, les conditions tarifaires réduites définis en annexe. Le contrat pilote ne se reconduit jamais tacitement : à son terme, il prend fin de plein droit, sauf signature d\'un nouveau contrat entre les parties portant sur une offre standard. Pendant la durée du pilote, chaque partie peut mettre fin au contrat par écrit, moyennant un préavis de ' + x.NOTICE_DAYS + ' jours, sans pénalité autre que le paiement des prestations déjà réalisées. Les conditions accordées dans le cadre du pilote (tarifs, volumes, modalités) sont propres à cette phase et ne constituent pas un engagement de SportVision pour tout contrat ultérieur ; en particulier, l\'absence de proposition de renouvellement à l\'échéance ne constitue ni une rupture ni un manquement. Les contenus produits pendant le pilote appartiennent au Client dans les mêmes conditions que pour un contrat standard du même type ; SportVision peut toutefois conserver et exploiter, à titre interne, les enseignements et retours d\'usage tirés du pilote pour améliorer ses offres, sans jamais divulguer d\'information identifiant le Client sans son accord.',
    };
  }
  if (type === "autre") {
    return {
      ref: "SV-CL-009", titre: "Conditions particulières — Autre", generique: false,
      texte: 'Ce contrat relève d\'un type de prestation ne correspondant à aucune des catégories standard de SportVision. Les conditions spécifiques (périmètre, prix, durée, modalités de résiliation) sont intégralement définies dans l\'annexe jointe au présent contrat, laquelle prévaut sur toute mention générale du socle commun en cas de contradiction. Avant toute signature, SportVision s\'assure que cette annexe couvre l\'ensemble des points nécessaires à la bonne exécution du contrat, notamment le prix, le périmètre exact des livrables, les délais, les droits d\'usage accordés au Client et les modalités de fin de contrat ; à défaut de précision sur un point donné, les règles du socle commun s\'appliquent. Ce type de contrat étant par nature hors des modèles habituels de SportVision, il est recommandé de le faire relire avant signature lorsque son montant, sa durée ou son périmètre sortent significativement de ce qui est pratiqué sur les autres types de contrats.',
    };
  }
  // Repli PROVISOIRE — identique à celui de SportVision-OS-Full.html. Ne devrait plus
  // jamais être atteint pour les 9 valeurs du CHECK de type_contrat (toutes couvertes
  // ci-dessus), gardé uniquement en filet de sécurité si une valeur imprévue arrivait.
  return {
    ref: null, titre: "Conditions particulières", generique: true,
    texte: "1. Le présent contrat prend effet à la date de signature par les deux parties.\n2. Le paiement est dû selon la fréquence indiquée ci-dessus, par virement bancaire.\n3. En cas de résiliation, un préavis de 30 jours est requis par lettre recommandée avec AR.\n4. SportVision se réserve le droit de sous-traiter certaines prestations à des partenaires qualifiés.\n5. Les droits sur les productions restent la propriété de SportVision jusqu'au paiement intégral.",
  };
}

async function buildPdf(
  docType: "devis" | "contrat",
  doc: any,
  client: any
): Promise<{ bytes: Uint8Array; sigPage: number; sigX: number; sigY: number }> {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595, 842]); // A4
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const navy = rgb(0.03, 0.07, 0.12);
  const gray = rgb(0.42, 0.46, 0.52);
  const margin = 50;
  const width = 595;
  let y = 780;

  const addPageIfNeeded = (needed: number) => {
    if (y - needed < 60) {
      page = pdfDoc.addPage([595, 842]);
      y = 780;
    }
  };

  page.drawText("SPORTVISION", { x: margin, y, size: 20, font: bold, color: navy });
  page.drawText("ELKANA GROUP — 4 Place Pierre Semard, 77130 Montereau-Fault-Yonne", {
    x: margin, y: y - 18, size: 8.5, font: regular, color: gray,
  });
  page.drawText("SIREN 105 173 124 — TVA FR15 105 173 124", {
    x: margin, y: y - 30, size: 8.5, font: regular, color: gray,
  });
  y -= 60;

  const title = docType === "devis" ? `Devis ${doc.numero || ""}` : `Contrat — ${CONTRAT_TYPES_LB[doc.type_contrat] || doc.type_contrat || ""}`;
  page.drawText(title, { x: margin, y, size: 16, font: bold, color: navy });
  y -= 26;

  page.drawText("Client", { x: margin, y, size: 9, font: bold, color: gray });
  y -= 14;
  const clientLine = client?.nom || "—";
  page.drawText(clientLine, { x: margin, y, size: 11, font: regular, color: navy });
  y -= 14;
  if (client?.email) {
    page.drawText(client.email, { x: margin, y, size: 10, font: regular, color: gray });
    y -= 14;
  }
  if (client?.adresse || client?.ville) {
    page.drawText([client?.adresse, client?.code_postal, client?.ville].filter(Boolean).join(", "), {
      x: margin, y, size: 10, font: regular, color: gray,
    });
    y -= 14;
  }
  y -= 16;

  if (docType === "devis") {
    const lignes = Array.isArray(doc.lignes) ? doc.lignes : [];
    page.drawText("Description", { x: margin, y, size: 9, font: bold, color: gray });
    page.drawText("Qté", { x: 360, y, size: 9, font: bold, color: gray });
    page.drawText("PU HT", { x: 410, y, size: 9, font: bold, color: gray });
    page.drawText("Total HT", { x: 480, y, size: 9, font: bold, color: gray });
    y -= 16;
    for (const l of lignes) {
      addPageIfNeeded(30);
      const lines = wrapText(l.libelle || "", regular, 10, 300);
      for (const line of lines) {
        page.drawText(line, { x: margin, y, size: 10, font: regular, color: navy });
        y -= 13;
      }
      const qte = l.qte || 1;
      const pu = l.pu || 0;
      page.drawText(String(qte), { x: 360, y: y + 13, size: 10, font: regular, color: navy });
      page.drawText(fmtMoney(pu), { x: 410, y: y + 13, size: 10, font: regular, color: navy });
      page.drawText(fmtMoney(qte * pu), { x: 480, y: y + 13, size: 10, font: regular, color: navy });
      y -= 6;
    }
    y -= 14;
    addPageIfNeeded(100);
    const totals: [string, string][] = [
      ["Sous-total HT", fmtMoney(doc.sous_total)],
      ...(doc.remise_pct ? [["Remise (" + doc.remise_pct + "%)", "- " + fmtMoney(doc.remise_montant)] as [string, string]] : []),
      ["Total HT", fmtMoney(doc.total_ht)],
      ["TVA (" + (doc.tva_pct ?? 20) + "%)", fmtMoney((doc.total_ttc || 0) - (doc.total_ht || 0))],
      ["Total TTC", fmtMoney(doc.total_ttc)],
    ];
    for (const [label, value] of totals) {
      page.drawText(label, { x: 380, y, size: 10, font: regular, color: gray });
      page.drawText(value, { x: 480, y, size: 10, font: bold, color: navy });
      y -= 15;
    }
    y -= 10;
    if (doc.date_expiration) {
      page.drawText("Devis valable jusqu'au " + fmtDate(doc.date_expiration) + ".", {
        x: margin, y, size: 9.5, font: regular, color: gray,
      });
      y -= 16;
    }
  } else {
    // ── Montant : contrats.montant_mensuel est stocké TTC (cf. commentaire de colonne
    // « comment on column contrats.tva_pct » dans migration-contrats-v2-types-banque.sql :
    // « sert à calculer le prix HT depuis montant_mensuel (TTC) »). Même calcul que
    // genererContratPDF() dans SportVision-OS-Full.html — ne PAS diverger de cette
    // interprétation ici, sous peine de montants HT/TTC différents entre l'aperçu staff
    // et le PDF réellement signé par le client.
    const tvaPct = doc.tva_pct === null || doc.tva_pct === undefined ? 20 : Number(doc.tva_pct);
    const ttc = doc.montant_mensuel === null || doc.montant_mensuel === undefined ? null : Number(doc.montant_mensuel);
    const ht = ttc === null ? null : ttc / (1 + tvaPct / 100);
    const typeLb = CONTRAT_TYPES_LB[doc.type_contrat] || doc.type_contrat || "—";

    const rows: [string, string][] = [
      ["Type de contrat", typeLb],
      ["Montant", ttc === null ? "—" : fmtMoney(ht) + " HT · " + fmtMoney(ttc) + " TTC (TVA " + fmtNum(tvaPct) + " %)"],
      ["Fréquence", doc.frequence || "mensuel"],
      ["Date de début", fmtDate(doc.date_debut)],
      ["Date de fin", doc.date_fin ? fmtDate(doc.date_fin) : "Sans date de fin"],
      ["Durée d'engagement", doc.engagement_mois ? doc.engagement_mois + " mois" : "—"],
      ["Préavis de résiliation", doc.preavis_jours ? doc.preavis_jours + " jours" : "—"],
      ["Renouvellement automatique", doc.renouvellement_auto ? "Oui" : "Non"],
    ];
    for (const [label, value] of rows) {
      addPageIfNeeded(20);
      page.drawText(label, { x: margin, y, size: 10, font: bold, color: gray });
      page.drawText(value, { x: 280, y, size: 10, font: regular, color: navy });
      y -= 18;
    }

    // Périmètre / prestations incluses — contrats.description (migration-contrats-v3-description.sql,
    // additive, EN ATTENTE d'exécution par Fouka). Reste simplement absent tant que la
    // migration n'est pas exécutée : doc.description est alors undefined et ce bloc ne
    // s'affiche pas, exactement comme dans l'aperçu staff (genererContratPDF).
    if (doc.description) {
      y -= 6;
      addPageIfNeeded(30);
      page.drawText("Périmètre / prestations incluses", { x: margin, y, size: 9, font: bold, color: gray });
      y -= 14;
      for (const line of wrapText(doc.description, regular, 10, width - margin * 2)) {
        addPageIfNeeded(16);
        page.drawText(line, { x: margin, y, size: 10, font: regular, color: navy });
        y -= 13;
      }
      y -= 6;
    }

    // Variables de substitution {{XXX}} — mêmes calculs et mêmes replis que dans
    // genererContratPDF() de SportVision-OS-Full.html (CONFIDENTIALITY_DURATION n'a pas
    // de colonne dédiée sur contrats : repli fixe "24 mois" des deux côtés).
    const x: Record<string, string> = {
      PRICE_EXCL_TAX: ht === null ? "—" : fmtNum(ht),
      PRICE_INCL_TAX: ttc === null ? "—" : fmtNum(ttc),
      COMMITMENT_MONTHS: doc.engagement_mois ? String(doc.engagement_mois) : "—",
      NOTICE_DAYS: doc.preavis_jours ? String(doc.preavis_jours) : "—",
      CONFIDENTIALITY_DURATION: "24 mois",
    };

    // Socle commun — texte intégral, identique à l'aperçu staff.
    y -= 10;
    addPageIfNeeded(40);
    page.drawText("SOCLE COMMUN — CONDITIONS GÉNÉRALES", { x: margin, y, size: 10, font: bold, color: navy });
    y -= 18;
    for (const [artTitre, artTexte] of contratSocleCommunArticles(x)) {
      addPageIfNeeded(28);
      page.drawText(artTitre, { x: margin, y, size: 10, font: bold, color: navy });
      y -= 13;
      for (const line of wrapText(artTexte, regular, 9.5, width - margin * 2)) {
        addPageIfNeeded(13);
        page.drawText(line, { x: margin, y, size: 9.5, font: regular, color: navy });
        y -= 12;
      }
      y -= 6;
    }

    // Conditions particulières — texte intégral spécifique au type de contrat, identique
    // à l'aperçu staff (même appel, mêmes variables substituées).
    const cp = contratConditionsParticulieres(doc.type_contrat || "autre", x);
    y -= 8;
    addPageIfNeeded(40);
    page.drawText((cp.titre + (cp.ref ? " · " + cp.ref : "")).toUpperCase(), { x: margin, y, size: 10, font: bold, color: navy });
    y -= 16;
    for (const paragraphe of cp.texte.split("\n")) {
      for (const line of wrapText(paragraphe, regular, 9.5, width - margin * 2)) {
        addPageIfNeeded(13);
        page.drawText(line, { x: margin, y, size: 9.5, font: regular, color: navy });
        y -= 12;
      }
    }
    if (cp.generique) {
      y -= 6;
      addPageIfNeeded(20);
      page.drawText("Conditions particulières génériques — modèle détaillé à venir pour ce type de contrat.", {
        x: margin, y, size: 8.5, font: regular, color: gray,
      });
      y -= 14;
    }
  }

  if (doc.notes) {
    y -= 10;
    addPageIfNeeded(40);
    page.drawText("Notes / conditions", { x: margin, y, size: 9, font: bold, color: gray });
    y -= 14;
    for (const line of wrapText(doc.notes, regular, 10, width - margin * 2)) {
      addPageIfNeeded(16);
      page.drawText(line, { x: margin, y, size: 10, font: regular, color: navy });
      y -= 13;
    }
  }

  addPageIfNeeded(60);
  y -= 20;
  page.drawText(
    "Ce document est proposé à la signature électronique via Youtrust, conformément au règlement eIDAS.",
    { x: margin, y, size: 8, font: regular, color: gray }
  );

  // Le champ de signature Youtrust doit être positionné sur la DERNIÈRE page réelle du
  // PDF (avant cette correction, "page: 1" était câblé en dur — inoffensif tant que le
  // document tenait sur une page, mais faux dès qu'il en occupe plusieurs, ce qui est
  // désormais systématique pour un contrat une fois le Socle 25 articles inclus).
  const sigPage = pdfDoc.getPageCount();

  return { bytes: await pdfDoc.save(), sigPage, sigX: 350, sigY: 60 };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentification requise" }, 401);

    const { doc_type, doc_id } = await req.json();
    if (!doc_type || !doc_id || !["devis", "contrat"].includes(doc_type)) {
      return json({ error: "doc_type ('devis' ou 'contrat') et doc_id requis" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const youtrustApiKey = Deno.env.get("YOUTRUST_API_KEY") ?? "";
    const youtrustApiUrl = Deno.env.get("YOUTRUST_API_URL") || "https://api-sandbox.yousign.app/v3";
    if (!youtrustApiKey) return json({ error: "YOUTRUST_API_KEY non configurée" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Session invalide" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    if (!profile || !["admin", "sec"].includes(profile.role)) {
      return json({ error: "Réservé au staff (admin/sec)" }, 403);
    }

    const table = doc_type === "devis" ? "devis" : "contrats";
    const { data: doc, error: docErr } = await admin
      .from(table)
      .select("*, clients(id,nom,email,adresse,ville,code_postal,prenom_contact,nom_contact)")
      .eq("id", doc_id)
      .maybeSingle();
    if (docErr || !doc) return json({ error: "Document introuvable" }, 404);
    const client = doc.clients;
    if (!client?.email) return json({ error: "Le client n'a pas d'adresse e-mail renseignée" }, 400);

    if (doc.signature_statut === "demandee" || doc.signature_statut === "signee") {
      return json({ error: "Une demande de signature est déjà en cours ou terminée pour ce document." }, 409);
    }

    // Réservation atomique : passe le document à "demandee" avant tout appel
    // Youtrust. Empêche un retry (double-clic, timeout réseau côté staff) de
    // renvoyer une SECONDE demande — et donc un second e-mail réel au client
    // — pendant qu'un premier envoi est encore en vol. Bug identifié le
    // 2026-08-06 : contrairement à Pennylane, aucun garde-fou n'existait ici
    // du tout. Si l'un des appels Youtrust échoue AVANT l'activation (donc
    // avant tout e-mail envoyé), la réservation est restaurée à son état
    // d'origine dans le catch ci-dessous pour permettre un retry légitime.
    const previousStatut = doc.signature_statut || "non_demandee";
    const { data: claimed, error: claimErr } = await admin
      .from(table)
      .update({ signature_statut: "demandee" })
      .eq("id", doc_id)
      .not("signature_statut", "in", "(demandee,signee)")
      .select("id")
      .maybeSingle();
    if (claimErr) return json({ error: claimErr.message }, 500);
    if (!claimed) {
      return json({ error: "Une demande de signature est déjà en cours ou terminée pour ce document." }, 409);
    }

    const pdfResult = await buildPdf(doc_type as "devis" | "contrat", doc, client);

    let sr: { id: string };
    let activated = false;
    try {
      // 1. Créer la demande de signature (brouillon)
      const srRes = await fetch(`${youtrustApiUrl}/signature_requests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${youtrustApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${doc_type === "devis" ? "Devis" : "Contrat"} — ${client.nom}`.slice(0, 128),
          delivery_mode: "email",
        }),
      });
      if (!srRes.ok) throw new Error("Youtrust (création) : " + (await srRes.text()));
      sr = await srRes.json();

      // 2. Uploader le PDF
      const form = new FormData();
      form.append("file", new Blob([pdfResult.bytes as unknown as BlobPart], { type: "application/pdf" }), `${doc_type}-${doc_id}.pdf`);
      form.append("nature", "signable_document");
      const docRes = await fetch(`${youtrustApiUrl}/signature_requests/${sr.id}/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${youtrustApiKey}` },
        body: form,
      });
      if (!docRes.ok) throw new Error("Youtrust (document) : " + (await docRes.text()));
      const uploadedDoc = await docRes.json();

      // 3. Ajouter le client comme signataire
      const signerName = (client.prenom_contact || client.nom_contact)
        ? { first_name: client.prenom_contact || client.nom, last_name: client.nom_contact || "" }
        : { first_name: client.nom, last_name: "" };
      const signerRes = await fetch(`${youtrustApiUrl}/signature_requests/${sr.id}/signers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${youtrustApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          info: { ...signerName, email: client.email, locale: "fr" },
          signature_level: "electronic_signature",
          signature_authentication_mode: "no_otp",
          fields: [{ document_id: uploadedDoc.id, type: "signature", page: pdfResult.sigPage, x: pdfResult.sigX, y: pdfResult.sigY }],
        }),
      });
      if (!signerRes.ok) throw new Error("Youtrust (signataire) : " + (await signerRes.text()));

      // 4. Activer — Youtrust envoie l'e-mail au client. Point de non-retour :
      // dès que cet appel réussit, la réservation ne doit plus jamais être
      // restaurée, même si l'enregistrement en base échoue ensuite.
      const activateRes = await fetch(`${youtrustApiUrl}/signature_requests/${sr.id}/activate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${youtrustApiKey}` },
      });
      if (!activateRes.ok) throw new Error("Youtrust (activation) : " + (await activateRes.text()));
      activated = true;
    } catch (e) {
      if (!activated) {
        await admin.from(table).update({ signature_statut: previousStatut }).eq("id", doc_id).eq("signature_statut", "demandee");
      }
      return json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }

    let saved = false;
    let lastErr: { message: string } | null = null;
    for (let attempt = 0; attempt < 3 && !saved; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));
      const { error: updateErr } = await admin
        .from(table)
        .update({
          signature_statut: "demandee",
          signature_demandee_at: new Date().toISOString(),
          youtrust_signature_request_id: sr.id,
        })
        .eq("id", doc_id);
      if (!updateErr) { saved = true; break; }
      lastErr = updateErr;
    }
    if (!saved) {
      // L'e-mail de signature a bien été envoyé au client mais l'ID Youtrust
      // n'a pas pu être enregistré après plusieurs tentatives — remonté au
      // staff pour renseignement manuel plutôt que de risquer un second envoi.
      return json({
        error: "E-mail de signature envoyé mais non enregistré côté SportVision après plusieurs tentatives : " + (lastErr?.message || "erreur inconnue"),
        youtrust_signature_request_id: sr.id,
      }, 500);
    }

    return json({ sent: true, youtrust_signature_request_id: sr.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
