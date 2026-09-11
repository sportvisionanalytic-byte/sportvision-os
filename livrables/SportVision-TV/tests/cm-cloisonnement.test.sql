-- Un CM affecté au Club A ne doit RIEN voir du Club B.
--
-- C'est le test du §80, et il est écrit avant la migration : c'est lui qui dit si le
-- cloisonnement fonctionne, pas la lecture du code.
--
-- Méthode : on cree deux clubs, deux CM, on affecte chacun au sien, puis on se met REELLEMENT
-- dans la peau de chaque CM (set local role authenticated + request.jwt.claims) et on compte ce
-- que la base lui rend. Aucune supposition sur les policies : on mesure ce qui sort.
--
-- Tout s'execute dans une transaction annulee.

begin;

-- Se mettre dans la peau d'un utilisateur : c'est auth.uid() qui gouverne toutes les policies.
-- Definie dans la transaction, elle disparait avec le rollback.
create or replace function pg_temp.incarner(p uuid) returns void language plpgsql as $inner$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',p::text,'role','authenticated')::text, true);
end $inner$;

do $$
declare
  v_cmA uuid; v_cmB uuid; v_clubA uuid; v_clubB uuid;
  v_teamA uuid; v_teamB uuid; v_aff uuid;
  n integer; e text[] := '{}'; v_admin uuid;

