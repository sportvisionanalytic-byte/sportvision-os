-- v270 — Le Responsable Production valide ses propres missions (25/09/2026)
--
-- « Il faut qu'il puisse valider la prestation, même si l'Admin n'a pas encore validé. Après,
-- c'est moi qui validerai, parce que là il n'y a que le salaire qui va bloquer. » (Fouka)
--
-- Le refus d'avant avait sa raison : personne ne relit plus ses missions à lui. Contrôle en moins,
-- assumé, sur une équipe de deux personnes où l'attendre bloquerait tout.
--
-- CE QUI REND LA CHOSE TENABLE : l'argent ne suit pas. Un montant différent de la grille reste une
-- demande d'exception que seul l'Admin tranche. Il valide son travail, il ne se paie pas plus.
--
-- Et ce n'est jamais discret : action distincte au journal financier, et l'Admin est notifié.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.mission_valider_travail(p_affectation_id uuid, p_valide boolean, p_motif text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pe prestations_equipe;
  v_ref text;
  v_motif text;
  v_role text;
  v_xp integer := 0;
  v_nouvelle boolean;
  v_soi_meme boolean;
  v_admin uuid;
begin
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select * into v_pe from prestations_equipe where id = p_affectation_id;
  if v_pe.id is null then raise exception 'Affectation introuvable.' using errcode = 'P0002'; end if;
  if not peut_arbitrer_mission(v_pe.prestation_id) then
    raise exception 'Le travail d''une mission se valide par la Production.' using errcode = '42501';
  end if;
  -- ── VALIDER SON PROPRE TRAVAIL : PERMIS, MAIS JAMAIS DISCRET (25/09/2026) ──────────────────
  --
  -- DÉCISION DE FOUKA : « Il faut que lui puisse valider la prestation, même si l'Admin n'a pas
  -- encore validé. Après, c'est moi qui validerai, parce que là il n'y a que le salaire qui va
  -- bloquer. Pour le moment je veux qu'il puisse valider tout seul ses prestations. »
  --
  -- LE REFUS D'AVANT AVAIT SA RAISON, et elle est dite ici pour qu'on sache ce qu'on a échangé :
  -- personne ne relit plus les missions que le Responsable Production fait lui-même. C'est un
  -- contrôle en moins, assumé, sur une équipe de deux personnes où l'attendre bloquerait tout.
  --
  -- CE QUI REND LA CHOSE TENABLE : l'argent ne suit pas. Un montant différent de la grille reste
  -- une demande d'exception que seul l'Admin tranche (v148) — il peut valider son travail, il ne
  -- peut toujours pas se payer plus. C'est exactement la frontière que Fouka décrit.
  --
  -- ON NE SE CONTENTE PAS DE LAISSER PASSER. Une validation de soi-même est tracée sous une
  -- action distincte dans le journal financier, et l'Admin en est notifié : il n'a pas à aller
  -- chercher ce qui s'est décidé sans lui.
  v_soi_meme := (v_pe.collaborateur_id = auth.uid());
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
  -- L'Admin apprend qu'une validation s'est faite sans lui, au moment ou elle se fait.
  if v_soi_meme and p_valide then
    for v_admin in select id from profiles where role = 'admin' and coalesce(actif, true) loop
      insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                                 source_type, source_id, lien_prestation_id, expediteur_id)
      values (v_admin, 'mission_verdict',
              'Travail validé par son propre auteur — ' || coalesce(v_ref, 'mission'),
              (select coalesce(prenom || ' ' || nom, 'Un responsable') from profiles where id = v_pe.collaborateur_id)
                || ' a validé son propre travail sur cette mission. La rémunération, elle, reste '
                || 'à la grille tant que vous n''avez pas tranché une éventuelle exception.',
              v_pe.prestation_id, 'normale', 'prestation', v_pe.prestation_id, v_pe.prestation_id, auth.uid());
    end loop;
  end if;

  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
  values (auth.uid(), case when not p_valide then 'mission_travail_refuse'
                          when v_soi_meme then 'mission_travail_valide_soi_meme'
                          else 'mission_travail_valide' end,
          'prestations_equipe', p_affectation_id, v_pe.remuneration, v_pe.remuneration,
          jsonb_build_object('motif', v_motif, 'operateur', v_pe.collaborateur_id,
                             'prestation', v_pe.prestation_id, 'xp', v_xp));

  return jsonb_build_object('ok', true, 'valide', p_valide, 'xp', v_xp,
                            'net_a_payer', mission_net_a_payer(p_affectation_id));
end $function$;
