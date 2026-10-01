-- migration-v400-le-verdict-sur-le-travail-n-est-pas-ecrit-a-la-main.sql
-- 01/10/2026 — audit du parcours de l'opérateur terrain, de la proposition à la rémunération.
--
-- LE TROU, MESURÉ PAR LE CHEMIN RÉEL : un opérateur pouvait écrire lui-même le verdict de la
-- Production sur son propre travail (`travail_valide`, `travail_motif`, `travail_decide_par`,
-- `travail_decide_le`) par un simple PATCH sur sa ligne de `prestations_equipe`.
--
-- TEST ROUGE (avant) / VERT (après), en transaction annulée, jeton d'Antoine Blin :
--   update prestations_equipe set travail_valide = true where id = 'baabc44c-…';
--   avant : passe, valeur relue `true`.
--   après : 42501 « Le verdict sur le travail d'une mission appartient à la Production… »
-- Et dans les deux cas, `rpc/mission_valider_travail` continue de fonctionner pour l'Admin et
-- pour un Responsable Production sur sa propre mission (décision de Fouka du 25/09, inchangée).

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

CREATE OR REPLACE FUNCTION public.mission_valider_travail(p_affectation_id uuid, p_valide boolean, p_motif text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_pe prestations_equipe;
  v_ref text;
  v_motif text;
  v_role text;
  v_xp integer := 0;
  v_nouvelle boolean;
  v_soi_meme boolean;
  v_admin uuid;
begin
  if public.compte_os_desactive() then
    raise exception 'Compte désactivé.' using errcode = '42501';
  end if;
  select * into v_pe from prestations_equipe where id = p_affectation_id;
  if v_pe.id is null then raise exception 'Affectation introuvable.' using errcode = 'P0002'; end if;
  if not peut_arbitrer_mission(v_pe.prestation_id) then
    raise exception 'Le travail d''une mission se valide par la Production.' using errcode = '42501';
  end if;
  -- ── VALIDER SON PROPRE TRAVAIL : PERMIS, MAIS JAMAIS DISCRET (25/09/2026) ──────────────────
  --
  -- DÉCISION DE FOUKA : « Il faut que lui puisse valider la prestation, même si l'Admin n'a pas
  -- encore validé. Après, c'est moi qui validerai, parce que là il n'y a que le salaire qui va
  -- bloquer. Pour le moment je veux qu'il puisse valider tout seul ses prestations. »
  --
  -- LE REFUS D'AVANT AVAIT SA RAISON, et elle est dite ici pour qu'on sache ce qu'on a échangé :
  -- personne ne relit plus les missions que le Responsable Production fait lui-même. C'est un
  -- contrôle en moins, assumé, sur une équipe de deux personnes où l'attendre bloquerait tout.
  --
  -- CE QUI REND LA CHOSE TENABLE : l'argent ne suit pas. Un montant différent de la grille reste
  -- une demande d'exception que seul l'Admin tranche (v148) — il peut valider son travail, il ne
  -- peut toujours pas se payer plus. C'est exactement la frontière que Fouka décrit.
  --
  -- ON NE SE CONTENTE PAS DE LAISSER PASSER. Une validation de soi-même est tracée sous une
  -- action distincte dans le journal financier, et l'Admin en est notifié : il n'a pas à aller
  -- chercher ce qui s'est décidé sans lui.
  v_soi_meme := (v_pe.collaborateur_id = auth.uid());
  v_motif := nullif(btrim(coalesce(p_motif, '')), '');
  -- Refuser sans dire pourquoi ne laisse à l'opérateur aucun moyen de corriger ni de contester.
  if p_valide is false and v_motif is null then
    raise exception 'Dites ce qui ne va pas : un refus sans motif n''est ni corrigeable ni contestable.';
  end if;

  -- La décision change-t-elle quelque chose ? Un second clic sur « Valider » ne doit pas
  -- renotifier l'opérateur : mesuré en transaction annulée, deux appels donnaient deux
  -- notifications « Mission validée » pour une seule décision. Les XP, eux, étaient déjà
  -- protégés par l'index unique — la notification ne l'était pas.
  v_nouvelle := v_pe.travail_valide is distinct from p_valide
                or coalesce(v_pe.travail_motif, '') is distinct from coalesce(v_motif, '');

  -- v400 : le déclencheur `protect_sensitive_affectation_fields` refuse désormais toute écriture
  -- des colonnes `travail_*` qui ne vient pas d'ici. Le réglage est posé le temps de l'écriture
  -- puis retiré, exactement comme `sv.decision_exception` pour les exceptions de rémunération :
  -- il ne doit pas rester ouvert pour la suite de la transaction appelante.
  perform set_config('sv.verdict_travail', 'oui', true);
  update prestations_equipe
     set travail_valide = p_valide, travail_motif = v_motif,
         travail_decide_par = auth.uid(), travail_decide_le = now(), updated_at = now()
   where id = p_affectation_id;
  perform set_config('sv.verdict_travail', '', true);

  -- ── Les XP, à la validation et nulle part ailleurs ──────────────────────────────────────────
  if p_valide then
    select role into v_role from profiles where id = v_pe.collaborateur_id;
    if v_role = 'photo' then
      v_xp := 100 + case when v_pe.est_responsable then 50 else 0 end;
      -- `on conflict do nothing` sur l'index unique : c'est LUI qui garantit qu'on ne crédite
      -- qu'une fois, pas un test préalable qui pourrait courir avec un autre appel.
      --
      -- LE PREDICAT EST OBLIGATOIRE. idx_xp_events_source_type_unique est un index PARTIEL
      -- (« where source_type is not null and source_id is not null »). Sans répéter ce prédicat
      -- ici, PostgreSQL ne reconnaît pas l'index et refuse : « there is no unique or exclusion
      -- constraint matching the ON CONFLICT specification ». Trouvé en éprouvant la fonction en
      -- transaction annulée, avant toute mise en service.
      insert into xp_events (collaborateur_id, montant, type, source_id, source_type,
                             description, attribue_par)
      values (v_pe.collaborateur_id, v_xp, 'prestation', p_affectation_id, 'prestations_equipe',
              'Mission validée par la Production', auth.uid())
      on conflict (source_type, source_id, type)
        where source_type is not null and source_id is not null
        do nothing;

      -- profiles.xp n'est incrémenté que si la ligne a VRAIMENT été insérée : sans ce test, une
      -- seconde validation gonflerait le compteur sans laisser de trace dans l'historique, et les
      -- deux ne diraient plus la même chose.
      if found then
        update profiles set xp = coalesce(xp, 0) + v_xp where id = v_pe.collaborateur_id;
      else
        v_xp := 0;
      end if;
    end if;
  end if;

  select reference into v_ref from prestations where id = v_pe.prestation_id;
  if v_nouvelle then
  insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                             source_type, source_id, lien_prestation_id, expediteur_id)
  values (v_pe.collaborateur_id, 'mission_verdict',
          case when p_valide then 'Mission validée — ' || coalesce(v_ref, 'mission')
               else 'Mission non validée — ' || coalesce(v_ref, 'mission') end,
          case when p_valide then
                 'La Production a validé ton travail sur cette mission. Tu n''as plus rien à faire.'
                 || case when v_xp > 0 then ' +' || v_xp || ' XP.' else '' end
               else 'La Production n''a pas validé ton travail sur cette mission. Motif : ' || v_motif end,
          v_pe.prestation_id, case when p_valide then 'normale' else 'haute' end,
          'prestation', v_pe.prestation_id, v_pe.prestation_id, auth.uid());
  end if;

  -- Le journal financier, lui, trace CHAQUE décision, même répétée : c'est son rôle de dire qui a
  -- cliqué quoi et quand, y compris deux fois.
  -- L'Admin apprend qu'une validation s'est faite sans lui, au moment ou elle se fait.
  if v_soi_meme and p_valide then
    for v_admin in select id from profiles where role = 'admin' and coalesce(actif, true) loop
      insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                                 source_type, source_id, lien_prestation_id, expediteur_id)
      values (v_admin, 'mission_verdict',
              'Travail validé par son propre auteur — ' || coalesce(v_ref, 'mission'),
              (select coalesce(prenom || ' ' || nom, 'Un responsable') from profiles where id = v_pe.collaborateur_id)
                || ' a validé son propre travail sur cette mission. La rémunération, elle, reste '
                || 'à la grille tant que vous n''avez pas tranché une éventuelle exception.',
              v_pe.prestation_id, 'normale', 'prestation', v_pe.prestation_id, v_pe.prestation_id, auth.uid());
    end loop;
  end if;

  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
  values (auth.uid(), case when not p_valide then 'mission_travail_refuse'
                          when v_soi_meme then 'mission_travail_valide_soi_meme'
                          else 'mission_travail_valide' end,
          'prestations_equipe', p_affectation_id, v_pe.remuneration, v_pe.remuneration,
          jsonb_build_object('motif', v_motif, 'operateur', v_pe.collaborateur_id,
                             'prestation', v_pe.prestation_id, 'xp', v_xp));

  return jsonb_build_object('ok', true, 'valide', p_valide, 'xp', v_xp,
                            'net_a_payer', mission_net_a_payer(p_affectation_id));
end $function$;
