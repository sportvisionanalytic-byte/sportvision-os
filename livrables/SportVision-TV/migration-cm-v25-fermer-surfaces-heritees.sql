-- ═══════════════════════════════════════════════════════════════════════════════
-- DETTE P1 — fermer les surfaces qu'un CM cloisonne heritait de is_staff()
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Mesure du 09/09/2026 sur un vrai CM affilie : au-dela de ses clubs, il lisait
--
--    36  recruitment_applications      les candidatures, donnees personnelles de tiers
--    42  notification_outbox           la file d'envoi de TOUS les e-mails, contenu compris
--    53  notification_attempts         leurs tentatives de remise
--    48  communication_audit_logs      le journal d'audit
--    13  profiles                      les profils du personnel SportVision
--     5  email_templates / materiels   l'outillage interne
--     4  kit_compositions
--     1  disponibilites / messages
--
-- Rien de tout cela n'est son metier. Il accompagne des clubs, il n'administre pas SportVision.
--
-- Methode inchangee : des policies RESTRICTIVE, qui se combinent en ET et ne peuvent que RETIRER
-- de l'acces. Chacune commence par `not est_cm_cloisonne() or ...`, donc aucun autre role n'est
-- touche — ni l'admin, ni la production, ni la comptabilite.
--
-- Ce qui lui reste sur ces tables : strictement ce qui le concerne lui. Ses propres notifications,
-- ses propres messages, son propre profil, ses propres clubs.
--
-- Volontairement NON fermees, parce qu'elles servent son travail : les modeles Studio, les modeles
-- de communication, le centre de ressources, le catalogue de formation, les produits media.

begin;

-- ── Ce qui ne le regarde pas du tout ─────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'recruitment_applications',   -- candidatures : donnees personnelles de tiers
    'communication_audit_logs',
    'email_templates',
    'materiels',
    'kit_compositions',
    'disponibilites',
    'atraiter_overrides',
    'audit_logs'
  ] loop
    if to_regclass('public.'||t) is null then continue; end if;
    execute format('drop policy if exists %I on %I', 'cm_hors_perimetre_'||t, t);
    execute format($f$
      create policy %I on %I as restrictive for all to authenticated
        using (not est_cm_cloisonne())
        with check (not est_cm_cloisonne())
    $f$, 'cm_hors_perimetre_'||t, t);
  end loop;
end $$;

-- ── Ce qui le regarde, mais SEULEMENT pour lui ───────────────────────────────
drop policy if exists cm_hors_perimetre_notification_outbox on notification_outbox;
create policy cm_hors_perimetre_notification_outbox on notification_outbox as restrictive for all to authenticated
  using (not est_cm_cloisonne() or recipient_user_id = auth.uid())
  with check (not est_cm_cloisonne() or recipient_user_id = auth.uid());

drop policy if exists cm_hors_perimetre_notification_attempts on notification_attempts;
create policy cm_hors_perimetre_notification_attempts on notification_attempts as restrictive for all to authenticated
  using (not est_cm_cloisonne()
         or exists (select 1 from notification_outbox o
                    where o.id = outbox_id and o.recipient_user_id = auth.uid()))
  with check (not est_cm_cloisonne()
              or exists (select 1 from notification_outbox o
                         where o.id = outbox_id and o.recipient_user_id = auth.uid()));

drop policy if exists cm_hors_perimetre_messages on messages;
create policy cm_hors_perimetre_messages on messages as restrictive for all to authenticated
  using (not est_cm_cloisonne() or expediteur_id = auth.uid() or destinataire_id = auth.uid())
  with check (not est_cm_cloisonne() or expediteur_id = auth.uid());

-- Son propre profil, et ceux des personnes de ses clubs qu'il doit pouvoir nommer.
--
-- Le predicat DOIT passer par une fonction SECURITY DEFINER. Ecrit directement dans la policy,
-- il interrogeait club_members, dont les policies interrogent profiles : recursion infinie, et
-- toute lecture de profiles tombait en erreur — pour tout le monde. Constate en le faisant, le
-- 09/09/2026. Une fonction SECURITY DEFINER ne declenche pas les policies des tables qu'elle lit,
-- ce qui coupe le cycle.
create or replace function public.cm_profil_de_ses_clubs(p_profil uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (select 1 from club_members cm
                 where cm.user_id = p_profil and cm.club_id in (select cm_clubs_autorises()));
$function$;

drop policy if exists cm_hors_perimetre_profiles on profiles;
create policy cm_hors_perimetre_profiles on profiles as restrictive for all to authenticated
  using (not est_cm_cloisonne() or id = auth.uid() or cm_profil_de_ses_clubs(id))
  with check (not est_cm_cloisonne() or id = auth.uid());

-- Ses adhesions a lui.
drop policy if exists cm_hors_perimetre_memberships on memberships;
create policy cm_hors_perimetre_memberships on memberships as restrictive for all to authenticated
  using (not est_cm_cloisonne() or user_id = auth.uid()
         or organization_id in (select cm_clubs_autorises()))
  with check (not est_cm_cloisonne() or user_id = auth.uid());

commit;

select 'OK — surfaces heritees fermees' as verdict;
