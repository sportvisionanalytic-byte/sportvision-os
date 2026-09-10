-- Presences : aucun quota, aucune obligation, et un retrait possible tant que rien n'est engage.
--
-- LES REGLES, telles que Fouka les a posees le 10/09/2026 :
--   aucun quota ; aucun « 0/12 » ; aucune obligation de couvrir un match ; le CM peut prevoir une
--   presence librement ; il peut la retirer AVANT engagement de la Production ; une fois la mission
--   creee, les protections existantes s'appliquent ; le tout remonte a l'OS Production.
--
-- OU CA SE JOUE, ET POURQUOI CE N'EST PAS OU ON CROIT. Deux surfaces portent le mot « presence »
-- et il ne faut pas les confondre :
--
--   • cote CLUB (Club+), `coverage_wishes` : le club SIGNALE un evenement qu'il aimerait voir
--     couvert. Reserve aux membres du club (admin, president, comm, directeur_sportif). Un CM
--     SportVision n'y a pas acces, et c'est voulu : il decide, il ne demande pas.
--   • cote SPORTVISION (l'OS), `planned_presences` : le CM PREVOIT reellement la presence, dans le
--     plan mensuel du client. C'est ici que vivent les regles ci-dessus.
--
-- Ce fichier mesure la seconde. Le « 0/12 » relevait de l'affichage et a ete retire le meme jour ;
-- ce qui doit tenir dans la duree, c'est qu'aucune limite ne soit REIMPOSEE en base, et que le
-- point de non-retour reste au bon endroit : apres la creation de la mission, pas avant.
--
-- Tout est fabrique dans la transaction et annule.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $i$;

do $$
declare
  cl uuid; cm uuid; cmVoisin uuid; plan uuid; planVoisin uuid; clVoisin uuid;
  pres uuid; e text[] := '{}'; n integer; i integer; pf uuid;
begin
  perform set_config('role','postgres',true);
  pf := pole_football_id();

  -- Deux CM, deux clients : le second sert a verifier qu'on ne prevoit rien chez le voisin.
  cm := gen_random_uuid(); cmVoisin := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (cm,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-cm1-'||cm||'@example.invalid','',now(),now(),now()),
         (cmVoisin,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-cm2-'||cmVoisin||'@example.invalid','',now(),now(),now());
  insert into profiles (id, role, prenom, nom, email, actif) values
    (cm,'cm','ZZ','CM1','zz-cm1@example.invalid',true),
    (cmVoisin,'cm','ZZ','CM2','zz-cm2@example.invalid',true);
  insert into pole_affectations (pole_id, user_id, role_pole) values (pf,cm,'membre'), (pf,cmVoisin,'membre')
    on conflict do nothing;

  insert into clients (nom, statut_relation, cm_id) values ('ZZ Client Presences','client',cm) returning id into cl;
  insert into clients (nom, statut_relation, cm_id) values ('ZZ Client Voisin','client',cmVoisin) returning id into clVoisin;

  insert into monthly_production_plans (client_id, cm_id, mois) values (cl, cm, date_trunc('month', current_date)::date)
    returning id into plan;
  insert into monthly_production_plans (client_id, cm_id, mois) values (clVoisin, cmVoisin, date_trunc('month', current_date)::date)
    returning id into planVoisin;

  perform pg_temp.incarner(cm);

  -- ══ 1. AUCUN QUOTA ═══════════════════════════════════════════════════════
  -- Trente presences d'affilee sur un seul mois. Si une limite de saison avait survecu quelque
  -- part, elle se verrait ici : douze etait le chiffre affiche par l'ancienne barre de progression.
  begin
    for i in 1..30 loop
      insert into planned_presences (plan_id, date_presence, equipe, type_couverture, statut)
      values (plan, current_date + i, 'ZZ Equipe', 'photo', 'prevu');
    end loop;
  exception when others then
    e := e || ('Une limite bloque la prevision de presences — '||left(sqlerrm,70))::text;
  end;

  select count(*) into n from planned_presences where plan_id = plan;
  if n < 30 then
    e := e || format('Seules %s presences sur 30 ont ete acceptees : une limite subsiste', n);
  end if;

  -- ══ 2. LE RETRAIT AVANT ENGAGEMENT ═══════════════════════════════════════
  select id into pres from planned_presences where plan_id = plan order by date_presence limit 1;

  begin
    update planned_presences set equipe = 'ZZ Equipe modifiee' where id = pres;
    get diagnostics n = row_count;
    if n = 0 then e := e || 'Le CM ne peut pas modifier une presence qu il a prevue'::text; end if;
  exception when others then
    e := e || ('Modifier une presence prevue est refuse — '||left(sqlerrm,60))::text;
  end;

  begin
    delete from planned_presences where id = pres;
    get diagnostics n = row_count;
    if n = 0 then e := e || 'Le CM ne peut pas retirer une presence avant engagement'::text; end if;
  exception when others then
    e := e || ('Retirer une presence avant engagement est refuse — '||left(sqlerrm,60))::text;
  end;

  -- ══ 3. LE POINT DE NON-RETOUR ════════════════════════════════════════════
  -- Des que la mission existe, le CM ne defait plus seul : c'est le sens de
  -- pp_cm_affecte_update (statut <> 'mission_creee').
  perform set_config('role','postgres',true);
  select id into pres from planned_presences where plan_id = plan order by date_presence limit 1;
  update planned_presences set statut = 'mission_creee' where id = pres;

  perform pg_temp.incarner(cm);
  begin
    update planned_presences set equipe = 'ZZ tentative apres mission' where id = pres;
    get diagnostics n = row_count;
    if n > 0 then
      e := e || 'Le CM a modifie une presence DEJA transformee en mission'::text;
    end if;
  exception when others then null; end;

  -- ══ 4. AUCUNE OBLIGATION ═════════════════════════════════════════════════
  -- Un plan mensuel sans aucune presence doit rester parfaitement valide : rien n'oblige a couvrir.
  perform set_config('role','postgres',true);
  declare
    planVide uuid;
  begin
    insert into monthly_production_plans (client_id, cm_id, mois)
    values (cl, cm, (date_trunc('month', current_date) + interval '1 month')::date) returning id into planVide;
    if planVide is null then e := e || 'Un plan mensuel sans presence est refuse'::text; end if;
  exception when others then
    e := e || ('Un plan mensuel sans aucune presence est refuse — '||left(sqlerrm,60))::text;
  end;

  -- ══ 5. LE CLIENT DU VOISIN ═══════════════════════════════════════════════
  perform pg_temp.incarner(cm);
  begin
    insert into planned_presences (plan_id, date_presence, equipe, type_couverture, statut)
    values (planVoisin, current_date + 5, 'ZZ Intrusion', 'photo', 'prevu');
    e := e || 'Un CM a prevu une presence sur le plan d un autre CM'::text;
  exception when others then null; end;

  select count(*) into n from planned_presences where plan_id = planVoisin;
  if n > 0 then e := e || 'Une presence a ete creee chez le voisin'::text; end if;

  -- ══ 6. VITALITE ══════════════════════════════════════════════════════════
  -- Sans ce controle, tout ce qui precede pourrait passer parce que RIEN ne fonctionne.
  select count(*) into n from planned_presences where plan_id = plan;
  if n < 25 then
    e := e || format('DECOR MORT : seules %s presences subsistent sur le plan du CM', n);
  end if;

  perform set_config('role','postgres',true);
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — aucune limite au nombre de presences prevues, aucune obligation de couvrir, le CM modifie et retire librement tant que la mission n existe pas, ne modifie plus apres, et ne prevoit rien sur le plan d un autre CM.' as verdict;

rollback;
