-- La proposition de mission part quand la Production VALIDE la mission, pas au premier clic.
--
-- Première mission réelle, 10/09/2026. Fouka : « le responsable doit pouvoir tout faire, et après
-- validation ça envoie au photographe/vidéaste la proposition de mission ». Jusqu'ici, « + Ajouter »
-- dans l'équipe invitait l'opérateur sur-le-champ (statut « invitation envoyée » + notification) :
-- il recevait une mission sans brief, avant que la Production ait fini de la préparer.
--
-- Désormais :
--   • « + Ajouter » PRÉVOIT l'opérateur : statut « à envoyer », invisible pour lui (ni la ligne, ni
--     la mission, ni notification) ;
--   • la Production compose l'équipe, écrit le brief, vérifie le budget, puis valide :
--     envoyer_propositions_mission passe chaque « à envoyer » en « invitation envoyée » et prévient
--     chaque opérateur (date, lieu, rémunération proposée) ; il accepte ou refuse comme avant ;
--   • rpc_ajouter_membre_equipe garde son comportement par défaut (p_envoyer = true) : seul
--     l'écran Équipe demande l'état préparé.
--
-- Partie 1 (à valider seule — une nouvelle valeur d'énuméré ne s'utilise pas dans la transaction
-- qui la crée) :
--   alter type statut_affectation add value if not exists 'a_envoyer' after 'en_attente';

begin;

