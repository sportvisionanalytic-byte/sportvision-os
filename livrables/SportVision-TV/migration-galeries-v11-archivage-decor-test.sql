-- ═══════════════════════════════════════════════════════════════════════════════
-- Archivage du decor de test des galeries — les commandes, elles, ne bougent pas
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- DECISION DE FOUKA, 10/09/2026 :
--
--   « Les 4 commandes payees "test" : surtout ne pas les supprimer. On conserve les commandes et
--     paiements comme historique financier. On archive/desactive les produits de test et on les
--     marque hors statistiques. Si ces paiements doivent etre rembourses, le remboursement doit
--     etre une decision separee et passer par le vrai flux Stripe. Jamais une suppression DB. »
--
-- CE QUE SONT REELLEMENT CES 4 COMMANDES, mesure avant d'agir :
--
--   07/09 19:24   4,00 EUR   payee   christian.fouka6@gmail.com    <- un vrai paiement Stripe
--   08/09 11:16   0,00 EUR   payee   zz-gratuit@sportvision-an.fr
--   08/09 11:17   0,00 EUR   payee   zz-gratuit@sportvision-an.fr
--   08/09 11:19   0,00 EUR   payee   zz-gratuit@sportvision-an.fr
--
-- Une seule porte de l'argent : 4 EUR, encaisses lors d'un test de bout en bout. Les trois autres
-- valident l'offre gratuite et ne representent aucun mouvement. Aucune n'est supprimee ni modifiee
-- ici : ce fichier ne touche QUE le decor (albums et liens).
--
-- CE QUI ETAIT DEJA FAIT. Les deux liens de test portaient deja analytics_excluded = true : la
-- partie « hors statistiques » de la decision etait acquise avant cette migration. Verifie, pas
-- suppose.
--
-- CE QUI RESTE A FAIRE : sortir ces albums de l'etat « publie », ou ils restent atteignables et
-- se melangent aux vraies galeries dans les ecrans.
--
-- LE MOTIF A ETE ELARGI APRES COUP. Ecrit d'abord comme « test » ou « audit » entoures de
-- non-lettres, il laissait passer un album nomme « testing match vc » — 4 medias, aucune commande,
-- cree le 08/09 pendant la QA — qui restait publie avec un lien actif. La borne de fin est donc
-- retiree : « testing » est attrape, « Contest » ne l'est pas puisque la borne de DEBUT reste.

begin;

-- Trace de ce qu'on archive, pour qu'un futur lecteur ne se demande pas ce qui a disparu.
create table if not exists public.media_albums_archives_test (
  album_id   uuid primary key,
  titre      text,
  ancien_statut text,
  motif      text,
  archive_le timestamptz not null default now()
);

insert into public.media_albums_archives_test (album_id, titre, ancien_statut, motif)
select a.id, a.title, a.status,
       'Decor de test des galeries. Archive le 10/09/2026 sur decision de Fouka. '
       'Les commandes rattachees sont conservees telles quelles comme historique financier.'
  from public.media_albums a
 where a.title ~* '(^|[^a-z])(test|audit)'
   and a.status = 'published'
on conflict (album_id) do nothing;

update public.media_albums a
   set status = 'archived'
 where a.title ~* '(^|[^a-z])(test|audit)'
   and a.status = 'published';

-- Les liens de ces albums cessent de servir. On ne les supprime pas : un lien supprime casserait
-- la lecture des commandes qui le referencent.
update public.media_album_links l
   set is_enabled = false,
       analytics_excluded = true
  from public.media_albums a
 where a.id = l.album_id
   and a.id in (select album_id from public.media_albums_archives_test)
   and (l.is_enabled or coalesce(l.analytics_excluded,false) = false);

commit;

-- ── Verification : le decor est range, l'argent est intact ───────────────────
select 'albums de test encore publies' as controle, count(*)::text as valeur
  from media_albums where title ~* '(^|[^a-z])(test|audit)' and status = 'published'
union all
select 'liens de test encore actifs', count(*)::text
  from media_album_links l join media_albums_archives_test t on t.album_id = l.album_id
 where l.is_enabled
union all
select 'commandes payees (doit rester 4)', count(*)::text from media_orders where status = 'paid'
union all
select 'montant total encaisse (doit rester 4.00)',
       to_char(coalesce(sum(amount_cents),0)/100.0,'FM999999990.00') from media_orders where status = 'paid';
