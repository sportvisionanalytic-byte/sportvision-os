-- v362 — UN VIREMENT NE PART PAS UN DIMANCHE (29/09/2026)
--
-- TROUVÉ EN LISANT LE DOCUMENT, pas en lisant le code. Le premier récapitulatif rendu avec de vraies
-- données annonçait : « Le montant vous sera viré au plus tard le dimanche 4 octobre. » Les banques
-- ne traitent pas les virements le week-end. On annonçait donc une date qui ne pouvait pas arriver,
-- à quelqu'un qui attend son argent.
--
-- C'est le genre de défaut qu'aucune relecture de code ne donne : `date + 5 jours` est correct, la
-- phrase est correcte, et l'ensemble promet l'impossible une fois sur trois. Il fallait regarder le
-- document.
--
-- LA CORRECTION reporte au jour ouvré suivant. On ne connaît pas les jours fériés français ici, et
-- on ne va pas les inventer : le samedi et le dimanche couvrent l'essentiel, et le mot « au plus
-- tard » laisse la marge qu'un férié demanderait. Promettre moins précisément vaut mieux que
-- promettre faux.

create or replace function public.recap_jour_ouvre(p_date date)
returns date
language sql
immutable
as $$
  -- 6 = samedi, 0 = dimanche pour `extract(dow)`. On avance, on ne recule jamais : reculer
  -- avancerait la promesse, et une promesse tenue en avance n'est pas un problème, l'inverse si.
  select case extract(dow from p_date)
           when 6 then p_date + 2   -- samedi  → lundi
           when 0 then p_date + 1   -- dimanche → lundi
           else p_date
         end;
$$;

comment on function public.recap_jour_ouvre(date) is
  'Reporte une date au jour ouvré suivant (week-end seulement, pas les fériés). Sert à ne pas '
  'annoncer un virement un dimanche : les banques ne traitent pas, et on promettait l''impossible '
  'une fois sur trois. Trouvé en LISANT le document, pas le code. v362, 29/09/2026.';

