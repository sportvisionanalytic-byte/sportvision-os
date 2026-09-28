// Créer les deux Pass Photo dans Google Play, par l'API.
//
// Jumeau de creer-produits-app-store.mjs, et volontairement séparé : les deux magasins n'ont ni la
// même notion de prix, ni les mêmes états, ni les mêmes contraintes.
//
// TROIS CHOSES APPRISES EN LE FAISANT, ET QUI COÛTENT UNE HEURE CHACUNE :
//
//  1. L'ancienne API `inappproducts` est FERMÉE. Google répond « Please migrate to the new
//     publishing API ». Le nouveau modèle est différent : un produit porte des « options d'achat »
//     avec un prix par région, au lieu d'un prix unique.
//  2. Le chemin s'écrit `oneTimeProducts` en lecture et `onetimeproducts` EN MINUSCULES en
//     écriture. Un PATCH sur la forme camelCase répond 404 en page HTML, pas en JSON — on croit
//     alors que l'app n'existe pas. C'est le document de découverte de l'API qui l'a révélé.
//  3. Le droit « Gérer la présence sur le Play Store » est nécessaire, et lui SE PROPAGE. La
//     lecture et l'envoi de version sont immédiats, l'écriture des produits non. Un 403 juste
//     après avoir coché la case ne veut pas dire que la case est mauvaise.
//
// Google accepte le prix EXACT du club : 19,90 et 39,90, là où Apple impose 19,99 et 39,99. Les
// identifiants portent donc le vrai prix, et la base les compare au caractère près.
//
//   node scripts/creer-produits-google-play.mjs [chemin de la clé JSON]

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
// LA CLÉ N'EST PAS DANS LE DÉPÔT, et son emplacement non plus. Chrome télécharge sur un disque
// externe chez Fouka ; coder ce chemin en dur ferait échouer le script sur toute autre machine, et
// inscrirait dans Git où vit un secret. On la passe en argument, ou par GOOGLE_PLAY_KEY.
const CLE = process.argv[2] || process.env.GOOGLE_PLAY_KEY || "";
if (!CLE) {
  console.error(`Il manque le chemin de la clé du compte de service Google Play.

  node ${process.argv[1].split("/").pop()} /chemin/vers/sportvision-play-xxxx.json

ou bien : export GOOGLE_PLAY_KEY=/chemin/vers/la/cle.json

Cette clé est téléchargée une seule fois depuis Google Cloud. Ne la mets jamais dans Git.`);
  process.exit(1);
}

const d = JSON.parse(readFileSync(CLE, "utf8"));
const b=(x)=>Buffer.from(x).toString("base64url");
const n=Math.floor(Date.now()/1000);
const h=b(JSON.stringify({alg:"RS256",typ:"JWT"}));
const p=b(JSON.stringify({iss:d.client_email,scope:"https://www.googleapis.com/auth/androidpublisher",aud:"https://oauth2.googleapis.com/token",iat:n,exp:n+3600}));
const s=createSign("SHA256"); s.update(`${h}.${p}`);
const T=(await (await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:`${h}.${p}.${s.sign(d.private_key,"base64url")}`})})).json()).access_token;
const APP="fr.sportvision.app";
const B=`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${APP}`;

const PRODUITS=[
 {id:"pass_photo_19_90", units:"19", nanos:900000000, club:"SF Villemomble"},
 {id:"pass_photo_39_90", units:"39", nanos:900000000, club:"RCP Fontainebleau"},
];

for (const pr of PRODUITS) {
  const corps = {
    packageName: APP,
    productId: pr.id,
    listings: [{ languageCode: "fr-FR",
      title: "Pass Photo saison 2026-2027",
      description: "Accès à vos photos de la saison, dans l'application et sur le web." }],
    purchaseOptions: [{
      purchaseOptionId: "standard",
      state: "ACTIVE",
      buyOption: { legacyCompatible: true, multiQuantityEnabled: false },
      regionalPricingAndAvailabilityConfigs: [{
        regionCode: "FR",
        price: { currencyCode: "EUR", units: pr.units, nanos: pr.nanos },
        availability: "AVAILABLE",
      }],
    }],
    regionsVersion: { version: "2022/02" },
  };
  const u = `${B}/onetimeproducts/${pr.id}?allowMissing=true&updateMask=listings,purchaseOptions,regionsVersion`
          + `&regionsVersion.version=2022%2F02`;
  const r = await fetch(u, { method:"PATCH",
    headers:{Authorization:`Bearer ${T}`,"Content-Type":"application/json"}, body: JSON.stringify(corps) });
  const t = await r.text();
  console.log(`${pr.id} -> ${r.status}  ${t.replace(/\s+/g," ").slice(0,300)}`);
}
