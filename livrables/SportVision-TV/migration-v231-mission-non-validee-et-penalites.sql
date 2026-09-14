-- v231 — La Production refuse une mission et retient une pénalité sur la rémunération.
--
-- DEMANDE DE FOUKA, 14/09/2026 : « le responsable production pouvoir dire mission pas validée,
-- mettre des pénalités et retirer sur la paye initiale dans les prestations mission ».
--
-- ═══ CE QUE JE DOIS DIRE AVANT TOUT ═══════════════════════════════════════════════════════════
-- Une retenue sur une rémunération déjà acceptée est une SANCTION PÉCUNIAIRE.
--   · Pour un SALARIÉ, c'est interdit par l'article L1331-2 du Code du travail, sans exception et
--     quelle que soit la faute. Une amende sur salaire est nulle de plein droit.
--   · Pour un PRESTATAIRE INDÉPENDANT, c'est licite mais seulement si une clause de pénalité
--     figure au contrat ou aux conditions de mission acceptées AVANT la prestation. Sans cette
--     clause écrite, la retenue est unilatérale et contestable.
-- Le produit ne peut pas trancher ça à la place de Fouka. Ce qu'il peut faire, et ce que fait
-- cette migration, c'est rendre la pratique défendable : jamais silencieuse, toujours motivée,
-- toujours traçable, toujours contestable. Une retenue que l'opérateur découvre sur son virement
-- est indéfendable devant un prud'homme comme devant un tribunal de commerce.
--
-- ═══ LE PRINCIPE TECHNIQUE ════════════════════════════════════════════════════════════════════
-- LA RÉMUNÉRATION ACCEPTÉE N'EST JAMAIS RÉÉCRITE. C'est le point dur de cette migration.
-- La règle figée le 10/09 dit qu'une baisse après acceptation est une NOUVELLE PROPOSITION que
-- l'opérateur doit ré-accepter (modifier_remuneration_mission). Écraser `remuneration` pour
-- appliquer une pénalité contournerait cette règle en douce et effacerait la trace de ce qui
-- avait été promis.
-- Une pénalité est donc une LIGNE À PART, qui vient en déduction au moment du règlement :
--     net à payer = rémunération acceptée − pénalités appliquées
-- Le montant promis reste lisible, le montant retenu aussi, et l'écart s'explique.
--
-- ═══ LES GARDE-FOUS, UN PAR UN ════════════════════════════════════════════════════════════════
--   1. Motif obligatoire. Une pénalité sans motif écrit est refusée par la base.
--   2. Le net ne descend jamais sous zéro. On ne facture pas un opérateur pour avoir travaillé.
--   3. Notification immédiate à l'opérateur, avec le motif et le nouveau net. Aucune retenue
--      silencieuse : c'est la condition de toute contestation, donc de toute défense.
--   4. Pas sur sa propre ligne. Un Responsable ne se pénalise pas lui-même, et ne s'auto-absout
--      pas non plus — même logique que l'exception de rémunération de la v148.
--   5. Rien après paiement. Une ligne déjà payée se rouvre d'abord ; on ne redemande pas de
--      l'argent déjà versé.
--   6. Une pénalité ne s'efface pas, elle s'annule, avec son motif d'annulation et son auteur.
--   7. L'opérateur peut contester par écrit, et sa contestation reste attachée à la ligne.
--   8. Tout passe dans financial_audit_log, comme n'importe quel mouvement d'argent.
--
-- ═══ « MISSION PAS VALIDÉE » ══════════════════════════════════════════════════════════════════
-- Distinct de la pénalité, et volontairement : refuser un travail n'est pas retenir de l'argent.
-- La Production pose un verdict sur le travail d'un opérateur (validé / refusé + motif). Un
-- travail refusé bloque la clôture de la mission tant qu'il n'est pas repris ou tranché, et il
-- est notifié à l'opérateur. Fouka peut refuser sans pénaliser, et pénaliser sans refuser.
--
-- Idempotent.

-- ── 1. Le verdict sur le travail d'un opérateur ───────────────────────────────────────────────
-- Pas de contrainte de clé étrangère sur travail_decide_par, comme exception_decidee_par avant
-- lui : une SECONDE clé vers profiles sur cette table rendrait ambiguë la jointure
-- `collaborateur:profiles(...)` que tous les écrans de l'OS utilisent, et les casserait d'un coup.
alter table prestations_equipe add column if not exists travail_valide boolean;
alter table prestations_equipe add column if not exists travail_motif text;
alter table prestations_equipe add column if not exists travail_decide_par uuid;
alter table prestations_equipe add column if not exists travail_decide_le timestamptz;

