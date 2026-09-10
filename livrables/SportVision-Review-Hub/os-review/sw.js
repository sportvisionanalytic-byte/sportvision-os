// Service worker minimal : uniquement pour satisfaire les critères d'installation
// PWA (Chrome/Android exige un gestionnaire fetch). Ne met rien en cache
// volontairement : ni les données (Supabase), ni le fichier applicatif lui-même
// (SportVision-OS-Full.html), qui évolue plusieurs fois par jour. Tout doit
// toujours venir du réseau, pour ne jamais servir une version obsolète (données
// ou code) à un collaborateur — même raisonnement que sw.js côté Connect.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