drop function if exists public.rpc_ajouter_membre_equipe(uuid, uuid, text, text, time without time zone, numeric, smallint, numeric, numeric, numeric, text, text);
CREATE FUNCTION public.rpc_ajouter_membre_equipe(p_prestation_id uuid, p_collaborateur_id uuid, p_fonction text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_heure_rdv time without time zone DEFAULT NULL::time without time zone, p_remuneration numeric DEFAULT NULL::numeric, p_niveau_snapshot smallint DEFAULT NULL::smallint, p_base_rate_snapshot numeric DEFAULT NULL::numeric, p_multiplier_snapshot numeric DEFAULT NULL::numeric, p_montant_recommande numeric DEFAULT NULL::numeric, p_motif_ajustement text DEFAULT NULL::text, p_motif_detail text DEFAULT NULL::text, p_envoyer boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role text; v_id uuid;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin', 'prod', 'sec') then
    raise exception 'Non autorise.' using errcode = '42501';
  end if;
  if v_role <> 'admin' and not coalesce(prestation_pole_scope_ok(p_prestation_id), false) then
    raise exception 'Cette mission n''est pas dans votre pôle.' using errcode = '42501';
  end if;
  insert into prestations_equipe (prestation_id, collaborateur_id, fonction, notes, statut, heure_rdv, remuneration,
                                  niveau_snapshot, base_rate_snapshot, multiplier_snapshot,
                                  montant_recommande, motif_ajustement, override_reason)
  -- p_envoyer = false : l'opérateur est PRÉVU, pas encore invité. La proposition part quand la
  -- Production valide la mission (envoyer_propositions_mission, v136).
  values (p_prestation_id, p_collaborateur_id, nullif(p_fonction, ''), nullif(p_notes, ''),
          case when p_envoyer then 'invitation_envoyée' else 'a_envoyer' end::statut_affectation,
          p_heure_rdv, p_remuneration, p_niveau_snapshot, p_base_rate_snapshot, p_multiplier_snapshot,
          p_montant_recommande, p_motif_ajustement, nullif(btrim(p_motif_detail), ''))
  returning id into v_id;
  return v_id;
end;
$function$;
revoke execute on function public.rpc_ajouter_membre_equipe(uuid, uuid, text, text, time without time zone, numeric, smallint, numeric, numeric, numeric, text, text, boolean) from public, anon;
grant execute on function public.rpc_ajouter_membre_equipe(uuid, uuid, text, text, time without time zone, numeric, smallint, numeric, numeric, numeric, text, text, boolean) to authenticated;

create or replace function public.envoyer_propositions_mission(p_prestation_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_p prestations;
  v_role text;
  v record;
  v_n int := 0;
begin
  select * into v_p from prestations where id = p_prestation_id;
  if v_p.id is null then raise exception 'Mission introuvable.'; end if;
  select role into v_role from profiles where id = auth.uid();
  if not (v_role = 'admin'
          or (v_role in ('prod', 'sec') and coalesce(prestation_pole_scope_ok(p_prestation_id), false))
          or coalesce(is_pole_responsable_of_prestation(p_prestation_id), false)) then
    raise exception 'Seule la Production du pôle envoie les propositions de mission.' using errcode = '42501';
  end if;

  for v in
    update prestations_equipe set statut = 'invitation_envoyée'
     where prestation_id = p_prestation_id and statut = 'a_envoyer'
    returning collaborateur_id, remuneration
  loop
    insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                               source_type, source_id, lien_prestation_id, lien_client_id, expediteur_id)
    values (v.collaborateur_id, 'invitation', 'Nouvelle mission — ' || coalesce(v_p.reference, 'mission'),
            'Mission du ' || coalesce(to_char(v_p.date_prestation, 'DD/MM'), '?')
              || coalesce(' à ' || to_char(v_p.heure_debut, 'HH24:MI'), '')
              || coalesce(' — ' || nullif(v_p.lieu, ''), '')
              || coalesce('. Rémunération proposée : ' || trim_scale(v.remuneration) || ' €', '')
              || '. Consulte le brief, puis accepte ou refuse depuis « Mes missions ».',
            p_prestation_id, 'haute', 'prestation', p_prestation_id, p_prestation_id, v_p.client_id, auth.uid());
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.envoyer_propositions_mission(uuid) from public, anon;
grant execute on function public.envoyer_propositions_mission(uuid) to authenticated;

-- ── L'opérateur ne voit rien d'une proposition qui n'est pas partie ──
create or replace view public.prestations_equipe_display as
SELECT id,
    prestation_id,
    collaborateur_id,
    est_responsable,
    fonction,
    heure_rdv,
        CASE
            WHEN collaborateur_id = auth.uid() THEN remuneration
            WHEN peut_voir_couts_mission(prestation_id) THEN remuneration
            ELSE NULL::numeric
        END AS remuneration,
    frais_km,
    km_estimes,
    statut,
    date_reponse,
    notes,
    created_at,
    notes_refus,
    heures_declarees,
    km_declares,
    frais_declares,
    notes_declaration,
    statut_paiement,
    date_paiement,
        CASE
            WHEN peut_voir_couts_mission(prestation_id) THEN montant_recommande
            ELSE NULL::numeric
        END AS montant_recommande,
        CASE
            WHEN peut_voir_couts_mission(prestation_id) THEN motif_ajustement
            ELSE NULL::text
        END AS motif_ajustement,
        CASE
            WHEN peut_voir_couts_mission(prestation_id) THEN override_reason
            ELSE NULL::text
        END AS motif_detail
   FROM prestations_equipe
  WHERE peut_voir_couts_mission(prestation_id) OR collaborateur_id = auth.uid() AND statut <> 'a_envoyer'::statut_affectation;

drop policy if exists equipe_select on public.prestations_equipe;
create policy equipe_select on public.prestations_equipe for select using (
  ((exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin', 'sec', 'rh', 'prod'])))
   and prestation_pole_scope_ok(prestation_id))
  or (collaborateur_id = auth.uid() and statut <> 'a_envoyer')
);
drop policy if exists equipe_update on public.prestations_equipe;
create policy equipe_update on public.prestations_equipe for update using (
  ((exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = any (array['admin', 'prod', 'sec', 'rh'])))
   and prestation_pole_scope_ok(prestation_id))
  or (collaborateur_id = auth.uid() and statut <> 'a_envoyer')
);
drop policy if exists prestations_acces on public.prestations;
create policy prestations_acces on public.prestations for all using (
(((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'sec'::text, 'prod'::text, 'compta'::text, 'rh'::text]))))) AND pole_scope_ok(pole_id)) OR (EXISTS ( SELECT 1
   FROM prestations_equipe
  WHERE ((prestations_equipe.prestation_id = prestations.id) AND (prestations_equipe.collaborateur_id = auth.uid()) AND (prestations_equipe.statut <> 'a_envoyer'::statut_affectation)))) OR ((type_prestation = 'réseaux_sociaux'::text) AND pole_scope_ok(pole_id) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'cm'::text) AND ((p.niveau_cm = 'cm_lead'::text) OR contenus_visible_par_cm(prestations.client_id, auth.uid())))))))
);

commit;
