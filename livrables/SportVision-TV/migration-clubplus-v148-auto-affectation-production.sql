-- v148 : le Responsable Production ne fixe pas sa propre rémunération (11/09/2026).
--
-- Décision de Fouka : le Responsable Production peut s'affecter lui-même comme photographe ou
-- vidéaste, mais sa rémunération terrain vient de la grille opérateur ; tout écart passe en
-- validation Admin, et il ne valide jamais sa propre exception. Pour les autres opérateurs, le
-- modèle actuel reste : Production, seuil de 15 %, motif.
--
-- Audit préalable :
--   • la grille (45/50/55/65/80 € selon le niveau, × 1 / 1,25 / 1,6 selon le format) n'existait
--     que dans le code de l'OS, et le montant recommandé arrivait du navigateur : falsifiable ;
--   • protect_sensitive_affectation_fields tient déjà les règles (seuil, baisse après acceptation,
--     règlement par la compta) : on l'étend, on n'ajoute pas un second garde-fou ;
--   • financial_audit_log tient déjà l'historique : les décisions d'exception y sont écrites.
-- Test : tests/finance-production-auto-affectation.test.sql

-- ── 1. La grille, en base ──
create table if not exists public.remuneration_grille_niveaux (
  niveau smallint primary key check (niveau between 1 and 5),
  taux numeric not null check (taux >= 0),
  updated_at timestamptz not null default now()
);
create table if not exists public.remuneration_grille_formats (
  format text primary key,
  coefficient numeric not null check (coefficient > 0),
  updated_at timestamptz not null default now()
);
insert into public.remuneration_grille_niveaux (niveau, taux) values (1, 45), (2, 50), (3, 55), (4, 65), (5, 80)
on conflict (niveau) do nothing;
insert into public.remuneration_grille_formats (format, coefficient) values ('standard', 1), ('double', 1.25), ('journee', 1.6)
on conflict (format) do nothing;
alter table public.remuneration_grille_niveaux enable row level security;
alter table public.remuneration_grille_formats enable row level security;
drop policy if exists grille_niveaux_lecture on public.remuneration_grille_niveaux;
create policy grille_niveaux_lecture on public.remuneration_grille_niveaux for select to authenticated using (true);
drop policy if exists grille_formats_lecture on public.remuneration_grille_formats;
create policy grille_formats_lecture on public.remuneration_grille_formats for select to authenticated using (true);
drop policy if exists grille_niveaux_admin on public.remuneration_grille_niveaux;
create policy grille_niveaux_admin on public.remuneration_grille_niveaux for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
drop policy if exists grille_formats_admin on public.remuneration_grille_formats;
create policy grille_formats_admin on public.remuneration_grille_formats for all to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
revoke all on public.remuneration_grille_niveaux, public.remuneration_grille_formats from anon;

-- ── 2. Le montant recommandé, calculé par la base ──
create or replace function public.remuneration_recommandee(p_collaborateur_id uuid, p_prestation_id uuid)
returns numeric
language sql stable security definer
set search_path = public, pg_temp
as $$
  select round(g.taux * f.coefficient, 2)
    from profiles p
    join remuneration_grille_niveaux g on g.niveau = p.niveau_operateur
    join prestations pr on pr.id = p_prestation_id
    join remuneration_grille_formats f on f.format = coalesce(pr.format_mission, 'standard')
   where p.id = p_collaborateur_id;
$$;
revoke execute on function public.remuneration_recommandee(uuid, uuid) from public, anon;
grant execute on function public.remuneration_recommandee(uuid, uuid) to authenticated;

-- ── 3. L'exception de rémunération, sur la ligne d'affectation ──
alter table public.prestations_equipe add column if not exists exception_montant numeric;
alter table public.prestations_equipe add column if not exists exception_motif text;
alter table public.prestations_equipe add column if not exists exception_statut text;
alter table public.prestations_equipe add column if not exists exception_demandee_le timestamptz;
-- Sans clé étrangère : une seconde référence vers profiles rendrait ambiguë toute jointure
-- « profiles(...) » sur prestations_equipe (PostgREST, PGRST201). Constaté en production le
-- 11/09/2026, corrigé dans la minute ; l'auteur reste tracé ici et dans financial_audit_log.
alter table public.prestations_equipe add column if not exists exception_decidee_par uuid;
alter table public.prestations_equipe drop constraint if exists prestations_equipe_exception_decidee_par_fkey;
alter table public.prestations_equipe add column if not exists exception_decidee_le timestamptz;
alter table public.prestations_equipe drop constraint if exists prestations_equipe_exception_statut_check;
alter table public.prestations_equipe add constraint prestations_equipe_exception_statut_check
  check (exception_statut is null or exception_statut in ('a_valider', 'approuvee', 'refusee'));

