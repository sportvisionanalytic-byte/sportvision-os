// La signature de depot Android survit a chaque `expo prebuild` (25/09/2026).
//
// TROUVE EN CONSTRUISANT L'AAB DU 25/09 : `./gradlew bundleRelease` produisait un bundle signe
// avec la cle de DEBOGAGE. Le modele Expo ecrit noir sur blanc `signingConfig
// signingConfigs.debug` dans le bloc `release`, avec le commentaire « Caution! In production, you
// need to generate your own keystore file ». Google Play refuse un bundle signe ainsi.
//
// RIEN NE LE SIGNALAIT : le build reussissait, l'AAB existait, il faisait 76 Mo. Le refus
// n'arrive qu'au depot, apres coup.
//
// POURQUOI UN GREFFON ET PAS UNE RETOUCHE DE android/app/build.gradle : android/ est genere par
// `expo prebuild` et ignore par Git. Toute correction ecrite dedans disparait au prebuild
// suivant, sans laisser de trace — exactement ce qui est arrive le meme jour a l'equipe de
// signature iOS et a android/local.properties.
//
// OU VIVENT LES SECRETS. Le fichier de cle est dans credentials/, hors de Git. Son mot de passe
// est dans le .env de la racine, hors de Git lui aussi, et lu par le script de construction qui
// le passe a Gradle. Rien de tout cela n'entre dans le depot.
//
// A SAUVEGARDER. Perdre credentials/sportvision-upload.keystore empeche de publier la moindre
// mise a jour. Google Play permet de reinitialiser une cle de depot par le support, mais ce n'est
// pas une formalite : la copier ailleurs prend dix secondes et evite ce detour.
const { withAppBuildGradle } = require("expo/config-plugins");

const BLOC = `
    // Injecte par plugins/signature-android.js — ne pas modifier ici, ce fichier est regenere.
    signingConfigs {
        release {
            storeFile file(System.getenv("SPORTVISION_KEYSTORE") ?: "../../credentials/sportvision-upload.keystore")
            storePassword System.getenv("SPORTVISION_KEYSTORE_PASSWORD")
            keyAlias "sportvision-upload"
            keyPassword System.getenv("SPORTVISION_KEYSTORE_PASSWORD")
        }
    }
`;

module.exports = function signatureAndroid(config) {
  return withAppBuildGradle(config, (c) => {
    let g = c.modResults.contents;

    // 1. Declarer la configuration de depot a cote de celle de debogage.
    if (!g.includes("SPORTVISION_KEYSTORE")) {
      const ancre = "    signingConfigs {";
      if (!g.includes(ancre)) {
        throw new Error(
          "signature-android : le bloc signingConfigs est introuvable dans build.gradle. "
          + "Le modele Expo a change, le greffon doit etre relu avant de construire.");
      }
      // On garde le bloc `debug` existant, et on ajoute `release` au meme niveau.
      g = g.replace(ancre, BLOC.trimEnd() + "\n" + ancre);
      // Les deux blocs `signingConfigs` fusionnent : Gradle les additionne, il n'y a pas de
      // conflit tant que les noms different.
    }

    // 2. Faire pointer la variante release dessus, au lieu de la cle de debogage.
    //
    // 25/09/2026 — DEUX PIEGES SUCCESSIFS, TOUS DEUX TROUVES EN AJOUTANT expo-iap.
    //
    // Le premier : cette etape cherchait une chaine litterale, voisinage et indentation compris.
    // expo-iap retouche aussi build.gradle (source CocoaPods, dependance OpenIAP,
    // missingDimensionStrategy) ; des qu'un autre greffon y touche, une recherche de texte exact
    // echoue, et le garde-fou refusait un fichier parfaitement sain.
    //
    // Le second : « le premier bloc release du fichier » n'est PAS celui des variantes. L'etape 1
    // ci-dessus vient d'en creer un autre, dans signingConfigs, et il arrive avant dans le
    // fichier. On s'ancre donc sur buildTypes explicitement, au lieu de supposer un ordre.
    // TROISIEME PIEGE, LE PLUS DISCRET : la syntaxe d'affectation change en cours de route.
    // Sur disque le modele ecrit `signingConfig signingConfigs.debug` ; en memoire, apres le
    // passage des autres greffons, c'est `signingConfig = signingConfigs.debug`. Groovy accepte
    // les deux, et une expression qui n'en connait qu'une echoue sur un fichier sain. D'ou le
    // `=?` dans les motifs ci-dessous : on decrit ce que Gradle accepte, pas ce qu'on a vu une
    // fois.
    const iBuildTypes = g.indexOf("buildTypes {");
    if (iBuildTypes === -1) {
      throw new Error(
        "signature-android : le bloc buildTypes est introuvable dans build.gradle. "
        + "Le modele Expo a change, le greffon doit etre relu avant de construire.");
    }
    const tete = g.slice(0, iBuildTypes);
    let queue = g.slice(iBuildTypes);

    const blocRelease = /(\n\s*release\s*\{)([\s\S]*?)(\n\s*\})/;
    const m = queue.match(blocRelease);
    if (!m) {
      throw new Error(
        "signature-android : la variante release est introuvable dans buildTypes. "
        + "Le modele Expo a change, le greffon doit etre relu avant de construire.");
    }
    if (!/signingConfigs\.release/.test(m[2])) {
      const corps = m[2].replace(
        /signingConfig\s*=?\s*signingConfigs\.debug/,
        "// La cle de depot, pas celle de debogage : Google Play refuse la seconde.\n"
        + "            signingConfig signingConfigs.release");
      if (corps === m[2]) {
        throw new Error(
          "signature-android : la variante release ne designe aucune configuration de signature "
          + "connue. Verifier android/app/build.gradle avant de construire, sinon l'AAB repartira "
          + "signe en debogage sans que rien ne le dise.");
      }
      queue = queue.replace(blocRelease, (_t, a, _b, c) => a + corps + c);
    }
    g = tete + queue;

    // LE CONTROLE QUI COMPTE. Le danger n'est pas qu'un build echoue, c'est qu'il REUSSISSE en
    // produisant un AAB signe en debogage : rien ne le signale, et le refus n'arrive qu'au depot.
    const apres = g.slice(g.indexOf("buildTypes {")).match(blocRelease);
    if (!apres || !/signingConfigs\.release/.test(apres[2])
        || /signingConfig\s*=?\s*signingConfigs\.debug/.test(apres[2])) {
      throw new Error(
        "signature-android : apres retouche, la variante release ne pointe toujours pas sur la "
        + "cle de depot. Rien ne sera construit.");
    }

    c.modResults.contents = g;
    return c;
  });
};
