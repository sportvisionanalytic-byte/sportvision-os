-- Reprendre les formules de la dernière galerie (21/09/2026)
--
-- DEMANDE DE FOUKA : « pour créer des galeries, il faut que ce soit beaucoup plus simple, parce
-- que ça fait encore un petit peu long. Quand je crée les packs souvenirs, je ne veux plus
-- réécrire "pack souvenirs" : quand je mets pack souvenirs, il y a directement écrit pack
-- souvenirs. Et parfois ça peut se baser sur le dernier pack que j'ai fait avant, donc ça met
-- automatiquement le pack, et puis je peux modifier. »
--
-- CE QUI SE PASSAIT. Chaque galerie repartait de zéro : ajouter une offre, taper « Pack
-- souvenirs », taper le prix, taper le nombre de photos, recommencer pour la galerie complète.
-- Cinq champs à remplir à l'identique, tournoi après tournoi. Le code s'en expliquait :
-- « aucune valeur suggérée, un prix pré-rempli finirait par être envoyé tel quel à des parents
-- parce que personne ne l'aurait relu ». La crainte est juste, mais elle protège contre une
-- erreur qui ne s'est jamais produite, au prix d'une corvée qui, elle, revient à chaque galerie.
-- Décision de Fouka : on pré-remplit, et on relit.
--
-- Cette fonction renvoie les formules du DERNIER lien créé — celles qu'on vient d'utiliser sur la
-- galerie précédente, donc celles qu'on veut presque toujours reconduire.

begin;

create or replace function public.media_dernieres_formules()
returns table (
  galerie_source text, cree_le timestamptz,
  offer_type text, offer_name text, price_cents int, photos_allowance int, is_featured boolean
)
language sql
stable security definer
set search_path to 'public'
as $$
  with dernier as (
    select l.id, a.title, l.created_at
      from media_album_links l
      join media_albums a on a.id = l.album_id
     where coalesce(l.analytics_excluded, false) = false
       -- Un lien sans aucune formule n'a rien à reconduire : on remonte jusqu'au dernier qui en
       -- porte vraiment, sinon le bouton s'afficherait pour ne rien proposer.
       and exists (select 1 from media_album_link_offers o where o.link_id = l.id and o.is_enabled)
     order by l.created_at desc
     limit 1
  )
  select d.title, d.created_at,
         o.offer_type, o.label, o.price_override_cents, o.photos_allowance, o.is_featured
    from dernier d
    join media_album_link_offers o on o.link_id = d.id
   where is_staff() and o.is_enabled
   order by o.display_order, o.price_override_cents;
$$;

revoke all on function public.media_dernieres_formules() from public;
grant execute on function public.media_dernieres_formules() to authenticated;

comment on function public.media_dernieres_formules() is
  'Les formules du dernier lien de galerie créé, pour les reconduire sur une nouvelle galerie '
  'sans tout retaper. Staff SportVision uniquement.';

commit;