-- Et on l'applique là où la date est posée. Même corps que v361, une seule expression change.
create or replace function public.recap_envoyer(
  p_collaborateur_id uuid,
  p_montant_verse numeric,
  p_mois date default null,
  p_note text default null,
  p_jours_virement integer default 5
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mois date; v_debut date; v_fin_exclue date; v_annonce date;
  v_recap uuid; v_email text; v_nb integer := 0;
  v_remu numeric := 0; v_primes numeric := 0; v_penalites numeric := 0; v_frais numeric := 0;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role = 'admin') then
    raise exception 'Seule la direction envoie un récapitulatif.' using errcode = '42501';
  end if;
  if p_montant_verse is null or p_montant_verse < 0 then
    raise exception 'Le montant versé doit être renseigné, et positif ou nul.' using errcode = '22023';
  end if;

  v_mois := date_trunc('month', coalesce(p_mois, public.recap_mois_courant()))::date;
  v_debut := v_mois;
  v_fin_exclue := (v_mois + interval '1 month')::date;
  -- LA DATE ANNONCÉE, REPORTÉE AU JOUR OUVRÉ. Voir l'en-tête : on annonçait des dimanches.
  v_annonce := public.recap_jour_ouvre(
    (now() at time zone 'Europe/Paris')::date + greatest(1, coalesce(p_jours_virement, 5)));

  if exists (select 1 from recapitulatifs_remuneration r
              where r.collaborateur_id = p_collaborateur_id and r.mois = v_mois and r.statut = 'envoye') then
    raise exception 'Un récapitulatif a déjà été envoyé à cette personne pour ce mois. Annulez-le d''abord si vous voulez le refaire.'
      using errcode = '23505';
  end if;

  select p.email into v_email from profiles p where p.id = p_collaborateur_id;

  select r.id into v_recap from recapitulatifs_remuneration r
   where r.collaborateur_id = p_collaborateur_id and r.mois = v_mois and r.statut = 'brouillon';

  if v_recap is null then
    insert into recapitulatifs_remuneration
      (collaborateur_id, mois, montant_verse, note, destinataire_email, virement_annonce_le, statut)
    values
      (p_collaborateur_id, v_mois, p_montant_verse, nullif(btrim(coalesce(p_note, '')), ''), v_email,
       v_annonce, 'brouillon')
    returning id into v_recap;
  else
    update recapitulatifs_remuneration
       set montant_verse = p_montant_verse,
           note = nullif(btrim(coalesce(p_note, '')), ''),
           destinataire_email = v_email,
           virement_annonce_le = v_annonce,
           updated_at = now()
     where id = v_recap;
    delete from recapitulatifs_remuneration_lignes where recapitulatif_id = v_recap;
  end if;

  with concernees as (
    select pe.id, pe.remuneration, pe.fonction, pr.date_prestation,
           initcap(coalesce(nullif(btrim(pr.type_prestation), ''), 'Prestation'))
             || coalesce(' — ' || nullif(btrim(pr.lieu), ''), '') as libelle
      from prestations_equipe pe
      join prestations pr on pr.id = pe.prestation_id
     where pe.collaborateur_id = p_collaborateur_id
       and pr.date_prestation >= v_debut and pr.date_prestation < v_fin_exclue
       and pe.statut = 'acceptée' and coalesce(pe.travail_valide, true) and pe.statut_paiement <> 'payé'
  )
  insert into recapitulatifs_remuneration_lignes
    (recapitulatif_id, affectation_id, date_prestation, libelle, fonction, montant, nature)
  select v_recap, c.id, c.date_prestation, c.libelle, c.fonction, c.remuneration, 'prestation' from concernees c;

  insert into recapitulatifs_remuneration_lignes
    (recapitulatif_id, affectation_id, date_prestation, libelle, montant, nature)
  select v_recap, pe.id, pr.date_prestation, 'Frais et kilomètres',
         coalesce(pe.frais_declares, 0) + coalesce(pe.frais_km, 0), 'frais'
    from prestations_equipe pe join prestations pr on pr.id = pe.prestation_id
   where pe.collaborateur_id = p_collaborateur_id
     and pr.date_prestation >= v_debut and pr.date_prestation < v_fin_exclue
     and pe.statut = 'acceptée' and coalesce(pe.travail_valide, true) and pe.statut_paiement <> 'payé'
     and coalesce(pe.frais_declares, 0) + coalesce(pe.frais_km, 0) > 0;

  insert into recapitulatifs_remuneration_lignes
    (recapitulatif_id, affectation_id, date_prestation, libelle, montant, nature, motif)
  select v_recap, mp.affectation_id, pr.date_prestation,
         coalesce(nullif(btrim(mp.motif), ''), 'Prime'), mp.montant, 'prime', mp.detail
    from mission_primes mp
    join prestations_equipe pe on pe.id = mp.affectation_id
    join prestations pr on pr.id = pe.prestation_id
   where pe.collaborateur_id = p_collaborateur_id
     and pr.date_prestation >= v_debut and pr.date_prestation < v_fin_exclue
     and pe.statut = 'acceptée' and pe.statut_paiement <> 'payé'
     and coalesce(mp.statut, 'active') <> 'annulee';

  insert into recapitulatifs_remuneration_lignes
    (recapitulatif_id, affectation_id, date_prestation, libelle, montant, nature, motif)
  select v_recap, mpe.affectation_id, pr.date_prestation,
         coalesce(nullif(btrim(mpe.motif), ''), 'Ajustement'), -abs(mpe.montant), 'ajustement', mpe.detail
    from mission_penalites mpe
    join prestations_equipe pe on pe.id = mpe.affectation_id
    join prestations pr on pr.id = pe.prestation_id
   where pe.collaborateur_id = p_collaborateur_id
     and pr.date_prestation >= v_debut and pr.date_prestation < v_fin_exclue
     and pe.statut = 'acceptée' and pe.statut_paiement <> 'payé'
     and coalesce(mpe.statut, 'active') not in ('annulee', 'contestee');

  select count(*) filter (where nature = 'prestation'),
         coalesce(sum(montant) filter (where nature = 'prestation'), 0),
         coalesce(sum(montant) filter (where nature = 'prime'), 0),
         coalesce(sum(montant) filter (where nature = 'ajustement'), 0),
         coalesce(sum(montant) filter (where nature = 'frais'), 0)
    into v_nb, v_remu, v_primes, v_penalites, v_frais
    from recapitulatifs_remuneration_lignes where recapitulatif_id = v_recap;

  update recapitulatifs_remuneration
     set nb_prestations = v_nb, montant_prestations = v_remu, montant_primes = v_primes,
         montant_ajustements = v_penalites, montant_frais = v_frais,
         montant_du = v_remu + v_primes + v_penalites + v_frais, updated_at = now()
   where id = v_recap;

  if v_nb = 0 then
    raise exception 'Aucune prestation à payer pour cette personne sur ce mois.' using errcode = '22023';
  end if;

  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
  values (auth.uid(), 'recapitulatif_prepare', 'recapitulatifs_remuneration', v_recap,
          v_remu + v_primes + v_penalites + v_frais, p_montant_verse,
          jsonb_build_object('mois', v_mois, 'collaborateur_id', p_collaborateur_id,
                             'nb_prestations', v_nb, 'note', p_note, 'virement_annonce_le', v_annonce));

  return v_recap;
end $$;

notify pgrst, 'reload schema';
