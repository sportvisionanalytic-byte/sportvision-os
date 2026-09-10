-- La frontière de la Production : les coûts de SES missions, pas la vie financière des personnes.
--
-- Décision de Fouka, 10/09/2026, après la v127 :
--   « Production peut voir : prix client en lecture seule, rémunération recommandée/retenue,
--     déplacements, coûts Production et marge estimée.
--     Production ne voit pas : paie globale, coordonnées bancaires, coûts RH hors mission,
--     rémunérations sans rapport avec son périmètre. »
--
-- Déjà fermé avant cette migration, vérifié par lecture des policies : coûts employeur
-- (employee_costs), transactions bancaires, fournisseurs et leurs IBAN (vendors), commissions,
-- documents RH des collaborateurs, prévisions, paiements.
--
-- Ce qui restait ouvert, et que cette migration ferme :
--   1. Le périmètre. Les missions de la Production sont cloisonnées par pôle (`prestations_acces`,
--      `equipe_update` : `pole_scope_ok`), mais les montants passaient par des fonctions qui ne
--      regardaient que le rôle : `peut_voir_couts_mission`, `v_rentabilite_missions`,
--      `prestations_equipe_display`, `rentabilite_club_mois`, `rentabilite_clubs_mois`,
--      `modifier_remuneration_mission`, `rpc_ajouter_membre_equipe`. La Production d'un pôle
--      voyait et modifiait les montants d'un autre. Même règle désormais pour le Secrétariat, déjà
--      cloisonné par pôle sur les affectations. La Comptabilité, l'expert-comptable et l'auditeur
--      gardent la vue globale : c'est leur métier.
--   2. Les frais. La Production validait les frais de tout le monde (secrétariat, CM, commerciaux),
--      mission ou pas. Elle voit maintenant les frais des missions de son pôle, et les frais hors
--      mission des opérateurs terrain, qu'elle encadre. Le reste va à la Comptabilité.
--   3. Le barème des responsables de pôle (fixe mensuel et variable selon le nombre de contrats) :
--      lisible par tout le staff, photographes compris, donc la paie d'une personne à une ligne
--      près. Réservé à l'administration, la finance, et aux responsables de pôle.
--
-- Aucun effet visible le 10/09 : un seul pôle a des clients (Football), une seule Production y est
-- affectée. La règle vaut pour le jour où un deuxième pôle aura sa Production.

begin;

-- Qui voit les coûts : la finance partout ; la Production et le Secrétariat dans leur pôle.
create or replace function public.peut_voir_couts_pole(p_pole_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from profiles where id = auth.uid()
                  and role in ('admin', 'compta', 'expert_comptable', 'auditeur'))
      or (exists (select 1 from profiles where id = auth.uid() and role in ('prod', 'sec'))
          and coalesce(pole_scope_ok(p_pole_id), false));
$$;

create or replace function public.peut_voir_couts_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p_client_id is not null
     and peut_voir_couts_pole((select pole_id from clients where id = p_client_id));
$$;

