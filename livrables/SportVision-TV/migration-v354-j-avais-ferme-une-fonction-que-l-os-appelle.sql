-- v354 — J'AVAIS FERMÉ UNE FONCTION QUE L'OS APPELLE (29/09/2026)
--
-- v351, une heure plus tôt, a fermé cinq fonctions du domaine de la reconnaissance au moteur seul,
-- parce que `create function` accorde EXECUTE à PUBLIC par défaut et que personne ne l'avait
-- révoqué. La démarche était bonne. La vérification, non : je n'ai pas cherché qui APPELAIT chacune
-- avant de la fermer.
--
-- `reconnaissance_joueurs_prets` est appelée par l'OS — `recoJoueursPrets()` dans
-- SportVision-OS-Full.html, « y a-t-il quelqu'un à reconnaître dans cette galerie ? ». Un membre du
-- staff connecté recevait donc 42501, et l'écran se vidait. C'est mot pour mot la leçon du 11/09 :
-- « écran toujours vide = droits trop fermés ». Deux tests l'ont attrapé en refusant de s'exécuter,
-- ce qui est exactement leur rôle : plusieurs-photos-de-reference et
-- galerie-multi-categories-reconnaissance.
--
-- CE QUI REND LA RÉOUVERTURE SÛRE, et c'est la raison pour laquelle on ne se contente pas du GRANT :
-- la fonction porte sa propre garde interne. Sondée en anonyme le 29/09, elle répond « Non
-- autorisé. » (42501). Le droit d'appel ne décide pas qui voit quoi ; la garde le décide. Les deux
-- couches ont chacune leur rôle, et c'est la garde qui protège la donnée.
--
-- LES QUATRE AUTRES FERMETURES DE v351 RESTENT : vérifié un par un dans l'OS, dans Connect, dans
-- Club+ et dans l'application mobile, aucune n'a d'appelant applicatif.
--   reconnaissance_fait, reconnaissance_preparer_galerie,
--   visage_reference_depuis_galerie, media_numeros_lus

grant execute on function public.reconnaissance_joueurs_prets(uuid, text) to authenticated;

comment on function public.reconnaissance_joueurs_prets(uuid, text) is
  'Les sportifs d''une galerie prêts pour la reconnaissance, avec leurs photos de référence. '
  'Appelée par le MOTEUR et par l''OS (recoJoueursPrets) : garder le droit d''appel à '
  '`authenticated`, la garde interne borne déjà au staff. La fermer au service_role seul vide '
  'l''écran de l''OS — c''est arrivé avec v351, le 29/09/2026.';

notify pgrst, 'reload schema';
