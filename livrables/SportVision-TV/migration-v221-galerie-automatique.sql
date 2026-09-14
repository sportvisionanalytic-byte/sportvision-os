-- v221 — La galerie se crée et se publie toute seule (14/09/2026, demande de Fouka).
--
-- LA DEMANDE, mot pour mot : « ce n'est pas nous qui devons créer la galerie à chaque fois. Quand
-- le photographe vidéaste termine la prestation de Fontainebleau, automatiquement ça va dans leur
-- espace Connect avec leurs photos. »
--
-- CE QUI EXISTAIT. `creer_galeries_mission` (v154) sait créer une galerie par équipe d'une mission,
-- avec le bon club, la bonne saison, le bon pôle. Mais elle s'appelle DEPUIS UN BOUTON, réservé à
-- l'Administration et à la Production : quelqu'un devait y penser, pour chaque mission. Et la
-- publication était un second geste manuel.
--
-- CE QUE FAIT CETTE MIGRATION. Deux automatismes, aux deux seuls moments qui ont un sens :
--
--   1. À L'AFFECTATION DE L'ÉQUIPE. Dès que la mission a son opérateur, ses galeries existent, en
--      brouillon. Il ouvre l'OS et les trouve prêtes : il n'a plus qu'à verser ses photos.
--      (Le versement des fichiers reste humain — ils sont sur sa carte mémoire, personne ne peut
--      les deviner. C'est le seul geste qui subsiste.)
--
--   2. À LA VALIDATION PAR LA PRODUCTION. Quand la mission passe à « livrée », les galeries qui
--      contiennent au moins une photo prête sont publiées. La publication déclenche déjà, depuis la
--      v156, la notification au coach, aux joueurs et aux parents : les familles reçoivent donc
--      leurs photos sans qu'on fasse quoi que ce soit.
--
-- POURQUOI LA PUBLICATION N'EST PAS PLUS PRÉCOCE. Publier prévient les familles, une seule fois et
-- pour toujours (v156/v168). Le faire avant le contrôle de la Production, c'est envoyer une galerie
-- vide ou mal cadrée à quinze familles, sans rattrapage possible. La validation de la Production
-- est le moment où quelqu'un a regardé.
--
-- CE QU'ON NE PUBLIE PAS : une galerie sans photo prête. Silencieusement ignorée, elle reste en
-- brouillon et pourra être publiée à la main plus tard.
--
-- Idempotente. Les deux déclencheurs ne font rien si la galerie existe déjà ou est déjà publiée.

-- ── La création, sans contrôle de rôle : c'est le système qui agit ───────────
create or replace function public.creer_galeries_mission_auto(p_prestation_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  p prestations;
  v_client clients;
  v_club uuid;
  v_saison uuid;
  v_pole uuid;
  v_date text;
  v_eq record;
  v_id uuid;
  v_titre text;
  v_creees integer := 0;
begin
  select * into p from prestations where id = p_prestation_id;
  if p.id is null then return 0; end if;

  select * into v_client from clients where id = p.client_id;
  select k.id into v_club from clubs k where k.portail_client_id = p.client_id limit 1;
  select s.id into v_saison from saisons s
   where p.date_prestation between s.date_debut and s.date_fin order by s.date_debut limit 1;
  v_pole := coalesce(p.pole_id, v_client.pole_id);
  v_date := to_char(p.date_prestation, 'DD/MM/YYYY');

  if v_club is not null and exists (select 1 from equipes_de_mission(p.id)) then
    for v_eq in select * from equipes_de_mission(p.id) loop
      select a.id into v_id from media_albums a where a.mission_id = p.id and a.team_id = v_eq.team_id limit 1;
      if v_id is null then
        v_titre := v_eq.team_name || coalesce(' — vs ' || v_eq.adversaires, '') || ' — ' || v_date;
        insert into media_albums (title, club_id, team_id, mission_id, event_date, saison_id, pole_id, status, created_by)
        values (v_titre, v_club, v_eq.team_id, p.id, p.date_prestation, v_saison, v_pole, 'draft', p.responsable_prod_id);
        v_creees := v_creees + 1;
      end if;
      v_id := null;
    end loop;
    return v_creees;
  end if;

  select a.id into v_id from media_albums a where a.mission_id = p.id limit 1;
  if v_id is not null then return 0; end if;

  v_titre := coalesce(v_client.nom, 'Prestation') || ' — ' || coalesce(nullif(p.type_prestation, ''), 'prestation') || ' — ' || v_date;
  insert into media_albums (title, club_id, mission_id, event_date, saison_id, pole_id, structure_externe, status, created_by)
  values (v_titre, v_club, p.id, p.date_prestation, v_saison, v_pole,
          case when v_club is null then v_client.nom end, 'draft', p.responsable_prod_id);
  return 1;
end $$;

comment on function public.creer_galeries_mission_auto(uuid) is
  'v221 — Crée les galeries d''une mission sans intervention : appelée par le déclencheur, jamais depuis un écran.';

-- ── Le déclencheur ───────────────────────────────────────────────────────────
create or replace function public.galeries_suivent_la_mission()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_publiees integer;
begin
  if new.statut = old.statut then
    return new;
  end if;

  -- 1. L'équipe est affectée : les galeries attendent l'opérateur, prêtes.
  if new.statut::text = 'équipe_affectée' then
    perform creer_galeries_mission_auto(new.id);
    return new;
  end if;

  -- 2. La Production a validé : ce qui contient des photos part aux familles.
  if new.statut::text = 'livrée' then
    -- Filet : une mission qui saute l'étape d'affectation (reprise, saisie manuelle) n'aurait
    -- aucune galerie. On les crée avant de publier plutôt que de ne rien livrer.
    perform creer_galeries_mission_auto(new.id);

    update media_albums a
       set status = 'published', published_at = now()
     where a.mission_id = new.id
       and a.status = 'draft'
       and exists (select 1 from media_assets x where x.album_id = a.id and x.status = 'ready');
    get diagnostics v_publiees = row_count;
  end if;

  return new;
end $$;

comment on function public.galeries_suivent_la_mission() is
  'v221 — Les galeries d''une mission se créent à l''affectation et se publient à la validation de la Production.';

drop trigger if exists trg_galeries_suivent_la_mission on public.prestations;
create trigger trg_galeries_suivent_la_mission
  after update of statut on public.prestations
  for each row execute function public.galeries_suivent_la_mission();