-- ── 4. La garde, étendue ──
create or replace function public.protect_sensitive_affectation_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_role text;
  v_production boolean;
  v_paiement boolean;
  v_montant_change boolean;
  v_reco numeric;
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

  -- v148 (11/09/2026) : le montant recommandé est calculé ICI, depuis la grille en base, et plus
  -- reçu du navigateur. Avant, un Responsable Production qui s'affectait lui-même pouvait déclarer
  -- « recommandé 150 € » et se payer 150 € sans aucun contrôle. Pour les autres opérateurs rien ne
  -- change : même grille, même seuil de 15 %, simplement impossible à contourner. Opérateur sans
  -- niveau ou format « exceptionnelle » : pas de recommandé, comme avant.
  -- Décider d'une exception n'appartient qu'à l'Admin (decider_exception_remuneration) : une
  -- écriture directe de « approuvée » ou « refusée » est refusée, pas seulement neutralisée.
  if tg_op = 'UPDATE' and new.exception_statut is distinct from old.exception_statut
     and new.exception_statut in ('approuvee', 'refusee')
     and coalesce(current_setting('sv.decision_exception', true), '') <> 'oui' then
    raise exception 'Une exception de rémunération se décide par l''Admin.' using errcode = '42501';
  end if;

  -- À la création, le recommandé est posé même sans montant : une auto-affectation reçoit la grille.
  if v_montant_change or tg_op = 'INSERT' then
    v_reco := remuneration_recommandee(new.collaborateur_id, new.prestation_id);
    if v_reco is not null then
      new.montant_recommande := v_reco;
    elsif new.collaborateur_id = auth.uid() then
      new.montant_recommande := null;
    end if;
  end if;

  -- Auto-affectation (hors Direction) : la rémunération terrain est celle de la grille. Tout autre
  -- montant est une EXCEPTION : motif obligatoire, montant mis en attente de validation Admin, et la
  -- rémunération effective reste le recommandé jusqu'à la décision. Juge et partie, jamais.
  -- Une exception ne se crée pas par une écriture directe : seuls ce bloc et la décision Admin la posent.
  if tg_op = 'INSERT' and coalesce(current_setting('sv.decision_exception', true), '') <> 'oui' then
    new.exception_montant := null; new.exception_motif := null; new.exception_statut := null;
    new.exception_demandee_le := null; new.exception_decidee_par := null; new.exception_decidee_le := null;
  end if;

  if (v_montant_change or tg_op = 'INSERT') and new.collaborateur_id = auth.uid() and v_role is distinct from 'admin' then
    if new.remuneration is null and new.montant_recommande is not null then
      new.remuneration := new.montant_recommande;
    end if;
    -- Revenir au montant de la grille retire une demande encore en attente.
    if new.remuneration is not distinct from new.montant_recommande
       and tg_op = 'UPDATE' and old.exception_statut = 'a_valider' then
      new.exception_statut := null; new.exception_montant := null; new.exception_motif := null;
      new.exception_demandee_le := null;
    end if;
    if new.remuneration is distinct from new.montant_recommande then
      if coalesce(nullif(btrim(coalesce(new.override_reason, '')), ''), new.motif_ajustement) is null then
        raise exception 'Votre propre rémunération : % € recommandés par la grille. Un autre montant demande un motif et part en validation Admin.',
          coalesce(new.montant_recommande::text, 'aucun montant') using errcode = '22023';
      end if;
      new.exception_montant := new.remuneration;
      new.exception_motif := coalesce(nullif(btrim(coalesce(new.override_reason, '')), ''), new.motif_ajustement);
      new.exception_statut := 'a_valider';
      new.exception_demandee_le := now();
      new.exception_decidee_par := null;
      new.exception_decidee_le := null;
      new.remuneration := case when tg_op = 'UPDATE' and old.exception_statut = 'approuvee' then old.remuneration
                               else new.montant_recommande end;
      -- Le seuil de 15 % ne s'applique pas à une demande d'exception : c'est l'Admin qui tranche.
      new.motif_ajustement := coalesce(new.motif_ajustement, 'autre');
    end if;
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

    -- Le circuit du paiement (décision de Fouka, 10/09/2026) : la Production valide la
    -- rémunération puis la transmet à la comptabilité ; la comptabilité ou le secrétariat la
    -- règlent. La Production ne marque jamais « payé », et ne revient pas sur un paiement réglé.
    -- v148 : sa propre rémunération, on ne la valide ni ne la transmet ni ne la règle soi-même.
    if (new.statut_paiement is distinct from old.statut_paiement or new.date_paiement is distinct from old.date_paiement)
       and old.collaborateur_id = auth.uid() and v_role not in ('admin', 'compta', 'sec') then
      raise exception 'Votre propre rémunération est validée par l''Admin ou la comptabilité, et réglée par la comptabilité ou le secrétariat.'
        using errcode = '42501';
    end if;
    -- Une exception se décide par decider_exception_remuneration (Admin), pas en écrivant la ligne.
    if (new.exception_statut is distinct from old.exception_statut or new.exception_montant is distinct from old.exception_montant)
       and not (new.collaborateur_id = auth.uid()
                and (new.exception_statut = 'a_valider' or (old.exception_statut = 'a_valider' and new.exception_statut is null)))
       and coalesce(current_setting('sv.decision_exception', true), '') <> 'oui' then
      raise exception 'Une exception de rémunération se décide par l''Admin.' using errcode = '42501';
    end if;

    if (new.statut_paiement is distinct from old.statut_paiement or new.date_paiement is distinct from old.date_paiement)
       and not v_paiement then
      if not (v_production
              and coalesce(old.statut_paiement, 'en_attente') <> 'payé'
              and coalesce(new.statut_paiement, 'en_attente') in ('en_attente', 'validé', 'transmis_compta')
              and new.date_paiement is not distinct from old.date_paiement) then
        raise exception 'Le règlement d''une rémunération relève de la comptabilité ou du secrétariat.' using errcode = '42501';
      end if;
    end if;

    -- La comptabilité règle : elle ne touche à rien d'autre sur l'affectation.
    if v_role = 'compta'
       and (to_jsonb(new) - 'statut_paiement' - 'date_paiement' - 'updated_at')
           is distinct from (to_jsonb(old) - 'statut_paiement' - 'date_paiement' - 'updated_at') then
      raise exception 'La comptabilité enregistre le règlement ; le reste de l''affectation relève de la Production.' using errcode = '42501';
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


