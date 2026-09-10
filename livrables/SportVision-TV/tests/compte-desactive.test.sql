-- Un compte OS désactivé ne lit plus rien et n'agit plus sur rien, même avec un jeton valide.
--
-- Décision du 10/09/2026 (migration-decisions-os-v1-compte-desactive.sql). Avant elle, un compte
-- désactivé gardait l'API jusqu'à une heure : is_staff() et toutes les vérifications d'identité
-- lisaient profiles.role sans lire profiles.actif.
--
-- Méthode : six collaborateurs fabriqués DANS la transaction (admin, secrétariat, RH, compta, CM
-- affecté à un club, photographe Responsable de pôle). Pour chacun, on se met réellement dans sa
-- peau (set local role authenticated + request.jwt.claims : c'est exactement ce que fait PostgREST
-- avec un jeton) et on mesure ce que la base lui rend — actif, puis désactivé, puis réactivé.
-- Réactivé doit rendre EXACTEMENT la même chose qu'actif : c'est ce qui prouve qu'on n'a rien
-- cassé pour les comptes actifs.
--
-- Rouge avant la migration (le compte désactivé lit encore), vert après.
-- Tout s'exécute dans une transaction annulée : rien ne subsiste.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $inner$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p::text, 'role', 'authenticated')::text, true);
end $inner$;

-- Revenir en postgres ET en service_role : le déclencheur protect_sensitive_profile_fields
-- refuse un changement de `actif` à quiconque n'est ni admin ni service_role. Sans ça, c'est
-- l'identité incarnée juste avant qui tenterait de désactiver le compte.
create or replace function pg_temp.redevenir_systeme() returns void language plpgsql as $inner$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $inner$;

-- Ce que voit le compte incarné. Une ligne par mesure, pour comparer actif / réactivé.
create or replace function pg_temp.mesurer() returns jsonb language plpgsql as $inner$
declare r jsonb := '{}'; n int; t text; b boolean; e text;
begin
  select count(*) into n from clients;                      r := r || jsonb_build_object('clients', n);
  select count(*) into n from prestations;                  r := r || jsonb_build_object('prestations', n);
  select count(*) into n from profiles;                     r := r || jsonb_build_object('profiles', n);
  select count(*) into n from notifications;                r := r || jsonb_build_object('notifications', n);
  select count(*) into n from poles;                        r := r || jsonb_build_object('poles', n);
  select count(*) into n from storage.objects;              r := r || jsonb_build_object('storage', n);
  select count(*) into n from secretariat_documents;        r := r || jsonb_build_object('secretariat_documents', n);
  r := r || jsonb_build_object('is_staff', is_staff());
  r := r || jsonb_build_object('get_my_role', get_my_role());
  r := r || jsonb_build_object('is_admin_or_rh', is_admin_or_rh());
  r := r || jsonb_build_object('media_pricing_staff', media_pricing_staff());
  select count(*) into n from cm_clubs_autorises();         r := r || jsonb_build_object('cm_clubs_autorises', n);
  r := r || jsonb_build_object('get_my_pole_ids', cardinality(get_my_pole_ids()));
  -- Une action : rentabilite_clubs_mois. On note son refus éventuel, pas son résultat.
  begin
    perform * from rentabilite_clubs_mois(current_date);
    e := 'passe';
  exception when others then e := sqlerrm; end;
  r := r || jsonb_build_object('rentabilite_clubs_mois', e);
  return r;
end $inner$;

do $$
declare
  v_club uuid;
  v_pole uuid;
  comptes text[][] := array[
    array['admin', ''], array['sec', ''], array['rh', ''], array['compta', ''],
    array['cm', 'affecte'], array['photo', 'responsable']
  ];
  i int; v_id uuid; v_role text;
  m_actif jsonb; m_off jsonb; m_react jsonb;
  e text[] := '{}';
