-- Supprimer une mission depuis l'OS, proprement (10/09/2026).
--
-- Demande de Fouka pendant la première mission réelle : « pouvoir supprimer des missions dans l'OS ».
-- Jusqu'ici, seul un « Supprimer » admin/secrétariat existait, par un DELETE brut : il échouait dès
-- qu'une notification citait la mission (clé étrangère sans action), et, quand il passait, il
-- laissait l'opérateur invité sans nouvelles, le kit réservé, et la présence du CM en « mission
-- créée » pointant vers rien. La Production n'avait aucun bouton.
--
-- supprimer_mission(mission, motif) :
--   • qui : l'administration ; la Production ou le secrétariat du pôle ; le responsable du pôle ;
--   • quoi : une mission PAS COMMENCÉE et SANS HISTORIQUE. Une mission partie sur le terrain, ou qui
--     porte un devis, une facture, un paiement, un avoir, des frais, une dépense, une commission, un
--     incident, une livraison ou des médias se clôture ou s'annule : elle ne disparaît pas ;
--   • défait tout ce qui en dépendait : opérateurs invités ou confirmés prévenus (« mission
--     annulée »), kits rendus disponibles, présence du CM retirée et CM prévenu, demande du club
--     passée « non retenue » avec le motif. Le club n'est pas notifié (aucun changement de statut).
--   • garde une copie complète (mission, équipe) dans audit_logs.

begin;

