-- Le cockpit du CM : santé du club, journal, sections de l'onboarding, lancement.
--
-- Ce que ce test tient pour vrai (migration v117, 10/09/2026) :
--   • le journal note l'AUTEUR réel, regroupe les rafales, et ignore la synchronisation qui ne
--     change rien de visible ;
--   • « Club opérationnel » compte les équipes sans encadrant, et une invitation préparée suffit
--     à ce qu'une équipe cesse d'être « sans coach » ;
--   • un club ne se lance que complet, que par `lancer_club`, et une seule fois ;
--   • un coach, ou un CM d'un autre club, ne lit rien de tout cela.
--
--   Exécution : coller dans l'éditeur SQL, ou POSTer sur /v1/projects/<ref>/database/query.
--   Tout est annulé, rien ne subsiste.

begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temp table ctx on commit drop as
  select 'f0d3bafa-3004-4831-bd85-249aa9af5c54'::uuid as club_id,
         (select id from clubs where nom = 'Villeneuve 340 SC') as autre_club;
grant select on ctx to authenticated;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role) values
  ('eeeeeeee-0000-0000-0000-000000000001','zz-cockpit-cm@example.invalid','',now(),'authenticated','authenticated'),
  ('eeeeeeee-0000-0000-0000-000000000002','zz-cockpit-coach@example.invalid','',now(),'authenticated','authenticated'),
  ('eeeeeeee-0000-0000-0000-000000000003','zz-cockpit-autre-cm@example.invalid','',now(),'authenticated','authenticated')
on conflict (id) do nothing;

insert into profiles (id, prenom, nom, role) values
  ('eeeeeeee-0000-0000-0000-000000000001','Zoé','Cockpit','cm'),
  ('eeeeeeee-0000-0000-0000-000000000003','Autre','CM','cm')
on conflict (id) do update set role = excluded.role, prenom = excluded.prenom, nom = excluded.nom;

insert into club_cm_affectations (club_id, cm_id, role, date_debut, actif)
select club_id, 'eeeeeeee-0000-0000-0000-000000000001'::uuid, 'secondaire', current_date, true from ctx
union all
select autre_club, 'eeeeeeee-0000-0000-0000-000000000003'::uuid, 'secondaire', current_date, true from ctx;

insert into club_members (user_id, club_id, role, status, teams)
select 'eeeeeeee-0000-0000-0000-000000000002'::uuid, club_id, 'coach', 'actif', '[]'::jsonb from ctx;

create temp table verdicts (controle text, attendu text, obtenu text) on commit drop;
grant select, insert on verdicts to authenticated;
create temp table memo (cle text primary key, v jsonb) on commit drop;
grant select, insert, update on memo to authenticated;

