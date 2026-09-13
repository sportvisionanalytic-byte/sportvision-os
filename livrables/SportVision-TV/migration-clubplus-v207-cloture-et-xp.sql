-- v207 — La clôture respecte ce que l'opérateur a déclaré, et une mission validée donne ses XP.
-- 13/09/2026.
--
-- CE QUI N'ALLAIT PAS.
--
-- 1. `mission_cloture_manquant` exige les livrables déduits de la COUVERTURE, sans exception :
--    une mission `photo_video` réclame montage et rushs même quand il n'y a pas eu de vidéo. La
--    v206 a donné à l'opérateur le moyen de déclarer un livrable sans objet, mais cette fonction
--    l'ignorait : la Production ne pouvait toujours pas clôturer. La déclaration n'aurait servi
--    à rien.
--
-- 2. Une mission validée ne donnait aucun XP. La table `xp_events` existe et sert depuis le
--    centre de formation (36 événements) et les bonus (18) — jamais le terrain. Or c'est le
--    travail réel qui devrait en donner.
--
-- CE QUE FAIT CETTE MIGRATION.
--   • La clôture accepte un livrable déclaré sans objet, avec son motif. Ce n'est pas un
--     contournement : la déclaration est tracée, nominative, et la Production la lit avant de
--     valider. Une mission dont TOUS les livrables seraient déclarés sans objet reste bloquée —
--     l'écran de l'opérateur l'interdit déjà, la base le redit ici.
--   • La galerie devient un livrable attendu quand il y a de la photo, déclarable sans objet
--     comme les autres.
--   • À la validation (passage en `clôturée`), chaque opérateur qui a accepté la mission reçoit
--     ses XP. Idempotent : un rejeu n'en donne pas deux fois.
--
-- Le barème : 50 XP par mission validée. Valeur de départ, à changer d'une ligne.
-- Idempotente.

create or replace function public.mission_cloture_manquant(p_prestation_id uuid)
returns text[]
language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cov text;
  v_manque text[] := '{}';
  v_sans_objet jsonb := '{}'::jsonb;
  v_fournis int := 0;
begin
  select couverture into v_cov from prestations where id = p_prestation_id;

  -- Ce que l'opérateur a déclaré sans objet (v206), tous opérateurs confondus.
  select coalesce(jsonb_object_agg(cle, valeur), '{}'::jsonb) into v_sans_objet
    from (
      select t.cle, t.valeur
        from mission_suivi_operateur m,
             lateral jsonb_each(coalesce(m.livrables_non_fournis, '{}'::jsonb)) as t(cle, valeur)
       where m.prestation_id = p_prestation_id
    ) s;

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

  if v_cov is null then
    v_manque := v_manque || 'Couverture non renseignée'::text;
  end if;

  if v_cov in ('photo','photo_video') then
    if exists (select 1 from media_liens where prestation_id = p_prestation_id
                and type_media = 'photo' and categorie = 'final') then
      v_fournis := v_fournis + 1;
      if not exists (select 1 from media_liens where prestation_id = p_prestation_id
                      and type_media = 'photo' and categorie = 'final' and statut = 'valide') then
        v_manque := v_manque || 'Photos non validées par la Production'::text;
      end if;
    elsif not (v_sans_objet ? 'photo') then
      v_manque := v_manque || 'Photos traitées non livrées'::text;
    end if;

    -- La galerie compte comme livrable fourni, mais ne BLOQUE pas la clôture aujourd'hui.
    --
    -- Pourquoi : l'écran qui permet à l'opérateur de la déposer ou de cocher « sans objet » n'est
    -- pas encore en ligne. La rendre exigible maintenant bloquerait les missions en cours — celle
    -- de Michael la première — sur un « Galerie non transmise » qu'il n'aurait aucun moyen de
    -- lever. Elle est proposée dans sa liste de livrables ; l'exiger sera une ligne à changer ici,
    -- une fois les écrans déployés et le geste disponible.
    if exists (select 1 from media_liens where prestation_id = p_prestation_id
                and categorie = 'livraison') then
      v_fournis := v_fournis + 1;
    end if;
  end if;

  if v_cov in ('video','photo_video') then
    if exists (select 1 from media_liens where prestation_id = p_prestation_id
                and type_media = 'video' and categorie = 'final') then
      v_fournis := v_fournis + 1;
      if not exists (select 1 from media_liens where prestation_id = p_prestation_id
                      and type_media = 'video' and categorie = 'final' and statut = 'valide') then
        v_manque := v_manque || 'Montage non validé par la Production'::text;
      end if;
    elsif not (v_sans_objet ? 'montage') then
      v_manque := v_manque || 'Montage final non livré'::text;
    end if;

    if exists (select 1 from media_liens where prestation_id = p_prestation_id
                and categorie = 'rushs') then
      v_fournis := v_fournis + 1;
    elsif not (v_sans_objet ? 'rushs') then
      v_manque := v_manque || 'Rushs vidéo non transmis'::text;
    end if;
  end if;

  -- Tout déclaré sans objet, rien de livré : une mission ne se clôture pas sur du vide.
  if v_cov is not null and v_fournis = 0 then
    v_manque := v_manque || 'Aucun livrable réellement transmis'::text;
  end if;

  -- Matériel : restitué, OU conservation autorisée (retour prévu plus tard).
  if exists (
    select 1 from kit_reservations kr
     where kr.prestation_id = p_prestation_id
       and kr.statut not in ('retourné','en_contrôle','disponible')
       and (kr.date_retour_prevue is null or kr.date_retour_prevue <= now())
  ) then
    v_manque := v_manque || 'Kit non restitué'::text;
  end if;

  return v_manque;
end
$function$;

-- ─── XP de mission ───────────────────────────────────────────────────────────
create or replace function public.attribuer_xp_mission_validee()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_xp constant integer := 50;   -- barème de départ, à changer ici
  v_op record;
begin
  if new.statut <> 'clôturée' or old.statut = 'clôturée' then
    return new;
  end if;

  for v_op in
    select distinct pe.collaborateur_id
      from prestations_equipe pe
     where pe.prestation_id = new.id
       and pe.statut = 'acceptée'
       and pe.collaborateur_id is not null
  loop
    -- Idempotent : un rejeu de la validation ne donne pas deux fois les XP.
    if not exists (
      select 1 from xp_events x
       where x.collaborateur_id = v_op.collaborateur_id
         and x.source_type = 'prestation'
         and x.source_id = new.id
         and x.type = 'prestation'
    ) then
      insert into xp_events (collaborateur_id, montant, type, source_id, source_type, description)
      values (v_op.collaborateur_id, v_xp, 'prestation', new.id, 'prestation',
              'Mission validée par la Production — ' || coalesce(new.reference, 'prestation'));
    end if;
  end loop;

  return new;
end $$;

drop trigger if exists trg_xp_mission_validee on prestations;
create trigger trg_xp_mission_validee
  after update of statut on prestations
  for each row execute function attribuer_xp_mission_validee();