create or replace function public.supprimer_mission(p_prestation_id uuid, p_motif text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_p prestations;
  v_role text;
  v_ref text;
  v_dest uuid;
  v_n_op int := 0;
  v_n_kits int := 0;
  v_kits uuid[];
  v_pp record;
  v_trace text;
  v_motif text := nullif(btrim(p_motif), '');
begin
  select * into v_p from prestations where id = p_prestation_id for update;
  if v_p.id is null then raise exception 'Mission introuvable.'; end if;
  select role into v_role from profiles where id = auth.uid();
  if not (v_role = 'admin'
          or (v_role in ('prod', 'sec') and coalesce(prestation_pole_scope_ok(p_prestation_id), false))
          or coalesce(is_pole_responsable_of_prestation(p_prestation_id), false)) then
    raise exception 'Seule la Production du pôle supprime une mission.' using errcode = '42501';
  end if;
  v_ref := coalesce(v_p.reference, 'la mission');

  if v_p.statut::text in ('équipe_en_route', 'arrivée_sur_place', 'production_démarrée', 'production_terminée',
                          'médias_à_transférer', 'médias_complets', 'à_monter', 'montage_en_cours', 'prêt_validation',
                          'à_valider_client', 'prête_à_livrer', 'livrée', 'clôturée') then
    raise exception '% est déjà commencée sur le terrain : elle se clôture ou s''annule, elle ne se supprime plus.', v_ref
      using errcode = '42501';
  end if;

  select concat_ws(', ',
    case when exists (select 1 from devis where prestation_id = p_prestation_id) then 'un devis' end,
    case when exists (select 1 from factures where prestation_id = p_prestation_id) then 'une facture' end,
    case when exists (select 1 from paiements where prestation_id = p_prestation_id) then 'un paiement' end,
    case when exists (select 1 from avoirs where prestation_id = p_prestation_id) then 'un avoir' end,
    case when exists (select 1 from frais where prestation_id = p_prestation_id) then 'des frais' end,
    case when exists (select 1 from expenses where prestation_id = p_prestation_id) then 'une dépense' end,
    case when exists (select 1 from commissions where prestation_id = p_prestation_id) then 'une commission' end,
    case when exists (select 1 from incidents where prestation_id = p_prestation_id)
           or exists (select 1 from materiel_incidents where prestation_id = p_prestation_id) then 'un incident' end,
    case when exists (select 1 from group_fundings where prestation_id = p_prestation_id) then 'une cagnotte' end,
    case when exists (select 1 from media_livrables where prestation_id = p_prestation_id)
           or exists (select 1 from media_livraisons where prestation_id = p_prestation_id)
           or exists (select 1 from media_albums where mission_id = p_prestation_id) then 'des médias ou une livraison' end,
    -- Une fiche de suivi peut n'avoir que l'acceptation : seule une vraie étape de terrain compte.
    case when exists (select 1 from mission_suivi_operateur where prestation_id = p_prestation_id
                       and coalesce(kit_prepare_at, parti_at, arrive_at, prestation_terminee_at, fichiers_securises_at, livre_at) is not null)
         then 'un suivi terrain' end)
    into v_trace;
  if nullif(v_trace, '') is not null then
    raise exception '% porte déjà % : elle ne se supprime pas, elle s''annule (secrétariat ou administration).', v_ref, v_trace
      using errcode = '42501';
  end if;

  -- La copie, avant tout.
  insert into audit_logs (acteur_id, action, cible_type, cible_id, details)
  values ((select id from profiles where id = auth.uid()), 'mission_supprimee', 'prestation', p_prestation_id,
          jsonb_build_object('reference', v_p.reference, 'motif', v_motif, 'mission', to_jsonb(v_p),
                             'equipe', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from prestations_equipe e where e.prestation_id = p_prestation_id),
                             'acteur_reel', auth.uid()));

  -- Les opérateurs déjà invités ou confirmés sont prévenus.
  for v_dest in select distinct collaborateur_id from prestations_equipe
                 where prestation_id = p_prestation_id and statut in ('invitation_envoyée', 'en_attente', 'acceptée') loop
    insert into notifications (destinataire_id, type, titre, message, priorite, source_type, lien_client_id, expediteur_id)
    values (v_dest, 'systeme', 'Mission annulée — ' || v_ref,
            'La mission du ' || coalesce(to_char(v_p.date_prestation, 'DD/MM'), '?') || coalesce(' — ' || nullif(v_p.lieu, ''), '')
              || ' est annulée par la Production.' || coalesce(' Motif : ' || v_motif, '') || ' Tu n''as rien à faire.',
            'haute', 'prestation', v_p.client_id, auth.uid());
    v_n_op := v_n_op + 1;
  end loop;

  -- Les kits réservés redeviennent disponibles (s'ils ne sont pas réservés ailleurs).
  -- Deux instructions : dans une seule, la réservation supprimée resterait visible au test « réservé
  -- ailleurs » et le kit ne serait jamais rendu.
  select coalesce(array_agg(kit_id), '{}') into v_kits from kit_reservations
   where prestation_id = p_prestation_id and statut <> 'retourné' and kit_id is not null;
  delete from kit_reservations where prestation_id = p_prestation_id and statut <> 'retourné';
  update kits k set statut = 'disponible'
   where k.id = any (v_kits) and k.statut = 'réservé'
     and not exists (select 1 from kit_reservations r where r.kit_id = k.id and r.statut <> 'retourné');
  get diagnostics v_n_kits = row_count;

  -- La présence décidée par le CM est retirée, le CM prévenu ; la demande du club, non retenue.
  for v_pp in select pp.id, pp.equipe, pp.adversaire, pp.date_presence, mp.cm_id
                from planned_presences pp join monthly_production_plans mp on mp.id = pp.plan_id
               where pp.created_prestation_id = p_prestation_id and pp.statut <> 'annule' loop
    update planned_presences set statut = 'annule', updated_at = now() where id = v_pp.id;
    update coverage_wishes set status = 'not_selected',
           not_selected_reason = coalesce(v_motif, 'Mission supprimée par la Production'), updated_at = now()
     where planned_presence_id = v_pp.id and status not in ('cancelled', 'completed', 'not_selected');
    if v_pp.cm_id is not null and v_pp.cm_id <> auth.uid() then
      insert into notifications (destinataire_id, type, titre, message, priorite, source_type, lien_client_id, expediteur_id)
      values (v_pp.cm_id, 'changement_planning_cm', 'Présence retirée par la Production',
              coalesce(nullif(concat_ws(' contre ', nullif(v_pp.equipe, ''), nullif(v_pp.adversaire, '')), ''), 'Un événement')
                || ' (' || to_char(v_pp.date_presence, 'DD/MM') || ') : ' || v_ref || ' a été supprimée.'
                || coalesce(' Motif : ' || v_motif, ''),
              'normale', 'prestation', v_p.client_id, auth.uid());
    end if;
  end loop;

  -- Les notifications déjà envoyées gardent leur texte ; elles ne pointent plus vers la mission.
  update notifications set prestation_id = null where prestation_id = p_prestation_id;
  update notifications set lien_prestation_id = null where lien_prestation_id = p_prestation_id;

  delete from prestations where id = p_prestation_id;

  return jsonb_build_object('ok', true, 'reference', v_p.reference, 'operateurs_prevenus', v_n_op, 'kits_rendus', v_n_kits);
end;
$$;
revoke execute on function public.supprimer_mission(uuid, text) from public, anon;
grant execute on function public.supprimer_mission(uuid, text) to authenticated;

commit;
