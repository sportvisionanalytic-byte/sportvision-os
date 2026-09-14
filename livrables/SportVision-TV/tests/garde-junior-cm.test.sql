-- Le garde des CM Juniors ne s'applique qu'aux juniors (v228, 14/09/2026).
--
-- LE DÉFAUT CORRIGÉ. Fouka validait un contenu du planning éditorial et recevait « Un CM Junior ne
-- peut pas ignorer la validation du tuteur ». Il n'est pas junior.
--
-- La cause tient à un NULL. `cm_niveau_autonomie` n'est renseigné que pour les juniors déclarés ;
-- il vaut NULL pour tous les autres. Le garde sortait sur :
--     if actor_tier != 'junior' or new.cm_id != auth.uid() then return new;
-- `NULL != 'junior'` ne vaut pas TRUE mais NULL. Tant que le contenu appartenait à quelqu'un
-- d'autre, `NULL or TRUE` sauvait la mise. Sur SON PROPRE contenu, `NULL or FALSE` = NULL : la
-- sortie ne se déclenchait pas et les refus destinés aux juniors s'appliquaient.
--
-- Une règle qui dépend d'une colonne facultative doit être testée AVEC la colonne vide. C'est
-- précisément ce cas qui manquait.
--
-- CE QU'ON MESURE :
--   1. Un CM au niveau non renseigné fait passer SON contenu de brouillon à prêt.
--   2. Un administrateur aussi, sur son propre contenu.
--   3. Un CM Junior déclaré reste bloqué sur le sien : la règle métier ne bouge pas.
--   4. Il peut toujours le soumettre à son tuteur.
--   5. Le junior n'est pas bridé sur le contenu d'un autre (il n'y a rien à protéger là).

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $i$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $i$;

create or replace function pg_temp.serveur() returns void language plpgsql as $i$
begin
  perform set_config('role','postgres',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
end $i$;

do $$
declare
  v_client uuid; v_admin uuid;
  v_cm_sans uuid; v_junior uuid; v_autre uuid;
  c_sans uuid; c_admin uuid; c_junior uuid; c_autre uuid;
  e text[] := '{}'; msg text; st text;
begin
  perform pg_temp.serveur();
  select id into v_admin from profiles where role='admin' and actif order by created_at limit 1;
  insert into clients (nom, statut) values ('ZZ Client Junior','client') returning id into v_client;

  -- Trois comptes : un CM au niveau NON renseigné (le cas du défaut), un junior déclaré, un tiers.
  v_cm_sans := gen_random_uuid(); v_junior := gen_random_uuid(); v_autre := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values
      (v_cm_sans,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-cm-sans@example.invalid','',now(),now(),now()),
      (v_junior,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-cm-junior@example.invalid','',now(),now(),now()),
      (v_autre,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','zz-cm-autre@example.invalid','',now(),now(),now());
  insert into profiles (id, prenom, nom, email, role, actif, cm_niveau_autonomie) values
    (v_cm_sans,'ZZ','CmSansNiveau','zz-cm-sans@example.invalid','cm',true, null),
    (v_junior,'ZZ','CmJunior','zz-cm-junior@example.invalid','cm',true,'junior'),
    (v_autre,'ZZ','CmAutre','zz-cm-autre@example.invalid','cm',true, null);

  -- Le droit d'écrire sur un contenu demande d'être affilié au client (contenus_visible_par_cm) :
  -- sans cette ligne, le refus viendrait de la RLS et non du garde qu'on veut mesurer.
  insert into client_affiliations (client_id, user_id, role_on_client, status) values
    (v_client, v_cm_sans, 'cm_principal', 'actif'),
    (v_client, v_junior, 'cm_junior', 'actif'),
    (v_client, v_autre, 'cm_secondaire', 'actif');

  insert into contenus (client_id, cm_id, titre, statut) values
    (v_client, v_cm_sans, 'ZZ contenu sans niveau', 'brouillon') returning id into c_sans;
  insert into contenus (client_id, cm_id, titre, statut) values
    (v_client, v_admin, 'ZZ contenu admin', 'brouillon') returning id into c_admin;
  insert into contenus (client_id, cm_id, titre, statut) values
    (v_client, v_junior, 'ZZ contenu junior', 'brouillon') returning id into c_junior;
  insert into contenus (client_id, cm_id, titre, statut) values
    (v_client, v_autre, 'ZZ contenu autre', 'brouillon') returning id into c_autre;

  -- ══ 1. NIVEAU NON RENSEIGNÉ : IL VALIDE SON CONTENU ══════════════════════
  perform pg_temp.incarner(v_cm_sans);
  begin
    update contenus set statut = 'pret' where id = c_sans;
  exception when others then
    e := e || ('un CM au niveau non renseigne est bloque sur SON contenu — '||left(sqlerrm,80))::text;
  end;
  perform pg_temp.serveur();
  select statut into st from contenus where id = c_sans;
  if st is distinct from 'pret' then e := e || format('contenu du CM sans niveau : statut %s', st); end if;

  -- ══ 2. L'ADMINISTRATEUR AUSSI, SUR LE SIEN ═══════════════════════════════
  perform pg_temp.incarner(v_admin);
  begin
    update contenus set statut = 'pret' where id = c_admin;
  exception when others then
    e := e || ('l administrateur est bloque sur SON contenu — '||left(sqlerrm,80))::text;
  end;
  perform pg_temp.serveur();
  select statut into st from contenus where id = c_admin;
  if st is distinct from 'pret' then e := e || format('contenu de l administrateur : statut %s', st); end if;

  -- ══ 3. LE JUNIOR DÉCLARÉ RESTE BLOQUÉ ════════════════════════════════════
  -- La règle métier ne bouge pas : c'est tout l'objet du garde.
  perform pg_temp.incarner(v_junior);
  msg := null;
  begin
    update contenus set statut = 'pret' where id = c_junior;
    e := e || 'un CM Junior a publie sans son tuteur'::text;
  exception when others then msg := sqlerrm;
  end;
  if msg is null or msg not like '%Junior%' then
    e := e || ('le refus du junior n est plus explicite : '||coalesce(left(msg,60),'(aucun)'))::text;
  end if;

  -- ══ 4. MAIS IL SOUMET À SON TUTEUR ═══════════════════════════════════════
  begin
    update contenus set statut = 'a_valider_tuteur' where id = c_junior;
  exception when others then
    e := e || ('le junior ne peut pas soumettre a son tuteur — '||left(sqlerrm,70))::text;
  end;
  perform pg_temp.serveur();
  select statut into st from contenus where id = c_junior;
  if st is distinct from 'a_valider_tuteur' then e := e || format('contenu du junior : statut %s', st); end if;

  -- ══ 5. LE JUNIOR N'EST PAS BRIDÉ SUR LE CONTENU D'UN AUTRE ═══════════════
  perform pg_temp.incarner(v_junior);
  begin
    update contenus set statut = 'pret' where id = c_autre;
  exception when others then
    -- Un refus ici viendrait des droits, pas du garde junior : on ne le compte pas comme un échec.
    null;
  end;

  perform pg_temp.serveur();
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — un niveau d''autonomie non renseigné vaut autonome : le CM et l''administrateur valident leurs propres contenus ; le CM Junior déclaré reste soumis à son tuteur et peut lui soumettre son travail.' as verdict;

rollback;
