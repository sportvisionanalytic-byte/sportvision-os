-- v313 — 27/09/2026 : la Production peut récompenser, pas seulement retenir
--
-- DEMANDE DE FOUKA : « il faut permettre aux responsables de production de pouvoir donner des primes
-- à ces photographes vidéastes, de 0 jusqu'à 100 euros. Et aussi de pouvoir faire des retraits de
-- salaire de 0 jusqu'à 100. Par rapport à des prestations non validées, mais qui ont déjà été
-- données. »
--
-- CE QUI EXISTAIT DÉJÀ, et qui n'avait pas besoin d'être refait : `mission_penaliser` (v231) porte
-- déjà toute la discipline de la retenue — Production seulement, jamais sur soi-même, motif écrit
-- obligatoire, impossible après paiement, et plafonnée à la rémunération parce qu'on ne facture
-- personne pour avoir travaillé.
--
-- CE QUI MANQUAIT : la symétrie. On pouvait retenir, on ne pouvait pas récompenser. Un responsable
-- qui n'a que le bâton ne s'en sert pas, ou s'en sert mal.
--
-- LA PRIME SUIT EXACTEMENT LES MÊMES RÈGLES QUE LA RETENUE, et ce n'est pas de la symétrie
-- décorative : un geste qui engage l'argent de l'entreprise se justifie et se trace, qu'il soit
-- favorable ou non.
--   • la Production décide (peut_arbitrer_mission), comme pour la retenue ;
--   • JAMAIS sur sa propre ligne — un responsable ne se prime pas lui-même, c'est l'Admin qui
--     trancherait. Même frontière que la v231, et la même raison : être juge et partie ;
--   • un motif écrit est obligatoire. Une prime sans raison est une faveur, et une faveur ne se
--     défend pas devant les autres opérateurs ;
--   • rien après paiement : la ligne se rouvre d'abord ;
--   • plafond de 100 € par prime, comme demandé.
--
-- LE PLAFOND DE 100 € S'APPLIQUE AUSSI À LA RETENUE. Fouka l'a dit pour les deux. La règle
-- existante (« pas plus que la rémunération ») reste, et la nouvelle s'y ajoute : on retient au plus
-- 100 € ET au plus ce qui a été gagné. La plus stricte des deux gagne.
--
-- ET LE NET À PAYER LES COMPTE TOUTES LES DEUX. Sans cette ligne, la prime serait décidée, tracée,
-- notifiée — et jamais versée. C'est le genre d'oubli qui ne se voit qu'au moment de payer.
--
-- Idempotent.

create table if not exists mission_primes (
  id uuid primary key default gen_random_uuid(),
  affectation_id uuid not null references prestations_equipe(id) on delete cascade,
  montant numeric(10,2) not null check (montant > 0 and montant <= 100),
  motif text not null,
  detail text,
  statut text not null default 'active' check (statut in ('active','annulee')),
  cree_par uuid references auth.users(id) on delete set null,
  cree_le timestamptz not null default now(),
  annulee_par uuid references auth.users(id) on delete set null,
  annulee_le timestamptz,
  annulation_motif text
);

comment on table mission_primes is
  'v313 : les primes accordees par la Production sur une mission. Memes regles que mission_penalites — decidee par la Production, jamais sur sa propre ligne, motif ecrit obligatoire, rien apres paiement, plafond 100 EUR.';

create index if not exists idx_mission_primes_affectation on mission_primes(affectation_id);

alter table mission_primes enable row level security;

-- La lecture, recopiee de mission_penalites : l'operateur voit les siennes, la Production celles de
-- son perimetre. Personne d'autre.
drop policy if exists mission_primes_lecture on mission_primes;
create policy mission_primes_lecture on mission_primes for select
  using (exists (
    select 1 from prestations_equipe pe
     where pe.id = mission_primes.affectation_id
       and (pe.collaborateur_id = auth.uid() or peut_arbitrer_mission(pe.prestation_id))));

drop policy if exists mission_primes_bloque_desactive on mission_primes;
create policy mission_primes_bloque_desactive on mission_primes as restrictive for all
  using (not (select compte_os_desactive())) with check (not (select compte_os_desactive()));

create or replace function public.mission_primes_total(p_affectation_id uuid)
returns numeric language sql stable security definer set search_path to 'public' as $f$
  select coalesce(sum(montant), 0) from mission_primes
   where affectation_id = p_affectation_id and statut = 'active';
$f$;

