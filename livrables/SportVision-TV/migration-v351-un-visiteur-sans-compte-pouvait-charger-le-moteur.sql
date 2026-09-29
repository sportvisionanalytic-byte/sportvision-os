-- v351 — UN VISITEUR SANS COMPTE POUVAIT CHARGER LE MOTEUR DE RECONNAISSANCE (29/09/2026)
--
-- LA FAILLE, vérifiée par le chemin réel avec la seule clé publique du site, sans aucune session :
--
--   POST /rest/v1/rpc/reconnaissance_preparer_galerie  {"p_album_id": "<une galerie publiée>"}
--   → 200 true
--
-- La fonction est SECURITY DEFINER et n'avait AUCUNE garde d'appelant. N'importe qui, depuis
-- n'importe où, pouvait donc inscrire du travail dans la file du moteur pour chaque galerie
-- publiée. Le moteur, c'est un Mac. Une galerie de 161 photos lui prend quarante minutes. La
-- reconnaissance est la priorité numéro un de SportVision, et on pouvait l'occuper indéfiniment
-- sans créer de compte, gratuitement, en boucle. Les vraies familles qui viennent de payer 39,90 €
-- auraient attendu derrière.
--
-- LA CAUSE, et c'est elle qu'il faut retenir : en PostgreSQL, `create function` accorde EXECUTE à
-- PUBLIC par défaut. Toute fonction créée sans `revoke` explicite est ouverte à `anon`. v347 a bien
-- écrit `grant execute ... to service_role, authenticated` — ce qui donne l'impression d'avoir
-- décidé quelque chose — mais sans révoquer PUBLIC d'abord, le grant n'enlève rien. Onze fonctions
-- du domaine de la reconnaissance étaient dans ce cas.
--
-- CE QUE LES DIX AUTRES ONT SAUVÉ : une garde INTERNE. Chacune a été sondée en anonyme, une par
-- une, et chacune répond 42501 — `visage_empreintes_du_sportif` ne rend rien, `media_numeros_lus`
-- exige un lecteur automatique, `visage_reference_ajouter` vérifie la parenté et le consentement.
-- Le modèle est bon, il tient. `reconnaissance_preparer_galerie` était la seule à ne rien vérifier :
-- v347 l'avait écrite pour être appelée par un déclencheur, et un déclencheur SECURITY DEFINER n'a
-- pas besoin de grant — le grant était donc inutile ET dangereux.
--
-- On corrige aux deux niveaux, parce qu'un seul ne suffit pas : la garde interne (qui survivra à un
-- futur `create or replace` mal recopié) et le droit d'appel (qui ferme la porte tout de suite).

create or replace function public.reconnaissance_preparer_galerie(p_album_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- LE MOTEUR, OU LE STAFF QUI PUBLIE. Les deux déclencheurs qui appellent cette fonction sont
  -- eux-mêmes SECURITY DEFINER : ils passent par le propriétaire et ne sont pas concernés.
  if not (auth.role() = 'service_role' or public.media_upload_staff()) then
    raise exception 'Non autorisé.' using errcode = '42501';
  end if;

  if not exists (select 1 from media_albums where id = p_album_id and status = 'published') then
    return false;
  end if;
  insert into reconnaissance_a_faire (album_id, player_id, priorite)
  select p_album_id, null, 9
   where not exists (select 1 from reconnaissance_a_faire f
                      where f.album_id = p_album_id and f.player_id is null and f.traite_le is null);
  return found;
end $$;

-- LE DROIT D'APPEL, fonction par fonction. `revoke ... from public` d'abord : sans lui, aucun
-- `grant` ne restreint quoi que ce soit. C'est la leçon de cette migration.
--
-- Réservées au moteur : personne d'autre n'a de raison de les appeler.
revoke all on function public.reconnaissance_preparer_galerie(uuid) from public, anon, authenticated;
grant execute on function public.reconnaissance_preparer_galerie(uuid) to service_role;

revoke all on function public.reconnaissance_joueurs_prets(uuid, text) from public, anon, authenticated;
grant execute on function public.reconnaissance_joueurs_prets(uuid, text) to service_role;

revoke all on function public.reconnaissance_fait(uuid, text) from public, anon, authenticated;
grant execute on function public.reconnaissance_fait(uuid, text) to service_role;

revoke all on function public.visage_reference_depuis_galerie(uuid, uuid, vector, text) from public, anon, authenticated;
grant execute on function public.visage_reference_depuis_galerie(uuid, uuid, vector, text) to service_role;

revoke all on function public.media_numeros_lus(uuid, smallint[], text) from public, anon, authenticated;
grant execute on function public.media_numeros_lus(uuid, smallint[], text) to service_role;

-- Les fonctions de déclencheur : jamais appelées à la main, par personne. Un `rend trigger` n'est
-- pas appelable depuis PostgREST de toute façon, mais un droit qu'on n'explique pas est un droit
-- qu'on finira par utiliser.
revoke all on function public.reconnaissance_a_l_achat_du_pass() from public, anon, authenticated;
revoke all on function public.reconnaissance_a_la_photo_de_reference() from public, anon, authenticated;
revoke all on function public.reconnaissance_a_la_publication() from public, anon, authenticated;
revoke all on function public.effacer_biometrie_au_retrait() from public, anon, authenticated;

-- Celles dont une personne CONNECTÉE a réellement besoin. On ferme `anon`, on garde
-- `authenticated`, et la garde interne continue de trancher qui a le droit de quoi. Fermer plus
-- que nécessaire, c'est l'autre faute : « écran toujours vide = droits trop fermés » (11/09).
revoke all on function public.reconnaissance_file(integer) from public, anon;
grant execute on function public.reconnaissance_file(integer) to authenticated, service_role;

revoke all on function public.visage_empreintes_du_sportif(uuid, text) from public, anon;
grant execute on function public.visage_empreintes_du_sportif(uuid, text) to authenticated, service_role;

revoke all on function public.visage_rapprocher_direct(uuid, vector, text, numeric) from public, anon;
grant execute on function public.visage_rapprocher_direct(uuid, vector, text, numeric) to authenticated, service_role;

revoke all on function public.visage_reference_ajouter(uuid, vector, text, uuid) from public, anon;
grant execute on function public.visage_reference_ajouter(uuid, vector, text, uuid) to authenticated, service_role;

revoke all on function public.media_numeros_de_la_photo(uuid, smallint[]) from public, anon;
grant execute on function public.media_numeros_de_la_photo(uuid, smallint[]) to authenticated, service_role;

notify pgrst, 'reload schema';
