-- ═══════════════════════════════════════════════════════════════════════════════
-- LOT 1 — Une galerie ne dépend plus d'un club
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Règle métier posée par Fouka le 08/09/2026 : SportVision photographie aussi des clubs non
-- clients, des équipes adverses, des tournois, des académies, des joueurs seuls. Le club,
-- l'équipe et la saison ENRICHISSENT une galerie ; ils ne doivent jamais être NÉCESSAIRES pour
-- la vendre.
--
-- Ce que l'audit a trouvé : la contrainte n'était pas seulement dans l'écran de création, elle
-- traversait toute la chaîne.
--
--   offre  → product_id OBLIGATOIRE → media_products.club_id + saison_id OBLIGATOIRES
--   vente  → media_orders.club_id   OBLIGATOIRE
--   album  → club_id, saison_id     OBLIGATOIRES
--   photo  → media_assets.club_id   OBLIGATOIRE, plus un déclencheur qui lève
--            « Album introuvable » dès que le club est vide
--
-- Une galerie sans club ne pouvait donc ni recevoir de photos, ni porter une offre, ni encaisser.
--
-- Ce que l'audit a trouvé de rassurant, et qui rend ce lot sûr :
--   • aucune politique RLS de media_albums n'utilise club_id ni saison_id — l'accès repose sur le
--     rôle, donc rien n'est affaibli ici ;
--   • team_id était DÉJÀ facultatif en base : seul l'écran l'exigeait ;
--   • media_gallery_open fait déjà un LEFT JOIN sur les clubs ;
--   • le prix vient de l'offre (media_gallery_quote, chemin « offres »), le club n'y est qu'une
--     colonne d'information.
--
-- Choix retenu pour le point le plus structurant : une offre peut désormais exister SANS produit
-- de catalogue. L'alternative — rendre media_products.club_id facultatif — aurait créé une ligne
-- de catalogue orpheline pour chaque adversaire photographié une seule fois. L'offre porte déjà
-- son nom, son quota et son prix : elle se suffit.
--
-- Volumes au moment de la migration : 1 album, 3 photos, 1 lien, 5 offres, 2 commandes.
-- Rien n'est réécrit, rien n'est supprimé : on desserre des contraintes, on n'en ajoute pas.

begin;

-- ── 1. L'album ───────────────────────────────────────────────────────────────
alter table media_albums alter column club_id  drop not null;
alter table media_albums alter column saison_id drop not null;

-- Contexte d'affichage libre, pour une structure qui n'est pas et ne sera peut-être jamais
-- cliente. Saisir « FC Sens U12 » ici ne crée NI organisation, NI club, NI compte Club+, NI
-- client, NI contrat : c'est du texte, et rien d'autre.
alter table media_albums add column if not exists structure_externe text;

comment on column media_albums.structure_externe is
  'Structure ou équipe affichée quand la galerie ne concerne aucun club SportVision (ex. « FC Sens U12 », « Tournoi de Montereau »). Contexte d''affichage uniquement : ne crée aucune entité dans le référentiel.';

-- ── 2. Les photos ────────────────────────────────────────────────────────────
alter table media_assets alter column club_id drop not null;

-- Le déclencheur confondait deux choses très différentes : « cet album n'existe pas » et « cet
-- album n'a pas de club ». Résultat, verser une photo dans une galerie sans club échouait sur
-- « Album introuvable », un message faux qui aurait coûté des heures à diagnostiquer.
create or replace function public.media_assets_set_club()
returns trigger
language plpgsql
as $function$
declare v_existe boolean;
begin
  select true, club_id into v_existe, new.club_id
  from media_albums where id = new.album_id;

  if not coalesce(v_existe, false) then
    raise exception 'Album introuvable : %', new.album_id using errcode = '23503';
  end if;

  -- club_id peut rester null : une galerie autonome n'appartient à aucun club.
  return new;
end;
$function$;

-- ── 3. Les offres ────────────────────────────────────────────────────────────
alter table media_album_link_offers alter column product_id drop not null;

-- Sans produit de catalogue, l'offre doit dire elle-même ce qu'elle vend.
alter table media_album_link_offers add column if not exists offer_type text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'malo_offer_type_check') then
    alter table media_album_link_offers
      add constraint malo_offer_type_check
      check (offer_type is null or offer_type in ('pack','album_complet'));
  end if;
end $$;

-- Les offres existantes héritent du type de leur produit, pour que la lecture soit identique
-- avant et après.
update media_album_link_offers o
   set offer_type = p.type
  from media_products p
 where p.id = o.product_id and o.offer_type is null;

-- Une offre doit rester lisible : soit elle a un produit, soit elle porte son propre prix.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'malo_prix_lisible_check') then
    alter table media_album_link_offers
      add constraint malo_prix_lisible_check
      check (product_id is not null or price_override_cents is not null);
  end if;
end $$;

-- ── 4. Les commandes ─────────────────────────────────────────────────────────
alter table media_orders alter column club_id drop not null;

commit;

-- ── Vérification ─────────────────────────────────────────────────────────────
select 'media_albums.club_id'            as colonne, is_nullable from information_schema.columns where table_name='media_albums' and column_name='club_id'
union all select 'media_albums.saison_id',            is_nullable from information_schema.columns where table_name='media_albums' and column_name='saison_id'
union all select 'media_albums.structure_externe',    is_nullable from information_schema.columns where table_name='media_albums' and column_name='structure_externe'
union all select 'media_assets.club_id',              is_nullable from information_schema.columns where table_name='media_assets' and column_name='club_id'
union all select 'media_album_link_offers.product_id',is_nullable from information_schema.columns where table_name='media_album_link_offers' and column_name='product_id'
union all select 'media_album_link_offers.offer_type',is_nullable from information_schema.columns where table_name='media_album_link_offers' and column_name='offer_type'
union all select 'media_orders.club_id',              is_nullable from information_schema.columns where table_name='media_orders' and column_name='club_id'
order by 1;
