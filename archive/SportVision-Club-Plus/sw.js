// Service worker minimal : uniquement pour satisfaire les critères d'installation
// PWA (Chrome/Android exige un gestionnaire fetch). Ne met rien en cache
// volontairement : les données (Supabase) et les crédits/permissions doivent
// toujours venir du réseau, jamais d'un cache qui pourrait devenir obsolète.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
