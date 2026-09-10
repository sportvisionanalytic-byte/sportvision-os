-- Le paiement d'une rémunération mission : qui fait quoi, et que ça fasse vraiment quelque chose.
--
-- Trouvé le 10/09/2026 en faisant passer une mission fictive par tout le circuit
-- (tests/circuit-mission-bout-en-bout.test.sql) : les étapes du paiement « réussissaient » sans
-- rien modifier.
--   • La Production ne lisait plus les affectations que par la vue `prestations_equipe_display`
--     (depuis le masquage des montants, fin août). Une modification exige de voir la ligne : ses
--     boutons « Valider » et « Transmettre à la compta » touchaient 0 ligne, sans erreur.
--   • La comptabilité n'avait aucun droit d'écriture sur les affectations : « Marquer payé »
--     touchait 0 ligne, sans erreur, et l'écran affichait « ✓ Payé ».
--   • La v127 réservait en plus tout changement du statut de paiement à admin/sec/compta : même
--     avec ses droits, la Production aurait été refusée.
--
-- Le circuit voulu par Fouka : la Production valide et transmet ; la comptabilité ou le
-- secrétariat règlent. Ici :
--   • la Production lit les affectations de SON pôle (elle voit les rémunérations depuis la v127,
--     décision permanente du 10/09 ; même périmètre que ses missions) ;
--   • la comptabilité peut enregistrer un règlement, et rien d'autre ;
--   • la garde de colonnes laisse la Production passer en « validé » / « transmis à la compta »,
--     jamais en « payé », et jamais revenir sur un paiement réglé.

begin;

drop policy if exists equipe_select on public.prestations_equipe;
create policy equipe_select on public.prestations_equipe for select using (
  ((exists (select 1 from profiles where profiles.id = auth.uid()
             and profiles.role = any (array['admin', 'sec', 'rh', 'prod'])))
   and prestation_pole_scope_ok(prestation_id))
  or collaborateur_id = auth.uid()
);

drop policy if exists equipe_compta_reglement on public.prestations_equipe;
create policy equipe_compta_reglement on public.prestations_equipe for update
  using (exists (select 1 from profiles where id = auth.uid() and role = 'compta'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'compta'));

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
