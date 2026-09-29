-- v364 — UNE RETENUE CONTESTÉE EST SUSPENDUE JUSQU'À CE QU'ON TRANCHE (29/09/2026)
--
-- DÉFAUT TROUVÉ PAR LE TEST DU RÉCAPITULATIF, ET IL ÉTAIT DANS MON CODE. v359 et v361 écartent les
-- ajustements contestés par `coalesce(mpe.statut,'active') not in ('annulee','contestee')`. Sauf
-- que le statut « contestee » N'EXISTE PAS : la contrainte de v231 n'admet que 'appliquee' et
-- 'annulee', et `mission_penalite_contester` écrit `contestation` et `conteste_le` mais jamais le
-- statut. Vérifié en base, les deux.
--
-- Mon filtre ne pouvait donc rien exclure. Une retenue contestée PAR ÉCRIT partait quand même sur
-- le récapitulatif, et l'argent était retiré à quelqu'un qui avait objecté et qui attendait une
-- réponse. Le filtre donnait l'impression que le cas était traité, ce qui est pire que de ne rien
-- écrire : personne ne va vérifier une protection qu'il croit en place.
--
-- ARBITRAGE DE FOUKA, 29/09 : « La retenue est suspendue jusqu'à ce que je tranche. » On ne prélève
-- rien sur quelqu'un qui attend une réponse. La retenue n'est pas perdue : elle revient si Fouka la
-- maintient.
--
-- TROIS CHOSES, ET IL FAUT LES TROIS. Un statut qui existe, une contestation qui le pose, et un
-- geste pour en sortir. Sans le troisième, une contestation suspendrait la retenue pour toujours,
-- et on aurait remplacé un prélèvement injuste par un abandon silencieux.

alter table public.mission_penalites drop constraint if exists mission_penalites_statut_check;
alter table public.mission_penalites add constraint mission_penalites_statut_check
  check (statut in ('appliquee', 'contestee', 'annulee'));

comment on column public.mission_penalites.statut is
  'appliquee : la retenue compte. contestee : SUSPENDUE, elle n''entre pas dans le récapitulatif '
  'tant que personne n''a tranché (décision de Fouka du 29/09/2026). annulee : abandonnée. '
  'Ne jamais filtrer sur un statut qui n''existe pas dans cette contrainte : c''est exactement la '
  'faute que v364 répare.';

-- ── LA CONTESTATION POSE LE STATUT ──────────────────────────────────────────────────────────────
create or replace function public.mission_penalite_contester(p_penalite_id uuid, p_texte text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_p mission_penalites; v_pe prestations_equipe; v_texte text; v_ref text; v_dest uuid;
begin
  select * into v_p from mission_penalites where id = p_penalite_id;
  if v_p.id is null then raise exception 'Pénalité introuvable.' using errcode = 'P0002'; end if;
  select * into v_pe from prestations_equipe where id = v_p.affectation_id;
  if v_pe.collaborateur_id <> auth.uid() then
    raise exception 'Seule la personne pénalisée conteste sa retenue.' using errcode = '42501';
  end if;
  v_texte := nullif(btrim(coalesce(p_texte, '')), '');
  if v_texte is null then raise exception 'Dites ce que vous contestez.'; end if;
  -- ON NE CONTESTE PAS UNE RETENUE DÉJÀ PRÉLEVÉE. Le récapitulatif est parti, le virement a été
  -- annoncé : rouvrir le montant après coup ne rendrait pas l'argent, ça rendrait le document faux.
  -- La contestation passe alors par une conversation, pas par ce bouton.
  if v_pe.statut_paiement in ('transmis_compta', 'payé') then
    raise exception 'Cette retenue est déjà partie sur un récapitulatif. Contactez la direction.'
      using errcode = '22023';
  end if;
  if v_p.statut = 'annulee' then
    raise exception 'Cette retenue a déjà été annulée : il n''y a rien à contester.' using errcode = '22023';
  end if;

  -- LE STATUT, ET C'EST TOUTE LA CORRECTION. Sans cette ligne, `contestation` remplissait une
  -- colonne que rien ne lisait.
  update mission_penalites
     set contestation = v_texte, conteste_le = now(), statut = 'contestee'
   where id = p_penalite_id;

  select reference into v_ref from prestations where id = v_pe.prestation_id;
  v_dest := v_p.cree_par;
  insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                             source_type, source_id, lien_prestation_id, expediteur_id)
  values (v_dest, 'mission_penalite',
          'Retenue contestée — ' || coalesce(v_ref, 'mission'),
          'L''opérateur conteste la retenue de ' || v_p.montant || ' € : ' || v_texte
            || ' — elle est SUSPENDUE et n''entrera pas dans son récapitulatif tant que vous n''aurez pas tranché.',
          v_pe.prestation_id, 'haute', 'prestation', v_pe.prestation_id, v_pe.prestation_id, auth.uid());

  return jsonb_build_object('ok', true, 'suspendue', true);
end $$;

comment on function public.mission_penalite_contester(uuid, text) is
  'La personne pénalisée conteste : la retenue passe en `contestee`, donc SUSPENDUE — elle sort du '
  'récapitulatif jusqu''à `mission_penalite_trancher`. Refuse une retenue déjà partie sur un '
  'récapitulatif : rouvrir le montant après coup rendrait le document faux. v364, 29/09/2026.';

