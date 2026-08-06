// Service worker minimal : uniquement pour satisfaire les critères d'installation
// PWA (Chrome/Android exige un gestionnaire fetch). Ne met rien en cache
// volontairement : ni les données (Supabase), ni les prix, ni les modules JS
// de l'app (app/modules/*.js) qui évoluent fréquemment. Tout doit toujours
// venir du réseau, pour ne jamais servir une version obsolète (données ou code)
// à un joueur, une famille, un coach ou un club.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