begin
  perform pg_temp.redevenir_systeme();
  select id into v_club from clubs order by created_at limit 1;
  select id into v_pole from poles order by nom limit 1;

  for i in 1 .. array_length(comptes, 1) loop
    v_role := comptes[i][1];
    v_id := gen_random_uuid();
    perform pg_temp.redevenir_systeme();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-os-dec-desactive-' || v_role || '-' || v_id || '@example.invalid', '', now(), now(), now());
    insert into profiles (id, role, prenom, nom, actif) values (v_id, v_role, 'Zz', 'Essai ' || v_role, true);
    if comptes[i][2] = 'affecte' then
      insert into club_cm_affectations (club_id, cm_id) values (v_club, v_id);
    elsif comptes[i][2] = 'responsable' then
      insert into pole_affectations (pole_id, user_id, role_pole) values (v_pole, v_id, 'responsable');
    end if;

    perform pg_temp.incarner(v_id);
    m_actif := pg_temp.mesurer();

    perform pg_temp.redevenir_systeme();
    update profiles set actif = false where id = v_id;
    perform pg_temp.incarner(v_id);
    m_off := pg_temp.mesurer();

    perform pg_temp.redevenir_systeme();
    update profiles set actif = true where id = v_id;
    perform pg_temp.incarner(v_id);
    m_react := pg_temp.mesurer();

    raise notice '% actif     : %', v_role, m_actif;
    raise notice '% désactivé : %', v_role, m_off;

    -- Le compte actif doit réellement lire quelque chose, sinon le test ne prouve rien.
    if (m_actif->>'is_staff')::boolean is distinct from true then
      e := e || (v_role || ' actif : is_staff() ne vaut pas vrai — le test ne mesure rien');
    end if;
    if (m_actif->>'prestations')::int = 0 and (m_actif->>'clients')::int = 0 and (m_actif->>'poles')::int = 0 then
      e := e || (v_role || ' actif : ne lit rien — le test ne mesure rien');
    end if;

    -- Désactivé : plus rien, sauf SON profil (l'OS le lit à la connexion pour dire « désactivé »).
    if (m_off->>'clients')::int <> 0 then e := e || (v_role || ' désactivé lit encore ' || (m_off->>'clients') || ' clients'); end if;
    if (m_off->>'prestations')::int <> 0 then e := e || (v_role || ' désactivé lit encore ' || (m_off->>'prestations') || ' prestations'); end if;
    if (m_off->>'notifications')::int <> 0 then e := e || (v_role || ' désactivé lit encore ses notifications'); end if;
    if (m_off->>'poles')::int <> 0 then e := e || (v_role || ' désactivé lit encore les pôles'); end if;
    if (m_off->>'storage')::int <> 0 then e := e || (v_role || ' désactivé lit encore ' || (m_off->>'storage') || ' fichiers'); end if;
    if (m_off->>'secretariat_documents')::int <> 0 then e := e || (v_role || ' désactivé lit encore des documents du secrétariat'); end if;
    if (m_off->>'profiles')::int <> 1 then e := e || (v_role || ' désactivé : ' || (m_off->>'profiles') || ' profils lus, attendu 1 (le sien)'); end if;
    if (m_off->>'is_staff')::boolean then e := e || (v_role || ' désactivé : is_staff() vrai'); end if;
    if m_off->>'get_my_role' is not null then e := e || (v_role || ' désactivé : get_my_role() = ' || (m_off->>'get_my_role')); end if;
    if (m_off->>'is_admin_or_rh')::boolean then e := e || (v_role || ' désactivé : is_admin_or_rh() vrai'); end if;
    if (m_off->>'media_pricing_staff')::boolean then e := e || (v_role || ' désactivé : media_pricing_staff() vrai'); end if;
    if (m_off->>'cm_clubs_autorises')::int <> 0 then e := e || (v_role || ' désactivé : ' || (m_off->>'cm_clubs_autorises') || ' clubs autorisés'); end if;
    if (m_off->>'get_my_pole_ids')::int <> 0 then e := e || (v_role || ' désactivé : encore affecté à un pôle'); end if;
    if m_off->>'rentabilite_clubs_mois' = 'passe' then e := e || (v_role || ' désactivé : rentabilite_clubs_mois passe'); end if;

    -- Réactivé : exactement ce qu'il voyait actif.
    if m_react is distinct from m_actif then
      e := e || (v_role || ' réactivé ne retrouve pas son accès : ' || m_react::text || ' au lieu de ' || m_actif::text);
    end if;
  end loop;

  -- Le service_role (fonctions serveur, webhooks) n'a pas d'identité : rien ne change pour lui.
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  if (select count(*) from prestations) = 0 then
    e := e || 'service_role ne lit plus les prestations'::text;
  end if;
  if to_regprocedure('public.compte_os_desactive()') is null then
    e := e || 'compte_os_desactive() absente : migration-decisions-os-v1 non appliquée'::text;
  elsif public.compte_os_desactive() then
    e := e || 'compte_os_desactive() vrai pour service_role'::text;
  end if;

  perform pg_temp.redevenir_systeme();
  if array_length(e, 1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — désactivé : plus aucune lecture ni action (hors son propre profil) ; réactivé : exactement le même accès qu''avant ; service_role inchangé.' as verdict;

rollback;
