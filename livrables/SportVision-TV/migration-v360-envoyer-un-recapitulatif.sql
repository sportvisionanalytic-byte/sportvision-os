-- v360 — ENVOYER UN RÉCAPITULATIF, ET NE PAS MENTIR SUR CE QUI EST PAYÉ (29/09/2026)
--
-- UNE DÉCISION DE CONCEPTION QUE JE SIGNALE, parce qu'elle s'écarte de ce que Fouka a décrit mot
-- pour mot. Il a dit : « j'envoie la paye ». Le réflexe serait de marquer les lignes `payé` à
-- l'envoi. Mais à cet instant, elles ne le sont pas : le virement part après, et Fouka annonce
-- lui-même « d'ici 3 à 5 jours ». Écrire `payé` maintenant, c'est afficher un succès qui n'a pas eu
-- lieu — la règle du 10/09, « aucune action n'affiche succès si la ligne n'a pas changé », vaut
-- surtout quand il s'agit d'argent dû à quelqu'un.
--
-- L'envoi marque donc `transmis_compta` : le récapitulatif est parti, le paiement est engagé, et
-- rien n'est encore réglé. `recap_virement_effectue` passe à `payé` quand l'argent est vraiment
-- parti. Deux gestes au lieu d'un, mais le second répond à une question à laquelle personne ne
-- pouvait répondre avant : « est-ce que je l'ai payé, ou est-ce que je le lui ai seulement dit ? »

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
  -- L'ADMIN SEUL DÉCIDE CE QU'IL PAIE. La comptabilité lit (recap_a_payer), elle n'envoie pas.
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role = 'admin') then
    raise exception 'Seule la direction envoie un récapitulatif.' using errcode = '42501';
  end if;
  if p_montant_verse is null or p_montant_verse < 0 then
    raise exception 'Le montant versé doit être renseigné, et positif ou nul.' using errcode = '22023';
  end if;

  v_mois := date_trunc('month', coalesce(p_mois, public.recap_mois_courant()))::date;
  v_debut := v_mois;
  v_fin_exclue := (v_mois + interval '1 month')::date;

  -- ON N'ENVOIE PAS DEUX FOIS. Deux récapitulatifs pour le même mois, c'est deux paiements annoncés
  -- à la même personne. Le message dit quoi faire plutôt que de laisser l'index parler en 23505.
  if exists (select 1 from recapitulatifs_remuneration r
              where r.collaborateur_id = p_collaborateur_id and r.mois = v_mois and r.statut = 'envoye') then
    raise exception 'Un récapitulatif a déjà été envoyé à cette personne pour ce mois. Annulez-le d''abord si vous voulez le refaire.'
      using errcode = '23505';
  end if;

  select p.email into v_email from profiles p where p.id = p_collaborateur_id;

  insert into recapitulatifs_remuneration
    (collaborateur_id, mois, montant_verse, note, destinataire_email,
     virement_annonce_le, envoye_le, envoye_par, statut)
  values
    (p_collaborateur_id, v_mois, p_montant_verse, nullif(btrim(coalesce(p_note, '')), ''), v_email,
     ((now() at time zone 'Europe/Paris')::date + greatest(1, coalesce(p_jours_virement, 5))),
     now(), auth.uid(), 'envoye')
  returning id into v_recap;

  -- ── LES LIGNES, COPIÉES. Voir v358 : un document parti ne change plus. ──
  with concernees as (
    select pe.id, pe.remuneration, pe.fonction,
           coalesce(pe.frais_declares, 0) + coalesce(pe.frais_km, 0) as frais,
           pr.date_prestation,
           -- UN LIBELLE QUE QUELQU'UN PEUT LIRE. La premiere version copiait `type_prestation`
           -- tel quel : la ligne du document disait « match », point. Sur une piece envoyee a une
           -- vraie personne qui doit reconnaitre SA journee, ca ne suffit pas. On y ajoute le lieu,
           -- qui est renseigne (« STADE PHILIPPE MAHUT 2 - FONTAINEBLEAU ») et qui est ce dont on
           -- se souvient. On ne retouche pas la casse ici : « OPB » ou « FC » ne survivraient pas a
           -- un initcap, et abimer un nom propre est pire qu'une majuscule de trop.
           initcap(coalesce(nullif(btrim(pr.type_prestation), ''), 'Prestation'))
             || coalesce(' — ' || nullif(btrim(pr.lieu), ''), '') as libelle
      from prestations_equipe pe
      join prestations pr on pr.id = pe.prestation_id
     where pe.collaborateur_id = p_collaborateur_id
       and pr.date_prestation >= v_debut and pr.date_prestation < v_fin_exclue
       and pe.statut = 'acceptée'
       and coalesce(pe.travail_valide, true)
       and pe.statut_paiement <> 'payé'
  )
  insert into recapitulatifs_remuneration_lignes
    (recapitulatif_id, affectation_id, date_prestation, libelle, fonction, montant, nature)
  select v_recap, c.id, c.date_prestation, c.libelle, c.fonction, c.remuneration, 'prestation'
    from concernees c;

  insert into recapitulatifs_remuneration_lignes
    (recapitulatif_id, affectation_id, date_prestation, libelle, montant, nature, motif)
  select v_recap, pe.id, pr.date_prestation, 'Frais et kilomètres',
         coalesce(pe.frais_declares, 0) + coalesce(pe.frais_km, 0), 'frais', null
    from prestations_equipe pe
    join prestations pr on pr.id = pe.prestation_id
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

  -- LES AJUSTEMENTS ENTRENT EN NÉGATIF (voir v358) : le total se lit par une addition.
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

  -- ── LES TOTAUX, LUS SUR LES LIGNES COPIÉES et non recalculés ailleurs : deux calculs qui se
  --    ressemblent finissent toujours par diverger, et c'est le document qui fait foi.
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

  -- ── LES LIGNES PASSENT À « TRANSMIS », PAS À « PAYÉ ». Voir l'en-tête. ──
  update prestations_equipe pe
     set statut_paiement = 'transmis_compta', updated_at = now()
   where pe.id in (select affectation_id from recapitulatifs_remuneration_lignes
                    where recapitulatif_id = v_recap and affectation_id is not null)
     and pe.statut_paiement <> 'payé';

  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
  values (auth.uid(), 'recapitulatif_envoye', 'recapitulatifs_remuneration', v_recap,
          v_remu + v_primes + v_penalites + v_frais, p_montant_verse,
          jsonb_build_object('mois', v_mois, 'collaborateur_id', p_collaborateur_id,
                             'nb_prestations', v_nb, 'note', p_note));

  return v_recap;
