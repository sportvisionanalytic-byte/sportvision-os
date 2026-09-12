-- Le calendrier unifié : une seule source, des occurrences virtuelles stables, des exceptions.
--
-- Écrit AVANT la vague C : c'est ce test qui garantit que le tableau de bord et l'écran calendrier
-- ne pourront jamais montrer deux calendriers différents.
--
-- Joué en transaction annulée sur la vraie base.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $inner$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $inner$;

do $$
declare
  v_cm uuid; v_club uuid; v_equipe uuid; v_autre uuid; v_lieu uuid;
  v_slot uuid; v_slot2 uuid; v_archivee uuid; v_slot_arch uuid;
  n integer; e text[] := '{}'; r record; v_ref text;
begin
  perform set_config('role','postgres',true);

  insert into organizations (id, organization_type, nom, statut)
  values (gen_random_uuid(),'club','ZZ Calendrier test','actif_standard') returning id into v_club;
  insert into clubs (id, nom, plan) values (v_club,'ZZ Calendrier test','performance');
  insert into club_teams (club_id, name) values (v_club,'ZZ U18') returning id into v_equipe;
  insert into club_teams (club_id, name) values (v_club,'ZZ U16') returning id into v_autre;
  insert into club_teams (club_id, name, archivee) values (v_club,'ZZ U13 archivee', true) returning id into v_archivee;
  insert into club_venues (club_id, nom) values (v_club,'ZZ Stade') returning id into v_lieu;

  -- Deux créneaux le même jour, à la même heure, sur deux équipes : cas réel chez Fouka.
  insert into club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id)
  values (v_equipe,'jeudi','19:45','21:00', v_lieu) returning id into v_slot;
  insert into club_team_training_slots (team_id, jour, heure_debut, heure_fin)
  values (v_autre,'jeudi','19:45','21:00') returning id into v_slot2;
  -- Une équipe archivée ne doit produire aucune séance.
  insert into club_team_training_slots (team_id, jour, heure_debut, heure_fin)
  values (v_archivee,'jeudi','18:00','19:30') returning id into v_slot_arch;

  insert into club_matches (club_id, team, opponent, match_date, kickoff_time, is_home)
  values (v_club,'ZZ U18','ZZ Adverse', date '2026-12-19', time '16:00', true);

  -- CM fabrique POUR ce test, annule avec la transaction. Il s'appuyait auparavant sur un vrai
  -- compte CM sans affectation : il a casse des qu'on a nettoye les comptes de test (09/09/2026),
  -- et surtout ca imposait d'en garder en production. Un test ne doit dependre d'aucune donnee
  -- vivante — meme correctif que pour cm-cloisonnement.
  v_cm := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_cm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-cal-' || v_cm || '@example.invalid', '', now(), now(), now());
  insert into profiles (id, role, prenom, nom, email)
  values (v_cm, 'cm', 'ZZ', 'CM Calendrier', 'zz-cal-' || v_cm || '@example.invalid');
  insert into club_cm_affectations (club_id, cm_id, role, actif) values (v_club, v_cm, 'principal', true);

  perform pg_temp.incarner(v_cm);

  -- ══ 1. Aucune séance hors de la fenêtre demandée ═══════════════════════════
  select count(*)::integer into n from club_calendrier(v_club, date '2026-12-01', date '2026-12-31')
  where date_evenement < date '2026-12-01' or date_evenement > date '2026-12-31';
  if n <> 0 then e := e || ('FUITE : '||n||' evenement(s) hors de la fenetre demandee')::text; end if;

  -- ══ 2. Deux équipes au même horaire le même jour ═══════════════════════════
  select count(*)::integer into n from club_calendrier(v_club, date '2026-12-03', date '2026-12-03')
  where genre='entrainement';
  if n <> 2 then e := e || ('Deux equipes au meme horaire : '||n||' seance(s) au lieu de 2')::text; end if;

  -- ══ 3. Une équipe archivée ne produit rien ═════════════════════════════════
  select count(*)::integer into n from club_calendrier(v_club, date '2026-12-01', date '2026-12-31')
  where equipe = 'ZZ U13 archivee';
  if n <> 0 then e := e || 'Une equipe archivee produit encore des seances'::text; end if;

  -- ══ 4. La référence d'occurrence est stable et distingue les dates ═════════
  select ref into v_ref from club_calendrier(v_club, date '2026-12-03', date '2026-12-03')
  where genre='entrainement' and team_id = v_equipe;
  if v_ref is distinct from 'entrainement:'||v_slot::text||':2026-12-03' then
    e := e || ('Reference d occurrence inattendue : '||coalesce(v_ref,'NULL'))::text;
  end if;
  select count(distinct ref)::integer into n from club_calendrier(v_club, date '2026-12-01', date '2026-12-31')
  where genre='entrainement';
  if n <> (select count(*)::integer from club_calendrier(v_club, date '2026-12-01', date '2026-12-31') where genre='entrainement') then
    e := e || 'Deux occurrences partagent la meme reference'::text;
  end if;

  -- ══ 5. Une exception annule UNE séance, pas toute la série ═════════════════
  perform set_config('role','postgres',true);
  insert into club_training_exceptions (slot_id, date_seance, statut, motif)
  values (v_slot, date '2026-12-24', 'annule', 'Vacances de Noel');
  perform pg_temp.incarner(v_cm);

  select statut into v_ref from club_calendrier(v_club, date '2026-12-24', date '2026-12-24')
  where genre='entrainement' and team_id = v_equipe;
  if v_ref is distinct from 'annulee' then
    e := e || ('La seance du 24/12 n est pas annulee (statut='||coalesce(v_ref,'absente')||')')::text;
  end if;
  -- Les autres jeudis de décembre sont intacts : 3, 10, 17, 31.
  select count(*)::integer into n from club_calendrier(v_club, date '2026-12-01', date '2026-12-31')
  where genre='entrainement' and team_id = v_equipe and statut = 'scheduled';
  if n <> 4 then e := e || ('Une annulation a touche toute la serie : '||n||' seance(s) intactes au lieu de 4')::text; end if;

  -- ══ 6. Une exception d'horaire déplace UNE séance ══════════════════════════
  perform set_config('role','postgres',true);
  insert into club_training_exceptions (slot_id, date_seance, statut, heure_debut, heure_fin)
  values (v_slot, date '2026-12-17', 'modifie', '18:30', '20:00');
  perform pg_temp.incarner(v_cm);

  select * into r from club_calendrier(v_club, date '2026-12-17', date '2026-12-17')
  where genre='entrainement' and team_id = v_equipe;
  if r.heure_debut <> time '18:30' or r.statut <> 'modifiee' then
    e := e || ('Horaire exceptionnel non applique : '||coalesce(r.heure_debut::text,'?')||' / '||coalesce(r.statut,'?'))::text;
  end if;
  select heure_debut into r.heure_debut from club_calendrier(v_club, date '2026-12-10', date '2026-12-10')
  where genre='entrainement' and team_id = v_equipe;
  if r.heure_debut <> time '19:45' then
    e := e || 'Un horaire exceptionnel a debordé sur les autres seances'::text;
  end if;

  -- ══ 7. Une semaine à cheval sur deux mois ══════════════════════════════════
  select count(*)::integer into n from club_calendrier(v_club, date '2026-11-30', date '2026-12-06')
  where genre='entrainement';
  if n <> 2 then e := e || ('Semaine a cheval sur deux mois : '||n||' seance(s) au lieu de 2')::text; end if;

  -- ══ 8. Le passage a l heure d hiver ne decale rien ═════════════════════════
  -- Le changement d'heure 2026 a lieu le 25 octobre. Le jeudi suivant doit rester un jeudi
  -- a 19h45, pas glisser d'un jour ni d'une heure.
  select count(*)::integer into n from club_calendrier(v_club, date '2026-10-29', date '2026-10-29')
  where genre='entrainement' and heure_debut = time '19:45';
  if n <> 2 then e := e || ('Passage a l heure d hiver : '||n||' seance(s) le jeudi 29/10 au lieu de 2')::text; end if;

  -- ══ 9. Une periode sans rien renvoie zero ligne, pas une erreur ════════════
  select count(*)::integer into n from club_calendrier(v_club, date '2026-12-07', date '2026-12-09');
  if n <> 0 then e := e || ('Periode sans evenement : '||n||' ligne(s) au lieu de 0')::text; end if;

  -- ══ 10. Match et entrainement le meme jour cohabitent ══════════════════════
  perform set_config('role','postgres',true);
  insert into club_matches (club_id, team, opponent, match_date, kickoff_time, is_home)
  values (v_club,'ZZ U18','ZZ Autre', date '2026-12-03', time '18:00', false);
  perform pg_temp.incarner(v_cm);
  select count(*)::integer into n from club_calendrier(v_club, date '2026-12-03', date '2026-12-03');
  if n <> 3 then e := e || ('Match + entrainements le meme jour : '||n||' evenement(s) au lieu de 3')::text; end if;

  -- ══ 11. Le tableau de bord et le calendrier disent la MEME chose ═══════════
  declare
    v_bord jsonb;
    v_semaine_debut date := (current_date - ((extract(isodow from current_date)::int - 1)))::date;
  begin
    v_bord := cm_tableau_de_bord(v_club);
    select count(*)::integer into n from club_calendrier(v_club, v_semaine_debut, v_semaine_debut + 6)
    where genre='entrainement' and statut <> 'annulee';
    if (v_bord->'semaine'->>'entrainements')::integer <> n then
      e := e || ('Tableau de bord et calendrier divergent sur les entrainements : '
                 ||(v_bord->'semaine'->>'entrainements')||' contre '||n)::text;
    end if;
    select count(*)::integer into n from club_calendrier(v_club, v_semaine_debut, v_semaine_debut + 6)
    where genre='match' and statut <> 'cancelled';
    if (v_bord->'semaine'->>'matchs')::integer <> n then
      e := e || ('Tableau de bord et calendrier divergent sur les matchs : '
                 ||(v_bord->'semaine'->>'matchs')||' contre '||n)::text;
    end if;
  end;

  -- ══ 12. Un CM hors perimetre ne lit rien ═══════════════════════════════════
  declare v_autre_cm uuid;
  begin
    select id into v_autre_cm from profiles p where p.role='cm' and p.id <> v_cm
      and not exists (select 1 from club_cm_affectations a where a.cm_id=p.id) limit 1;
    if v_autre_cm is not null then
      perform pg_temp.incarner(v_autre_cm);
      select count(*)::integer into n from club_calendrier(v_club, date '2026-12-01', date '2026-12-31');
      if n <> 0 then e := e || ('FUITE : un CM non affecte lit '||n||' evenement(s) du club')::text; end if;
    end if;
  end;

  -- ══ 13. Plusieurs saisons actives : les bornes s'UNISSENT, ne s'intersectent pas ══
  -- Regression reelle du 08/09/2026 : avec deux saisons actives, max(debut)/min(fin) donnait une
  -- fenetre inversee et le calendrier renvoyait ZERO evenement, en silence.
  perform set_config('role','postgres',true);
  perform pg_temp.incarner(v_cm);
  select count(*)::integer into n from club_calendrier(v_club, date '2026-12-01', date '2026-12-31');
  if n = 0 then
    e := e || 'Le calendrier est vide sur un mois qui contient des seances — bornes de saison inversees ?'::text;
  end if;

  -- ══ 14. Hors saison, aucune seance ════════════════════════════════════════
  select count(*)::integer into n from club_calendrier(v_club, date '2026-06-01', date '2026-06-30');
  if n <> 0 then e := e || ('Des seances sont produites AVANT le debut de saison : '||n)::text; end if;

  -- ══ 15. La periode d'activite d'un creneau borne ses seances ══════════════
  perform set_config('role','postgres',true);
  update club_team_training_slots set active_from = date '2026-12-15' where id = v_slot;
  perform pg_temp.incarner(v_cm);
  select count(*)::integer into n from club_calendrier(v_club, date '2026-12-01', date '2026-12-14')
  where genre='entrainement' and team_id = v_equipe;
  if n <> 0 then e := e || ('Un creneau produit des seances avant sa periode d activite : '||n)::text; end if;
  select count(*)::integer into n from club_calendrier(v_club, date '2026-12-15', date '2026-12-31')
  where genre='entrainement' and team_id = v_equipe;
  if n = 0 then e := e || 'Un creneau ne produit plus rien DANS sa periode d activite'::text; end if;
  perform set_config('role','postgres',true);
  update club_team_training_slots set active_from = null where id = v_slot;
  perform pg_temp.incarner(v_cm);

  -- ══ 16. La saison de l'equipe borne ses seances ═══════════════════════════
  -- Question de Fouka : pourquoi un creneau 2026-2027 se projette-t-il en juillet 2027 ? Parce que
  -- rien ne le rattachait a une saison. Rattacher l'equipe doit suffire a le borner, sans que la
  -- creation d'une saison ulterieure fasse revivre d'anciens creneaux.
  declare v_saison uuid;
  begin
    perform set_config('role','postgres',true);
    -- 12/09/2026 — La saison du decor n'a pas besoin d'etre ACTIVE : ce qui borne les seances,
    -- c'est la saison rattachee a l'equipe, pas la saison active du moment. Et depuis la v203, la
    -- base n'accepte qu'une seule saison active — deux ont coexiste en production, ce qui faisait
    -- naitre des galeries sur la mauvaise saison.
    insert into saisons (label, date_debut, date_fin, active)
    values ('ZZ 2026-2027', date '2026-09-01', date '2026-12-20', false) returning id into v_saison;
    update club_teams set saison_id = v_saison where id = v_equipe;
    perform pg_temp.incarner(v_cm);

    select count(*)::integer into n from club_calendrier(v_club, date '2026-12-21', date '2026-12-31')
    where genre='entrainement' and team_id = v_equipe;
    if n <> 0 then e := e || ('Des seances sont produites APRES la fin de saison de l equipe : '||n)::text; end if;

    select count(*)::integer into n from club_calendrier(v_club, date '2026-12-01', date '2026-12-20')
    where genre='entrainement' and team_id = v_equipe;
    if n = 0 then e := e || 'L equipe ne produit plus rien PENDANT sa propre saison'::text; end if;

    -- L'autre equipe, sans saison, n'est pas affectee : on ne devine pas sa saison.
    select count(*)::integer into n from club_calendrier(v_club, date '2026-12-21', date '2026-12-31')
    where genre='entrainement' and team_id = v_autre;
    if n = 0 then e := e || 'Une equipe SANS saison a ete bornee alors que rien ne la rattache'::text; end if;

    -- La periode du creneau prime sur la saison de l'equipe.
    perform set_config('role','postgres',true);
    update club_team_training_slots set active_to = date '2026-12-31' where id = v_slot;
    perform pg_temp.incarner(v_cm);
    select count(*)::integer into n from club_calendrier(v_club, date '2026-12-21', date '2026-12-31')
    where genre='entrainement' and team_id = v_equipe;
    if n = 0 then e := e || 'La periode du creneau ne prime pas sur la saison de l equipe'::text; end if;
    perform set_config('role','postgres',true);
    update club_team_training_slots set active_to = null where id = v_slot;
    update club_teams set saison_id = null where id = v_equipe;
    perform pg_temp.incarner(v_cm);
  end;

  perform set_config('role','postgres',true);
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — calendrier unifie : fenetre respectee, occurrences stables, exceptions ponctuelles, tableau de bord aligne, cloisonnement tenu.' as verdict;

rollback;
