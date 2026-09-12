-- v182 : une cotisation collectée ne reste plus sans suite (12/09/2026).
--
-- Trouvé par l'audit des cotisations. La mécanique de paiement est saine : le montant ne vient
-- jamais du navigateur, le webhook est idempotent, un verrou de ligne sérialise le recalcul. Le
-- trou est dans TOUT CE QUI DEVRAIT SE PASSER APRÈS.
--
--   1. Objectif atteint : la cotisation passait bien en « objectif_atteint », et c'est tout.
--      Personne n'était prévenu chez SportVision. L'argent était encaissé, l'écran annonçait à la
--      famille « votre prestation est entièrement financée », et aucune commande n'existait nulle
--      part. Seul le DÉPASSEMENT de l'objectif déclenchait une alerte : le cas normal, non.
--   2. Date limite dépassée sous l'objectif : aucun traitement, aucune alerte, aucun
--      remboursement. Les participants avaient payé pour rien, et personne ne le savait.
--   3. Une participation déclarée en espèces était DÉFINITIVE : aucune policy de modification ni
--      de suppression sur funding_contributions. Un montant saisi de travers, ou de bonne foi mais
--      jamais remis, bloquait la cotisation pour toujours et empêchait les vrais paiements par
--      carte (le solde restant tombant à zéro).
--   4. La ligne entière d'une participation était lisible par tout membre du groupe, donc l'adresse
--      e-mail des participants invités, que l'écran prend soin de ne pas afficher.
--
-- Ce que cette migration NE fait pas, volontairement : créer une prestation ou rembourser
-- automatiquement. Ces deux gestes engagent l'argent et le planning, ils appartiennent à
-- SportVision. Ce qui manquait, c'est de le SAVOIR : on prévient, une fois, et on trace.
-- Test : tests/cotisations-suite.test.sql

alter table public.group_fundings add column if not exists staff_notifie_le timestamptz;
alter table public.group_fundings add column if not exists expiration_signalee_le timestamptz;

-- ── 1. Prévenir quand l'objectif est atteint, tout de suite ──
create or replace function public.signaler_cotisation_objectif_atteint()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.statut = 'objectif_atteint' and coalesce(old.statut, '') <> 'objectif_atteint'
     and new.staff_notifie_le is null then
    begin
      perform notify_staff_by_role(
        array['sec', 'prod'],
        'Cotisation financée : ' || coalesce(new.titre, 'sans titre'),
        'La cotisation « ' || coalesce(new.titre, 'sans titre') || ' » a atteint son objectif de '
          || new.montant_cible || ' € (' || new.montant_collecte || ' € collectés). '
          || 'Rien n''est créé automatiquement : la prestation correspondante reste à organiser avec la famille.',
        'haute', null, null, null);
      update group_fundings set staff_notifie_le = now() where id = new.id;
    exception when others then
      -- Une notification qui échoue ne doit pas empêcher d'enregistrer la participation qui vient
      -- d'être payée : le rattrapage quotidien ci-dessous s'en chargera.
      raise warning 'notification cotisation impossible : %', sqlerrm;
    end;
  end if;
  return new;
end $$;
drop trigger if exists trg_signaler_cotisation_objectif_atteint on public.group_fundings;
create trigger trg_signaler_cotisation_objectif_atteint
  after update of statut on public.group_fundings
  for each row execute function public.signaler_cotisation_objectif_atteint();

-- ── 2. Le rattrapage quotidien : objectifs atteints oubliés, et dates limites dépassées ──
create or replace function public.check_cotisations_a_traiter()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n integer := 0;
begin
  -- Objectif atteint et jamais signalé (notification ratée, ou espèces déclarées hors webhook).
  for r in
    select * from group_fundings
     where statut = 'objectif_atteint' and staff_notifie_le is null
  loop
    perform notify_staff_by_role(
      array['sec', 'prod'],
      'Cotisation financée : ' || coalesce(r.titre, 'sans titre'),
      'La cotisation « ' || coalesce(r.titre, 'sans titre') || ' » a atteint son objectif ('
        || r.montant_collecte || ' € sur ' || r.montant_cible || ' €). La prestation reste à organiser.',
      'haute', null, null, null);
    update group_fundings set staff_notifie_le = now() where id = r.id;
    n := n + 1;
  end loop;

  -- Date limite dépassée, objectif NON atteint, et de l'argent déjà collecté : quelqu'un a payé
  -- pour quelque chose qui n'aura pas lieu. C'est le cas qu'il ne faut surtout pas laisser passer
  -- en silence.
  for r in
    select * from group_fundings
     where statut = 'ouverte' and date_limite is not null and date_limite < current_date
       and coalesce(montant_collecte, 0) > 0 and expiration_signalee_le is null
  loop
    perform notify_staff_by_role(
      array['sec', 'compta'],
      'Cotisation expirée sans atteindre son objectif',
      'La cotisation « ' || coalesce(r.titre, 'sans titre') || ' » s''est terminée le '
        || to_char(r.date_limite, 'DD/MM/YYYY') || ' avec ' || r.montant_collecte || ' € collectés sur '
        || r.montant_cible || ' €. Les participants ont payé pour une prestation qui n''aura pas lieu : '
        || 'à rembourser ou à arbitrer avec eux.',
      'haute', null, null, null);
    update group_fundings set expiration_signalee_le = now() where id = r.id;
    n := n + 1;
  end loop;

  return n;