begin
  perform set_config('role','postgres',true);

  -- ── Decor : deux clubs, deux CM ────────────────────────────────────────────
  insert into organizations (id, organization_type, nom, statut)
  values (gen_random_uuid(),'club','ZZ Club A test','actif_standard') returning id into v_clubA;
  insert into organizations (id, organization_type, nom, statut)
  values (gen_random_uuid(),'club','ZZ Club B test','actif_standard') returning id into v_clubB;
  -- plan 'performance' : le plafond d'equipes par plan est une vraie regle metier (« 1 equipe
  -- maximum » en gratuit). Le test porte sur le cloisonnement, pas sur les quotas.
  insert into clubs (id, nom, plan) values (v_clubA,'ZZ Club A test','performance');
  insert into clubs (id, nom, plan) values (v_clubB,'ZZ Club B test','performance');
  insert into club_teams (club_id, name) values (v_clubA,'ZZ U18 A') returning id into v_teamA;
  insert into club_teams (club_id, name) values (v_clubB,'ZZ U18 B') returning id into v_teamB;

  -- Deux CM REELS plutot que des profils fabriques : profiles reference auth.users, et surtout
  -- le test doit mesurer ce que voient les personnes qui utilisent vraiment l'OS.
  -- Des CM sans aucune affectation reelle : sinon leurs vrais clubs s'ajoutent aux comptes du
  -- test et le font echouer pour une raison qui n'a rien a voir avec ce qu'il verifie.
  -- Deux CM fabriques POUR ce test, dans la transaction, donc annules avec elle.
  --
  -- Le test s'appuyait auparavant sur de vrais comptes CM sans affectation. C'etait fragile — il
  -- a casse le 09/09/2026 des qu'on a nettoye les comptes de test — et surtout ca imposait de
  -- garder des comptes de test permanents en production, ce qui est precisement ce qui a abime la
  -- reputation d'expediteur du domaine. Un test ne doit dependre d'aucune donnee vivante.
  v_cmA := gen_random_uuid();
  v_cmB := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_cmA, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-cm-a-' || v_cmA || '@example.invalid', '', now(), now(), now()),
         (v_cmB, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-cm-b-' || v_cmB || '@example.invalid', '', now(), now(), now());
  insert into profiles (id, role, prenom, nom, email)
  values (v_cmA, 'cm', 'ZZ', 'CM A', 'zz-cm-a-' || v_cmA || '@example.invalid'),
         (v_cmB, 'cm', 'ZZ', 'CM B', 'zz-cm-b-' || v_cmB || '@example.invalid');

  insert into club_cm_affectations (club_id, cm_id, role, actif)
  values (v_clubA, v_cmA, 'principal', true) returning id into v_aff;
  insert into club_cm_affectations (club_id, cm_id, role, actif)
  values (v_clubB, v_cmB, 'principal', true);

  -- ══ 1. Le CM A voit SON club ═══════════════════════════════════════════════
  perform pg_temp.incarner(v_cmA);
  select count(*)::integer into n from clubs where id = v_clubA;
  if n <> 1 then e := e || 'CM A ne voit pas son propre club'::text; end if;
  select count(*)::integer into n from club_teams where club_id = v_clubA;
  if n <> 1 then e := e || 'CM A ne voit pas les equipes de son club'::text; end if;

  -- ══ 2. Le CM A ne voit RIEN du club B ══════════════════════════════════════
  select count(*)::integer into n from clubs where id = v_clubB;
  if n <> 0 then e := e || ('FUITE : CM A lit le club B ('||n||' ligne)'); end if;
  select count(*)::integer into n from club_teams where club_id = v_clubB;
  if n <> 0 then e := e || ('FUITE : CM A lit les equipes du club B ('||n||')'); end if;
  select count(*)::integer into n from organizations where id = v_clubB;
  if n <> 0 then e := e || ('FUITE : CM A lit l organisation du club B'); end if;
  select count(*)::integer into n from club_onboarding_progress where club_id = v_clubB;
  if n <> 0 then e := e || 'FUITE : CM A lit l onboarding du club B'::text; end if;
  select count(*)::integer into n from team_invite_codes where club_id = v_clubB;
  if n <> 0 then e := e || 'FUITE : CM A lit les liens d inscription du club B'::text; end if;
  select count(*)::integer into n from membership_requests where club_id = v_clubB;
  if n <> 0 then e := e || 'FUITE : CM A lit les demandes d adhesion du club B'::text; end if;
  select count(*)::integer into n from memberships where organization_id = v_clubB;
  if n <> 0 then e := e || 'FUITE : CM A lit les affiliations du club B'::text; end if;
  select count(*)::integer into n from player_invitations where club_id = v_clubB;
  if n <> 0 then e := e || 'FUITE : CM A lit les invitations joueur du club B'::text; end if;
  select count(*)::integer into n from club_members where club_id = v_clubB;
  if n <> 0 then e := e || 'FUITE : CM A lit les membres du club B'::text; end if;

  -- ══ 2b. Les fonctions de la phase 2 respectent le meme perimetre ══════════
  -- Une RPC qui contournerait les policies serait une porte derobee : on la mesure comme le reste.
  select count(*)::integer into n from cm_mes_clubs();
  if n <> 1 then e := e || ('cm_mes_clubs rend '||n||' club(s) au CM A au lieu de 1'); end if;
  select count(*)::integer into n from cm_mes_clubs() where club_id = v_clubB;
  if n <> 0 then e := e || 'FUITE : cm_mes_clubs rend le club B au CM A'::text; end if;

  select count(*)::integer into n from club_affectations_cm(v_clubB);
  if n <> 0 then e := e || 'FUITE : CM A lit l equipe SportVision du club B'::text; end if;
  select count(*)::integer into n from club_affectations_cm(v_clubA);
  if n <> 1 then e := e || ('CM A ne voit pas sa propre affectation ('||n||')'); end if;

  -- ══ 3. Le CM A ne MODIFIE rien du club B ═══════════════════════════════════
  begin
    update club_teams set name = 'PIRATE' where club_id = v_clubB;
    get diagnostics n = row_count;
    if n > 0 then e := e || ('FUITE : CM A a modifie '||n||' equipe(s) du club B'); end if;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into club_teams (club_id, name) values (v_clubB, 'PIRATE');
    e := e || 'FUITE : CM A a cree une equipe dans le club B'::text;
  exception when others then null;
  end;

  -- ══ 3b. Le CM A ECRIT sur son club, et nulle part ailleurs (phase 3) ══════
  -- C'est le vrai enjeu du lot : il ne s'agit plus de lecture.
  begin
    perform cm_club_infos_maj(v_clubA, 'ZZ Club A renomme', 'Sens', null, null, null, null, null, null);
    perform 1 from clubs where id = v_clubA and nom = 'ZZ Club A renomme';
    if not found then e := e || 'CM A ne peut pas renommer son propre club'::text; end if;
  exception when others then
    e := e || ('CM A ne peut pas modifier son club : '||sqlerrm);
  end;

  -- Le SIRET n'est PAS dans la liste blanche : aucun chemin ne doit permettre de l'ecrire.
  begin
    update clubs set siret = '00000000000000' where id = v_clubA;
    get diagnostics n = row_count;
    if n > 0 then e := e || 'FUITE : CM A a modifie le SIRET de son club'::text; end if;
  exception when insufficient_privilege then null; when others then null;
  end;

  -- Le club B reste hors de portee, meme par la fonction.
  begin
    perform cm_club_infos_maj(v_clubB, 'PIRATE', null, null, null, null, null, null, null);
    e := e || 'FUITE : CM A a modifie les informations du club B'::text;
  exception when others then null;
  end;

  -- Creer une equipe : autorise chez soi, refuse ailleurs.
  begin
    insert into club_teams (club_id, name) values (v_clubA, 'ZZ U16 A');
  exception when others then e := e || ('CM A ne peut pas creer d equipe chez lui : '||sqlerrm); end;
  begin
    insert into club_teams (club_id, name) values (v_clubB, 'PIRATE 2');
    e := e || 'FUITE : CM A a cree une equipe dans le club B'::text;
  exception when others then null; end;

  -- Archiver plutot que supprimer : la suppression ne doit pas etre accordee.
  begin
    update club_teams set archivee = true, archivee_at = now() where club_id = v_clubA and name = 'ZZ U18 A';
    get diagnostics n = row_count;
    if n <> 1 then e := e || 'CM A ne peut pas archiver une equipe de son club'::text; end if;
  exception when others then e := e || ('archivage impossible : '||sqlerrm); end;
  begin
    delete from club_teams where club_id = v_clubA and name = 'ZZ U16 A';
    get diagnostics n = row_count;
    if n > 0 then e := e || 'Le CM peut SUPPRIMER une equipe : on voulait de l archivage'::text; end if;
  exception when insufficient_privilege then null; when others then null; end;

  -- Le journal et les etapes manuelles, chez soi seulement.
  begin
    insert into club_onboarding_events (club_id, auteur_id, action) values (v_clubA, v_cmA, 'test');
  exception when others then e := e || ('CM A ne peut pas journaliser chez lui : '||sqlerrm); end;
  begin
    insert into club_onboarding_events (club_id, auteur_id, action) values (v_clubB, v_cmA, 'pirate');
    e := e || 'FUITE : CM A a ecrit dans le journal du club B'::text;
  exception when others then null; end;

  -- La preparation ne se calcule que sur son perimetre.
  select count(*)::integer into n from club_preparation(v_clubB);
  if n <> 0 then e := e || 'FUITE : CM A lit la preparation du club B'::text; end if;
  select count(*)::integer into n from club_preparation(v_clubA);
  if n = 0 then e := e || 'CM A ne voit pas la preparation de son propre club'::text; end if;

  -- ══ 4. Une affectation desactivee retire les droits IMMEDIATEMENT ══════════
  perform set_config('role','postgres',true);
  update club_cm_affectations set actif = false where id = v_aff;
  perform pg_temp.incarner(v_cmA);
  select count(*)::integer into n from clubs where id = v_clubA;
  if n <> 0 then e := e || ('Desactivation sans effet : CM A lit encore son ancien club'); end if;
  select count(*)::integer into n from club_teams where club_id = v_clubA;
  if n <> 0 then e := e || 'Desactivation sans effet : CM A lit encore les equipes'::text; end if;
  select count(*)::integer into n from cm_mes_clubs();
  if n <> 0 then e := e || 'Desactivation sans effet : le club reste dans « Mes clubs »'::text; end if;
  -- §51 : la prochaine ECRITURE doit etre refusee, sans attendre une reconnexion.
  begin
    perform cm_club_infos_maj(v_clubA, 'APRES RETRAIT', null, null, null, null, null, null, null);
    e := e || 'Desactivation sans effet : CM A ecrit encore sur son ancien club'::text;
  exception when others then null;
  end;

  -- ══ 5. Une affectation expiree ne donne plus rien ══════════════════════════
  perform set_config('role','postgres',true);
  -- date_debut recule aussi : la contrainte cca_dates_coherentes refuse une fin anterieure au
  -- debut, et elle a raison de le faire.
  update club_cm_affectations
     set actif = true, date_debut = current_date - 10, date_fin = (now() at time zone 'Europe/Paris')::date - 1
   where id = v_aff;
  perform pg_temp.incarner(v_cmA);
  select count(*)::integer into n from clubs where id = v_clubA;
  if n <> 0 then e := e || 'Une affectation expiree donne encore acces'::text; end if;
  select count(*)::integer into n from cm_mes_clubs();
  if n <> 0 then e := e || 'Une affectation expiree laisse le club dans « Mes clubs »'::text; end if;

  -- ══ 6. Une affectation qui commence demain ne donne rien aujourd'hui ═══════
  perform set_config('role','postgres',true);
  -- Depuis v153, la fenetre d'une affectation se lit en jours de PARIS : entre minuit et 2 h,
  -- « current_date + 1 » (UTC) est deja aujourd'hui a Paris, et l'acces serait legitimement ouvert.
  update club_cm_affectations set date_fin = null,
         date_debut = (now() at time zone 'Europe/Paris')::date + 1 where id = v_aff;
  -- (affectation qui ne commence que demain)
  perform pg_temp.incarner(v_cmA);
  select count(*)::integer into n from clubs where id = v_clubA;
  if n <> 0 then e := e || 'Une affectation future donne deja acces'::text; end if;
  select count(*)::integer into n from cm_mes_clubs();
  if n <> 0 then e := e || 'Une affectation future fait deja apparaitre le club'::text; end if;

  -- ══ 7. L'admin, lui, continue de tout voir ═════════════════════════════════
  perform set_config('role','postgres',true);
  update club_cm_affectations set date_debut = current_date where id = v_aff;
  begin
    select id into v_admin from profiles where role = 'admin' limit 1;
    if v_admin is not null then
      perform pg_temp.incarner(v_admin);
      select count(*)::integer into n from clubs where id in (v_clubA, v_clubB);
      if n <> 2 then e := e || ('L admin ne voit plus les deux clubs ('||n||'/2) — le cloisonnement deborde'); end if;
    end if;
  end;

  -- ─────────────────────────────────────────────────────────────────────────
  -- L'ecriture de l'onboarding : le CM doit pouvoir remplir son club, et rien d'autre.
  -- Ces tables sont celles que l'ecran d'onboarding de Club+ utilise reellement.
  -- ─────────────────────────────────────────────────────────────────────────
  perform set_config('role','postgres',true);
  perform pg_temp.incarner(v_cmA);

  update clubs set ville = 'ZZ Ville' where id = v_clubA;
  get diagnostics n = row_count;
  if n <> 1 then e := e || 'Le CM ne peut pas modifier les informations de son propre club'::text; end if;

  update clubs set ville = 'ZZ Vole' where id = v_clubB;
  get diagnostics n = row_count;
  if n <> 0 then e := e || 'Le CM a modifie un club hors de son perimetre'::text; end if;

  -- Le SIRET identifie juridiquement la structure : il peut finir sur une facture.
  begin
    update clubs set siret = '99999999999999' where id = v_clubA;
    e := e || 'Le CM a pu modifier le SIRET de son club'::text;
  exception when others then null;
  end;

  begin
    insert into club_calendar_events (club_id, title, event_date, type)
    values (v_clubA, 'ZZ evenement', current_date, 'match');
  exception when others then e := e || 'Le CM ne peut pas creer un evenement sur son club'::text; end;

  begin
    insert into club_calendar_events (club_id, title, event_date, type)
    values (v_clubB, 'ZZ evenement vole', current_date, 'match');
    e := e || 'Le CM a cree un evenement sur un club hors de son perimetre'::text;
  exception when others then null; end;

  begin
    insert into club_matches (club_id, team, opponent, match_date)
    values (v_clubA, 'ZZ U18 A', 'ZZ adverse', current_date);
  exception when others then e := e || 'Le CM ne peut pas creer un match sur son club'::text; end;

  begin
    insert into club_matches (club_id, team, opponent, match_date)
    values (v_clubB, 'ZZ U18 B', 'ZZ vole', current_date);
    e := e || 'Le CM a cree un match sur un club hors de son perimetre'::text;
  exception when others then null; end;

  begin
    insert into club_members (user_id, club_id, role, prenom, nom)
    values (v_cmA, v_clubA, 'coach', 'ZZ', 'membre');
  exception when others then e := e || 'Le CM ne peut pas ajouter un membre a son club'::text; end;

  -- Le retirer IMMEDIATEMENT : cette ligne fait du CM un membre du club, ce qui lui ouvrirait
  -- toutes les policies `is_club_member` pour la suite du test. Sans ce nettoyage, les
  -- assertions suivantes mesureraient un CM qui n'existe pas. (Piege tombe dedans le 08/09 :
  -- le test restait vert meme apres suppression de la policy des creneaux.)
  perform set_config('role','postgres',true);
  delete from club_members where club_id = v_clubA and prenom = 'ZZ' and nom = 'membre';
  perform pg_temp.incarner(v_cmA);

  begin
    insert into club_members (user_id, club_id, role, prenom, nom)
    values (v_cmA, v_clubB, 'coach', 'ZZ', 'vole');
    e := e || 'Le CM a ajoute un membre a un club hors de son perimetre'::text;
  exception when others then null; end;

  -- ─────────────────────────────────────────────────────────────────────────
  -- Le reste de l'onboarding : lieux, creneaux, reseaux sociaux, progression, effectif.
  -- Ces surfaces manquaient a la v10 et bloquaient reellement l'ecran (creneaux signales par
  -- Fouka le 08/09). Les creneaux n'ont pas de club_id : leur perimetre passe par l'equipe.
  -- ─────────────────────────────────────────────────────────────────────────
  perform set_config('role','postgres',true);
  perform pg_temp.incarner(v_cmA);

  declare v_lieu uuid;
  begin
    begin
      insert into club_onboarding_progress (club_id, statut) values (v_clubA, 'in_progress')
      on conflict (club_id) do update set last_activity_at = now();
    exception when others then e := e || 'Le CM ne peut pas demarrer la mise en place de son club'::text; end;

    begin
      insert into club_onboarding_progress (club_id, statut) values (v_clubB, 'in_progress')
      on conflict (club_id) do update set last_activity_at = now();
      e := e || 'Le CM a demarre la mise en place d un club hors de son perimetre'::text;
    exception when others then null; end;

    begin
      insert into club_venues (club_id, nom) values (v_clubA, 'ZZ stade') returning id into v_lieu;
    exception when others then e := e || 'Le CM ne peut pas creer un lieu sur son club'::text; end;

    begin
      insert into club_venues (club_id, nom) values (v_clubB, 'ZZ stade vole');
      e := e || 'Le CM a cree un lieu sur un club hors de son perimetre'::text;
    exception when others then null; end;

    begin
      insert into club_team_training_slots (team_id, jour, heure_debut, heure_fin, venue_id)
      values (v_teamA, 'mardi', '18:00', '19:30', v_lieu);
    exception when others then e := e || 'Le CM ne peut pas creer un creneau sur une equipe de son club'::text; end;

    begin
      insert into club_team_training_slots (team_id, jour, heure_debut, heure_fin)
      values (v_teamB, 'mardi', '18:00', '19:30');
      e := e || 'Le CM a cree un creneau sur une equipe hors de son perimetre'::text;
    exception when others then null; end;

    begin
      insert into club_social_accounts (club_id, plateforme, handle_ou_url) values (v_clubA, 'instagram', 'zz');
    exception when others then e := e || 'Le CM ne peut pas enregistrer un reseau social sur son club'::text; end;

    begin
      insert into club_social_accounts (club_id, plateforme, handle_ou_url) values (v_clubB, 'instagram', 'zz');
      e := e || 'Le CM a enregistre un reseau social sur un club hors de son perimetre'::text;
    exception when others then null; end;

    begin
      insert into club_sponsors (club_id, name) values (v_clubA, 'ZZ sponsor');
    exception when others then e := e || 'Le CM ne peut pas creer un sponsor sur son club'::text; end;

    begin
      insert into club_sponsors (club_id, name) values (v_clubB, 'ZZ sponsor vole');
      e := e || 'Le CM a cree un sponsor sur un club hors de son perimetre'::text;
    exception when others then null; end;

    -- Import d'effectif : saisie de mise en place, aucun compte cree, aucun e-mail.
    begin
      perform preview_club_players_import(v_clubA, '[]'::jsonb);
    exception when others then e := e || 'Le CM ne peut pas preparer un import d effectif sur son club'::text; end;

    begin
      perform preview_club_players_import(v_clubB, '[]'::jsonb);
      e := e || 'Le CM a prepare un import d effectif sur un club hors de son perimetre'::text;
    exception when others then null; end;

    -- Une autorisation ne doit jamais valoir « inconnu » : un club_id null, c'est non.
    if peut_preparer_club(null) is distinct from false then
      e := e || 'peut_preparer_club(null) ne vaut pas false — un appel sans club traverserait le controle'::text;
    end if;

    -- Les invitations sont OUVERTES au CM depuis le 10/09/2026 (phase 4 commencee : voir les
    -- ecrans « Coachs & dirigeants » de Club+). Ce controle affirmait l'inverse et virait au rouge
    -- des l'ouverture : il mesurait un etat du produit, pas une regle de securite. Or ce qui doit
    -- tenir quoi qu'il arrive n'est pas « le CM ne peut pas inviter », c'est « le CM ne peut pas
    -- inviter CHEZ LE VOISIN ». C'est desormais ce qui est verifie, dans les deux sens.
    begin
      perform create_invite_code(v_clubA, null, null);
    exception when others then
      e := e || ('Le CM ne peut plus creer de lien collectif sur SON club — '||left(sqlerrm,70))::text;
    end;

    begin
      perform create_invite_code(v_clubB, null, null);
      e := e || 'Le CM a cree un lien collectif pour un club hors de son perimetre'::text;
    exception when others then null; end;
  end;

  perform set_config('role','postgres',true);
  if array_length(e,1) is not null then
    raise exception E'ECHECS :\n  - %', array_to_string(e, E'\n  - ');
  end if;
end $$;

select 'OK — un CM ne voit et ne modifie que les clubs qui lui sont affectes ; desactivation, expiration et date future retirent l acces immediatement ; l admin garde sa vue globale.' as verdict;

rollback;
