-- v420 — Constituer l'effectif sans la date que personne n'a (01/10/2026)
--
-- ═══ LE DÉFAUT, MESURÉ PAR LE CHEMIN RÉEL ══════════════════════════════════════════════════════
--
-- La v389 a rendu `player_profiles.date_naissance` FACULTATIVE, et son en-tête dit pourquoi, mot
-- pour mot : « Fouka a décidé le 01/10 que les familles renseigneront la date pendant leur
-- inscription : lui ne saisit que le prénom, le nom, la catégorie et la photo de référence. »
--
-- Mais `effectif_constituer` (v384, écrite la même nuit, AVANT la v389) refuse toujours chaque
-- ligne sans date. Joué avec le jeton de l'administrateur de RCP Fontainebleau, transaction
-- annulée :
--
--     effectif_constituer(U16C, '[{"prenom":"Zzz","nom":"SansDate"},
--                                 {"prenom":"Yyy","nom":"AvecDate","date_naissance":"2010-05-04"}]')
--     → rang 1 : refusee — « Date de naissance manquante ou illisible (format AAAA-MM-JJ). »
--     → rang 2 : creee
--
-- La colonne est ouverte, le seul chemin qui l'écrit est resté fermé. Les 27 catégories de
-- Fontainebleau sont donc intégralement rejetées par le seul écran prévu pour les saisir.
--
-- ═══ CE QUI AUTORISE À OUVRIR, ET CE QUI RESTE FERMÉ ═══════════════════════════════════════════
--
-- L'argument de la v384 était juste : la date décide QUI donne l'accord de reconnaissance (avant
-- 15 ans un parent, de 15 à 17 ans le sportif). On ne la devine donc pas, et on ne la déduit pas
-- de la catégorie. Rien de cela ne change ici.
--
-- Ce qui change, c'est qu'une fiche SANS date ne mène plus nulle part de dangereux, parce que la
-- v389 a fermé la sortie elle-même : `sv_age_bracket(null)` rend 'inconnu' et non NULL, donc les
-- cinq appelants appliquent les protections du mineur ; et le déclencheur
-- `trg_photo_reference_attend_la_date` refuse toute photo de référence tant que la date manque.
--
-- Une fiche sans date porte donc un prénom, un nom et une équipe, et RIEN de biométrique. C'est
-- exactement ce que Fouka a devant lui sur le terrain.
--
-- ═══ ET UN TROISIÈME DÉFAUT, TROUVÉ EN VÉRIFIANT LE DEUXIÈME ═══════════════════════════════════
--
-- `DateStyle` vaut « ISO, MDY » sur cette base (mesuré : `show datestyle`). La v384 castait le texte
-- reçu sans contrôle de forme. Donc :
--
--     '04/03/2017'::date  →  2017-04-03   (le 3 avril, pas le 4 mars)   SILENCIEUX
--     '04/13/2017'::date  →  2017-04-13   (accepté, verdict « Fiche créée »)
--     '14/09/2016'::date  →  ERREUR       (14 n'est pas un mois)
--
-- La forme française n'est donc attrapée que les jours où le jour dépasse 12, et silencieusement
-- fausse les onze autres jours sur douze. Et cette date décide QUI donne l'accord de reconnaissance
-- d'un mineur : un mois pris pour un jour peut faire passer un enfant de 14 à 15 ans, c'est-à-dire
-- le faire consentir lui-même là où il fallait un parent.
--
-- L'écran convertit déjà en AAAA-MM-JJ avant d'envoyer (`normaliserDate`), donc Club+ n'était pas
-- touché — mais la fonction est la seule autorité, elle est appelable directement, et son propre
-- message annonçait « format AAAA-MM-JJ » sans l'exiger. Elle l'exige désormais.
--
-- ═══ CE QU'ON NE CONFOND SURTOUT PAS : ABSENTE ET ILLISIBLE ════════════════════════════════════
--
-- La v384 écrivait `begin v_dn := …::date; exception when others then v_dn := null; end`. Une date
-- mal tapée devenait donc indistinguable d'une date absente. C'était sans conséquence quand les
-- deux étaient refusées ; en acceptant l'absence, cela deviendrait un AVALEMENT SILENCIEUX : « né
-- le 04/13/2017 » créerait une fiche sans date sans le dire, et la famille recevrait une fiche
-- muette au lieu d'une correction.
--
-- Les deux cas sont donc séparés : le champ VIDE est accepté, le champ REMPLI mais illisible est
-- refusé avec sa raison.
--
-- ═══ ET LE RAPPROCHEMENT, QUI EST LE VRAI PIÈGE ════════════════════════════════════════════════
--
-- La v384 rapproche sur `pp.date_naissance = v_dn`. Avec une date nulle, cette comparaison vaut
-- NULL — jamais VRAI (le piège mesuré trois fois aujourd'hui). Sans rien faire, recoller la même
-- catégorie une seconde fois créerait donc 27 doublons, en annonçant 27 « Fiche créée ».
--
-- Sans date, on rapproche donc sur le club et le nom normalisé seuls. Et quand deux fiches du club
-- portent ce nom, on NE CHOISIT PAS : on refuse la ligne en demandant la date, qui est justement ce
-- qui les distingue. Deviner ici, c'est rattacher la photo d'un enfant à l'homonyme.

begin;

create or replace function public.effectif_constituer(p_team_id uuid, p_lignes jsonb)
returns table(rang integer, fiche_id uuid, prenom text, nom text, verdict text, detail text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_club uuid;
  v_saison uuid;
  v_saison_label text;
  v_n integer;
  l record;
  v_prenom text; v_nom text; v_dn date; v_maillot text; v_sexe text;
  v_dn_brut text; v_date_illisible boolean;
  v_id uuid;
  v_homonymes integer;
  v_rattache integer;
begin
  if not public.effectif_peut_constituer(p_team_id) then
    raise exception 'Vous ne pouvez pas constituer l''effectif de cette équipe.' using errcode = '42501';
  end if;

  select t.club_id, t.saison_id into v_club, v_saison from club_teams t where t.id = p_team_id;

  -- L'équipe peut ne porter aucune saison (mesuré : U16C de Fontainebleau). On retombe alors sur la
  -- saison active, jamais sur rien : `team_memberships.saison` entre dans la clé d'unicité, et une
  -- saison nulle ferait échapper la ligne à l'idempotence.
  if v_saison is null then
    select s.id into v_saison from saisons s where s.active order by s.date_debut desc limit 1;
  end if;
  select s.label into v_saison_label from saisons s where s.id = v_saison;
  if v_saison_label is null then
    raise exception 'Aucune saison active : impossible de rattacher un effectif à une saison inconnue.'
      using errcode = '22023';
  end if;

  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' then
    raise exception 'Il faut une liste de sportifs.' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_lignes);
  if v_n = 0 then return; end if;
  -- CENT PAR ENVOI. Au-delà, un refus en milieu de liste devient illisible et la transaction longue
  -- bloque la table. Une catégorie entière tient largement dessous.
  if v_n > 100 then
    raise exception 'Cent sportifs au maximum par envoi. Découpez la liste.' using errcode = '22023';
  end if;

  for l in select ordinality::integer as r, value as v
             from jsonb_array_elements(p_lignes) with ordinality
  loop
    v_prenom := btrim(coalesce(l.v->>'prenom', ''));
    v_nom    := btrim(coalesce(l.v->>'nom', ''));
    v_maillot := nullif(btrim(coalesce(l.v->>'numero_maillot', '')), '');
    v_sexe   := nullif(btrim(coalesce(l.v->>'sexe', '')), '');

    -- ABSENTE ET ILLISIBLE NE SONT PAS LE MÊME CAS (voir l'en-tête). Le champ vide est accepté ;
    -- le champ rempli qu'on n'arrive pas à lire est refusé, jamais avalé.
    v_dn_brut := nullif(btrim(coalesce(l.v->>'date_naissance', '')), '');
    v_dn := null;
    v_date_illisible := false;
    if v_dn_brut is not null then
      -- AAAA-MM-JJ STRICTEMENT, ET LE CAST SEUL NE SUFFIT PAS À L'EXIGER. Mesuré sur cette base :
      -- `DateStyle` vaut « ISO, MDY ». Donc `'04/03/2017'::date` ne lève RIEN et rend le
      -- 3 AVRIL 2017, là où toute la France écrit le 4 mars. Le cas 04/13/2017 passe aussi : il
      -- devient le 13 avril. Seul `14/09/2016` lève, parce que 14 n'est pas un mois — autrement dit
      -- la forme française n'est attrapée que les jours où elle dépasse 12, et silencieusement
      -- fausse les autres jours.
      --
      -- Cette date décide QUI donne l'accord de reconnaissance d'un mineur. Un mois pris pour un
      -- jour peut faire passer un enfant de 14 à 15 ans, c'est-à-dire faire consentir l'enfant là
      -- où il fallait un parent. On n'accepte donc que la forme non ambiguë, et l'appelant convertit
      -- avant d'envoyer (`normaliserDate` le fait déjà côté écran).
      if v_dn_brut !~ '^\d{4}-\d{2}-\d{2}$' then
        v_date_illisible := true;
      else
        begin
          v_dn := v_dn_brut::date;
        exception when others then
          v_date_illisible := true;   -- 2017-02-31 : bien formée, inexistante.
        end;
      end if;
    end if;

    if v_prenom = '' or v_nom = '' then
      return query select l.r, null::uuid, v_prenom, v_nom, 'refusee'::text,
                          'Prénom et nom sont obligatoires.'::text;
      continue;
    end if;

    if v_date_illisible then
      return query select l.r, null::uuid, v_prenom, v_nom, 'refusee'::text,
                          ('Date de naissance illisible : « ' || v_dn_brut ||
                           ' ». Attendu AAAA-MM-JJ, ou laissez-la vide si vous ne l''avez pas.')::text;
      continue;
    end if;

    -- LA DATE NE S'INVENTE PAS, ET NE SE DÉDUIT PAS DE LA CATÉGORIE : c'est elle qui décide qui
    -- donne l'accord de reconnaissance. Mais elle peut MANQUER, et c'est le cas normal depuis la
    -- v389 : la famille la renseigne en s'inscrivant. Tant qu'elle manque, aucune photo ne devient
    -- une référence (`trg_photo_reference_attend_la_date`) et `sv_age_bracket` rend 'inconnu', donc
    -- les protections du mineur s'appliquent. La fiche ne porte qu'un prénom, un nom, une équipe.
    if v_dn is not null
       and (v_dn > (now() at time zone 'Europe/Paris')::date or v_dn < date '1930-01-01') then
      return query select l.r, null::uuid, v_prenom, v_nom, 'refusee'::text,
                          'Date de naissance invraisemblable.'::text;
      continue;
    end if;
    if v_sexe is not null and v_sexe not in ('M', 'F') then
      v_sexe := null;
    end if;

    -- LE CLUB CONNAÎT-IL DÉJÀ CET ENFANT ?
    v_id := null;
    if v_dn is not null then
      -- Même règle de rapprochement que `request_team_membership_for_child` : même club, même date,
      -- noms normalisés. Deux chemins qui rapprochent différemment finiraient par créer les
      -- doublons que chacun croit éviter.
      select pp.id into v_id
        from player_profiles pp
       where pp.club_id = v_club
         and pp.date_naissance = v_dn
         and normalize_person_name(pp.prenom) = normalize_person_name(v_prenom)
         and normalize_person_name(pp.nom) = normalize_person_name(v_nom)
       order by pp.created_at
       limit 1;
    else
      -- SANS DATE, LE NOM SEUL RAPPROCHE — et `= null` n'aurait rapproché de rien, donc recoller la
      -- même liste aurait créé des doublons en annonçant « Fiche créée ». On rapproche aussi une
      -- fiche qui PORTE une date : c'est la même personne, et la fiche existante a raison.
      select count(*) into v_homonymes
        from player_profiles pp
       where pp.club_id = v_club
         and normalize_person_name(pp.prenom) = normalize_person_name(v_prenom)
         and normalize_person_name(pp.nom) = normalize_person_name(v_nom);

      -- DEUX HOMONYMES : ON NE CHOISIT PAS. Choisir, c'est rattacher la photo d'un enfant à
      -- l'autre. La date est précisément ce qui les distingue : on la demande.
      if v_homonymes > 1 then
        return query select l.r, null::uuid, v_prenom, v_nom, 'refusee'::text,
                            ('Ce club a déjà ' || v_homonymes || ' fiches à ce nom : ajoutez la date '
                             || 'de naissance pour dire de laquelle il s''agit.')::text;
        continue;
      end if;

      select pp.id into v_id
        from player_profiles pp
       where pp.club_id = v_club
         and normalize_person_name(pp.prenom) = normalize_person_name(v_prenom)
         and normalize_person_name(pp.nom) = normalize_person_name(v_nom)
       order by pp.created_at
       limit 1;
    end if;

    if v_id is null then
      insert into player_profiles (club_id, prenom, nom, date_naissance, sexe, numero_maillot,
                                   account_status, created_by)
      values (v_club, v_prenom, v_nom, v_dn, v_sexe, v_maillot, 'sans_compte', auth.uid())
      returning id into v_id;

      insert into team_memberships (player_id, team_id, club_id, saison, saison_id, statut)
      values (v_id, p_team_id, v_club, v_saison_label, v_saison, 'active')
      on conflict (player_id, team_id, saison) do nothing;

      if v_dn is null then
        return query select l.r, v_id, v_prenom, v_nom, 'creee'::text,
                            'Date de naissance à renseigner par la famille.'::text;
      else
        return query select l.r, v_id, v_prenom, v_nom, 'creee'::text, null::text;
      end if;
    else
      -- La fiche existe. On ne touche NI à son identité NI à son numéro : une fiche déjà là a
      -- peut-être été corrigée par sa famille, et un import qui écrase est un import qui efface.
      insert into team_memberships (player_id, team_id, club_id, saison, saison_id, statut)
      values (v_id, p_team_id, v_club, v_saison_label, v_saison, 'active')
      on conflict (player_id, team_id, saison) do nothing;
      -- `found` n'est pas garanti après un `return query` : on relève le compte tout de suite.
      get diagnostics v_rattache = row_count;

      if v_rattache > 0 then
        return query select l.r, v_id, v_prenom, v_nom, 'rattachee'::text,
                            'Fiche déjà au club, rattachée à cette équipe.'::text;
      else
        return query select l.r, v_id, v_prenom, v_nom, 'deja_presente'::text,
                            'Déjà dans cette équipe : rien à faire.'::text;
      end if;
    end if;
  end loop;
end
$function$;

-- ═══ LA PHOTO ATTEND LA DATE ; L'ACCORD DE LA FAMILLE N'ATTEND RIEN ════════════════════════════
--
-- Second défaut, mesuré après celui du dessus, et plus grave parce qu'il frappe la FAMILLE.
--
-- La v389 refuse une photo de référence tant que la date manque, par un déclencheur sur
-- `player_face_refs`. Mais ce n'est pas l'écran du club qui insère là : c'est
-- `photos_attente_promouvoir`, appelée par `trg_promouvoir_photos_a_l_accord`, DÉCLENCHEUR SUR
-- `consentements_biometrie`. Le refus remonte donc dans la transaction du parent, et c'est
-- l'ACCORD qui échoue. Mesuré, transaction annulée :
--
--     fiche sans date + une photo en attente + insert consentements_biometrie('accorde')
--     → ERROR 22023 « La date de naissance de ce sportif n'est pas connue… »
--       CONTEXT: photo_reference_attend_la_date() ← photos_attente_promouvoir()
--                ← promouvoir_photos_a_l_accord()
--
-- Autrement dit, sur toute fiche que Fouka va créer aujourd'hui avec une photo : la famille arrive,
-- reconnaît son enfant, donne son autorisation — et la base la refuse, en lui parlant d'une date.
-- Elle ne peut pas donner son accord DU TOUT.
--
-- L'en-tête de la v389 dit ce qu'elle voulait : la photo « ATTEND aussi la DATE ». Attendre, c'est
-- rester en attente — pas faire échouer ce qui passe à côté. La promotion saute donc les sportifs
-- dont la date est inconnue, et leur photo reste exactement là où elle était, en attente. Le
-- déclencheur de la v389 reste en place : il garde le dernier mot pour tout autre chemin.

create or replace function public.photos_attente_promouvoir(p_player_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_consent uuid; v_deja integer; v_n integer := 0; a record; v_ref uuid; v_dn date;
begin
  -- SANS ACCORD ACTIF, CETTE FONCTION NE FAIT RIEN. C'est son seul garde-fou, et il suffit : elle
  -- n'ouvre aucun droit, elle déplace une photo d'un côté à l'autre d'une porte que quelqu'un vient
  -- d'ouvrir.
  select c.id into v_consent from consentements_biometrie c
   where c.player_id = p_player_id and c.statut = 'accorde'
   order by c.accorde_le desc limit 1;
  if v_consent is null then return 0; end if;

  -- v420 : SANS DATE, LA PHOTO ATTEND — ELLE NE FAIT PAS ÉCHOUER L'ACCORD. Voir l'en-tête. On sort
  -- AVANT d'insérer, parce que `trg_photo_reference_attend_la_date` lèverait dans la transaction du
  -- parent et lui interdirait de donner son autorisation. La photo reste en attente et partira à la
  -- promotion suivante, celle que la date déclenchera.
  select date_naissance into v_dn from player_profiles where id = p_player_id;
  if v_dn is null then return 0; end if;

  select count(*) into v_deja from player_face_refs where consentement_id = v_consent;

  for a in select * from photos_reference_attente
            where player_id = p_player_id and promue_le is null and refusee_le is null
            order by created_at
  loop
    exit when v_deja >= 5;   -- même plafond que partout ailleurs
    insert into player_face_refs (player_id, consentement_id, moteur, storage_bucket, storage_path,
                                  created_by)
    values (a.player_id, v_consent, 'en_attente', a.storage_bucket, a.storage_path, a.deposee_par)
    returning id into v_ref;
    -- Le trigger `trg_reconnaissance_photo_reference` vient de mettre ce sportif en file. C'est le
    -- moteur, et lui seul, qui calculera l'empreinte — après cet accord, jamais avant.
    update photos_reference_attente set promue_le = now(), face_ref_id = v_ref where id = a.id;
    v_deja := v_deja + 1;
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$function$;

-- ═══ ET LA DATE, QUAND ELLE ARRIVE, DOIT RATTRAPER LES PHOTOS QUI L'ATTENDAIENT ════════════════
--
-- Conséquence directe du point ci-dessus : si la promotion saute une fiche sans date, il faut que
-- quelque chose la rejoue le jour où la date est renseignée. Sinon la photo attend pour toujours,
-- l'accord est donné, et personne ne voit que rien ne s'est passé — un faux succès parfait.
--
-- La famille renseigne la date par `corriger_identite_sportif`, par la validation d'adhésion ou par
-- `decider_revendication` : trois chemins. On ne rejoue donc pas la règle dans chacun, on la met
-- là où la donnée change, c'est-à-dire sur la colonne.

create or replace function public.promouvoir_photos_a_la_date()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Seul cas qui nous intéresse : la date était inconnue, elle est maintenant connue.
  if old.date_naissance is null and new.date_naissance is not null then
    perform public.photos_attente_promouvoir(new.id);
  end if;
  return null;   -- AFTER trigger : la valeur de retour est ignorée
end;
$function$;

drop trigger if exists trg_promouvoir_photos_a_la_date on public.player_profiles;
create trigger trg_promouvoir_photos_a_la_date
  after update of date_naissance on public.player_profiles
  for each row execute function public.promouvoir_photos_a_la_date();

comment on function public.effectif_constituer(uuid, jsonb) is
  'Constituer l''effectif d''une équipe en collant une liste. La date de naissance est FACULTATIVE '
  '(v389/v420) : la famille la renseigne en s''inscrivant, et tant qu''elle manque aucune photo ne '
  'devient une référence. Une date remplie mais illisible est refusée, jamais avalée. Sans date, le '
  'rapprochement se fait sur le nom seul, et deux homonymes font refuser la ligne.';

commit;
