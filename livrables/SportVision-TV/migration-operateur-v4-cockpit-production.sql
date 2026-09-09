-- ═══════════════════════════════════════════════════════════════════════════════
-- Cockpit Production + règle de clôture de mission
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- §B du master prompt : « Ne recalcule pas les statuts dans le frontend. Une mission doit
-- appartenir au même groupe partout. » D'où une vue unique, qui sert à la fois les listes et
-- les compteurs — c'est la même requête, donc ils ne peuvent pas diverger.
--
-- §S : aucun statut nouveau. La vue TRADUIT statut_prestation, prestations_equipe, media_liens
-- et kit_reservations en un libellé métier ; elle n'ajoute rien au modèle.

begin;

-- ── Ce qui manque encore pour clôturer une mission ───────────────────────────
--
-- §K et §L. La liste dépend de la couverture : une mission photo n'attend pas de montage, une
-- mission vidéo n'attend pas de photos traitées, une mission photo_video attend les deux.
-- Renvoie un tableau vide quand tout est bon — donc « prête à clôturer ».
--
-- SECURITY DEFINER : appelée depuis une vue et un déclencheur, elle doit lire l'état réel sans
-- dépendre des policies de l'appelant, sinon un opérateur et un admin obtiendraient des verdicts
-- différents sur la même mission.
create or replace function public.mission_cloture_manquant(p_prestation_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cov text;
  v_manque text[] := '{}';
  v_suivi record;
begin
  select couverture into v_cov from prestations where id = p_prestation_id;

  -- Terrain
  if not exists (select 1 from mission_suivi_operateur
                  where prestation_id = p_prestation_id and prestation_terminee_at is not null) then
    v_manque := v_manque || 'Prestation non déclarée réalisée'::text;
  end if;

  -- Fichiers sécurisés
  if not exists (select 1 from mission_suivi_operateur
                  where prestation_id = p_prestation_id and fichiers_securises_at is not null) then
    v_manque := v_manque || 'Fichiers non sécurisés'::text;
  end if;

  -- Transfert confirmé : au moins une livraison réellement partie.
  if not exists (select 1 from media_liens
                  where prestation_id = p_prestation_id and transfert_confirme is true) then
    v_manque := v_manque || 'Aucun transfert confirmé'::text;
  end if;

  -- Livrables exigés par la couverture, chacun validé par la Production.
  -- Une couverture inconnue ne vaut pas « rien à livrer » : on le dit.
  if v_cov is null then
    v_manque := v_manque || 'Couverture non renseignée'::text;
  end if;

  if v_cov in ('photo','photo_video') then
    if not exists (select 1 from media_liens where prestation_id = p_prestation_id
                    and type_media = 'photo' and categorie = 'final') then
      v_manque := v_manque || 'Photos traitées non livrées'::text;
    elsif not exists (select 1 from media_liens where prestation_id = p_prestation_id
                    and type_media = 'photo' and categorie = 'final' and statut = 'valide') then
      v_manque := v_manque || 'Photos non validées par la Production'::text;
    end if;
  end if;

  if v_cov in ('video','photo_video') then
    if not exists (select 1 from media_liens where prestation_id = p_prestation_id
                    and type_media = 'video' and categorie = 'final') then
      v_manque := v_manque || 'Montage final non livré'::text;
    elsif not exists (select 1 from media_liens where prestation_id = p_prestation_id
                    and type_media = 'video' and categorie = 'final' and statut = 'valide') then
      v_manque := v_manque || 'Montage non validé par la Production'::text;
    end if;
    -- §52 : les rushs sont exigés, pas optionnels, dès qu'une vidéo est prévue.
    if not exists (select 1 from media_liens where prestation_id = p_prestation_id
                    and categorie = 'rushs') then
      v_manque := v_manque || 'Rushs vidéo non transmis'::text;
    end if;
  end if;

  -- Matériel : restitué, OU conservation autorisée (retour prévu plus tard) et kit préparé.
  -- Aucun kit réservé = rien à rendre, ce n'est pas un manque.
  if exists (
    select 1 from kit_reservations kr
     where kr.prestation_id = p_prestation_id
       and kr.statut not in ('retourné','en_contrôle','disponible')
       and (kr.date_retour_prevue is null or kr.date_retour_prevue <= now())
  ) then
    v_manque := v_manque || 'Kit non restitué'::text;
  end if;

  return v_manque;
end $function$;

comment on function public.mission_cloture_manquant(uuid) is
  'Ce qui empêche encore de clôturer une mission, adapté à sa couverture. Tableau vide = clôturable. Source unique de la règle §K — ne pas la redéfinir ailleurs.';

-- ── Le verrou ────────────────────────────────────────────────────────────────
-- « Mission terminée » ne peut pas apparaître tant que tout ce qui est applicable n'est pas fait.
-- La règle est en base : un écran qui grise un bouton n'empêche rien.
create or replace function public.proteger_cloture_mission()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_manque text[];
begin
  if new.statut <> 'clôturée' or old.statut = 'clôturée' then
    return new;
  end if;
  v_manque := mission_cloture_manquant(new.id);
  if array_length(v_manque, 1) is not null then
    raise exception 'Mission non clôturable : %', array_to_string(v_manque, ' ; ')
      using errcode = '42501';
  end if;
  return new;
end $function$;

drop trigger if exists trg_proteger_cloture_mission on prestations;
create trigger trg_proteger_cloture_mission
  before update of statut on prestations
  for each row execute function public.proteger_cloture_mission();

-- ── La vue unique du cockpit ─────────────────────────────────────────────────
--
-- Un mission = un groupe, partout. Les compteurs sortent de cette vue, donc ils ne peuvent pas
-- raconter autre chose que les listes.
--
-- Sept groupes et non six : les missions en post-production (l'opérateur travaille, Production
-- n'a encore rien à vérifier) n'entraient dans aucune des six vues demandées. Les diluer dans
-- « À vérifier » aurait gonflé un compteur d'actions à faire avec des missions où il n'y a rien
-- à faire — exactement le défaut que le §5 demande d'éviter.
create or replace view public.v_production_missions as
select
  p.id                     as prestation_id,
  p.reference,
  p.statut,
  p.couverture,
  p.date_prestation,
  p.heure_debut,
  p.heure_rdv,
  p.lieu,
  p.pole_id,
  p.responsable_prod_id,
  p.deadline_photo_at,
  p.deadline_video_at,
  c.nom                    as client_nom,

  case
    when p.statut in ('clôturée','payée','facturée')                       then 'terminees'
    when p.statut = 'annulée'                                              then 'annulees'
    when exists (select 1 from media_liens ml
                  where ml.prestation_id = p.id and ml.statut = 'correction_demandee')
                                                                           then 'corrections'
    when p.statut in ('prêt_validation','à_valider_client','prête_à_livrer','livrée')
                                                                           then 'a_verifier'
    when p.statut in ('équipe_en_route','arrivée_sur_place','production_démarrée')
                                                                           then 'terrain'
    when p.statut in ('production_terminée','médias_à_transférer','médias_complets','à_monter','montage_en_cours')
                                                                           then 'post_production'
    when exists (select 1 from prestations_equipe pe
                  where pe.prestation_id = p.id
                    and pe.statut in ('invitation_envoyée','en_attente'))   then 'attente_acceptation'
    when p.statut in ('planifiée','équipe_affectée','prête')                then 'a_venir'
    else 'autres'
  end as groupe,

  -- Qui est dessus, et depuis quand l'invitation attend (§1).
  (select min(pe.created_at) from prestations_equipe pe
    where pe.prestation_id = p.id and pe.statut in ('invitation_envoyée','en_attente'))
                           as invitation_depuis,
  (select string_agg(coalesce(pr.prenom,'')||' '||coalesce(pr.nom,''), ', ')
     from prestations_equipe pe join profiles pr on pr.id = pe.collaborateur_id
    where pe.prestation_id = p.id and pe.statut = 'acceptée')
                           as operateurs,

  -- Avancement terrain, pour « Arrivé à 14:17 » sans ouvrir la mission (§3).
  (select max(mso.arrive_at) from mission_suivi_operateur mso where mso.prestation_id = p.id)
                           as arrive_at,
  (select max(mso.livre_at) from mission_suivi_operateur mso where mso.prestation_id = p.id)
                           as livre_at,

  -- Livrables et transfert (§4).
  (select count(*) from media_liens ml where ml.prestation_id = p.id and ml.type_media='photo' and ml.categorie='final') as nb_photos,
  (select count(*) from media_liens ml where ml.prestation_id = p.id and ml.type_media='video' and ml.categorie='final') as nb_montages,
  (select count(*) from media_liens ml where ml.prestation_id = p.id and ml.categorie='rushs') as nb_rushs,
  exists (select 1 from media_liens ml where ml.prestation_id = p.id and ml.transfert_confirme is true) as transfert_confirme,

  -- Kit (§G).
  (select kt.nom from kit_reservations kr join kits kt on kt.id = kr.kit_id
    where kr.prestation_id = p.id and kr.statut not in ('retourné','en_contrôle') limit 1) as kit_nom,
  (select kr.date_retour_prevue from kit_reservations kr
    where kr.prestation_id = p.id and kr.statut not in ('retourné','en_contrôle') limit 1) as kit_retour_prevu,

  exists (select 1 from incidents i where i.prestation_id = p.id and i.cloture = false) as incident_ouvert,

  -- §E : en retard uniquement si une VRAIE échéance existe et qu'elle est dépassée.
  -- Aucune échéance ne vaut jamais « en retard ».
  (
    (p.deadline_photo_at is not null and p.deadline_photo_at < now()
      and p.couverture in ('photo','photo_video')
      and not exists (select 1 from media_liens ml where ml.prestation_id=p.id and ml.type_media='photo' and ml.categorie='final' and ml.statut='valide'))
    or
    (p.deadline_video_at is not null and p.deadline_video_at < now()
      and p.couverture in ('video','photo_video')
      and not exists (select 1 from media_liens ml where ml.prestation_id=p.id and ml.type_media='video' and ml.categorie='final' and ml.statut='valide'))
  ) as livraison_en_retard,

  -- §F : Production doit voir qu'elle a oublié de fixer une échéance. Avertissement, pas blocage.
  (
    (p.couverture in ('photo','photo_video') and p.deadline_photo_at is null)
    or (p.couverture in ('video','photo_video') and p.deadline_video_at is null)
  ) as echeance_manquante,

  mission_cloture_manquant(p.id) as cloture_manquant,
  (select mp.operateur_confirme and mp.brief_rempli and mp.lieu_horaire_ok and mp.kit_ok and mp.pas_incident_ouvert
     from v_mission_prete mp where mp.prestation_id = p.id) as mission_prete

from prestations p
left join clients c on c.id = p.client_id
where is_staff() and pole_scope_ok(p.pole_id);

comment on view public.v_production_missions is
  'Source unique du cockpit Production : un groupe métier par mission, plus les indicateurs (retard, échéance manquante, kit, incident, ce qui bloque la clôture). Listes ET compteurs sortent de cette vue — ils ne peuvent pas diverger.';

commit;

select 'OK — cockpit Production et verrou de clôture posés' as verdict;
