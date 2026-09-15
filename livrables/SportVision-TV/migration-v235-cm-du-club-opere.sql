-- v235 — Le CM du club OPÈRE le club, sans l'administrer.
--
-- Suite de la v234. Le planning éditorial lui était ouvert, mais presque tous les autres écrans
-- du club passent par `peut_operer_club()` : le calendrier, les événements, les matchs, les
-- présences, les galeries du club. Le CM du club y répondait non, et se retrouvait avec un menu
-- complet ouvrant des écrans vides.
--
-- LA DISTINCTION EXISTE DÉJÀ, et elle est exactement celle que Fouka a demandée :
--   · `is_club_admin`    — ADMINISTRER : inviter des gens, régler le club, l'argent.
--   · `peut_operer_club` — OPÉRER : travailler sur le club au quotidien.
-- Le CM du club rejoint le second, jamais le premier. C'est la traduction litérale de « tout sauf
-- l'argent et les accès ».
--
-- Ce que cette migration N'OUVRE PAS, et c'est délibéré : les coordonnées bancaires et le SIRET
-- (peut_lire_paiement_club), l'annuaire des membres (peut_lire_annuaire_club) et la propriété du
-- club (is_real_club_admin) ont leurs propres fonctions, décidées le 11/09, et ne passent pas par
-- celle-ci.
--
-- Idempotent.

create or replace function peut_operer_club(p_club_id uuid)
returns boolean language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
begin
  -- Sur un p_club_id nul, l'ancienne expression rendait false grâce au coalesce : un NULL dans un
  -- `if not (...)` n'aurait pas déclenché la branche de refus (défaut trouvé sur
  -- peut_preparer_club(null) le 08/09). Toujours un booléen, jamais NULL.
  if p_club_id is null then
    return false;
  end if;
  -- Owner Club+, Président, délégation d'agence CM, CM responsable. Écrit en expression simple :
  -- PL/pgSQL garde l'état de cet appel pour la transaction, là où l'ancienne version SQL
  -- re-planifiait is_club_admin à chaque ligne d'une policy (≈ 700 µs perdus par ligne).
  if is_club_admin(p_club_id) then
    return true;
  end if;
  -- v235 (15/09/2026) — Le Community Manager DU CLUB. Il opère le club comme le CM SportVision :
  -- calendrier, événements, matchs, contenus, présences, galeries. Il n'administre rien : ni
  -- invitations, ni paramètres, ni argent — ces trois-là passent par is_club_admin ou par des
  -- fonctions dédiées, et pas par ici.
  if exists (
    select 1 from club_members m
     where m.user_id = auth.uid() and m.club_id = p_club_id
       and m.status = 'actif' and m.role = 'comm'
  ) then
    return true;
  end if;
  -- CM SportVision et staff de l'OS, cloisonnés par cm_clubs_autorises : inchangé.
  return coalesce(
    exists (
      select 1 from profiles p
       where p.id = auth.uid()
         and p.actif
         and p.role in ('admin', 'com', 'sec', 'cm')
    )
    and p_club_id in (select public.cm_clubs_autorises()),
    false);
end;
$$;
