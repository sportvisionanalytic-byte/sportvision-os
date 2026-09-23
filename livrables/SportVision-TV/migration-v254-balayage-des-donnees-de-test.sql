-- v254 — La production se balaie toute seule (23/09/2026)
--
-- Constat de l'audit du 23/09 : 118 organisations de test vivaient en production. Nommées
-- « ZZ Club Reco 1790004104970 », « ZZ Client Majeur 1790008445275 », « DEMO Villemomble ».
-- Elles s'accumulaient depuis le 10 septembre, entre 15 et 30 par campagne de tests, 29 pour la
-- seule journée du 21. Sur 130 organisations en base, 9 seulement étaient des clubs, et 3 de
-- vrais clubs.
--
-- Elles ne cassaient rien : mesuré, aucune ne portait de membre, de joueur, de galerie, de
-- commande, de facture, de prestation ni de contrat. Mais elles faussaient tout compteur de
-- clients dans l'OS, et surtout le flux ne s'arrêtait pas : 32 scénarios de bout en bout créent
-- ces données et ne les reprennent pas.
--
-- Corriger les 32 scénarios un par un serait long, risqué en période de gel, et ça
-- recommencerait au 33e. On corrige donc à l'endroit où ça se voit : un balayage nocturne, qui
-- ne connaît qu'une seule convention de nommage, et qui refuse de toucher à quoi que ce soit
-- qui porte une trace réelle.
--
-- Ce que le balayage ne touchera JAMAIS :
--   * tout ce qui ne commence pas par « ZZ » ;
--   * les comptes de démonstration remis à Apple et à Google pour la relecture des magasins,
--     qui sont rattachés aux vrais clubs (vérifié le 23/09) et non à une organisation fictive ;
--   * toute organisation portant ne serait-ce qu'une galerie, une commande, une facture, une
--     prestation, un contrat, un membre ou un joueur.

-- ── La fonction de balayage ────────────────────────────────────────────────────────────────
create or replace function public.purger_organisations_de_test()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_supprimees integer := 0;
  v_id uuid;
begin
  with candidates as (
    select o.id
    from organizations o
    where o.nom like 'ZZ %'                      -- la convention des tests, et elle seule
      -- Rien de réel accroché : sept vérifications, parce qu'une seule qui manque et on
      -- supprime le travail de quelqu'un.
      and not exists (select 1 from media_albums    a where a.club_id   = o.id)
      and not exists (select 1 from media_orders    m where m.club_id   = o.id)
      and not exists (select 1 from factures        f where f.client_id = o.id)
      and not exists (select 1 from prestations     p where p.client_id = o.id)
      and not exists (select 1 from contrats        k where k.client_id = o.id)
      and not exists (select 1 from club_members    c where c.club_id   = o.id)
      and not exists (select 1 from player_profiles j where j.club_id   = o.id)
      -- On laisse vivre celles du jour : un test en cours d'exécution ne doit pas voir son
      -- décor disparaître sous ses pieds.
      and o.created_at < now() - interval '12 hours'
  )
  delete from organizations o using candidates c where o.id = c.id;
  get diagnostics v_supprimees = row_count;

  -- Les fiches client jumelles, quand elles ne servent plus à rien non plus.
  --
  -- Une par une, et non d'un seul geste : la première exécution s'est arrêtée net parce qu'une
  -- fiche de test portait des messages (messages_client), et le refus de la clé étrangère a
  -- annulé tout le balayage. Un ménage ne doit jamais échouer en bloc à cause d'une seule
  -- ligne accrochée. Celles qui résistent sont simplement laissées là, et la table qui les
  -- retient sera la prochaine à recevoir sa vérification. C'est aussi ce qui rend ce balayage
  -- durable : le jour où une nouvelle table pointera vers clients, il ne cassera pas.
  for v_id in
    select c.id from clients c
    where c.nom like 'ZZ %'
      and c.created_at < now() - interval '12 hours'
      and not exists (select 1 from factures      f where f.client_id = c.id)
      and not exists (select 1 from prestations   p where p.client_id = c.id)
      and not exists (select 1 from contrats      k where k.client_id = c.id)
      and not exists (select 1 from organizations o where o.legacy_client_id = c.id)
  loop
    begin
      delete from clients where id = v_id;
    exception when foreign_key_violation then
      null;  -- accrochée ailleurs : on la laisse, elle ne gêne personne
    end;
  end loop;

  return v_supprimees;
end $$;

-- Personne ne l'appelle depuis une application : c'est une tâche de ménage, elle appartient au
-- cron. Même règle que les onze autres tâches planifiées (v253).
revoke execute on function public.purger_organisations_de_test() from public, anon, authenticated;

comment on function public.purger_organisations_de_test() is
  'Balayage nocturne des organisations de test (prefixe ZZ) laissees par les scenarios de bout '
  'en bout. Ne supprime que ce qui ne porte aucune trace reelle et date de plus de 12 heures. '
  'Voir migration v254.';

-- ── Le balayage tous les jours à 4 h du matin ──────────────────────────────────────────────
select cron.schedule(   -- cron.schedule remplace la tâche si elle existe déjà
  'sportvision-purger-donnees-de-test',
  '0 4 * * *',
  $cron$select purger_organisations_de_test();$cron$
);