create or replace function public.mission_primer(
  p_affectation_id uuid, p_montant numeric, p_motif text, p_detail text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_pe prestations_equipe; v_motif text; v_id uuid; v_ref text;
begin
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select * into v_pe from prestations_equipe where id = p_affectation_id;
  if v_pe.id is null then raise exception 'Affectation introuvable.' using errcode = 'P0002'; end if;
  if not peut_arbitrer_mission(v_pe.prestation_id) then
    raise exception 'Une prime se décide par la Production.' using errcode = '42501';
  end if;
  -- Même frontière que la retenue : on n'est pas juge et partie sur sa propre ligne.
  if v_pe.collaborateur_id = auth.uid() then
    raise exception 'On ne se prime pas soi-même : cette décision relève de l''Admin.' using errcode = '42501';
  end if;
  v_motif := nullif(btrim(coalesce(p_motif, '')), '');
  if v_motif is null then
    raise exception 'Une prime sans motif écrit n''est pas défendable devant les autres opérateurs : dites ce qui est récompensé.';
  end if;
  if p_montant is null or p_montant <= 0 then raise exception 'Montant de prime invalide.'; end if;
  if p_montant > 100 then raise exception 'Une prime va de 1 à 100 € : au-delà, c''est une décision de l''Admin.'; end if;
  if v_pe.statut_paiement in ('payé','transmis_compta') then
    raise exception 'Cette mission est déjà % : rouvrez le règlement avant d''ajouter une prime.', v_pe.statut_paiement
      using errcode = '42501';
  end if;

  insert into mission_primes (affectation_id, montant, motif, detail, cree_par)
  values (p_affectation_id, p_montant, v_motif, nullif(btrim(coalesce(p_detail,'')),''), auth.uid())
  returning id into v_id;

  select reference into v_ref from prestations where id = v_pe.prestation_id;

  -- L'operateur l'apprend au moment ou c'est decide, comme pour une retenue.
  insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                             source_type, source_id, lien_prestation_id, expediteur_id)
  values (v_pe.collaborateur_id, 'mission_verdict',
          'Prime de ' || trim(to_char(p_montant, '999D99')) || ' € — ' || coalesce(v_ref, 'mission'),
          'La Production t''accorde une prime sur cette mission. Motif : ' || v_motif,
          v_pe.prestation_id, 'normale', 'prestation', v_pe.prestation_id, v_pe.prestation_id, auth.uid());

  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id,
                                   montant_avant, montant_apres, details)
  values (auth.uid(), 'mission_prime', 'mission_primes', v_id,
          mission_primes_total(p_affectation_id) - p_montant, mission_primes_total(p_affectation_id),
          jsonb_build_object('motif', v_motif, 'affectation_id', p_affectation_id));

  return jsonb_build_object('id', v_id, 'montant', p_montant,
                            'total_primes', mission_primes_total(p_affectation_id),
                            'net_a_payer', mission_net_a_payer(p_affectation_id));
end $f$;

create or replace function public.mission_prime_annuler(p_prime_id uuid, p_motif text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $f$
declare v_prime mission_primes; v_pe prestations_equipe; v_motif text;
begin
  select * into v_prime from mission_primes where id = p_prime_id;
  if v_prime.id is null then raise exception 'Prime introuvable.' using errcode = 'P0002'; end if;
  select * into v_pe from prestations_equipe where id = v_prime.affectation_id;
  if not peut_arbitrer_mission(v_pe.prestation_id) then
    raise exception 'Seule la Production revient sur une prime.' using errcode = '42501';
  end if;
  v_motif := nullif(btrim(coalesce(p_motif,'')),'');
  if v_motif is null then raise exception 'Dites pourquoi la prime est retirée.'; end if;
  if v_prime.statut = 'annulee' then return jsonb_build_object('deja', true); end if;

  -- RIEN NE S'EFFACE : la prime reste, marquee annulee, avec qui et pourquoi. Meme regle que la
  -- v231 pour les penalites — l'historique d'une decision d'argent ne se reecrit pas.
  update mission_primes
     set statut = 'annulee', annulee_par = auth.uid(), annulee_le = now(), annulation_motif = v_motif
   where id = p_prime_id;

  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id,
                                   montant_avant, montant_apres, details)
  values (auth.uid(), 'mission_prime_annulee', 'mission_primes', p_prime_id,
          v_prime.montant, 0, jsonb_build_object('motif', v_motif));

  return jsonb_build_object('annulee', true, 'net_a_payer', mission_net_a_payer(v_prime.affectation_id));
end $f$;

-- ── LE NET À PAYER COMPTE LES DEUX ─────────────────────────────────────────────────────────────
-- Sans cette ligne, la prime serait decidee, tracee, notifiee — et jamais versee.
create or replace function public.mission_net_a_payer(p_affectation_id uuid)
returns numeric language sql stable security definer set search_path to 'public' as $f$
  select greatest(coalesce((select remuneration from prestations_equipe where id = p_affectation_id), 0)
                  + mission_primes_total(p_affectation_id)
                  - mission_penalites_total(p_affectation_id), 0);
$f$;

grant execute on function public.mission_primer(uuid, numeric, text, text) to authenticated;
grant execute on function public.mission_prime_annuler(uuid, text) to authenticated;
grant execute on function public.mission_primes_total(uuid) to authenticated;
grant select on mission_primes to authenticated;
