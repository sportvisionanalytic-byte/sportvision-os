-- Rémunération mission : la Production la fixe, avec un référentiel, un motif, un historique, et
-- un montant qui ne recule plus une fois accepté.
--
-- Décision de Fouka, 10/09/2026 :
--   « Le CM décide où SportVision doit être présent → le Responsable Production transforme ça en
--     mission exploitable → il choisit l'opérateur → il fixe sa rémunération → l'opérateur voit
--     le montant avant d'accepter. »
--   Trois notions séparées : prix client (secrétariat / admin), coût production, rémunération
--   opérateur. La grille reste la RECOMMANDATION, pas le montant imposé. Au-delà d'un écart
--   notable, un motif. Tout est historisé. Montant figé après acceptation : on peut l'augmenter,
--   pour le baisser il faut une nouvelle proposition que l'opérateur accepte.
--
-- ── Ce qui existait, et ce qui ne tenait pas ──
--   • L'historique (`financial_audit_log`) notait avant / après / auteur, sans motif.
--   • La grille (niveau × format) était calculée par l'OS et figée en « snapshot », sans le
--     montant recommandé lui-même.
--   • admin, prod ET sec modifiaient une rémunération à tout moment — y compris à la baisse après
--     acceptation. Le secrétariat ne doit plus y toucher (hors admin).
--   • La production pouvait changer le PRIX CLIENT (montant_ht…) d'une prestation.
--   • La production ne VOYAIT PAS les rémunérations (masquage de fin août, que la décision du jour
--     remplace : elle les fixe, elle doit les voir).
--   • `v_rentabilite_missions` (prix vendu, rémunérations, marge par mission) était ouverte à tout
--     « staff » — photographes, vidéastes et CM compris — et fermée à la production.
--
-- ── Ce que pose ce fichier ──
--   1. `montant_recommande` et `motif_ajustement` sur l'affectation ; seuil d'écart unique (15 %).
--   2. La règle en base, quel que soit l'écran : qui fixe (admin, production, responsable du
--      pôle), motif obligatoire au-delà du seuil, verrou à la baisse après acceptation.
--   3. L'historique porte le motif, le montant recommandé et le rôle de l'auteur ;
--      `historique_remuneration(prestation)` le rend lisible.
--   4. `modifier_remuneration_mission(...)` : le geste de la Production, qui prévient l'opérateur.
--   5. `rpc_ajouter_membre_equipe` reçoit le montant recommandé et le motif.
--   6. Visibilité : la production voit les rémunérations ; la rentabilité est réservée à admin,
--      compta, production, secrétariat (et expert-comptable / auditeur) ; la production ne change
--      plus le prix client.
--   7. `rentabilite_club_mois(club, mois)` : revenus, présences, rémunérations, déplacements, coût,
--      marge opérationnelle estimée.
--
-- Rien ne change pour l'opérateur : il ne voit que SA rémunération, avant d'accepter. Le CM ne voit
-- aucun montant (couverture_operateurs ne rend que noms, fonction et réponse).

begin;

-- ── 1. Le référentiel et le motif ──
alter table public.prestations_equipe
  add column if not exists montant_recommande numeric,
  add column if not exists motif_ajustement text
    check (motif_ajustement is null or motif_ajustement in
      ('match_eloigne','grande_amplitude','urgence','double_couverture','operateur_senior','autre'));

comment on column public.prestations_equipe.montant_recommande is
  'Montant de la grille (niveau × format) au moment où la rémunération est fixée. Référence, pas montant imposé.';
comment on column public.prestations_equipe.motif_ajustement is
  'Pourquoi la rémunération retenue s''écarte du montant recommandé. Obligatoire au-delà de seuil_ecart_remuneration().';

create or replace function public.seuil_ecart_remuneration()
returns numeric
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$ select 0.15::numeric; $$;

