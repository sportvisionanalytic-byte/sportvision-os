-- Valider le travail d'une mission crédite les XP, une seule fois (25/09/2026).
--
-- POURQUOI CE TEST EXISTE. La fonction qui calculait l'XP de mission — 100 points, plus 50 pour
-- le responsable — vivait dans le navigateur et n'était appelée NULLE PART. Du code mort depuis
-- son écriture. Elle se déclenchait en plus sur le statut de la PRESTATION et non sur la
-- validation du travail : un opérateur dont le travail était refusé aurait été crédité quand même.
--
-- Les XP sont donc posés dans `mission_valider_travail`, au moment où la décision est prise et du
-- côté du serveur. Ce test vérifie les quatre propriétés qui comptent, par le chemin réel — avec
-- l'identité d'un vrai compte Production, comme PostgREST la présente.
--
-- TOUT SE PASSE DANS UNE TRANSACTION ANNULÉE. Rien n'est écrit : aucun opérateur réel ne reçoit
-- de notification, aucune mission réelle n'est validée, aucun XP n'est crédité. C'est la seule
-- façon honnête d'éprouver une fonction qui écrit, sans prendre une décision métier à la place
-- de la Production.
begin;

create temp table _mesure(cle text, attendu text, obtenu text);

do $$
declare
  v_prod uuid; v_aff uuid; v_op uuid; v_resp boolean;
  v_xp_avant integer; v_xp_apres integer;
  v_r1 jsonb; v_r2 jsonb; v_evts integer; v_notif integer;
  v_attendu integer;
begin
  select id into v_prod from profiles where role = 'prod' limit 1;
  if v_prod is null then
    insert into _mesure values ('aucun compte Production en base', 'un compte', 'aucun');
    return;
  end if;

  select pe.id, pe.collaborateur_id, pe.est_responsable into v_aff, v_op, v_resp
  from prestations_equipe pe
  join profiles p on p.id = pe.collaborateur_id and p.role = 'photo'
  where pe.travail_valide is null and pe.collaborateur_id <> v_prod
  limit 1;
  if v_aff is null then
    insert into _mesure values ('aucune mission a valider', 'une mission', 'aucune');
    return;
  end if;

  v_attendu := 100 + case when v_resp then 50 else 0 end;
  select coalesce(xp, 0) into v_xp_avant from profiles where id = v_op;

  -- On se présente comme PostgREST le ferait pour ce compte Production.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_prod::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_r1 := mission_valider_travail(v_aff, true, null);
  -- Deuxième clic sur le même bouton : rien ne doit bouger.
  v_r2 := mission_valider_travail(v_aff, true, null);
  perform set_config('role', 'postgres', true);

  select coalesce(xp, 0) into v_xp_apres from profiles where id = v_op;
  select count(*) into v_evts from xp_events
   where source_id = v_aff and source_type = 'prestations_equipe' and type = 'prestation';
  select count(*) into v_notif from notifications
   where destinataire_id = v_op and type = 'mission_verdict'
     and prestation_id = (select prestation_id from prestations_equipe where id = v_aff);

  insert into _mesure values
    ('le travail est marqué validé', 'true',
     (select travail_valide::text from prestations_equipe where id = v_aff)),
    ('les XP sont crédités', v_attendu::text, coalesce(v_r1->>'xp', 'rien')),
    ('le profil monte d''autant', v_attendu::text, (v_xp_apres - v_xp_avant)::text),
    ('revalider ne recrédite pas', '0', coalesce(v_r2->>'xp', 'rien')),
    ('une seule ligne d''historique', '1', v_evts::text),
    ('une seule notification', '1', v_notif::text);
end $$;

select case when count(*) filter (where attendu is distinct from obtenu) = 0
            then '✅ ' || count(*) || ' vérifications passées : les XP tombent à la validation, une seule fois'
            else '❌ ' || string_agg(cle || ' — attendu ' || attendu || ', obtenu ' || obtenu, ' | ')
                          filter (where attendu is distinct from obtenu)
       end as verdict
from _mesure;

rollback;