end $$;

comment on function public.recap_envoyer(uuid, numeric, date, text, integer) is
  'Envoie le récapitulatif mensuel d''un freelance : copie ses lignes, fige les totaux, passe les '
  'affectations en `transmis_compta` (PAS `payé` : le virement part après) et journalise. Direction '
  'seule. Un seul envoi par personne et par mois. v360, 29/09/2026.';

revoke all on function public.recap_envoyer(uuid, numeric, date, text, integer) from public, anon, authenticated;
grant execute on function public.recap_envoyer(uuid, numeric, date, text, integer) to authenticated;

-- ── LE VIREMENT EST PARTI ────────────────────────────────────────────────────────────────────────
create or replace function public.recap_virement_effectue(p_recapitulatif_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role in ('admin','compta')) then
    raise exception 'Réservé à la direction et à la comptabilité.' using errcode = '42501';
  end if;

  update prestations_equipe pe
     set statut_paiement = 'payé',
         date_paiement = coalesce(pe.date_paiement, (now() at time zone 'Europe/Paris')::date),
         updated_at = now()
   where pe.id in (select affectation_id from recapitulatifs_remuneration_lignes
                    where recapitulatif_id = p_recapitulatif_id and affectation_id is not null)
     and pe.statut_paiement <> 'payé';
  get diagnostics v_n = row_count;

  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, details)
  values (auth.uid(), 'virement_effectue', 'recapitulatifs_remuneration', p_recapitulatif_id,
          jsonb_build_object('lignes_reglees', v_n));

  return v_n;
end $$;

comment on function public.recap_virement_effectue(uuid) is
  'Le virement est parti : les affectations du récapitulatif passent à `payé`, avec leur date. '
  'Geste séparé de l''envoi, pour que `payé` veuille dire payé. v360, 29/09/2026.';

revoke all on function public.recap_virement_effectue(uuid) from public, anon;
grant execute on function public.recap_virement_effectue(uuid) to authenticated;

notify pgrst, 'reload schema';
