-- v271 — Sa propre remuneration : plus de motif obligatoire (25/09/2026)
--
-- « Il ne faut pas lui obliger de mettre un motif d'ajustement. » (Fouka)
--
-- Le motif etait exige, et le refus etait brutal : sans une ligne de texte, l'affectation entiere
-- echouait. Sur une equipe de deux personnes ou l'Admin voit passer chaque demande, exiger une
-- justification ecrite avant meme qu'il ait regarde ajoutait une etape sans rien proteger.
--
-- CE QUI NE CHANGE PAS, ET QUI EST LE VRAI GARDE-FOU : la remuneration retenue reste celle de la
-- grille, le montant demande part en exception, et seul l'Admin tranche. Un motif absent se lit
-- « sans motif indique » a l'ecran — l'Admin sait alors qu'il devra demander.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.protect_sensitive_affectation_fields()
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
      -- LE MOTIF N'EST PLUS EXIGE (25/09/2026, decision de Fouka : « il ne faut pas lui obliger
      -- de mettre un motif d'ajustement »).
      --
      -- Il l'etait, et le refus etait brutal : sans une ligne de texte, l'affectation entiere
      -- echouait. Sur une equipe de deux personnes ou l'Admin voit passer chaque demande, exiger
      -- une justification ecrite avant meme qu'il ait regarde ajoutait une etape sans rien
      -- proteger — le montant, lui, n'a jamais bouge sans son accord.
      --
      -- CE QUI NE CHANGE PAS, ET QUI EST LE VRAI GARDE-FOU : la remuneration reste a la grille,
      -- le montant demande part en exception, et seul l'Admin tranche. Un motif absent se lit
      -- « sans motif indique » a l'ecran — l'Admin sait alors qu'il devra demander, ce qui est
      -- une information en soi.
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
