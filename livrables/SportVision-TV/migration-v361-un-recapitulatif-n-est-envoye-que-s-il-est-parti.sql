-- v361 — UN RÉCAPITULATIF N'EST « ENVOYÉ » QUE QUAND IL EST VRAIMENT PARTI (29/09/2026)
--
-- DÉFAUT QUE JE VIENS DE CRÉER, TROUVÉ EN ÉCRIVANT L'ENVOI DE L'E-MAIL. v360 faisait tout d'un
-- bloc : `recap_envoyer` créait le récapitulatif avec `statut = 'envoye'`, `envoye_le = now()`, et
-- passait les affectations en `transmis_compta`. L'e-mail, lui, part APRÈS, depuis une edge
-- function. Si Resend est indisponible, si l'adresse est mauvaise, si la fonction tombe : la base
-- affirme « envoyé le 29/09 à 22 h 14 » et personne n'a rien reçu.
--
-- C'est exactement le faux succès que la règle du 10/09 interdit, et c'est le pire endroit pour en
-- faire un : le collaborateur attend un virement dont il n'a jamais été prévenu, et Fouka croit
-- l'avoir prévenu. Personne ne peut s'en apercevoir avant la réclamation.
--
-- LA CHAÎNE DEVIENT DONC EN DEUX TEMPS, et chaque état veut dire ce qu'il dit :
--   `recap_envoyer`         → prépare un BROUILLON : copie les lignes, fige les totaux, ne touche
--                             à rien d'autre. Rejouable : si l'e-mail a échoué, on recommence sans
--                             créer de doublon, et sans re-figer des montants qui auraient bougé
--                             entre-temps — c'est le même brouillon qu'on renvoie.
--   `recap_marquer_envoye`  → appelée par l'edge function APRÈS que Resend a accepté le message :
--                             passe à `envoye`, date l'envoi, et fait basculer les affectations en
--                             `transmis_compta`.
--
-- Le nom `recap_envoyer` est conservé volontairement : c'est le geste de Fouka (« j'envoie »), et
-- l'écran de l'OS l'appelle déjà. Ce qui change est ce qu'il garantit, pas son nom.

-- On rejoue v360 en changeant deux choses : le statut créé, et le fait de ne plus toucher aux
-- affectations. Le reste est identique, y compris le libellé lisible et les instantanés.
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
  v_mois date; v_debut date; v_fin_exclue date;
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

  -- DÉJÀ PARTI : ON NE RECOMMENCE PAS. Deux récapitulatifs envoyés pour le même mois, c'est deux
  -- paiements annoncés à la même personne. Le message dit quoi faire, au lieu de laisser l'index
  -- unique répondre par un 23505 que personne ne sait lire.
  if exists (select 1 from recapitulatifs_remuneration r
              where r.collaborateur_id = p_collaborateur_id and r.mois = v_mois and r.statut = 'envoye') then
    raise exception 'Un récapitulatif a déjà été envoyé à cette personne pour ce mois. Annulez-le d''abord si vous voulez le refaire.'
      using errcode = '23505';
  end if;

  select p.email into v_email from profiles p where p.id = p_collaborateur_id;

  -- UN BROUILLON EXISTANT SE REPREND, IL NE SE DOUBLE PAS. C'est le cas du deuxième essai après un
  -- e-mail qui n'est pas parti : on remplace ses lignes et ses totaux, on garde son identifiant, et
  -- l'écran qui le suivait continue de le suivre.
  select r.id into v_recap from recapitulatifs_remuneration r
   where r.collaborateur_id = p_collaborateur_id and r.mois = v_mois and r.statut = 'brouillon';

  if v_recap is null then
    insert into recapitulatifs_remuneration
      (collaborateur_id, mois, montant_verse, note, destinataire_email, virement_annonce_le, statut)
    values
      (p_collaborateur_id, v_mois, p_montant_verse, nullif(btrim(coalesce(p_note, '')), ''), v_email,
       ((now() at time zone 'Europe/Paris')::date + greatest(1, coalesce(p_jours_virement, 5))), 'brouillon')
    returning id into v_recap;
  else
    update recapitulatifs_remuneration
       set montant_verse = p_montant_verse,
           note = nullif(btrim(coalesce(p_note, '')), ''),
           destinataire_email = v_email,
           virement_annonce_le = ((now() at time zone 'Europe/Paris')::date + greatest(1, coalesce(p_jours_virement, 5))),
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
                             'nb_prestations', v_nb, 'note', p_note));

  return v_recap;
end $$;

comment on function public.recap_envoyer(uuid, numeric, date, text, integer) is
  'Prépare le récapitulatif mensuel d''un freelance : copie ses lignes et fige ses totaux, en '
  'BROUILLON. Ne marque rien comme envoyé ni comme transmis — c''est recap_marquer_envoye, appelée '
  'par l''edge function une fois l''e-mail accepté, qui le fait. Rejouable sans doublon après un '
  'envoi rate. Direction seule. v361, 29/09/2026.';

-- ── L'E-MAIL EST PARTI ───────────────────────────────────────────────────────────────────────────
create or replace function public.recap_marquer_envoye(p_recapitulatif_id uuid, p_reference text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_deja text;
begin
  -- LE MOTEUR D'ENVOI OU LA DIRECTION. L'edge function tourne avec la clé de service ; Fouka peut
  -- aussi confirmer à la main si un envoi est parti par un autre chemin.
  if not (auth.role() = 'service_role'
          or exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role = 'admin')) then
    raise exception 'Non autorisé.' using errcode = '42501';
  end if;

  select statut into v_deja from recapitulatifs_remuneration where id = p_recapitulatif_id;
  if v_deja is null then
    raise exception 'Ce récapitulatif n''existe pas.' using errcode = 'P0002';
  end if;
  -- Idempotent : un e-mail accepté deux fois ne redate pas l'envoi et ne rejoue pas la bascule.
  if v_deja = 'envoye' then return false; end if;
  if v_deja <> 'brouillon' then
    raise exception 'Ce récapitulatif est %, il ne peut pas être marqué envoyé.', v_deja using errcode = '22023';
  end if;

  update recapitulatifs_remuneration
     set statut = 'envoye', envoye_le = now(), updated_at = now()
   where id = p_recapitulatif_id;

  -- LES AFFECTATIONS BASCULENT MAINTENANT, et pas à `payé` : le virement part ensuite (voir v360).
  update prestations_equipe pe
     set statut_paiement = 'transmis_compta', updated_at = now()
   where pe.id in (select affectation_id from recapitulatifs_remuneration_lignes
                    where recapitulatif_id = p_recapitulatif_id and affectation_id is not null)
     and pe.statut_paiement <> 'payé';

  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, details)
  values (auth.uid(), 'recapitulatif_envoye', 'recapitulatifs_remuneration', p_recapitulatif_id,
          jsonb_build_object('reference_envoi', p_reference));

  return true;
end $$;

comment on function public.recap_marquer_envoye(uuid, text) is
  'Confirme qu''un récapitulatif est PARTI : statut envoye, date d''envoi, affectations en '
  'transmis_compta. Appelée par l''edge function après acceptation par le fournisseur d''e-mail, '
  'jamais avant : sans cela la base affirmerait un envoi que personne n''a reçu. Idempotente. '
  'v361, 29/09/2026.';

revoke all on function public.recap_marquer_envoye(uuid, text) from public, anon;
grant execute on function public.recap_marquer_envoye(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
