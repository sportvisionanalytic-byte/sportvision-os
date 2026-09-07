-- Migration : Galeries — les jetons doivent etre sûrs dans une URL
-- À exécuter APRÈS migration-galeries-v9-email-formules.sql.
--
-- ── Le défaut, trouvé sur un vrai paiement ──
-- Les jetons étaient fabriqués en `encode(gen_random_bytes(n), 'base64')`. L'alphabet base64
-- contient `+`, `/` et `=`, dont AUCUN n'est sûr dans une URL :
--
--   `+`  dans une chaîne de requête, se décode en ESPACE. Le jeton reçu n'est plus le même.
--   `/`  dans un chemin, coupe la route en deux. La page n'existe même plus.
--   `=`  ambigu selon les décodeurs.
--
-- Constaté en réel le 07/09 : un paiement de 4 € abouti, commande payée, droit créé, et la page
-- « Commande introuvable » parce que le jeton contenait un `+`. Rien n'était perdu en base, mais
-- l'acheteur ne pouvait pas récupérer ses photos.
--
-- ── L'ampleur ──
-- Un jeton de 24 caractères base64 a plus d'une chance sur DEUX de contenir au moins un `+` ou un
-- `/` (2 chances sur 64 par caractère). La majorité des liens de galerie envoyés aux familles
-- auraient donc été cassés. Aucun ne l'était encore : il n'existait qu'un lien, propre par hasard.
--
-- ── La correction ──
-- base64url : `+` devient `-`, `/` devient `_`, `=` disparaît (translate supprime les caractères
-- sans correspondance). Même entropie, même longueur utile, mais transportable tel quel dans une
-- URL. On ne corrige pas ça dans le code qui construit les liens : un jeton qui voyage dans une
-- URL doit être sûr PAR CONSTRUCTION, sinon le prochain endroit qui en fabrique un réintroduira
-- le défaut.
--
-- La contrainte CHECK est la vraie garantie : elle rend le problème impossible à recréer, y
-- compris par un futur DEFAULT mal écrit ou un insert à la main.

begin;

-- ── 1. Les jetons déjà émis ────────────────────────────────────────────────
-- Ces jetons sont déjà inutilisables pour leur destinataire : les réécrire ne casse rien qui
-- fonctionne, ça répare. On le fait AVANT de poser la contrainte, sinon elle refuserait de
-- s'appliquer aux lignes existantes.
update media_download_grants
set token = translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_')
where token ~ '[+/=]';

update media_album_links
set token = translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_')
where token ~ '[+/=]';

-- ── 2. Les prochains ───────────────────────────────────────────────────────
alter table media_download_grants
  alter column token set default translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');

alter table media_album_links
  alter column token set default translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');

-- ── 3. Le garde-fou ────────────────────────────────────────────────────────
alter table media_download_grants
  drop constraint if exists media_download_grants_token_url_safe;
alter table media_download_grants
  add constraint media_download_grants_token_url_safe
  check (token ~ '^[A-Za-z0-9_-]+$');

alter table media_album_links
  drop constraint if exists media_album_links_token_url_safe;
alter table media_album_links
  add constraint media_album_links_token_url_safe
  check (token ~ '^[A-Za-z0-9_-]+$');

commit;