-- ── 5. La décision d'exception : Admin seulement, jamais sur sa propre ligne ──
create or replace function public.decider_exception_remuneration(p_equipe_id uuid, p_approuver boolean, p_commentaire text default null)
returns public.prestations_equipe
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_ligne prestations_equipe; v_avant numeric;
begin
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Seule la Direction (Admin) décide d''une exception de rémunération.' using errcode = '42501';
  end if;
  select * into v_ligne from prestations_equipe where id = p_equipe_id for update;
  if v_ligne.id is null or v_ligne.exception_statut is distinct from 'a_valider' then
    raise exception 'Aucune exception en attente sur cette affectation.' using errcode = 'P0002';
  end if;
  if v_ligne.collaborateur_id = auth.uid() then
    raise exception 'Vous ne pouvez pas décider de votre propre exception.' using errcode = '42501';
  end if;
  v_avant := v_ligne.remuneration;
  perform set_config('sv.decision_exception', 'oui', true);
  update prestations_equipe set
    remuneration = case when p_approuver then exception_montant else remuneration end,
    exception_statut = case when p_approuver then 'approuvee' else 'refusee' end,
    exception_decidee_par = auth.uid(),
    exception_decidee_le = now()
  where id = p_equipe_id
  returning * into v_ligne;
  perform set_config('sv.decision_exception', '', true);
  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
  values (auth.uid(), case when p_approuver then 'exception_approuvee' else 'exception_refusee' end,
          'prestations_equipe', p_equipe_id, v_avant, v_ligne.remuneration,
          jsonb_build_object('prestation_id', v_ligne.prestation_id, 'collaborateur_id', v_ligne.collaborateur_id,
                             'montant_demande', v_ligne.exception_montant, 'montant_recommande', v_ligne.montant_recommande,
                             'motif', v_ligne.exception_motif, 'commentaire', nullif(btrim(coalesce(p_commentaire, '')), ''),
                             'regle', 'grille opérateur × format'));
  return v_ligne;
end $$;
revoke execute on function public.decider_exception_remuneration(uuid, boolean, text) from public, anon;
grant execute on function public.decider_exception_remuneration(uuid, boolean, text) to authenticated;

-- ── 6. modifier_remuneration_mission : pas de faux « augmentée » sur sa propre ligne ──
create or replace function public.modifier_remuneration_mission(p_equipe_id uuid, p_montant numeric, p_montant_recommande numeric DEFAULT NULL::numeric, p_motif text DEFAULT NULL::text, p_motif_detail text DEFAULT NULL::text)
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
  -- Compte OS désactivé : refus, même avec un jeton encore valide (voir en-tête de la migration).
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
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
  -- v148 : sur sa propre ligne, un montant hors grille part en validation Admin. On le dit, et on
  -- ne s'envoie pas à soi-même « Rémunération augmentée » pour un montant qui n'est pas acquis.
  if v_pe.collaborateur_id = auth.uid() then
    select * into v_pe from prestations_equipe where id = p_equipe_id;
    return jsonb_build_object('ok', true, 'nouvelle_proposition', false,
                              'exception', v_pe.exception_statut = 'a_valider',
                              'montant_retenu', v_pe.remuneration, 'montant_demande', v_pe.exception_montant);
  end if;
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

-- ── 7. La vue d'équipe expose l'état d'une exception (colonnes ajoutées en fin, rien de retiré) ──
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
        END AS motif_detail,
    exception_montant,
    exception_motif,
    exception_statut,
    exception_demandee_le,
    exception_decidee_le
   FROM prestations_equipe
  WHERE peut_voir_couts_mission(prestation_id) OR collaborateur_id = auth.uid() AND statut <> 'a_envoyer'::statut_affectation;
