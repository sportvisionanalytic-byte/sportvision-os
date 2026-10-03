-- v494 — La Production fixe son propre montant sans demander la permission (03/10/2026)
--
-- Un seul bloc de `protect_sensitive_affectation_fields` change : celui qui plafonnait la
-- rémunération que la Production se fixe à elle-même. Le reste de la fonction est repris
-- CARACTÈRE POUR CARACTÈRE depuis `pg_get_functiondef`, et non réécrit : elle protège aussi le
-- montant déjà accepté par un opérateur, le règlement réservé à la comptabilité, le seuil d'écart
-- de 15 %, le statut de réponse et le verdict sur le travail (v400). J'ai commencé par la retaper
-- de mémoire après n'en avoir lu qu'un tiers : six protections auraient disparu.
--
-- Le détail de la mesure et du raisonnement est dans le bloc lui-même, à sa place.

begin;

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

  -- ── SA PROPRE LIGNE : LE MONTANT SAISI EST LE MONTANT RETENU (v494, 03/10/2026) ────────────
  --
  -- DEMANDE DE FOUKA, mot pour mot : « Mikael ne peut pas se donner plus de 55 €, faut corriger,
  -- lui laisser liberté. »
  --
  -- CE QUE FAISAIT CE BLOC. Il remettait `new.remuneration` au montant de la grille et envoyait le
  -- montant voulu en `exception_statut = 'a_valider'`. MESURÉ par le chemin réel, transaction
  -- annulée, sous l'identité de Mikael : `set remuneration = 75` ressortait à 55, exception à 75.
  -- Trois missions acceptées attendaient ainsi depuis des jours, à 70, 65 et 60 € demandés, toutes
  -- payées 55.
  --
  -- La v148 (11/09) avait posé ce plafond. Le 25/09, Fouka a retiré l'obligation de motif mais le
  -- plafond est resté, alors que la même décision disait déjà que le Responsable Production
  -- « saisit le montant qu'il veut ». Le code appliquait la moitié de la décision.
  --
  -- CE QUI PROTÈGE ENCORE, ET POURQUOI LEVER CE PLAFOND NE LIBÈRE PERSONNE D'AUTRE :
  --   le bloc `if v_montant_change and not v_production` ci-dessus refuse déjà toute écriture de
  --   rémunération qui ne vient pas d'un Admin, d'un `prod` dans son périmètre, ou du responsable
  --   du pôle. Un opérateur photo qui tenterait de s'augmenter est arrêté là, par ce raise 42501.
  --   C'est lui qui gardait l'argent, pas celui-ci.
  --   La trace reste entière : `montant_recommande` est rempli juste au-dessus, donc l'écart avec
  --   la grille se lit à l'écran et dans le récapitulatif, et `trg_log_equipe_change` historise
  --   chaque changement avec son auteur. Fouka voit tout, après coup, sans rien bloquer.
  if (v_montant_change or tg_op = 'INSERT') and new.collaborateur_id = auth.uid() and v_role is distinct from 'admin' then
    -- Un montant laissé vide prend la valeur de la grille : sans cela, un oubli vaudrait zéro.
    if new.remuneration is null and new.montant_recommande is not null then
      new.remuneration := new.montant_recommande;
    end if;
    -- Revenir de soi-même au montant de la grille retire une demande encore en attente : sinon
    -- une exception orpheline resterait à l'écran de l'Admin pour un écart qui n'existe plus.
    if new.remuneration is not distinct from new.montant_recommande
       and tg_op = 'UPDATE' and old.exception_statut = 'a_valider' then
      new.exception_statut := null; new.exception_montant := null; new.exception_motif := null;
      new.exception_demandee_le := null;
    end if;
    -- Le motif reste facultatif (25/09) : on le normalise pour l'affichage et pour que le contrôle
    -- de l'écart de 15 %, plus bas, ne refuse pas une écriture qu'on vient d'autoriser.
    if new.remuneration is distinct from new.montant_recommande then
      new.motif_ajustement := coalesce(new.motif_ajustement, 'autre');
    end if;
  end if;

  -- ── LE VERDICT SUR LE TRAVAIL NE S'ÉCRIT PAS À LA MAIN (v400, 01/10/2026) ─────────────────
  --
  -- MESURÉ par le chemin réel, transaction annulée : Antoine Blin (rôle `photo`) pouvait faire
  --   update prestations_equipe set travail_valide = true, travail_motif = null
  --    where id = <sa propre affectation>
  -- et la valeur relue valait bien `true`. Aucune policy, aucun déclencheur ne s'y opposait :
  -- `equipe_update` laisse passer toute ligne dont `collaborateur_id = auth.uid()`, et cette
  -- fonction ne gardait que l'argent (rémunération, frais, paiement, exception) et le statut de
  -- la réponse. Les quatre colonnes du VERDICT étaient grandes ouvertes.
  --
  -- CE QUE ÇA COÛTAIT : un travail refusé par la Production (`travail_valide = false`) se remet
  -- à `true` par son propre auteur. `mission_travail_refuse_manquant` cesse alors de signaler le
  -- blocage, la mission peut se clôturer, et `recap_a_payer` — qui exclut les lignes `false` —
  -- la fait repasser au paiement. Le tout sans une ligne dans `financial_audit_log`, sans
  -- notification, et avec `travail_decide_par` resté sur l'Admin : le journal désigne quelqu'un
  -- qui n'a rien décidé.
  --
  -- LA RÈGLE EST CELLE DE LA LIVRAISON, ET C'EST VOULU. v375 a fermé le même trou sur
  -- `media_liens` : « Le verdict sur une livraison appartient à la Production. » Un verdict sur
  -- le TRAVAIL n'a pas de raison d'être moins tenu qu'un verdict sur un LIEN.
  --
  -- ON NE REFUSE PAS SELON LE RÔLE, ON EXIGE LE CHEMIN. `mission_valider_travail` porte toute la
  -- règle : qui a le droit (`peut_arbitrer_mission`), le motif obligatoire sur un refus, les XP,
  -- la notification à l'opérateur, l'alerte à l'Admin quand quelqu'un valide son propre travail,
  -- et la ligne de journal financier. Un PATCH direct contourne les six. Même l'Admin passe par
  -- la fonction — sinon son geste ne se retrouve nulle part. Mesuré : l'OS web n'écrit ces
  -- colonnes que par `rpc/mission_valider_travail` (lignes 16788, 17206, 19323), et
  -- l'application native ne les écrit pas du tout. Rien à réparer côté écrans.
  --
  -- `coalesce(current_setting(..., true), '')` : sans lui, le réglage absent rend NULL, `NULL
  -- <> 'oui'` vaut NULL, et le garde NE LÈVE JAMAIS — précisément dans le cas qu'il devait
  -- refuser. C'est le piège trouvé deux fois le 01/10 ailleurs dans cette même fonction.
  if coalesce(current_setting('sv.verdict_travail', true), '') <> 'oui'
     and (tg_op = 'INSERT' and (new.travail_valide is not null or new.travail_motif is not null
                                or new.travail_decide_par is not null or new.travail_decide_le is not null)
          or tg_op = 'UPDATE' and (new.travail_valide is distinct from old.travail_valide
                                   or new.travail_motif is distinct from old.travail_motif
                                   or new.travail_decide_par is distinct from old.travail_decide_par
                                   or new.travail_decide_le is distinct from old.travail_decide_le)) then
    raise exception 'Le verdict sur le travail d''une mission appartient à la Production, et il passe par la validation de mission : écrit à la main, il ne laisse ni trace ni notification.'
      using errcode = '42501';
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

commit;
