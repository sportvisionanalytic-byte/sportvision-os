-- v214 — Supprimer définitivement un collaborateur ou un client, sans perdre une pièce comptable
-- (13/09/2026, demande de Fouka).
--
-- CE QUI MANQUAIT. L'OS sait désactiver un collaborateur, pas le supprimer. Après trois mois de
-- tests, la liste des collaborateurs porte des comptes qui n'ont jamais existé ailleurs que dans
-- un essai, et rien ne permet de les faire disparaître autrement qu'en SQL. Même chose côté
-- clients.
--
-- POURQUOI CE N'EST PAS UN SIMPLE `delete`. 124 colonnes pointent vers `profiles`, 30 vers
-- `clients`, et elles ne se comportent PAS toutes pareil :
--   • RESTRICT : la base refuse la suppression. C'est la protection qui fonctionne.
--   • CASCADE : la ligne liée disparaît AUSSI. `employee_costs`, `contrats`, `monthly_reports`,
--     `retractation_demandes` sont en cascade : supprimer un compte effacerait des pièces que
--     l'entreprise doit conserver.
--   • SET NULL : pire encore. `factures.client_id` et `paiements.client_id` passent à NULL : la
--     facture reste, sans client. Une facture orpheline est un problème comptable, pas un détail.
--
-- Le Code de commerce (L123-22) impose dix ans de conservation des pièces comptables. Une
-- suppression qui les emporte ou les orpheline n'est donc pas une option, quel que soit le bouton.
--
-- CE QUE FAIT CETTE MIGRATION. Deux fonctions, réservées à l'administrateur de l'OS :
--   • `compte_blocages_suppression(...)` dit, EN FRANÇAIS, ce qui empêche la suppression. Elle
--     s'appelle avant de proposer le bouton : on ne propose pas une action qui échouera.
--   • `supprimer_compte_definitivement(...)` supprime, après avoir rejoué ce contrôle elle-même.
--     Le contrôle n'est jamais délégué à l'écran.
--
-- Ce qui reste interdit dans tous les cas : se supprimer soi-même, supprimer le dernier
-- administrateur actif, supprimer un compte porteur d'une trace comptable ou contractuelle.
-- Pour ceux-là, la désactivation reste la bonne réponse, et elle coupe déjà tous les accès.
--
-- Idempotente.

-- ── Ce qui compte comme trace à conserver ────────────────────────────────────
-- Listes explicites plutôt que déduites des contraintes : une table en CASCADE ou en SET NULL ne
-- lève aucune erreur, elle détruit ou orpheline en silence. C'est précisément celles-là qu'il faut
-- nommer à la main.
create or replace function public.compte_blocages_suppression(p_user_id uuid)
returns table(objet text, nb bigint)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r record;
  n bigint;
  -- table, colonne, libellé lisible
  v_traces text[][] := array[
    ['prestations_equipe','collaborateur_id','missions sur lesquelles il a été affecté'],
    ['prestations','responsable_prestation_id','prestations dont il est le responsable'],
    ['prestations','responsable_prod_id','prestations dont il est le responsable de production'],
    ['prestations','created_by','prestations qu''il a créées'],
    ['employee_costs','collaborateur_id','lignes de coût employeur'],
    ['pole_remuneration_calculs','responsable_id','calculs de rémunération'],
    ['frais','collaborateur_id','notes de frais'],
    ['commissions','commercial_id','commissions commerciales'],
    ['factures','created_by','factures qu''il a émises'],
    ['devis','created_by','devis qu''il a établis'],
    ['avoirs','created_by','avoirs qu''il a émis'],
    ['contrats','created_by','contrats qu''il a rédigés'],
    ['collaborateur_documents','collaborateur_id','documents RH (contrat de travail, pièces)'],
    ['recruitment_applications','collaborateur_id','dossier de recrutement'],
    ['kit_reservations','collaborateur_id','réservations de matériel'],
    ['incidents','declare_par','incidents qu''il a déclarés'],
    ['expenses','created_by','dépenses saisies'],
    ['fec_exports','genere_par','exports comptables FEC'],
    ['accounting_periods','cloturee_par','clôtures comptables']
  ];
  i int;