-- ── 2. La règle, en base ──
create or replace function public.protect_sensitive_affectation_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role text;
  v_production boolean;
  v_paiement boolean;
  v_montant_change boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select role into v_role from profiles where id = auth.uid();
  -- Fixer une rémunération : l'administration, la production, le responsable du pôle.
  v_production := v_role in ('admin', 'prod') or is_pole_responsable_of_prestation(new.prestation_id);
  -- Régler une rémunération : l'administration, le secrétariat, la comptabilité.
  v_paiement := v_role in ('admin', 'sec', 'compta');

  v_montant_change := tg_op = 'INSERT' and (new.remuneration is not null or new.frais_km is not null)
                   or tg_op = 'UPDATE' and (new.remuneration is distinct from old.remuneration
                                            or new.frais_km is distinct from old.frais_km);

  if v_montant_change and not v_production then
    raise exception 'La rémunération d''une mission se fixe par la Production.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    -- Montant engagé : une fois accepté, il ne recule plus sans l'accord de l'opérateur. Le
    -- baisser passe par une NOUVELLE proposition (l'affectation repart en invitation).
    if old.statut = 'acceptée' and new.statut = 'acceptée'
       and (coalesce(new.remuneration, 0) < coalesce(old.remuneration, 0)
            or coalesce(new.frais_km, 0) < coalesce(old.frais_km, 0)) then
      raise exception 'Montant engagé : l''opérateur a accepté % €. Pour le baisser, faites-lui une nouvelle proposition, qu''il acceptera ou non.',
        old.remuneration using errcode = '42501';
    end if;

    if (new.statut_paiement is distinct from old.statut_paiement or new.date_paiement is distinct from old.date_paiement)
       and not (v_paiement or v_role = 'admin') then
      raise exception 'Le règlement d''une rémunération relève de la comptabilité ou du secrétariat.' using errcode = '42501';
    end if;

    if (new.prestation_id is distinct from old.prestation_id or new.collaborateur_id is distinct from old.collaborateur_id
        or new.est_responsable is distinct from old.est_responsable)
       and not (v_production or v_role = 'sec') then
      raise exception 'Modification non autorisée : l''affectation est réservée à la Production.' using errcode = '42501';
    end if;
  end if;

  -- Écart notable avec la grille : un motif.
  if v_montant_change and new.montant_recommande is not null and new.montant_recommande > 0
     and new.remuneration is not null
     and abs(new.remuneration - new.montant_recommande) > seuil_ecart_remuneration() * new.montant_recommande
     and new.motif_ajustement is null then
    raise exception 'Écart de % %% avec le montant recommandé (% €) : indiquez le motif de l''ajustement.',
      round(100 * abs(new.remuneration - new.montant_recommande) / new.montant_recommande),
      new.montant_recommande using errcode = '22023';
  end if;

  if v_production or v_role = 'sec' then
    return new;
  end if;

  -- L'opérateur lui-même : seule la réponse à sa propre invitation lui revient.
  if tg_op = 'INSERT' then
    if new.est_responsable is true or coalesce(new.statut_paiement, 'en_attente') <> 'en_attente'
       or new.date_paiement is not null or new.statut is distinct from 'invitation_envoyée' then
      raise exception 'Modification non autorisée : responsabilité, paiement et statut sont réservés à la Production.';
    end if;
    return new;
  end if;

  if new.statut is distinct from old.statut then
    if not (old.statut in ('invitation_envoyée', 'en_attente') and new.statut in ('acceptée', 'refusée')
            and old.collaborateur_id = auth.uid()) then
      raise exception 'Modification non autorisée : seule l''acceptation ou le refus de votre propre invitation est permis sans validation Production.';
    end if;
  end if;

  return new;
end;
$function$;

-- ── 3. L'historique porte le motif ──
create or replace function public.log_equipe_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    begin
      insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_apres, details)
      values (auth.uid(), 'creation', 'prestations_equipe', new.id, new.remuneration,
        jsonb_build_object('prestation_id', new.prestation_id, 'collaborateur_id', new.collaborateur_id,
                           'fonction', new.fonction, 'montant_recommande', new.montant_recommande,
                           'motif', new.motif_ajustement, 'motif_detail', new.override_reason,
                           'role_auteur', (select role from profiles where id = auth.uid())));
    exception when others then
      raise warning 'log_equipe_change (insert): échec du log (non bloquant) : %', sqlerrm;
    end;
    return new;
  end if;

  if new.statut is distinct from old.statut or new.remuneration is distinct from old.remuneration
     or new.frais_km is distinct from old.frais_km then
    begin
      insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
      values (auth.uid(), 'modification', 'prestations_equipe', new.id, old.remuneration, new.remuneration,
        jsonb_build_object('statut_avant', old.statut, 'statut_apres', new.statut,
                           'prestation_id', new.prestation_id, 'collaborateur_id', new.collaborateur_id,
                           'frais_km_avant', old.frais_km, 'frais_km_apres', new.frais_km,
                           'montant_recommande', new.montant_recommande,
                           'motif', new.motif_ajustement, 'motif_detail', new.override_reason,
                           'role_auteur', (select role from profiles where id = auth.uid())));
    exception when others then
      raise warning 'log_equipe_change (update): échec du log (non bloquant) : %', sqlerrm;
    end;
  end if;
  return new;