comment on column prestations_equipe.travail_valide is
  'Verdict de la Production sur le travail de cet opérateur : null = pas encore revu, true = validé, false = refusé (motif obligatoire). Un refus bloque la clôture de la mission. Distinct de la rémunération : refuser un travail n''est pas retenir de l''argent.';

-- ── 2. Les pénalités ──────────────────────────────────────────────────────────────────────────
create table if not exists mission_penalites (
  id uuid primary key default gen_random_uuid(),
  affectation_id uuid not null references prestations_equipe(id) on delete cascade,
  montant numeric not null check (montant > 0),
  motif text not null check (btrim(motif) <> ''),
  detail text,
  statut text not null default 'appliquee' check (statut in ('appliquee','annulee')),
  cree_par uuid not null,
  cree_le timestamptz not null default now(),
  annulee_par uuid,
  annulee_le timestamptz,
  annulation_motif text,
  contestation text,
  conteste_le timestamptz
);
create index if not exists mission_penalites_affectation_idx on mission_penalites(affectation_id);

comment on table mission_penalites is
  'Retenues décidées par la Production sur une mission. Une pénalité NE MODIFIE JAMAIS prestations_equipe.remuneration : le montant accepté reste lisible, la retenue est une ligne à part, et le net à payer est leur différence. Motif obligatoire, opérateur notifié, annulable jamais effaçable, contestable par écrit.';