begin
  if not exists (select 1 from profiles where id = auth.uid() and actif and role = 'admin') then
    raise exception 'Réservé à l''administrateur SportVision.';
  end if;

  for i in 1 .. array_length(v_traces, 1) loop
    execute format('select count(*) from public.%I where %I = $1', v_traces[i][1], v_traces[i][2])
      into n using p_user_id;
    if n > 0 then
      objet := v_traces[i][3];
      nb := n;
      return next;
    end if;
  end loop;

  -- Filet : toute autre contrainte qui refuserait la suppression, même non listée ci-dessus. Sans
  -- lui, une table ajoutée demain ferait échouer la suppression avec un message de Postgres en
  -- anglais au lieu d'une phrase utile.
  for r in
    select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
       and c.confdeltype in ('a', 'r')
       and array_length(c.conkey, 1) = 1
  loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into n using p_user_id;
    -- Ne pas répéter ce qui porte déjà un libellé lisible plus haut.
    if n > 0 and not exists (
      select 1 from generate_subscripts(v_traces, 1) k
       where v_traces[k][1] = replace(r.tbl, 'public.', '')
         and v_traces[k][2] = r.col
    ) then
      objet := replace(r.tbl, 'public.', '') || ' (' || r.col || ')';
      nb := n;
      return next;
    end if;
  end loop;
end $$;

comment on function public.compte_blocages_suppression(uuid) is
  'v214 — Ce qui empêche de supprimer ce compte, en français. Vide = suppression possible.';

-- ── La suppression elle-même ─────────────────────────────────────────────────
create or replace function public.supprimer_compte_definitivement(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_profil record;
  v_blocages text;
  v_nb_admins int;
begin
  if not exists (select 1 from profiles where id = auth.uid() and actif and role = 'admin') then
    raise exception 'Réservé à l''administrateur SportVision.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Vous ne pouvez pas supprimer votre propre compte.';
  end if;

  select id, prenom, nom, email, role, actif into v_profil from profiles where id = p_user_id;
  if v_profil.id is null then
    raise exception 'Ce compte n''existe pas ou a déjà été supprimé.';
  end if;

  -- Le dernier administrateur actif ne se supprime pas : plus personne ne pourrait rouvrir l'OS.
  if v_profil.role = 'admin' then
    select count(*) into v_nb_admins from profiles where role = 'admin' and actif and id <> p_user_id;
    if v_nb_admins = 0 then
      raise exception 'C''est le dernier administrateur actif : le supprimer fermerait l''OS à tout le monde.';
    end if;
  end if;

  select string_agg(objet || ' (' || nb || ')', ', ') into v_blocages
    from compte_blocages_suppression(p_user_id);
  if v_blocages is not null then
    raise exception 'Suppression impossible : ce compte porte des traces à conserver — %. Désactivez-le, son accès est déjà coupé.', v_blocages;
  end if;

  -- Trace de l'acte lui-même, avant que le compte ne disparaisse.
  insert into audit_logs (acteur_id, action, cible_type, cible_id, details)
  values (auth.uid(), 'compte.supprime', 'profiles', p_user_id,
          jsonb_build_object('email', v_profil.email, 'role', v_profil.role,
                             'nom', coalesce(v_profil.prenom,'') || ' ' || coalesce(v_profil.nom,'')));

  -- `profiles` est en CASCADE depuis `auth.users` : supprimer le compte d'authentification
  -- emporte le profil et tout ce qui en dépend réellement (formations, XP, disponibilités...).
  delete from auth.users where id = p_user_id;

  return jsonb_build_object('supprime', true, 'email', v_profil.email);
end $$;

comment on function public.supprimer_compte_definitivement(uuid) is
  'v214 — Supprime un compte collaborateur, après avoir vérifié qu''il ne porte aucune trace à conserver. Administrateur uniquement.';

revoke all on function public.compte_blocages_suppression(uuid) from public;
revoke all on function public.supprimer_compte_definitivement(uuid) from public;
grant execute on function public.compte_blocages_suppression(uuid) to authenticated;
grant execute on function public.supprimer_compte_definitivement(uuid) to authenticated;