create or replace function public.peut_voir_couts_mission(p_prestation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select peut_voir_couts_pole((select pole_id from prestations where id = p_prestation_id))
      or coalesce(is_pole_responsable_of_prestation(p_prestation_id), false);
$$;

revoke execute on function public.peut_voir_couts_pole(uuid) from public, anon;
revoke execute on function public.peut_voir_couts_client(uuid) from public, anon;
grant execute on function public.peut_voir_couts_pole(uuid) to authenticated;
grant execute on function public.peut_voir_couts_client(uuid) to authenticated;

-- ── Les montants, dans le périmètre ──

create or replace view public.v_rentabilite_missions as
SELECT p.id AS prestation_id,
    p.reference,
    p.type_prestation,
    p.client_id,
    c.nom AS client_nom,
    p.date_prestation,
    p.statut_financier,
    COALESCE(p.montant_ht, 0::numeric) AS revenu_ht,
    COALESCE(re.total_remunerations, 0::numeric) AS cout_remunerations,
    COALESCE(fr.total_frais, 0::numeric) AS cout_frais,
    COALESCE(de.total_depenses, 0::numeric) AS cout_depenses_directes,
    COALESCE(( SELECT cost_allocations.valeur
           FROM cost_allocations
          WHERE cost_allocations.actif = true AND cost_allocations.methode = 'forfait_par_mission'::text
         LIMIT 1), 0::numeric) + COALESCE(p.montant_ht, 0::numeric) * COALESCE(( SELECT cost_allocations.valeur
           FROM cost_allocations
          WHERE cost_allocations.actif = true AND cost_allocations.methode = 'pourcentage_ca'::text
         LIMIT 1), 0::numeric) / 100.0 AS cout_indirect_alloue,
    COALESCE(p.montant_ht, 0::numeric) - COALESCE(re.total_remunerations, 0::numeric) - COALESCE(fr.total_frais, 0::numeric) - COALESCE(de.total_depenses, 0::numeric) - (COALESCE(( SELECT cost_allocations.valeur
           FROM cost_allocations
          WHERE cost_allocations.actif = true AND cost_allocations.methode = 'forfait_par_mission'::text
         LIMIT 1), 0::numeric) + COALESCE(p.montant_ht, 0::numeric) * COALESCE(( SELECT cost_allocations.valeur
           FROM cost_allocations
          WHERE cost_allocations.actif = true AND cost_allocations.methode = 'pourcentage_ca'::text
         LIMIT 1), 0::numeric) / 100.0) AS marge_nette,
    p.pole_id
   FROM prestations p
     LEFT JOIN clients c ON c.id = p.client_id
     LEFT JOIN ( SELECT prestations_equipe.prestation_id,
            sum(prestations_equipe.remuneration) AS total_remunerations
           FROM prestations_equipe
          WHERE prestations_equipe.statut = 'acceptée'::statut_affectation
          GROUP BY prestations_equipe.prestation_id) re ON re.prestation_id = p.id
     LEFT JOIN ( SELECT frais.prestation_id,
            sum(frais.montant) AS total_frais
           FROM frais
          WHERE frais.statut = ANY (ARRAY['validé'::text, 'remboursé'::text])
          GROUP BY frais.prestation_id) fr ON fr.prestation_id = p.id
     LEFT JOIN ( SELECT expenses.prestation_id,
            sum(expenses.montant_ht) AS total_depenses
           FROM expenses
          WHERE expenses.statut = ANY (ARRAY['engagee'::text, 'payee'::text, 'comptabilisee'::text])
          GROUP BY expenses.prestation_id) de ON de.prestation_id = p.id
  WHERE (p.statut <> ALL (ARRAY['annulée'::statut_prestation, 'refusée'::statut_prestation])) AND peut_voir_couts_pole(p.pole_id);

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
  WHERE peut_voir_couts_mission(prestation_id) OR collaborateur_id = auth.uid();

CREATE OR REPLACE FUNCTION public.rentabilite_club_mois(p_club_id uuid, p_mois date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_client uuid;
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin date := (date_trunc('month', p_mois) + interval '1 month - 1 day')::date;
  v_abonnement numeric; v_ponctuel numeric; v_presences int; v_missions int;
  v_remu numeric; v_km numeric; v_frais numeric;
begin
  select portail_client_id into v_client from clubs where id = p_club_id;
  if not peut_voir_couts_client(v_client) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  select coalesce(sum(ct.montant_mensuel), 0) into v_abonnement
    from contrats ct
   where ct.client_id = v_client and ct.statut = 'actif' and ct.montant_mensuel is not null
     and (ct.date_debut is null or ct.date_debut <= v_fin) and (ct.date_fin is null or ct.date_fin >= v_debut);

  select coalesce(sum(p.montant_ht), 0) into v_ponctuel
    from prestations p
   where p.client_id = v_client and p.date_prestation between v_debut and v_fin
     and p.statut not in ('annulée', 'refusée') and p.source <> 'planning_mensuel_cm';

  select count(*) into v_presences from planned_presences pr
   where coalesce(pr.statut, 'prevu') <> 'annule' and pr.date_presence between v_debut and v_fin
     and (exists (select 1 from club_matches m where m.id = pr.match_id and m.club_id = p_club_id)
          or exists (select 1 from club_calendar_events e where e.id = pr.calendar_event_id and e.club_id = p_club_id)
          or pr.occurrence_ref in (select 'entrainement:' || s.id || ':' || to_char(pr.date_presence, 'YYYY-MM-DD')
                                     from club_team_training_slots s join club_teams t on t.id = s.team_id
                                    where t.club_id = p_club_id));

  select coalesce(sum(pe.remuneration), 0), coalesce(sum(pe.frais_km), 0)
    into v_remu, v_km
    from prestations p
    left join prestations_equipe pe on pe.prestation_id = p.id and pe.statut = 'acceptée'
   where p.client_id = v_client and p.date_prestation between v_debut and v_fin
     and p.statut not in ('annulée', 'refusée');
  select count(distinct p.id) into v_missions from prestations p
   where p.client_id = v_client and p.date_prestation between v_debut and v_fin and p.statut not in ('annulée', 'refusée');

  select coalesce(sum(f.montant), 0) into v_frais
    from frais f join prestations p on p.id = f.prestation_id
   where p.client_id = v_client and p.date_prestation between v_debut and v_fin
     and f.statut in ('validé', 'remboursé');

  return jsonb_build_object(
    'mois', to_char(v_debut, 'YYYY-MM'),
    'revenus_abonnement', v_abonnement,
    'revenus_ponctuels', v_ponctuel,
    'revenus_total', v_abonnement + v_ponctuel,
    'presences', v_presences,
    'missions', v_missions,
    'remunerations', v_remu,
    'deplacements', v_km + v_frais,
    'cout_production', v_remu + v_km + v_frais,
    'marge_estimee', v_abonnement + v_ponctuel - (v_remu + v_km + v_frais)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.rentabilite_clubs_mois(p_mois date)
 RETURNS TABLE(club_id uuid, club_nom text, detail jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not exists (select 1 from profiles where id = auth.uid()
                  and role in ('admin', 'prod', 'compta', 'sec', 'expert_comptable', 'auditeur')) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select c.id, c.nom, rentabilite_club_mois(c.id, p_mois)
    from clubs c
   where c.portail_client_id is not null and peut_voir_couts_client(c.portail_client_id)
   order by c.nom;
end;
$function$;

CREATE OR REPLACE FUNCTION public.modifier_remuneration_mission(p_equipe_id uuid, p_montant numeric, p_montant_recommande numeric DEFAULT NULL::numeric, p_motif text DEFAULT NULL::text, p_motif_detail text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pe prestations_equipe;
  v_ref text;
  v_nouvelle_proposition boolean := false;
begin
  select * into v_pe from prestations_equipe where id = p_equipe_id;
  if v_pe.id is null then raise exception 'Affectation introuvable.'; end if;
  if not (exists (select 1 from profiles where id = auth.uid() and role = 'admin')
          or (exists (select 1 from profiles where id = auth.uid() and role = 'prod')
              and prestation_pole_scope_ok(v_pe.prestation_id))
          or is_pole_responsable_of_prestation(v_pe.prestation_id)) then
    raise exception 'La rémunération d''une mission se fixe par la Production.' using errcode = '42501';
  end if;
  if p_montant is not null and p_montant < 0 then raise exception 'Montant invalide.'; end if;

  -- Baisser un montant accepté = nouvelle proposition : l'opérateur la reçoit et répond.
  v_nouvelle_proposition := v_pe.statut = 'acceptée' and coalesce(p_montant, 0) < coalesce(v_pe.remuneration, 0);

  update prestations_equipe
     set remuneration = p_montant,
         montant_recommande = coalesce(p_montant_recommande, montant_recommande),
         motif_ajustement = p_motif,
         override_reason = nullif(btrim(p_motif_detail), ''),
         statut = case when v_nouvelle_proposition then 'invitation_envoyée'::statut_affectation else statut end,
         date_reponse = case when v_nouvelle_proposition then null else date_reponse end
   where id = p_equipe_id;

  select reference into v_ref from prestations where id = v_pe.prestation_id;
  if v_pe.statut = 'acceptée' or v_nouvelle_proposition then
    insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                               source_type, source_id, lien_prestation_id, expediteur_id)
    values (v_pe.collaborateur_id,
            case when v_nouvelle_proposition then 'invitation' else 'remuneration_modifiee' end,
            case when v_nouvelle_proposition then 'Nouvelle proposition — ' || coalesce(v_ref, 'mission')
                 else 'Rémunération augmentée — ' || coalesce(v_ref, 'mission') end,
            case when v_nouvelle_proposition
                 then 'La Production te propose ' || p_montant || ' € (au lieu de ' || v_pe.remuneration || ' € acceptés). Accepte ou refuse depuis ton tableau de bord.'
                 else 'Ta rémunération pour cette mission passe de ' || coalesce(v_pe.remuneration, 0) || ' € à ' || p_montant || ' €.' end,
            v_pe.prestation_id, 'haute', 'prestation', v_pe.prestation_id, v_pe.prestation_id, auth.uid());
  end if;

  return jsonb_build_object('ok', true, 'nouvelle_proposition', v_nouvelle_proposition);
end;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_ajouter_membre_equipe(p_prestation_id uuid, p_collaborateur_id uuid, p_fonction text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_heure_rdv time without time zone DEFAULT NULL::time without time zone, p_remuneration numeric DEFAULT NULL::numeric, p_niveau_snapshot smallint DEFAULT NULL::smallint, p_base_rate_snapshot numeric DEFAULT NULL::numeric, p_multiplier_snapshot numeric DEFAULT NULL::numeric, p_montant_recommande numeric DEFAULT NULL::numeric, p_motif_ajustement text DEFAULT NULL::text, p_motif_detail text DEFAULT NULL::text)
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
  values (p_prestation_id, p_collaborateur_id, nullif(p_fonction, ''), nullif(p_notes, ''), 'invitation_envoyée',
          p_heure_rdv, p_remuneration, p_niveau_snapshot, p_base_rate_snapshot, p_multiplier_snapshot,
          p_montant_recommande, p_motif_ajustement, nullif(btrim(p_motif_detail), ''))
  returning id into v_id;
  return v_id;
end;
$function$;

-- ── Les frais ──
-- Lire le rôle du déclarant sans passer par la RLS de `profiles` : la Production ne voit pas
-- forcément le profil d'un opérateur qui n'est affecté à aucun pôle.
create or replace function public.est_operateur_terrain(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from profiles where id = p_user_id and role = 'photo');
$$;
revoke execute on function public.est_operateur_terrain(uuid) from public, anon;
grant execute on function public.est_operateur_terrain(uuid) to authenticated;

drop policy if exists frais_select on public.frais;
create policy frais_select on public.frais for select using (
  collaborateur_id = auth.uid()
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'compta'))
  or (exists (select 1 from profiles where id = auth.uid() and role = 'prod')
      and (coalesce(pole_scope_ok(pole_id), false)
           or (prestation_id is null
               and est_operateur_terrain(frais.collaborateur_id))))
);
drop policy if exists frais_update on public.frais;
create policy frais_update on public.frais for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'compta'))
  or (exists (select 1 from profiles where id = auth.uid() and role = 'prod')
      and (coalesce(pole_scope_ok(pole_id), false)
           or (prestation_id is null
               and est_operateur_terrain(frais.collaborateur_id))))
);

-- ── Le barème des responsables de pôle ──
drop policy if exists pole_remuneration_paliers_select_staff on public.pole_remuneration_paliers;
drop policy if exists pole_remuneration_paliers_select on public.pole_remuneration_paliers;
create policy pole_remuneration_paliers_select on public.pole_remuneration_paliers for select using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'compta', 'expert_comptable', 'auditeur'))
  or exists (select 1 from pole_affectations pa
              where pa.user_id = auth.uid() and pa.role_pole = 'responsable' and pa.actif
                and (pole_remuneration_paliers.pole_id is null or pa.pole_id = pole_remuneration_paliers.pole_id))
);

commit;