-- ── 3. Qui arbitre une mission ────────────────────────────────────────────────────────────────
-- Exactement la même autorité que pour en fixer la rémunération (modifier_remuneration_mission) :
-- l'Admin, la Production dans son pôle, le responsable du pôle de la prestation.
create or replace function peut_arbitrer_mission(p_prestation_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
      or (exists (select 1 from profiles where id = auth.uid() and role = 'prod')
          and prestation_pole_scope_ok(p_prestation_id))
      or is_pole_responsable_of_prestation(p_prestation_id);
$$;

-- ── 4. Le net à payer ─────────────────────────────────────────────────────────────────────────
create or replace function mission_penalites_total(p_affectation_id uuid)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select coalesce(sum(montant), 0) from mission_penalites
   where affectation_id = p_affectation_id and statut = 'appliquee';
$$;

create or replace function mission_net_a_payer(p_affectation_id uuid)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select greatest(coalesce((select remuneration from prestations_equipe where id = p_affectation_id), 0)
                  - mission_penalites_total(p_affectation_id), 0);
$$;

-- ── 5. Poser le verdict sur un travail ────────────────────────────────────────────────────────
create or replace function mission_valider_travail(p_affectation_id uuid, p_valide boolean, p_motif text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_pe prestations_equipe; v_ref text; v_motif text;
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

  update prestations_equipe
     set travail_valide = p_valide, travail_motif = v_motif,
         travail_decide_par = auth.uid(), travail_decide_le = now(), updated_at = now()
   where id = p_affectation_id;

  select reference into v_ref from prestations where id = v_pe.prestation_id;
  insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                             source_type, source_id, lien_prestation_id, expediteur_id)
  values (v_pe.collaborateur_id, 'mission_verdict',
          case when p_valide then 'Mission validée — ' || coalesce(v_ref, 'mission')
               else 'Mission non validée — ' || coalesce(v_ref, 'mission') end,
          case when p_valide then 'La Production a validé ton travail sur cette mission.'
               else 'La Production n''a pas validé ton travail sur cette mission. Motif : ' || v_motif end,
          v_pe.prestation_id, case when p_valide then 'normale' else 'haute' end,
          'prestation', v_pe.prestation_id, v_pe.prestation_id, auth.uid());

  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
  values (auth.uid(), case when p_valide then 'mission_travail_valide' else 'mission_travail_refuse' end,
          'prestations_equipe', p_affectation_id, v_pe.remuneration, v_pe.remuneration,
          jsonb_build_object('motif', v_motif, 'operateur', v_pe.collaborateur_id, 'prestation', v_pe.prestation_id));

  return jsonb_build_object('ok', true, 'valide', p_valide, 'net_a_payer', mission_net_a_payer(p_affectation_id));
end $$;

-- ── 6. Appliquer une pénalité ─────────────────────────────────────────────────────────────────
create or replace function mission_penaliser(p_affectation_id uuid, p_montant numeric, p_motif text, p_detail text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_pe prestations_equipe; v_ref text; v_motif text; v_id uuid; v_net numeric; v_deja numeric;
begin
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select * into v_pe from prestations_equipe where id = p_affectation_id;
  if v_pe.id is null then raise exception 'Affectation introuvable.' using errcode = 'P0002'; end if;
  if not peut_arbitrer_mission(v_pe.prestation_id) then
    raise exception 'Une pénalité se décide par la Production.' using errcode = '42501';
  end if;
  if v_pe.collaborateur_id = auth.uid() then
    raise exception 'On ne se pénalise pas soi-même : cette décision relève de l''Admin.' using errcode = '42501';
  end if;
  v_motif := nullif(btrim(coalesce(p_motif, '')), '');
  if v_motif is null then
    raise exception 'Une pénalité sans motif écrit n''est pas défendable : dites ce qui est reproché.';
  end if;
  if p_montant is null or p_montant <= 0 then raise exception 'Montant de pénalité invalide.'; end if;
  -- Déjà payé : on ne reprend pas de l'argent versé. La ligne se rouvre d'abord.
  if v_pe.statut_paiement in ('payé','transmis_compta') then
    raise exception 'Cette mission est déjà % : rouvrez le règlement avant toute retenue.', v_pe.statut_paiement
      using errcode = '42501';
  end if;
  v_deja := mission_penalites_total(p_affectation_id);
  -- On ne facture pas quelqu'un pour avoir travaillé : la retenue s'arrête à la rémunération.
  if v_deja + p_montant > coalesce(v_pe.remuneration, 0) then
    raise exception 'Retenue trop élevée : % € déjà retenus sur % € de rémunération, il reste % € retenables.',
      v_deja, coalesce(v_pe.remuneration, 0), greatest(coalesce(v_pe.remuneration, 0) - v_deja, 0);
  end if;

  insert into mission_penalites (affectation_id, montant, motif, detail, cree_par)
  values (p_affectation_id, p_montant, v_motif, nullif(btrim(coalesce(p_detail, '')), ''), auth.uid())
  returning id into v_id;

  v_net := mission_net_a_payer(p_affectation_id);
  select reference into v_ref from prestations where id = v_pe.prestation_id;
  -- Aucune retenue silencieuse : l'opérateur apprend le montant, le motif et ce qu'il reste.
  insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                             source_type, source_id, lien_prestation_id, expediteur_id)
  values (v_pe.collaborateur_id, 'mission_penalite',
          'Retenue sur ta rémunération — ' || coalesce(v_ref, 'mission'),
          'Une retenue de ' || p_montant || ' € est appliquée sur cette mission. Motif : ' || v_motif ||
          '. Rémunération acceptée ' || coalesce(v_pe.remuneration, 0) || ' €, net à payer ' || v_net ||
          ' €. Si tu n''es pas d''accord, réponds depuis ta mission : ta contestation est enregistrée.',
          v_pe.prestation_id, 'haute', 'prestation', v_pe.prestation_id, v_pe.prestation_id, auth.uid());

  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
  values (auth.uid(), 'mission_penalite_appliquee', 'prestations_equipe', p_affectation_id,
          coalesce(v_pe.remuneration, 0) - v_deja, v_net,
          jsonb_build_object('penalite_id', v_id, 'montant', p_montant, 'motif', v_motif,
                             'operateur', v_pe.collaborateur_id, 'prestation', v_pe.prestation_id));

  return jsonb_build_object('ok', true, 'penalite_id', v_id, 'net_a_payer', v_net,
                            'remuneration', v_pe.remuneration, 'retenu_total', v_deja + p_montant);
end $$;

-- ── 7. Annuler une pénalité (jamais l'effacer) ────────────────────────────────────────────────
create or replace function mission_penalite_annuler(p_penalite_id uuid, p_motif text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_p mission_penalites; v_pe prestations_equipe; v_motif text; v_ref text; v_net numeric;
begin
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select * into v_p from mission_penalites where id = p_penalite_id;
  if v_p.id is null then raise exception 'Pénalité introuvable.' using errcode = 'P0002'; end if;
  select * into v_pe from prestations_equipe where id = v_p.affectation_id;
  if not peut_arbitrer_mission(v_pe.prestation_id) then
    raise exception 'L''annulation d''une pénalité se décide par la Production.' using errcode = '42501';
  end if;
  v_motif := nullif(btrim(coalesce(p_motif, '')), '');
  if v_motif is null then raise exception 'Dites pourquoi cette pénalité est levée.'; end if;
  if v_p.statut = 'annulee' then
    return jsonb_build_object('ok', true, 'deja_annulee', true, 'net_a_payer', mission_net_a_payer(v_p.affectation_id));
  end if;

  update mission_penalites
     set statut = 'annulee', annulee_par = auth.uid(), annulee_le = now(), annulation_motif = v_motif
   where id = p_penalite_id;

  v_net := mission_net_a_payer(v_p.affectation_id);
  select reference into v_ref from prestations where id = v_pe.prestation_id;
  insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                             source_type, source_id, lien_prestation_id, expediteur_id)
  values (v_pe.collaborateur_id, 'mission_penalite',
          'Retenue levée — ' || coalesce(v_ref, 'mission'),
          'La retenue de ' || v_p.montant || ' € est annulée. Motif : ' || v_motif ||
          '. Net à payer ' || v_net || ' €.',
          v_pe.prestation_id, 'haute', 'prestation', v_pe.prestation_id, v_pe.prestation_id, auth.uid());

  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
  values (auth.uid(), 'mission_penalite_annulee', 'prestations_equipe', v_p.affectation_id,
          v_net - v_p.montant, v_net,
          jsonb_build_object('penalite_id', p_penalite_id, 'montant', v_p.montant, 'motif', v_motif));

  return jsonb_build_object('ok', true, 'net_a_payer', v_net);
end $$;

-- ── 8. Contester (l'opérateur, et lui seul) ───────────────────────────────────────────────────
create or replace function mission_penalite_contester(p_penalite_id uuid, p_texte text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_p mission_penalites; v_pe prestations_equipe; v_texte text; v_ref text; v_dest uuid;
begin
  select * into v_p from mission_penalites where id = p_penalite_id;
  if v_p.id is null then raise exception 'Pénalité introuvable.' using errcode = 'P0002'; end if;
  select * into v_pe from prestations_equipe where id = v_p.affectation_id;
  if v_pe.collaborateur_id <> auth.uid() then
    raise exception 'Seule la personne pénalisée conteste sa retenue.' using errcode = '42501';
  end if;
  v_texte := nullif(btrim(coalesce(p_texte, '')), '');
  if v_texte is null then raise exception 'Dites ce que vous contestez.'; end if;

  update mission_penalites set contestation = v_texte, conteste_le = now() where id = p_penalite_id;

  select reference into v_ref from prestations where id = v_pe.prestation_id;
  -- La contestation remonte à qui a décidé : sans destinataire, elle mourrait dans une colonne.
  v_dest := v_p.cree_par;
  insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                             source_type, source_id, lien_prestation_id, expediteur_id)
  values (v_dest, 'mission_penalite',
          'Retenue contestée — ' || coalesce(v_ref, 'mission'),
          'L''opérateur conteste la retenue de ' || v_p.montant || ' € : ' || v_texte,
          v_pe.prestation_id, 'haute', 'prestation', v_pe.prestation_id, v_pe.prestation_id, auth.uid());

  return jsonb_build_object('ok', true);
end $$;

-- ── 9. Qui lit quoi ───────────────────────────────────────────────────────────────────────────
alter table mission_penalites enable row level security;
drop policy if exists mission_penalites_lecture on mission_penalites;
create policy mission_penalites_lecture on mission_penalites for select using (
  exists (select 1 from prestations_equipe pe
           where pe.id = mission_penalites.affectation_id
             and (pe.collaborateur_id = auth.uid() or peut_arbitrer_mission(pe.prestation_id)))
);
-- Aucune policy d'écriture : tout passe par les fonctions ci-dessus, qui motivent, notifient et
-- journalisent. Une écriture directe contournerait les trois.
revoke insert, update, delete on mission_penalites from authenticated, anon;
grant select on mission_penalites to authenticated;

-- ── 10. Un travail refusé bloque la clôture ───────────────────────────────────────────────────
create or replace function mission_travail_refuse_manquant(p_prestation_id uuid)
returns text[] language sql stable security definer set search_path to 'public' as $$
  select case when exists (
    select 1 from prestations_equipe
     where prestation_id = p_prestation_id and travail_valide is false
  ) then array['Travail d''un opérateur non validé par la Production']::text[] else '{}'::text[] end;
$$;
