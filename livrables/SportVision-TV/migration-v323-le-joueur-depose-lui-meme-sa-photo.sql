-- v323 — 28/09/2026 : un joueur mineur dépose lui-même sa photo de référence
--
-- DEMANDE DE FOUKA : « il dépose lui-même sa photo de référence, le parent n'est pas obligé de le
-- faire à sa place ».
--
-- CE QUI EXISTAIT. La règle du dépôt exigeait d'être parent confirmé, OU le joueur ET majeur. Un
-- U16 qui ouvrait l'écran se voyait donc refuser sa propre photo — et le message parlait de
-- connexion réseau, ce qui a coûté un aller-retour complet à diagnostiquer.
--
-- POURQUOI CE N'EST PAS UN RELÂCHEMENT. Ce qui protège une donnée biométrique de mineur, c'est
-- l'ACCORD, pas la main qui téléverse. Et l'accord ne bouge pas : `consentement_biometrie_actif`
-- reste exigé par cette même règle, et les conditions pour le DONNER ne changent pas d'une ligne
-- (policy `cb_donner`, fonction `donner_consentement_biometrie`). Le modèle prévoit d'ailleurs
-- déjà une qualité `joueur_15_17` parmi celles qui peuvent consentir : la possibilité qu'un ado
-- agisse pour lui-même y est inscrite depuis le début.
--
-- Donc : le parent autorise, l'enfant peut ensuite déposer. Sans accord, personne ne dépose rien —
-- ni l'enfant, ni le parent.
--
-- CE QUI NE CHANGE PAS NON PLUS : le dossier doit porter l'identifiant du joueur, et il faut être
-- ce joueur ou son parent CONFIRMÉ. Un inconnu ne dépose rien, un parent non confirmé non plus.
--
-- Idempotent.

drop policy if exists sv_media_prive_visages_insert on storage.objects;

create policy sv_media_prive_visages_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'sportvision-media-prive'
  and (storage.foldername(name))[1] = 'visages'
  and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
  -- Le joueur lui-meme, quel que soit son age, OU son parent confirme. La majorite ne conditionne
  -- plus le depot : c'est l'accord ci-dessous qui porte la protection.
  and (
    public.is_confirmed_parent_of(((storage.foldername(name))[2])::uuid)
    or public.is_own_player(((storage.foldername(name))[2])::uuid)
  )
  -- L'ACCORD RESTE LA CONDITION. Sans lui, ni l'enfant ni le parent ne deposent quoi que ce soit.
  and public.consentement_biometrie_actif(((storage.foldername(name))[2])::uuid)
);
