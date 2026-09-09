-- ═══════════════════════════════════════════════════════════════════════════════
-- Notifications événementielles — ce qui doit partir à l'instant où ça se produit
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Les rappels du cron (v5) couvrent les oublis. Ici, les événements : une livraison arrive,
-- Production valide, un incident est signalé, une mission est refusée.
--
-- En déclencheurs et non en JavaScript, volontairement : une notification posée par l'écran ne
-- part pas quand l'action vient d'ailleurs. Conséquence assumée — la demande de correction
-- était notifiée depuis modalDemanderCorrection() ; ce chemin est retiré de l'interface dans le
-- même commit, pour ne pas doubler la notification.

begin;

-- ── Une livraison arrive → Production ────────────────────────────────────────
-- Une par mission et par jour : l'opérateur dépose souvent les photos puis les rushs à
-- quelques minutes d'intervalle, et deux notifications pour un même envoi seraient du bruit.
create or replace function public.notifier_livraison_recue()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_client text; v_cov text; d uuid;
begin
  if new.prestation_id is null or new.categorie not in ('final','rushs') then
    return new;
  end if;

  select c.nom, p.couverture into v_client, v_cov
    from prestations p left join clients c on c.id = p.client_id where p.id = new.prestation_id;

  for d in select destinataires_production(new.prestation_id) loop
    perform notifier(d, 'taches', 'livraison_recue',
      'Nouvelle livraison à vérifier',
      coalesce(v_client,'Mission')||coalesce(' — '||
        case v_cov when 'photo' then 'Photo' when 'video' then 'Vidéo' when 'photo_video' then 'Photo + vidéo' end, '')||'.',
      new.prestation_id, 'normale',
      'livraison_recue:'||new.prestation_id||':'||d||':'||to_char(current_date,'YYYY-MM-DD'));
  end loop;
  return new;
end $function$;

drop trigger if exists trg_notifier_livraison_recue on media_liens;
create trigger trg_notifier_livraison_recue
  after insert on media_liens
  for each row execute function public.notifier_livraison_recue();

-- ── Production statue → l'opérateur ──────────────────────────────────────────
-- Validation et demande de correction passent par le même chemin : c'est le même événement vu
-- des deux côtés, et le message doit dire quoi faire, pas seulement ce qui s'est passé.
create or replace function public.notifier_decision_livraison()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_client text; v_op uuid; v_manque text[];
begin
  if new.statut is not distinct from old.statut or new.prestation_id is null then
    return new;
  end if;
  if new.statut not in ('valide','correction_demandee') then
    return new;
  end if;

  select c.nom into v_client
    from prestations p left join clients c on c.id = p.client_id where p.id = new.prestation_id;

  -- La personne qui a déposé le lien ; à défaut l'opérateur accepté sur la mission.
  v_op := new.ajouteur_id;
  if v_op is null then
    select pe.collaborateur_id into v_op from prestations_equipe pe
     where pe.prestation_id = new.prestation_id and pe.statut = 'acceptée' limit 1;
  end if;
  -- Ne pas se notifier soi-même : un opérateur qui corrige son propre lien n'a rien à apprendre.
  if v_op is null or v_op = auth.uid() then return new; end if;

  if new.statut = 'correction_demandee' then
    perform notifier(v_op, 'taches', 'correction_demandee',
      'Correction demandée',
      coalesce(v_client,'Mission')||coalesce(' — « '||nullif(trim(new.commentaire),'')||' »', ' — voir le détail dans la mission.'),
      new.prestation_id, 'normale',
      'correction_demandee:'||new.id||':'||v_op||':'||to_char(now(),'YYYY-MM-DD"T"HH24:MI'));
  else
    v_manque := mission_cloture_manquant(new.prestation_id);
    perform notifier(v_op, 'taches', 'livraison_validee',
      'Livraison validée',
      coalesce(v_client,'Mission')||' — '||
        case when array_length(v_manque,1) is null
             then 'votre mission est terminée.'
             else 'il reste : '||array_to_string(v_manque, ', ')||'.' end,
      new.prestation_id, 'faible',
      'livraison_validee:'||new.id||':'||v_op||':'||to_char(now(),'YYYY-MM-DD"T"HH24:MI'));
  end if;
  return new;
end $function$;

drop trigger if exists trg_notifier_decision_livraison on media_liens;
create trigger trg_notifier_decision_livraison
  after update of statut on media_liens
  for each row execute function public.notifier_decision_livraison();

-- ── Un incident est signalé → Production, en priorité haute ──────────────────
-- Matériel ou fichiers : dans les deux cas Production doit pouvoir réagir avant que le
-- problème devienne une perte.
create or replace function public.notifier_incident_prod()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_client text; d uuid;
begin
  if new.prestation_id is null or new.cloture then return new; end if;

  select c.nom into v_client
    from prestations p left join clients c on c.id = p.client_id where p.id = new.prestation_id;

  for d in select destinataires_production(new.prestation_id) loop
    if d = new.declare_par then continue; end if;
    perform notifier(d, 'taches', 'incident_signale',
      case when new.description ilike 'Matériel —%' then 'Incident matériel'
           when new.type_incident in ('carte_corrompue','fichier_manquant','disque_endommage','erreur_import','images_illisibles','carte_non_vide')
                then 'Problème de fichiers signalé'
           else 'Incident signalé' end,
      coalesce(v_client,'Mission')||' — '||left(new.description, 160),
      new.prestation_id, 'haute',
      'incident_signale:'||new.id||':'||d);
  end loop;
  return new;
end $function$;

drop trigger if exists trg_notifier_incident_prod on incidents;
create trigger trg_notifier_incident_prod
  after insert on incidents
  for each row execute function public.notifier_incident_prod();

-- ── Une mission est refusée → Production, immédiatement ──────────────────────
-- Il faut réaffecter, et c'est le genre d'information qui ne doit pas attendre le prochain cron.
create or replace function public.notifier_mission_refusee()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_client text; v_date date; v_qui text; d uuid;
begin
  if new.statut is not distinct from old.statut or new.statut <> 'refusée' then
    return new;
  end if;

  select c.nom, p.date_prestation into v_client, v_date
    from prestations p left join clients c on c.id = p.client_id where p.id = new.prestation_id;
  select coalesce(prenom,'')||' '||coalesce(nom,'') into v_qui from profiles where id = new.collaborateur_id;

  for d in select destinataires_production(new.prestation_id) loop
    perform notifier(d, 'taches', 'mission_refusee',
      'Mission refusée',
      coalesce(nullif(trim(v_qui),''),'Un opérateur')||' ne peut pas assurer '||coalesce(v_client,'la mission')||
        coalesce(' du '||to_char(v_date,'DD/MM'),'')||
        coalesce(' — « '||nullif(trim(new.notes_refus),'')||' »','')||'.',
      new.prestation_id, 'haute',
      'mission_refusee:'||new.id||':'||d);
  end loop;
  return new;
end $function$;

drop trigger if exists trg_notifier_mission_refusee on prestations_equipe;
create trigger trg_notifier_mission_refusee
  after update of statut on prestations_equipe
  for each row execute function public.notifier_mission_refusee();

commit;

select 'OK — notifications evenementielles posees' as verdict;
