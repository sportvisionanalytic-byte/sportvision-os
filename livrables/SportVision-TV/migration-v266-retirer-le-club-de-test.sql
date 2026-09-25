-- v266 — Retirer Villeneuve 340 SC, club de test (25/09/2026)
--
-- DÉCISION DE FOUKA : « Il faut qu'on retire le club de Villeneuve 340 de nos partenaires, c'était
-- un club test pour tester l'application. On retire tout — le Club+, le Connect, etc. »
--
-- CE QUI A ÉTÉ VÉRIFIÉ AVANT, parce qu'on ne supprime pas un club sur un nom :
--   · Ses 4 galeries s'appellent « Test paiement », « Essai paiement reel », « ZZ Temoin
--     filigrane », « ZZ Galerie gratuite ». Ce sont des essais, pas du travail livré.
--   · Ses 2 commandes sont TOUTES DEUX REMBOURSÉES, 5,50 € au total, passées depuis les adresses
--     de Fouka lui-même. Aucun client réel n'a payé quoi que ce soit.
--   · Aucune facture, aucune prestation, aucune fiche joueur.
--   · Un seul compte y est rattaché : 340sportingclub@gmail.com.
-- Une seule de ces réponses différente aurait demandé un arbitrage avant d'effacer.
--
-- LES FICHIERS ONT ÉTÉ EFFACÉS AVANT CETTE MIGRATION — 13 photos, originaux et dérivés. La base
-- ne les supprime pas en supprimant leurs lignes : l'ordre inverse aurait laissé 13 fichiers
-- introuvables et payants dans le stockage, sans plus aucune ligne pour dire à qui ils étaient.
--
-- L'ORDRE COMPTE. Presque tout ce qui pointe vers un club part en CASCADE, sauf trois tables
-- posées en RESTRICT : media_albums, media_entitlements et media_orders. Ce sont elles qui
-- touchent à l'argent, et ce refus de disparaître en silence est volontaire. On les retire donc
-- explicitement, en premier, en sachant ce qu'on retire.
--
-- Idempotente : relancée, elle ne trouve plus le club et ne fait rien.

do $$
declare
  v_club   uuid;
  v_client uuid;
  v_orgs   uuid[];
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  select id, portail_client_id into v_club, v_client
  from clubs where nom ilike '%Villeneuve 340%';
  if v_club is null then
    raise notice 'Villeneuve 340 SC est deja retire : rien a faire.';
    return;
  end if;

  select array_agg(id) into v_orgs from organizations where nom ilike '%Villeneuve 340%';

  -- 1. Ce qui touche a l'argent, retire explicitement (RESTRICT, pas CASCADE).
  -- Les remboursements tiennent leurs commandes : ses deux commandes ayant ete remboursees, il
  -- faut retirer la trace du remboursement avant la commande. L'ordre inverse echoue — c'est le
  -- meme principe de refus silencieux que pour les commandes elles-memes.
  delete from media_orders_remboursements
   where order_id in (select id from media_orders
                      where club_id = v_club
                         or album_id in (select id from media_albums where club_id = v_club));
  delete from media_orders
   where club_id = v_club or album_id in (select id from media_albums where club_id = v_club);
  delete from media_entitlements where club_id = v_club;
  delete from media_album_links where album_id in (select id from media_albums where club_id = v_club);
  delete from media_albums where club_id = v_club;

  -- 2. La source de calendrier et ses executions, qui survivraient a un club efface.
  delete from calendar_sync_runs where club_id = v_club;
  delete from club_calendar_sources where club_id = v_club;

  -- 3. Le club. Tout le reste part en cascade : equipes, matchs, membres, invitations,
  --    affiliations, sponsors, venues, onboarding, tickets, reglages medias.
  delete from clubs where id = v_club;

  -- 4. Club+ : l'organisation et ses membres.
  if v_orgs is not null then
    delete from memberships where organization_id = any(v_orgs);
    delete from organizations where id = any(v_orgs);
  end if;

  -- 5. La fiche client et son contrat Full Communication.
  if v_client is not null then
    delete from contrats where client_id = v_client;
    delete from clients where id = v_client;
  end if;

  raise notice 'Villeneuve 340 SC retire.';
end $$;

-- Ce qui reste de lui, s'il reste quelque chose.
select 'clubs' as ou, count(*) as reste from clubs where nom ilike '%Villeneuve 340%'
union all select 'organizations', count(*) from organizations where nom ilike '%Villeneuve 340%'
union all select 'clients', count(*) from clients where nom ilike '%Villeneuve 340%'
union all select 'galeries', count(*) from media_albums where title ilike '%Villeneuve 340%';
