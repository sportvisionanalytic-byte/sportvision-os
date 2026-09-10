-- P0 — Le calendrier d'un club se lisait sans compte.
--
-- ── Mesuré le 10/09/2026 (tests/calendrier-acces.test.sql, rouge) ──
-- `club_calendrier(club, du, au)` s'exécute avec les droits de son propriétaire (SECURITY
-- DEFINER), ne vérifiait RIEN, et restait exécutable par `anon`. Un appel à l'API avec la seule
-- clé publique rendait le calendrier complet de SF Villemomble : matchs, et surtout horaires et
-- lieux des entraînements d'équipes de mineurs (U6 à U18). Un compte sans lien, un coach ou un CM
-- d'un autre club le lisaient de même.
--
-- ── La correction, sans réécrire le calendrier ──
-- Le corps actuel devient `club_calendrier_interne`, que plus aucun rôle de l'API ne peut
-- appeler. `club_calendrier` devient une porte : elle vérifie le lien avec le club, puis rend
-- exactement ce que rendait l'ancienne fonction. Même nom, mêmes colonnes : l'écran et
-- `cm_tableau_de_bord` ne changent pas.
--
-- Qui lit : qui opère le club (Owner, président, CM affecté), tout membre actif, le staff
-- SportVision hors CM cloisonné, un joueur du club ou le parent confirmé d'un joueur du club.

begin;

alter function public.club_calendrier(uuid, date, date) rename to club_calendrier_interne;
revoke execute on function public.club_calendrier_interne(uuid, date, date) from public, anon, authenticated;

create or replace function public.peut_lire_calendrier_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select peut_operer_club(p_club_id)
      or is_club_member(p_club_id)
      or (is_staff() and not est_cm_cloisonne())
      or exists (
        select 1 from player_profiles pp
         where pp.club_id = p_club_id
           and coalesce(pp.account_status, '') <> 'retire'
           and (pp.user_id = auth.uid() or is_confirmed_parent_of(pp.id))
      );
$$;

revoke execute on function public.peut_lire_calendrier_club(uuid) from public, anon;
grant execute on function public.peut_lire_calendrier_club(uuid) to authenticated;

create function public.club_calendrier(p_club_id uuid, p_du date, p_au date)
returns TABLE(ref text, genre text, date_evenement date, heure_debut time without time zone, heure_fin time without time zone, titre text, equipe text, team_id uuid, adversaire text, domicile boolean, lieu text, competition text, score text, statut text, couverture text, adversaire_logo text, type_couverture text, buteurs text, passeurs text, homme_du_match text, cartons text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not peut_lire_calendrier_club(p_club_id) then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  return query select * from club_calendrier_interne(p_club_id, p_du, p_au);
end;
$$;

comment on function public.club_calendrier(uuid, date, date) is
  'Le calendrier unifié d''un club. Vérifie d''abord le lien avec le club (peut_lire_calendrier_club) : jusqu''au 10/09/2026, il se lisait sans compte.';

revoke execute on function public.club_calendrier(uuid, date, date) from public, anon;
grant execute on function public.club_calendrier(uuid, date, date) to authenticated;

commit;
