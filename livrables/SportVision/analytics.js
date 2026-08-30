// analytics.js — Google Analytics 4, chargé uniquement si l'utilisateur a explicitement
// accepté la catégorie "Mesure d'audience" du bandeau cookies (RGPD). Aucune requête vers
// Google n'est envoyée avant ce consentement — voir window.svCookieConsent, exposé par le
// bandeau cookies présent sur chaque page (cf. § "Bandeau cookies (RGPD)" dans le <script>
// de chaque fichier).
//
// Propriété GA4 créée par Fouka le 30/08/2026 (analytics.google.com), ID de mesure
// ci-dessous. Le garde-fou "XXXX" reste en place plus bas au cas où cet ID devrait être
// retiré temporairement (ex. nouvelle propriété à recréer) : remettre 'G-XXXXXXXXXX'
// suffit à tout désactiver sans toucher au reste du script.
(function () {
  'use strict';

  var GA_MEASUREMENT_ID = 'G-2GKKTPTJQC';

  var loaded = false;

  function loadGA4() {
    if (loaded) return;
    if (!GA_MEASUREMENT_ID || GA_MEASUREMENT_ID.indexOf('XXXX') !== -1) return;
    loaded = true;

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
    document.head.appendChild(s);

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    // anonymize_ip : conformité RGPD, cohérent avec le reste du site (aucune donnée
    // personnelle superflue collectée). page_path envoyé par défaut par gtag.js.
    window.gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });
  }

  function checkAndLoad() {
    if (typeof window.svCookieConsent === 'function' && window.svCookieConsent('audience')) {
      loadGA4();
    }
  }

  // Cas 1 : consentement déjà donné lors d'une visite précédente (localStorage) — charge dès
  // que le DOM est prêt (svCookieConsent lit localStorage, pas besoin d'attendre le bandeau).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndLoad);
  } else {
    checkAndLoad();
  }

  // Cas 2 : consentement donné PENDANT cette visite (clic sur "Tout accepter" ou "Enregistrer
  // mes choix" dans le bandeau). setTimeout(...,0) garantit que ce recheck s'exécute APRÈS le
  // gestionnaire de clic propre à chaque page (qui écrit le choix en localStorage de façon
  // synchrone juste avant), quel que soit l'ordre de chargement des <script> sur la page.
  ['cookie-accept', 'cookie-save'].forEach(function (id) {
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('#' + id)) {
        setTimeout(checkAndLoad, 0);
      }
    });
  });

  // API de suivi des conversions — utilisée par les gestionnaires de succès des formulaires
  // (devis, RDV, réservation, candidature) sur les pages qui en ont besoin. No-op silencieux
  // si GA4 n'est pas chargé (ID non configuré, ou consentement refusé) : ne bloque jamais le
  // parcours utilisateur, la conversion métier (écriture en base) a déjà eu lieu avant l'appel.
  window.svTrackConversion = function (eventName, params) {
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params || {});
    }
  };
})();
