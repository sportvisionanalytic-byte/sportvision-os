-- v480 (02/10/2026) — L'Admin voit le détail de ce qu'il paie.
--
-- Fouka : « dans le récap du mois je veux voir toutes les prestations qu'ils ont faites, et
-- pouvoir mettre une prime ou un ajustement en fonction de la prestation, avec une note, pour
-- qu'il voie le justificatif et qu'il s'améliore. Eux voient le détail, moi je ne le vois pas. »
--
-- MESURÉ : l'écran « Clôture du mois » n'affiche que cinq totaux par personne — nombre de
-- prestations, montant des prestations, primes, ajustements, montant dû — et AUCUN bouton.
-- L'opérateur, lui, voit ses prestations une par une dans son application. Celui qui décide du
-- montant en voyait donc moins que celui qui le reçoit.
--
-- CE QUI EXISTAIT DÉJÀ, ET QUI NE SERVAIT PAS : `mission_primer` et `mission_penaliser` posent un
-- montant, un motif et un détail SUR UNE AFFECTATION, donc sur une prestation précise. Les deux
-- tables sont vides : zéro prime, zéro ajustement depuis l'origine. Le geste était possible mais
-- seulement depuis la fiche d'une mission, jamais depuis la clôture du mois — c'est-à-dire jamais
-- au moment où on décide.
--
-- CETTE FONCTION NE DÉCIDE RIEN, ELLE MONTRE. Elle rend, pour un collaborateur et un mois, la
-- liste de ses prestations avec ce qui compose son montant : la rémunération, les frais, les
-- primes et les ajustements déjà posés, et l'état du verdict sur le travail. L'écran peut alors
-- déplier une personne et agir ligne par ligne avec les fonctions qui existent déjà.
--
-- LE CONTRÔLE D'ACCÈS EST CELUI DE `recap_a_payer` : direction et comptabilité. On ne l'ouvre pas
-- davantage, parce que cette liste nomme des montants individuels.

create or replace function public.recap_detail_collaborateur(p_collaborateur_id uuid, p_mois date)
returns table (
  affectation_id uuid, prestation_id uuid, reference text, date_prestation date,
  client text, lieu text, equipes text, fonction text,
  remuneration numeric, frais_km numeric, primes numeric, ajustements numeric, net numeric,
  travail_valide boolean, travail_motif text, statut_paiement text, statut_mission text,
  liens_deposes integer, contestation_en_attente boolean
)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_debut date; v_fin date;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'compta')) then
    raise exception 'Réservé à la direction et à la comptabilité.' using errcode = '42501';
  end if;

  select b.debut, b.fin into v_debut, v_fin from recap_bornes_du_mois(p_mois) b;

  return query
  select pe.id, pr.id, pr.reference, pr.date_prestation,
         cl.nom, pr.lieu, pr.equipes, pe.fonction,
         coalesce(pe.remuneration, 0), coalesce(pe.frais_km, 0),
         coalesce((select sum(mp.montant) from mission_primes mp
                    where mp.affectation_id = pe.id and mp.statut <> 'annulee'), 0),
         coalesce((select sum(mpe.montant) from mission_penalites mpe
                    where mpe.affectation_id = pe.id and mpe.statut <> 'annulee'), 0),
         coalesce(mission_net_a_payer(pe.id), 0),
         pe.travail_valide, pe.travail_motif, pe.statut_paiement, pr.statut::text,
         (select count(*)::int from media_liens ml where ml.prestation_id = pr.id),
         exists (select 1 from mission_penalites mpe
                  where mpe.affectation_id = pe.id and mpe.contestation is not null
                    and mpe.statut not in ('annulee', 'maintenue'))
    from prestations_equipe pe
    join prestations pr on pr.id = pe.prestation_id
    left join clients cl on cl.id = pr.client_id
   where pe.collaborateur_id = p_collaborateur_id
     and pr.date_prestation between v_debut and v_fin
     and pe.statut = 'acceptée'
   order by pr.date_prestation, pr.reference;
end;
$function$;

revoke all on function public.recap_detail_collaborateur(uuid, date) from public;
grant execute on function public.recap_detail_collaborateur(uuid, date) to authenticated;

comment on function public.recap_detail_collaborateur(uuid, date) is
  'Le détail d''un mois pour un collaborateur : ses prestations, ce qui compose son montant, et l''état du verdict sur le travail. Lecture seule, réservée à la direction et à la comptabilité.';