end $$;
revoke execute on function public.check_cotisations_a_traiter() from public, anon, authenticated;

select cron.schedule('sportvision-check-cotisations-a-traiter', '30 7 * * *',
                     'select check_cotisations_a_traiter();')
 where not exists (select 1 from cron.job where jobname = 'sportvision-check-cotisations-a-traiter');

-- ── 3. Annuler une participation en espèces ──
-- Réservé à l'organisateur de la cotisation et à la personne qui l'a déclarée. Les paiements par
-- carte ne sont pas concernés : un encaissement réel se rembourse, il ne s'efface pas.
create or replace function public.annuler_contribution_especes(p_contribution_id uuid, p_motif text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c funding_contributions; v_createur uuid;
begin
  select * into v_c from funding_contributions where id = p_contribution_id;
  if not found then
    raise exception 'Cette participation n''existe plus.' using errcode = '22023';
  end if;
  if v_c.mode_paiement <> 'especes' then
    raise exception 'Un paiement par carte ne s''annule pas : il se rembourse. Écrivez à SportVision.' using errcode = '42501';
  end if;
  select created_by into v_createur from group_fundings where id = v_c.funding_id;
  if auth.uid() is null or (auth.uid() <> v_createur and auth.uid() is distinct from v_c.contributor_user_id) then
    raise exception 'Seule la personne qui a déclaré cette participation, ou l''organisateur de la cotisation, peut l''annuler.'
      using errcode = '42501';
  end if;

  update funding_contributions set statut = 'echoue' where id = p_contribution_id;
  -- Le total et le statut de la cotisation sont recalculés par le trigger existant.
  return jsonb_build_object('ok', true, 'montant', v_c.montant, 'motif', nullif(btrim(coalesce(p_motif, '')), ''));
end $$;
revoke execute on function public.annuler_contribution_especes(uuid, text) from public, anon;
grant execute on function public.annuler_contribution_especes(uuid, text) to authenticated;

-- ── 4. L'adresse d'un participant invité n'est plus lisible par le groupe ──
-- get_funding_detail() (SECURITY DEFINER) continue de rendre ce qu'il faut à l'écran : le prénom,
-- le montant et la date. L'adresse e-mail ne servait à personne d'autre qu'à SportVision.
-- Un droit de lecture accordé sur la TABLE couvre toutes ses colonnes : révoquer la seule colonne
-- ne change donc rien tant que le droit de table subsiste. On retire le droit de table, puis on
-- rend explicitement toutes les colonnes SAUF guest_email. Une colonne ajoutée plus tard ne sera
-- pas lisible tant qu'on ne l'aura pas accordée : c'est le bon sens de la prudence.
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'funding_contributions'
     and column_name <> 'guest_email';
  execute 'revoke select on public.funding_contributions from authenticated, anon';
  execute format('grant select (%s) on public.funding_contributions to authenticated, anon', v_cols);
end $$;

-- L'écran de suivi des cotisations dans l'OS lisait la table en direct, adresse des invités
-- comprise. Comme le staff se connecte avec le même rôle Postgres que tout le monde, lui rendre
-- cette colonne reviendrait à la rendre à tous : il passe donc par cette fonction, qui vérifie
-- qu'il est bien du staff SportVision.
create or replace function public.funding_participants(p_funding_id uuid)
returns table (id uuid, contributor_user_id uuid, guest_prenom text, guest_email text,
               montant numeric, statut text, mode_paiement text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select fc.id, fc.contributor_user_id, fc.guest_prenom, fc.guest_email,
         fc.montant, fc.statut, fc.mode_paiement, fc.created_at
    from funding_contributions fc
   where fc.funding_id = p_funding_id and is_staff()
   order by fc.created_at desc;
$$;
revoke execute on function public.funding_participants(uuid) from public, anon;
grant execute on function public.funding_participants(uuid) to authenticated;
