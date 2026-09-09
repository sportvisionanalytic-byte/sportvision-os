-- La regle la plus importante du module : une carte n'est liberable que si les fichiers
-- sont reellement securises (§24, §37, §65).
--
-- Elle est en base et pas dans l'interface, ce test le verifie en attaquant directement la
-- table avec l'identite d'un vrai operateur — pas en cliquant sur un ecran.
--
-- Tout s'execute dans une transaction annulee.

begin;

create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $inner$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $inner$;

do $$
declare
  v_op uuid; v_autre uuid; v_admin uuid; v_client uuid; v_pres uuid; v_lien uuid;
  n integer; e text[] := '{}';
begin
  perform set_config('role','postgres',true);

  select id into v_op from profiles where role='photo' and actif order by created_at limit 1;
  select id into v_autre from profiles where role='photo' and actif and id<>v_op order by created_at limit 1;
  select id into v_admin from profiles where role='admin' and actif limit 1;

  insert into clients (nom, statut) values ('ZZ Client cartes SD','client') returning id into v_client;
  insert into prestations (reference, statut, client_id, date_prestation, couverture)
  values ('ZZ-SD','planifiée', v_client, current_date, 'photo_video') returning id into v_pres;

  perform set_config('request.jwt.claims', json_build_object('sub',v_admin::text,'role','authenticated')::text, true);
  insert into prestations_equipe (prestation_id, collaborateur_id, statut)
  values (v_pres, v_op, 'invitation_envoyée');
  perform pg_temp.incarner(v_op);
  update prestations_equipe set statut='acceptée' where prestation_id=v_pres and collaborateur_id=v_op;

  -- ── 1. Liberer les cartes sans rien avoir securise : REFUSE ────────────────
  -- Sonde isolee : si la protection tombe, cette insertion REUSSIT et laisserait une ligne
  -- derriere elle. L'etape 2 heurterait alors la contrainte d'unicite et le test mourrait sur
  -- une erreur de cle dupliquee au lieu de dire ce qui ne va vraiment pas. On enregistre le
  -- constat dans `e`, puis on defait l'ecriture : un bloc PL/pgSQL annule ses ecritures quand
  -- il sort par exception, mais conserve ses variables.
  begin
    insert into mission_suivi_operateur (prestation_id, collaborateur_id, cartes_liberees_at)
    values (v_pres, v_op, now());
    e := e || 'Les cartes ont ete declarees liberables sans aucune securisation'::text;
    raise exception 'rollback_sonde';
  exception when others then null; end;

  -- ── 2. Avancement normal jusqu'a la securisation des fichiers ──────────────
  insert into mission_suivi_operateur (prestation_id, collaborateur_id, arrive_at, prestation_terminee_at)
  values (v_pres, v_op, now(), now());

  update mission_suivi_operateur set fichiers_securises_at = now()
   where prestation_id = v_pres and collaborateur_id = v_op;
  get diagnostics n = row_count;
  if n <> 1 then e := e || 'L operateur ne peut pas declarer ses fichiers securises'::text; end if;

  -- ── 3. Fichiers securises MAIS aucune seconde copie confirmee : REFUSE ─────
  -- C'est le cas qui fait perdre un match : un seul disque, et il tombe en panne.
  begin
    update mission_suivi_operateur set cartes_liberees_at = now()
     where prestation_id = v_pres and collaborateur_id = v_op;
    e := e || 'Les cartes ont ete liberees sans aucun transfert confirme'::text;
    raise exception 'rollback_sonde';
  exception when others then null; end;

  -- ── 4. Avec une livraison dont le transfert est confirme : AUTORISE ────────
  insert into media_liens (prestation_id, nom, url, categorie, type_media, statut, ajouteur_id, transfert_confirme)
  values (v_pres, 'ZZ photos', 'https://exemple.test/sd', 'final', 'photo', 'a_verifier', v_op, true)
  returning id into v_lien;

  begin
    update mission_suivi_operateur set cartes_liberees_at = now()
     where prestation_id = v_pres and collaborateur_id = v_op;
    get diagnostics n = row_count;
    if n <> 1 then e := e || 'Les cartes restent bloquees alors que tout est securise'::text; end if;
  exception when others then
    e := e || 'Les cartes restent bloquees alors que tout est securise (exception)'::text;
  end;

  -- ── 5. Un collegue ne coche pas a la place de l operateur ──────────────────
  if v_autre is not null then
    perform pg_temp.incarner(v_autre);
    update mission_suivi_operateur set notes = 'intrusion'
     where prestation_id = v_pres and collaborateur_id = v_op;
    get diagnostics n = row_count;
    if n <> 0 then e := e || 'Un autre operateur a modifie le suivi de cette mission'::text; end if;

    begin
      insert into mission_suivi_operateur (prestation_id, collaborateur_id)
      values (v_pres, v_autre);
      e := e || 'Un operateur non affecte a cree un suivi sur cette mission'::text;
    exception when others then null; end;
  end if;

  -- ── 6. Production suit l avancement ───────────────────────────────────────
  perform pg_temp.incarner(v_admin);
  select count(*) into n from mission_suivi_operateur where prestation_id = v_pres;
  if n <> 1 then e := e || 'L encadrement ne voit pas l avancement de l operateur'::text; end if;

  perform set_config('role','postgres',true);
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — cartes liberables uniquement apres securisation des fichiers ET un transfert confirme ; refus valable aussi en appel direct ; un operateur ne coche que pour lui.' as verdict;

rollback;
