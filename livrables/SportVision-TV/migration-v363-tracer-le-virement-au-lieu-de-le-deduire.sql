-- v363 — TRACER LE VIREMENT AU LIEU DE LE DÉDUIRE (29/09/2026)
--
-- DEUX REMARQUES DE L'AGENT QUI A CONSTRUIT L'ÉCRAN, toutes les deux justes.
--
-- 1. RIEN NE DISAIT QUE LE VIREMENT ÉTAIT PARTI. L'écran devait le déduire : « toutes les
--    affectations de ce récapitulatif sont à `payé`, donc le virement est fait ». Ça marche, et c'est
--    fragile pour une raison précise : une affectation passée à `payé` depuis un AUTRE écran ferait
--    disparaître le bouton « Virement effectué » sans que personne n'ait viré quoi que ce soit. On
--    déduirait un fait à partir d'un effet de bord. Une date sur le récapitulatif dit ce qui s'est
--    passé, et se lit en une requête au lieu de deux.
--
-- 2. `anon` AVAIT LES DROITS DE TABLE sur les deux tables du récapitulatif, par les privilèges par
--    défaut du projet. Seule la RLS l'arrêtait, et ses policies exigent toutes `auth.uid()`, donc
--    c'était fermé en pratique. Mais ce sont des montants nominatifs, et on vient de payer deux fois
--    aujourd'hui le fait qu'un droit inutile finit par servir (v351 sur anon, v354 sur l'OS).
--    `revoke` est une ceinture qui ne coûte rien.

alter table public.recapitulatifs_remuneration
  add column if not exists vire_le timestamptz,
  add column if not exists vire_par uuid references public.profiles(id);

comment on column public.recapitulatifs_remuneration.vire_le is
  'Quand le virement a été fait. NE PAS déduire ce fait de l''état des affectations : une ligne '
  'passée à `payé` par un autre écran ferait croire à un virement qui n''a pas eu lieu. v363.';

create or replace function public.recap_virement_effectue(p_recapitulatif_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer; v_statut text; v_deja timestamptz;
begin
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.actif and p.role in ('admin','compta')) then
    raise exception 'Réservé à la direction et à la comptabilité.' using errcode = '42501';
  end if;

  select statut, vire_le into v_statut, v_deja
    from recapitulatifs_remuneration where id = p_recapitulatif_id;
  if v_statut is null then
    raise exception 'Ce récapitulatif n''existe pas.' using errcode = 'P0002';
  end if;
  -- ON NE MARQUE PAS UN VIREMENT SUR UN RÉCAPITULATIF QUE PERSONNE N'A REÇU. Le collaborateur n'a
  -- pas été prévenu : virer d'abord et l'informer après, c'est un virement qu'il ne sait pas
  -- rattacher à un mois.
  if v_statut <> 'envoye' then
    raise exception 'Ce récapitulatif est %, il n''a pas encore été envoyé au collaborateur.', v_statut
      using errcode = '22023';
  end if;
  -- Idempotent : deux clics ne redatent pas le virement.
  if v_deja is not null then return 0; end if;

  update recapitulatifs_remuneration
     set vire_le = now(), vire_par = auth.uid(), updated_at = now()
   where id = p_recapitulatif_id;

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
  'Le virement est parti : date sur le récapitulatif, affectations à `payé`. Refuse un récapitulatif '
  'non envoyé — virer avant d''informer donne un virement que le collaborateur ne sait pas rattacher '
  'à un mois. Idempotente. v363, 29/09/2026.';

revoke all on table public.recapitulatifs_remuneration from anon;
revoke all on table public.recapitulatifs_remuneration_lignes from anon;

notify pgrst, 'reload schema';