end;
$function$;

create or replace function public.peut_voir_couts_mission(p_prestation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from profiles where id = auth.uid()
                  and role in ('admin', 'prod', 'compta', 'sec', 'expert_comptable', 'auditeur'))
      or is_pole_responsable_of_prestation(p_prestation_id);
$$;
revoke execute on function public.peut_voir_couts_mission(uuid) from public, anon;
grant execute on function public.peut_voir_couts_mission(uuid) to authenticated;

create or replace function public.historique_remuneration(p_prestation_id uuid)
returns table (le timestamptz, collaborateur text, avant numeric, apres numeric, statut text,
               par text, role_par text, montant_recommande numeric, motif text, motif_detail text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not peut_voir_couts_mission(p_prestation_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query
  select l.created_at,
         nullif(btrim(concat_ws(' ', c.prenom, c.nom)), ''),
         l.montant_avant, l.montant_apres,
         coalesce(l.details->>'statut_apres', 'invitation_envoyée'),
         nullif(btrim(concat_ws(' ', a.prenom, a.nom)), ''),
         l.details->>'role_auteur',
         nullif(l.details->>'montant_recommande', '')::numeric,
         l.details->>'motif', l.details->>'motif_detail'
    from financial_audit_log l
    join prestations_equipe pe on pe.id = l.ligne_id
    left join profiles c on c.id = pe.collaborateur_id
    left join profiles a on a.id = l.acteur_id
   where l.table_cible = 'prestations_equipe' and pe.prestation_id = p_prestation_id
     and (l.action = 'creation' or l.montant_avant is distinct from l.montant_apres
          or l.details->>'frais_km_avant' is distinct from l.details->>'frais_km_apres')
   order by l.created_at;
end;
$$;
revoke execute on function public.historique_remuneration(uuid) from public, anon;
grant execute on function public.historique_remuneration(uuid) to authenticated;

-- ── 4. Le geste de la Production ──
create or replace function public.modifier_remuneration_mission(
  p_equipe_id uuid, p_montant numeric, p_montant_recommande numeric default null,
  p_motif text default null, p_motif_detail text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_pe prestations_equipe;
  v_ref text;
  v_nouvelle_proposition boolean := false;
begin
  select * into v_pe from prestations_equipe where id = p_equipe_id;
  if v_pe.id is null then raise exception 'Affectation introuvable.'; end if;
  if not (exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'prod'))
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
$$;
revoke execute on function public.modifier_remuneration_mission(uuid, numeric, numeric, text, text) from public, anon;
grant execute on function public.modifier_remuneration_mission(uuid, numeric, numeric, text, text) to authenticated;

-- ── 5. L'affectation reçoit le montant recommandé et le motif ──
drop function if exists public.rpc_ajouter_membre_equipe(uuid, uuid, text, text, time without time zone, numeric, smallint, numeric, numeric);
create or replace function public.rpc_ajouter_membre_equipe(
  p_prestation_id uuid, p_collaborateur_id uuid, p_fonction text default null, p_notes text default null,
  p_heure_rdv time without time zone default null, p_remuneration numeric default null,
  p_niveau_snapshot smallint default null, p_base_rate_snapshot numeric default null,
  p_multiplier_snapshot numeric default null, p_montant_recommande numeric default null,
  p_motif_ajustement text default null, p_motif_detail text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_role text; v_id uuid;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin', 'prod', 'sec') then
    raise exception 'Non autorise.' using errcode = '42501';
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
revoke execute on function public.rpc_ajouter_membre_equipe(uuid, uuid, text, text, time without time zone, numeric, smallint, numeric, numeric, numeric, text, text) from public, anon;
grant execute on function public.rpc_ajouter_membre_equipe(uuid, uuid, text, text, time without time zone, numeric, smallint, numeric, numeric, numeric, text, text) to authenticated;

-- ── 6. Visibilité ──
-- La production voit les rémunérations qu'elle fixe (le masquage de fin août est levé).
create or replace view public.prestations_equipe_display as
 SELECT id, prestation_id, collaborateur_id, est_responsable, fonction, heure_rdv,
        CASE
            WHEN collaborateur_id = auth.uid() THEN remuneration
            WHEN peut_voir_couts_mission(prestation_id) THEN remuneration
            ELSE NULL::numeric
        END AS remuneration,
    frais_km, km_estimes, statut, date_reponse, notes, created_at, notes_refus, heures_declarees,
    km_declares, frais_declares, notes_declaration, statut_paiement, date_paiement,
        CASE WHEN peut_voir_couts_mission(prestation_id) THEN montant_recommande END AS montant_recommande,
        CASE WHEN peut_voir_couts_mission(prestation_id) THEN motif_ajustement END AS motif_ajustement,
        CASE WHEN peut_voir_couts_mission(prestation_id) THEN override_reason END AS motif_detail
   FROM prestations_equipe
  WHERE (EXISTS ( SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid() AND (profiles.role = ANY (ARRAY['admin'::text, 'prod'::text, 'sec'::text, 'compta'::text, 'expert_comptable'::text, 'auditeur'::text]))))
     OR collaborateur_id = auth.uid();

-- La rentabilité : ni aux opérateurs, ni aux CM ; ouverte à la production.
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
  WHERE (p.statut <> ALL (ARRAY['annulée'::statut_prestation, 'refusée'::statut_prestation])) AND (EXISTS ( SELECT 1
           FROM profiles
          WHERE profiles.id = auth.uid() AND (profiles.role = ANY (ARRAY['admin'::text, 'compta'::text, 'prod'::text, 'sec'::text, 'expert_comptable'::text, 'auditeur'::text]))));

-- Le prix client ne se change plus par la production.
CREATE OR REPLACE FUNCTION public.protect_sensitive_prestation_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  is_privileged boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(
    -- 10/09/2026 — `prod` retiré : la Production VOIT le prix vendu (il l'aide à décider), elle ne
    -- le CHANGE pas. Le prix client est l'affaire du secrétariat et de l'administration.
    select 1 from profiles where id = auth.uid() and role in ('admin','sec','compta')
  ) into is_privileged;

  if not is_privileged then
    if new.montant_ht is distinct from old.montant_ht
       or new.montant_ttc is distinct from old.montant_ttc
       or new.tva_pct is distinct from old.tva_pct
       or new.acompte_montant is distinct from old.acompte_montant
       or new.acompte_recu is distinct from old.acompte_recu
       or new.acompte_date is distinct from old.acompte_date
       or new.statut_financier is distinct from old.statut_financier
       or new.contrat_signe is distinct from old.contrat_signe
       or new.budget_client is distinct from old.budget_client
       or new.client_id is distinct from old.client_id
    then
      raise exception 'Modification non autorisée : les champs financiers et le rattachement client sont réservés à l''administration.';
    end if;
  end if;

  return new;
end;
$function$;

-- ── 7. La rentabilité d'un club sur un mois ──
create or replace function public.rentabilite_club_mois(p_club_id uuid, p_mois date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_client uuid;
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin date := (date_trunc('month', p_mois) + interval '1 month - 1 day')::date;
  v_abonnement numeric; v_ponctuel numeric; v_presences int; v_missions int;
  v_remu numeric; v_km numeric; v_frais numeric;
begin
  if not exists (select 1 from profiles where id = auth.uid()
                  and role in ('admin', 'prod', 'compta', 'sec', 'expert_comptable', 'auditeur')) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  select portail_client_id into v_client from clubs where id = p_club_id;

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
$$;
revoke execute on function public.rentabilite_club_mois(uuid, date) from public, anon;
grant execute on function public.rentabilite_club_mois(uuid, date) to authenticated;

commit;
