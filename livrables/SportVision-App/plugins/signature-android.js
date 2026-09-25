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
    const avant = "            signingConfig signingConfigs.debug\n"
      + "            def enableShrinkResources";
    const apres = "            // La cle de depot, pas celle de debogage : Google Play refuse la seconde.\n"
      + "            signingConfig signingConfigs.release\n"
      + "            def enableShrinkResources";
    if (g.includes(avant)) g = g.replace(avant, apres);
    else if (!g.includes("signingConfigs.release\n            def enableShrinkResources")) {
      throw new Error(
        "signature-android : la variante release ne pointe pas la ou on l'attendait. "
        + "Verifier android/app/build.gradle avant de construire, sinon l'AAB repartira "
        + "signe en debogage sans que rien ne le dise.");
    }

    c.modResults.contents = g;
    return c;
  });
};
