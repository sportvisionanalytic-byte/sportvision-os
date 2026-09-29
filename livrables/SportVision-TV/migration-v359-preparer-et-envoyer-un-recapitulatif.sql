-- v359 — PRÉPARER, PUIS ENVOYER UN RÉCAPITULATIF (29/09/2026)
--
-- Deux fonctions, et la séparation est le coeur du sujet.
--
--   `recap_a_payer(mois)`        — CE QU'IL Y A À PAYER. Lecture seule, recalculée à chaque appel :
--                                  c'est l'écran de travail de l'Admin, il doit refléter l'état
--                                  courant. Aucun instantané ici.
--   `recap_envoyer(...)`         — L'ENVOI. Copie tout dans le récapitulatif, marque les lignes
--                                  payées, et ne peut plus être défait qu'en annulant.
--
-- POURQUOI LA PÉRIODE SE COMPTE À PARIS. `date_trunc('month', now())` en UTC ferait basculer le mois
-- entre minuit et 2 h du matin heure française : une mission du 1er octobre à 0 h 30 tomberait dans
-- septembre, et le collaborateur serait payé avec un mois de retard sans que personne comprenne
-- pourquoi. Leçon du 14/09, et elle se rejoue partout où il y a une date.

create or replace function public.recap_bornes_du_mois(p_mois date)
returns table (debut date, fin date)
language sql
immutable
as $$
  -- Le premier et le DERNIER jour du mois, inclus — « du premier au dernier jour du mois », mot
  -- pour mot. On rend la fin incluse parce que c'est ce qu'un humain lit sur le document ; les
  -- comparaisons internes utilisent `< debut + 1 mois`, jamais `<= fin`.
  select date_trunc('month', p_mois)::date,
         (date_trunc('month', p_mois) + interval '1 month - 1 day')::date;
$$;

comment on function public.recap_bornes_du_mois(date) is
  'Premier et dernier jour du mois, inclus. Toujours passer une date déjà calculée à Paris : voir '
  'recap_mois_courant(). v359, 29/09/2026.';

create or replace function public.recap_mois_courant()
returns date
language sql
stable
as $$
  -- À PARIS, ET C'EST TOUT L'INTÉRÊT DE CETTE FONCTION. Le serveur est en UTC : le 1er octobre à
  -- 1 h du matin heure de Paris, il est encore le 30 septembre pour lui. Un « mois courant » calculé
  -- en UTC serait faux deux heures par nuit, et ces deux heures tombent précisément au moment où
  -- l'on clôture un mois.
  select date_trunc('month', (now() at time zone 'Europe/Paris'))::date;
$$;

-- ── CE QU'IL Y A À PAYER ────────────────────────────────────────────────────────────────────────
create or replace function public.recap_a_payer(p_mois date default null)
returns table (
  collaborateur_id uuid,
  collaborateur text,
  email text,
  fonction_principale text,
  nb_prestations integer,
  montant_prestations numeric,
  montant_primes numeric,
  montant_ajustements numeric,
  montant_frais numeric,
  montant_du numeric,
  deja_envoye boolean,
  recapitulatif_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_mois date; v_debut date; v_fin_exclue date;
begin
  -- L'ADMIN ET LA COMPTABILITÉ SEULEMENT. Ce que gagne chaque collaborateur est la donnée la plus
  -- personnelle de l'OS : ni la Production, ni un responsable de pôle n'ont à voir la paie globale
  -- (décision du 10/09, v129 — « jamais paie globale hors mission »).
  if not exists (select 1 from profiles p
                  where p.id = auth.uid() and p.actif and p.role in ('admin','compta')) then
    raise exception 'Réservé à la direction et à la comptabilité.' using errcode = '42501';
  end if;

  v_mois := date_trunc('month', coalesce(p_mois, public.recap_mois_courant()))::date;
  v_debut := v_mois;
  v_fin_exclue := (v_mois + interval '1 month')::date;

  return query
  with lignes as (
    select pe.id, pe.collaborateur_id, pe.remuneration, pe.fonction,
           coalesce(pe.frais_declares, 0) + coalesce(pe.frais_km, 0) as frais
      from prestations_equipe pe
      join prestations pr on pr.id = pe.prestation_id
     where pr.date_prestation >= v_debut and pr.date_prestation < v_fin_exclue
       -- CE QU'ON PAIE : une affectation ACCEPTÉE par le collaborateur, dont le travail a été
       -- validé, et qui n'est pas déjà réglée. Une affectation refusée ou en attente de réponse
       -- n'est pas un travail fait.
       and pe.statut = 'acceptée'
       and coalesce(pe.travail_valide, true)
       and pe.statut_paiement <> 'payé'
  ), primes as (
    select l.collaborateur_id, coalesce(sum(mp.montant), 0) as total
      from lignes l join mission_primes mp on mp.affectation_id = l.id
     where coalesce(mp.statut, 'active') <> 'annulee'
     group by 1
  ), penalites as (
    select l.collaborateur_id, coalesce(sum(mpe.montant), 0) as total
      from lignes l join mission_penalites mpe on mpe.affectation_id = l.id
     where coalesce(mpe.statut, 'active') not in ('annulee', 'contestee')
     group by 1
  ), par_personne as (
    select l.collaborateur_id,
           count(*)::integer as nb,
           coalesce(sum(l.remuneration), 0) as remu,
           coalesce(sum(l.frais), 0) as frais,
           (array_agg(l.fonction order by l.fonction))[1] as fonction
      from lignes l group by 1
  )
  select pp.collaborateur_id,
         coalesce(nullif(btrim(coalesce(p.prenom,'') || ' ' || coalesce(p.nom,'')), ''), 'Collaborateur'),
         p.email,
         pp.fonction,
         pp.nb,
         pp.remu,
         coalesce(pr.total, 0),
         -- LES AJUSTEMENTS SONT NÉGATIFS, et c'est voulu : le total se lit alors par une simple
         -- addition, sans se demander dans quel sens compter une retenue.
         -coalesce(pe.total, 0),
         pp.frais,
         pp.remu + coalesce(pr.total, 0) - coalesce(pe.total, 0) + pp.frais,
         (r.id is not null),
         r.id
    from par_personne pp
    join profiles p on p.id = pp.collaborateur_id
    left join primes pr on pr.collaborateur_id = pp.collaborateur_id
    left join penalites pe on pe.collaborateur_id = pp.collaborateur_id
    left join recapitulatifs_remuneration r
      on r.collaborateur_id = pp.collaborateur_id and r.mois = v_mois and r.statut = 'envoye'
   order by 2;
end $$;

comment on function public.recap_a_payer(date) is
  'Ce qu''il y a à payer pour un mois, par collaborateur. Lecture seule et recalculée à chaque '
  'appel : c''est l''écran de travail de l''Admin. Réservé à admin et compta — la paie globale ne '
  'sort pas de là (v129). Les ajustements sont rendus NÉGATIFS. v359, 29/09/2026.';

revoke all on function public.recap_a_payer(date) from public, anon;
grant execute on function public.recap_a_payer(date) to authenticated, service_role;

notify pgrst, 'reload schema';