create or replace function pg_temp.en(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.hors() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;
create or replace function pg_temp.note(p_controle text, p_attendu text, p_obtenu text) returns void
language sql as $$ insert into verdicts values (p_controle, p_attendu, p_obtenu); $$;

-- ── Le CM lit la santé du club ────────────────────────────────────────────────
do $$
declare v jsonb; v_sans int;
begin
  perform pg_temp.en('eeeeeeee-0000-0000-0000-000000000001');
  v := club_sante((select club_id from ctx));
  select count(*) filter (where encadrant_statut = 'aucun') into v_sans from club_equipes_etat((select club_id from ctx));
  perform pg_temp.hors();
  insert into memo values ('sante_avant', v);
  perform pg_temp.note('santé : un score entre 0 et 100', 'oui',
    case when (v->>'score')::int between 0 and 100 then 'oui' else 'non : ' || coalesce(v->>'score', 'nul') end);
  perform pg_temp.note('santé : « équipes sans coach » = équipes sans encadrant', v_sans::text,
    coalesce((select p->>'nombre' from jsonb_array_elements(v->'problemes') p where p->>'code' = 'equipes_sans_coach'), '0'));
end $$;

-- ── Le journal : l'auteur, le regroupement ────────────────────────────────────
do $$
declare v_ev record;
begin
  perform pg_temp.en('eeeeeeee-0000-0000-0000-000000000001');
  insert into club_teams (club_id, name, categorie) values ((select club_id from ctx), 'ZZ Cockpit A', 'Seniors');
  insert into club_teams (club_id, name, categorie) values ((select club_id from ctx), 'ZZ Cockpit B', 'Seniors');
  perform pg_temp.hors();
  select * into v_ev from club_onboarding_events
   where club_id = (select club_id from ctx) and section = 'equipes' and action = 'ajout'
     and auteur_id = 'eeeeeeee-0000-0000-0000-000000000001';
  perform pg_temp.note('journal : deux créations regroupées en une ligne, par le CM', '2',
    coalesce(v_ev.nb::text, 'aucune ligne'));
end $$;

-- ── Le journal ignore la synchronisation qui ne change rien de visible ────────
do $$
declare v_avant int; v_apres int; v_match uuid;
begin
  select id into v_match from club_matches where club_id = (select club_id from ctx) and score is null limit 1;
  select count(*) into v_avant from club_onboarding_events where club_id = (select club_id from ctx) and section = 'calendrier';
  update club_matches set last_synced_at = now() where id = v_match;
  select count(*) into v_apres from club_onboarding_events where club_id = (select club_id from ctx) and section = 'calendrier';
  perform pg_temp.note('journal : une synchronisation sans changement visible n''écrit rien', '0', (v_apres - v_avant)::text);

  perform pg_temp.en('eeeeeeee-0000-0000-0000-000000000001');
  update club_matches set score = '2-1' where id = v_match;
  perform pg_temp.hors();
  perform pg_temp.note('journal : un score saisi devient « résultat »', 'oui',
    case when exists (select 1 from club_onboarding_events where club_id = (select club_id from ctx)
                       and action = 'resultat' and auteur_id = 'eeeeeeee-0000-0000-0000-000000000001')
         then 'oui' else 'non' end);
end $$;

-- ── Le fil d'activité et les sections disent qui ───────────────────────────────
do $$
declare v_texte text; v_qui text; v_nb int; v_oblig text; v_par text;
begin
  perform pg_temp.en('eeeeeeee-0000-0000-0000-000000000001');
  select texte, qui into v_texte, v_qui from club_journal((select club_id from ctx), 20) where texte like 'a créé%' limit 1;
  select count(*), string_agg(cle, ',' order by cle) filter (where obligatoire),
         max(derniere_par) filter (where cle = 'equipes')
    into v_nb, v_oblig, v_par
    from club_onboarding_sections((select club_id from ctx));
  perform pg_temp.hors();
  perform pg_temp.note('fil d''activité : « Zoé Cockpit a créé 2 équipes »', 'Zoé Cockpit a créé 2 équipes',
    coalesce(v_qui || ' ' || v_texte, 'rien'));
  perform pg_temp.note('sections : 9', '9', v_nb::text);
  perform pg_temp.note('sections : les 6 obligatoires', 'calendrier,droit_image,entrainements,equipes,identite,responsables', v_oblig);
  perform pg_temp.note('sections : dernière modification des équipes par le CM', 'Zoé Cockpit', coalesce(v_par, 'nul'));
end $$;

-- ── Une invitation préparée : l'équipe n'est plus « sans coach » ──────────────
do $$
declare v_avant text; v_apres text;
begin
  perform pg_temp.en('eeeeeeee-0000-0000-0000-000000000001');
  select encadrant_statut into v_avant from club_equipes_etat((select club_id from ctx)) where nom = 'ZZ Cockpit A';
  perform preparer_invitation_club((select club_id from ctx), 'zz-coach-cockpit@example.invalid', 'coach', 'Nina', 'Test', null, '["ZZ Cockpit A"]'::jsonb);
  select encadrant_statut into v_apres from club_equipes_etat((select club_id from ctx)) where nom = 'ZZ Cockpit A';
  perform pg_temp.hors();
  perform pg_temp.note('équipe : sans encadrant, puis invitation préparée', 'aucun → prepare', coalesce(v_avant, '?') || ' → ' || coalesce(v_apres, '?'));
end $$;

-- ── Le CM note les coordonnées du président (v118) ───────────────────────────
do $$
declare v_par text; v_texte text; v_connu boolean;
begin
  perform pg_temp.en('eeeeeeee-0000-0000-0000-000000000001');
  insert into client_organigramme (client_id, role, prenom, nom, email)
  select portail_client_id, 'Président', 'Zed', 'Président', 'zz-president-contact@example.invalid'
    from clubs where id = (select club_id from ctx);
  select derniere_par into v_par from club_onboarding_sections((select club_id from ctx)) where cle = 'responsables';
  select texte into v_texte from club_journal((select club_id from ctx), 30) where texte like '%coordonnées du président%' limit 1;
  perform pg_temp.hors();
  v_connu := club_president_connu((select club_id from ctx));
  perform pg_temp.note('président : ses coordonnées suffisent à le rendre connu', 'oui', case when v_connu then 'oui' else 'non' end);
  -- Mesuré sur l'action elle-même : la section a déjà été touchée plus haut par l'invitation
  -- d'un coach, son auteur seul ne prouverait rien (vu vert à tort le 10/09/2026).
  perform pg_temp.note('journal : les coordonnées du président, notées par le CM', 'oui',
    case when exists (select 1 from club_onboarding_events where club_id = (select club_id from ctx)
                       and action = 'contact_president' and auteur_id = 'eeeeeeee-0000-0000-0000-000000000001')
         then 'oui' else 'non' end);
  perform pg_temp.note('responsables : dernière modification par le CM', 'Zoé Cockpit', coalesce(v_par, 'nul'));
  perform pg_temp.note('fil d''activité : « a noté les coordonnées du président »', 'oui', case when v_texte is not null then 'oui' else 'non' end);
end $$;

-- ── Le lancement ──────────────────────────────────────────────────────────────
do $$
declare v_ok text; v_statut jsonb; v_res jsonb;
begin
  -- Écrire lance_at soi-même, sans passer par lancer_club : refusé.
  perform pg_temp.en('eeeeeeee-0000-0000-0000-000000000001');
  begin
    update clubs set lance_at = now() where id = (select club_id from ctx);
    v_ok := 'autorisé';
  exception when others then v_ok := 'refusé';
  end;
  perform pg_temp.hors();
  perform pg_temp.note('lancement : écrire lance_at directement', 'refusé', v_ok);

  -- Rendre la configuration obligatoire complète, puis lancer.
  update clubs set droit_image_mode = coalesce(droit_image_mode, 'inscription'),
                   adresse = coalesce(adresse, 'ZZ adresse de test'),
                   ville = coalesce(ville, 'Villemomble')
   where id = (select club_id from ctx);

  perform pg_temp.en('eeeeeeee-0000-0000-0000-000000000001');
  v_statut := club_statut_lancement((select club_id from ctx));
  begin
    v_res := lancer_club((select club_id from ctx));
    v_ok := 'autorisé';
  exception when others then v_ok := 'refusé : ' || sqlerrm;
  end;
  perform pg_temp.hors();
  perform pg_temp.note('lancement : club complet, statut « prêt »', 'pret', coalesce(v_statut->>'statut', '?') ||
    case when v_statut->>'statut' <> 'pret' then ' (' || (v_statut->>'sections_manquantes') || ')' else '' end);
  perform pg_temp.note('lancement : le CM lance', 'autorisé', v_ok);
  perform pg_temp.note('lancement : les invitations préparées sont rendues pour envoi', 'oui',
    case when v_res->'invitations' @> '[{"email":"zz-coach-cockpit@example.invalid"}]' then 'oui' else 'non' end);
  perform pg_temp.note('lancement : lance_par = le CM', 'oui',
    case when (select lance_par from clubs where id = (select club_id from ctx)) = 'eeeeeeee-0000-0000-0000-000000000001' then 'oui' else 'non' end);
  perform pg_temp.note('lancement : le journal le note', 'oui',
    case when exists (select 1 from club_onboarding_events where club_id = (select club_id from ctx) and action = 'lancement') then 'oui' else 'non' end);

  perform pg_temp.en('eeeeeeee-0000-0000-0000-000000000001');
  begin perform lancer_club((select club_id from ctx)); v_ok := 'autorisé';
  exception when others then v_ok := 'refusé'; end;
  v_statut := club_statut_lancement((select club_id from ctx));
  perform pg_temp.hors();
  perform pg_temp.note('lancement : une seconde fois', 'refusé', v_ok);
  perform pg_temp.note('lancement : statut « actif »', 'actif', v_statut->>'statut');
end $$;

-- ── Le tableau de bord porte les nouveaux compteurs ───────────────────────────
do $$
declare v jsonb;
begin
  perform pg_temp.en('eeeeeeee-0000-0000-0000-000000000001');
  v := cm_tableau_de_bord((select club_id from ctx));
  perform pg_temp.hors();
  perform pg_temp.note('tableau de bord : invitations préparées comptées', 'oui',
    case when (v->'a_faire'->>'invitations_preparees')::int >= 1 then 'oui' else 'non' end);
  perform pg_temp.note('tableau de bord : le mois Full Communication', 'oui',
    case when v ? 'mois' and v->'mois' ? 'presences_prevues' then 'oui' else 'non' end);
  perform pg_temp.note('tableau de bord : les anciennes clés sont là', 'oui',
    case when v ? 'aujourdhui' and v ? 'semaine' and v ? 'adoption' and v->'a_faire' ? 'resultats_manquants' then 'oui' else 'non' end);
end $$;

-- ── Personne d'autre ──────────────────────────────────────────────────────────
do $$
declare v_qui text; f text; v_ok text;
begin
  foreach v_qui in array array['coach','autre_cm'] loop
    foreach f in array array['club_sante','club_journal','club_onboarding_sections','club_equipes_etat','club_statut_lancement','lancer_club'] loop
      perform pg_temp.en(case v_qui when 'coach' then 'eeeeeeee-0000-0000-0000-000000000002'::uuid else 'eeeeeeee-0000-0000-0000-000000000003'::uuid end);
      begin
        execute case f when 'club_sante' then 'select club_sante($1)'
                       when 'club_journal' then 'select count(*) from club_journal($1, 5)'
                       when 'club_onboarding_sections' then 'select count(*) from club_onboarding_sections($1)'
                       when 'club_equipes_etat' then 'select count(*) from club_equipes_etat($1)'
                       when 'club_statut_lancement' then 'select club_statut_lancement($1)'
                       else 'select lancer_club($1)' end
          using (select club_id from ctx);
        v_ok := 'autorisé';
      exception when others then v_ok := 'refusé';
      end;
      perform pg_temp.hors();
      perform pg_temp.note(f || ' — ' || v_qui, 'refusé', v_ok);
    end loop;
  end loop;
end $$;

select case when attendu = obtenu then '✅' else '❌' end as ok, controle, attendu, obtenu from verdicts;

rollback;
