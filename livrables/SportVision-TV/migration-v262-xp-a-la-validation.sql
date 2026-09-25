-- v262 — Les XP tombent quand la Production valide le travail (25/09/2026)
--
-- DEMANDE DE FOUKA : « Une fois que c'est validé, le photographe vidéaste n'a plus rien à faire.
-- Il reçoit comme quoi ça a été validé, il reçoit ses XP, sa rémunération. »
--
-- CE QUI EXISTAIT, ET CE QUI MANQUAIT. `mission_valider_travail` (v231) fait déjà presque tout :
-- elle vérifie que c'est bien la Production qui décide, interdit de valider son propre travail,
-- exige un motif écrit pour un refus, notifie l'opérateur et trace la décision. Il n'y manquait
-- que les XP.
--
-- LA FONCTION QUI LES CALCULAIT EXISTAIT AUSSI — `syncMissionXp` dans l'OS, 100 XP plus 50 pour
-- le responsable — et n'était appelée NULLE PART. Du code mort depuis son écriture. Elle vivait
-- en plus dans le navigateur : l'XP d'un opérateur dépendait donc de savoir si quelqu'un avait
-- ouvert le bon écran. Elle se déclenchait sur le statut de la PRESTATION, pas sur la validation
-- du travail — un opérateur dont le travail était refusé aurait touché ses XP quand même.
--
-- ON LES POSE DONC ICI, dans la décision elle-même, côté serveur. Un seul endroit décide, et il
-- décide au moment où la décision est prise.
--
-- CE QUI NE CHANGE PAS :
--   · Seul le rôle photographe/vidéaste a un parcours XP. Les autres rôles ne sont pas crédités,
--     comme avant : leur en donner n'aurait aucun sens, ils n'ont pas de grade à monter.
--   · L'idempotence vient de l'index unique xp_events(source_type, source_id, type), pas d'une
--     vérification applicative. Revalider ne recrédite pas.
--   · Un refus ne crédite rien, et ne RETIRE rien non plus si la mission avait été validée avant :
--     reprendre des XP acquis est une sanction que personne n'a demandée, et qui rendrait le
--     compteur d'un opérateur imprévisible.
--
-- Idempotente. À exécuter dans Supabase → SQL Editor.

create or replace function mission_valider_travail(p_affectation_id uuid, p_valide boolean, p_motif text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_pe prestations_equipe;
  v_ref text;
  v_motif text;
  v_role text;
  v_xp integer := 0;
  v_nouvelle boolean;
begin
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select * into v_pe from prestations_equipe where id = p_affectation_id;
  if v_pe.id is null then raise exception 'Affectation introuvable.' using errcode = 'P0002'; end if;
  if not peut_arbitrer_mission(v_pe.prestation_id) then
    raise exception 'Le travail d''une mission se valide par la Production.' using errcode = '42501';
  end if;
  if v_pe.collaborateur_id = auth.uid() then
    raise exception 'On ne valide pas son propre travail : cette mission relève de l''Admin.' using errcode = '42501';
  end if;
  v_motif := nullif(btrim(coalesce(p_motif, '')), '');
  -- Refuser sans dire pourquoi ne laisse à l'opérateur aucun moyen de corriger ni de contester.
  if p_valide is false and v_motif is null then
    raise exception 'Dites ce qui ne va pas : un refus sans motif n''est ni corrigeable ni contestable.';
  end if;

  -- La décision change-t-elle quelque chose ? Un second clic sur « Valider » ne doit pas
  -- renotifier l'opérateur : mesuré en transaction annulée, deux appels donnaient deux
  -- notifications « Mission validée » pour une seule décision. Les XP, eux, étaient déjà
  -- protégés par l'index unique — la notification ne l'était pas.
  v_nouvelle := v_pe.travail_valide is distinct from p_valide
                or coalesce(v_pe.travail_motif, '') is distinct from coalesce(v_motif, '');

  update prestations_equipe
     set travail_valide = p_valide, travail_motif = v_motif,
         travail_decide_par = auth.uid(), travail_decide_le = now(), updated_at = now()
   where id = p_affectation_id;

  -- ── Les XP, à la validation et nulle part ailleurs ──────────────────────────────────────────
  if p_valide then
    select role into v_role from profiles where id = v_pe.collaborateur_id;
    if v_role = 'photo' then
      v_xp := 100 + case when v_pe.est_responsable then 50 else 0 end;
      -- `on conflict do nothing` sur l'index unique : c'est LUI qui garantit qu'on ne crédite
      -- qu'une fois, pas un test préalable qui pourrait courir avec un autre appel.
      --
      -- LE PREDICAT EST OBLIGATOIRE. idx_xp_events_source_type_unique est un index PARTIEL
      -- (« where source_type is not null and source_id is not null »). Sans répéter ce prédicat
      -- ici, PostgreSQL ne reconnaît pas l'index et refuse : « there is no unique or exclusion
      -- constraint matching the ON CONFLICT specification ». Trouvé en éprouvant la fonction en
      -- transaction annulée, avant toute mise en service.
      insert into xp_events (collaborateur_id, montant, type, source_id, source_type,
                             description, attribue_par)
      values (v_pe.collaborateur_id, v_xp, 'prestation', p_affectation_id, 'prestations_equipe',
              'Mission validée par la Production', auth.uid())
      on conflict (source_type, source_id, type)
        where source_type is not null and source_id is not null
        do nothing;

      -- profiles.xp n'est incrémenté que si la ligne a VRAIMENT été insérée : sans ce test, une
      -- seconde validation gonflerait le compteur sans laisser de trace dans l'historique, et les
      -- deux ne diraient plus la même chose.
      if found then
        update profiles set xp = coalesce(xp, 0) + v_xp where id = v_pe.collaborateur_id;
      else
        v_xp := 0;
      end if;
    end if;
  end if;

  select reference into v_ref from prestations where id = v_pe.prestation_id;
  if v_nouvelle then
  insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                             source_type, source_id, lien_prestation_id, expediteur_id)
  values (v_pe.collaborateur_id, 'mission_verdict',
          case when p_valide then 'Mission validée — ' || coalesce(v_ref, 'mission')
               else 'Mission non validée — ' || coalesce(v_ref, 'mission') end,
          case when p_valide then
                 'La Production a validé ton travail sur cette mission. Tu n''as plus rien à faire.'
                 || case when v_xp > 0 then ' +' || v_xp || ' XP.' else '' end
               else 'La Production n''a pas validé ton travail sur cette mission. Motif : ' || v_motif end,
          v_pe.prestation_id, case when p_valide then 'normale' else 'haute' end,
          'prestation', v_pe.prestation_id, v_pe.prestation_id, auth.uid());
  end if;

  -- Le journal financier, lui, trace CHAQUE décision, même répétée : c'est son rôle de dire qui a
  -- cliqué quoi et quand, y compris deux fois.
  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
  values (auth.uid(), case when p_valide then 'mission_travail_valide' else 'mission_travail_refuse' end,
          'prestations_equipe', p_affectation_id, v_pe.remuneration, v_pe.remuneration,
          jsonb_build_object('motif', v_motif, 'operateur', v_pe.collaborateur_id,
                             'prestation', v_pe.prestation_id, 'xp', v_xp));

  return jsonb_build_object('ok', true, 'valide', p_valide, 'xp', v_xp,
                            'net_a_payer', mission_net_a_payer(p_affectation_id));
end $$;