-- ── ET ON EN SORT ───────────────────────────────────────────────────────────────────────────────
create or replace function public.mission_penalite_trancher(
  p_penalite_id uuid, p_maintenir boolean, p_reponse text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_p mission_penalites; v_pe prestations_equipe;
begin
  -- LA DIRECTION TRANCHE. Pas celui qui a posé la retenue : juger sa propre décision contestée, ce
  -- n'est pas trancher. Même raison que pour les exceptions de rémunération (v148-v150, 11/09).
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role = 'admin') then
    raise exception 'Seule la direction tranche une contestation.' using errcode = '42501';
  end if;
  if p_maintenir is null then
    raise exception 'Dites si la retenue est maintenue ou abandonnée.' using errcode = '22023';
  end if;

  select * into v_p from mission_penalites where id = p_penalite_id;
  if v_p.id is null then raise exception 'Retenue introuvable.' using errcode = 'P0002'; end if;
  if v_p.statut <> 'contestee' then
    raise exception 'Cette retenue n''est pas contestée (elle est %).', v_p.statut using errcode = '22023';
  end if;

  select * into v_pe from prestations_equipe where id = v_p.affectation_id;

  update mission_penalites
     set statut = case when p_maintenir then 'appliquee' else 'annulee' end,
         annulation_motif = case when p_maintenir then annulation_motif
                                 else coalesce(nullif(btrim(coalesce(p_reponse, '')), ''), 'Contestation acceptée') end,
         annulee_le = case when p_maintenir then annulee_le else now() end,
         annulee_par = case when p_maintenir then annulee_par else auth.uid() end
   where id = p_penalite_id;

  -- ON RÉPOND À LA PERSONNE. Une contestation qui se règle en silence est une contestation qu'on
  -- refait le mois suivant.
  insert into notifications (destinataire_id, type, titre, message, prestation_id, priorite,
                             source_type, source_id, lien_prestation_id, expediteur_id)
  values (v_pe.collaborateur_id, 'mission_penalite',
          case when p_maintenir then 'Retenue maintenue' else 'Retenue annulée' end,
          case when p_maintenir
               then 'Votre contestation a été examinée : la retenue de ' || v_p.montant || ' € est maintenue.'
               else 'Votre contestation a été acceptée : la retenue de ' || v_p.montant || ' € est annulée.' end
            || coalesce(' ' || nullif(btrim(coalesce(p_reponse, '')), ''), ''),
          v_pe.prestation_id, 'normale', 'prestation', v_pe.prestation_id, v_pe.prestation_id, auth.uid());

  insert into financial_audit_log (acteur_id, action, table_cible, ligne_id, montant_avant, montant_apres, details)
  values (auth.uid(), case when p_maintenir then 'penalite_maintenue' else 'penalite_abandonnee' end,
          'mission_penalites', p_penalite_id, v_p.montant,
          case when p_maintenir then v_p.montant else 0 end,
          jsonb_build_object('contestation', v_p.contestation, 'reponse', p_reponse));

  return jsonb_build_object('ok', true, 'maintenue', p_maintenir);
end $$;

comment on function public.mission_penalite_trancher(uuid, boolean, text) is
  'La direction tranche une contestation : maintenue (retour en `appliquee`, donc elle rentre au '
  'prochain récapitulatif) ou abandonnée (`annulee`). Pas celui qui a posé la retenue : juger sa '
  'propre décision contestée n''est pas trancher. Répond toujours à la personne. v364, 29/09/2026.';

revoke all on function public.mission_penalite_trancher(uuid, boolean, text) from public, anon;
grant execute on function public.mission_penalite_trancher(uuid, boolean, text) to authenticated;

-- ── ET ON LES VOIT AVANT DE CLÔTURER ────────────────────────────────────────────────────────────
create or replace function public.recap_contestations_en_attente(p_mois date default null)
returns table (
  penalite_id uuid, collaborateur_id uuid, collaborateur text, date_prestation date,
  montant numeric, motif text, contestation text, conteste_le timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_mois date;
begin
  if not exists (select 1 from profiles p
                  where p.id = auth.uid() and p.actif and p.role in ('admin','compta')) then
    raise exception 'Réservé à la direction et à la comptabilité.' using errcode = '42501';
  end if;
  v_mois := date_trunc('month', coalesce(p_mois, public.recap_mois_courant()))::date;

  return query
  select mpe.id, pe.collaborateur_id,
         coalesce(nullif(btrim(coalesce(p.prenom,'') || ' ' || coalesce(p.nom,'')), ''), 'Collaborateur'),
         pr.date_prestation, mpe.montant, mpe.motif, mpe.contestation, mpe.conteste_le
    from mission_penalites mpe
    join prestations_equipe pe on pe.id = mpe.affectation_id
    join prestations pr on pr.id = pe.prestation_id
    join profiles p on p.id = pe.collaborateur_id
   where mpe.statut = 'contestee'
     and pr.date_prestation >= v_mois and pr.date_prestation < (v_mois + interval '1 month')::date
   order by mpe.conteste_le;
end $$;

comment on function public.recap_contestations_en_attente(date) is
  'Les retenues contestées du mois, SUSPENDUES en attendant une décision. À montrer sur l''écran de '
  'clôture : sans ça, elles disparaissent du récapitulatif sans que personne ne sache qu''il y a une '
  'réponse à donner, et on aurait remplacé un prélèvement injuste par un abandon silencieux. '
  'v364, 29/09/2026.';

revoke all on function public.recap_contestations_en_attente(date) from public, anon;
grant execute on function public.recap_contestations_en_attente(date) to authenticated, service_role;

notify pgrst, 'reload schema';
