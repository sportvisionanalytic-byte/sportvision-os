-- v227 — Le directeur sportif, le membre du bureau et le secrétaire administrent le club
-- (14/09/2026, décision de Fouka).
--
-- LA DEMANDE : « sur Club+ il faut aussi dirigeant accès complet, pas que président ».
--
-- CE QUI EXISTAIT. `is_club_admin` ne reconnaissait que `admin` et `president`. Tous les autres
-- rôles du bureau — directeur sportif, membre du bureau, secrétaire — voyaient le club mais ne
-- pouvaient rien administrer : ni inviter, ni modifier la fiche, ni gérer les membres. Or dans un
-- club réel, le président signe, et ce sont ces trois-là qui font tourner la maison.
--
-- CE QUI A ÉTÉ ÉCARTÉ, et pourquoi c'est important. Le rôle `resp_equipe` porte le libellé
-- « Dirigeant (responsable d'équipe) » à l'écran : c'est le mot « dirigeant » qui prête à
-- confusion. Il n'est PAS concerné. C'est un rôle d'équipe ; lui donner l'accès complet aurait
-- ouvert les factures, l'abonnement et les paramètres du club à chaque responsable d'équipe,
-- parfois dix personnes. Vérifié auprès de Fouka avant d'écrire.
--
-- CE QUI NE CHANGE PAS : la PROPRIÉTÉ du club. Attribuer un rôle privilégié, supprimer
-- définitivement un membre, transférer le club restent réservés à `is_real_club_admin`, c'est-à-dire
-- au rôle `admin` strict. Un secrétaire administre ; il ne devient pas propriétaire.
--
-- Idempotente.

create or replace function public.is_club_admin(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from club_members
    where club_id = target_club_id and user_id = auth.uid()
      -- `president` ajouté le 10/09/2026, puis le bureau le 14/09/2026 : ces rôles administrent le
      -- club au même titre. Ce qui relève de la PROPRIÉTÉ passe, lui, par `is_real_club_admin`.
      -- `resp_equipe` n'est volontairement pas ici : malgré son libellé « Dirigeant », c'est un
      -- rôle d'équipe.
      and role in ('admin', 'president', 'directeur_sportif', 'membre_bureau', 'secretaire')
      and status = 'actif'
  )
  or exists (
    select 1
    from cm_agency_club_access caa
    join memberships m on m.organization_id = caa.cm_agency_org_id
    where caa.club_id = target_club_id
      and m.user_id = auth.uid()
      and m.status = 'actif'
      and (caa.expires_at is null or caa.expires_at >= current_date)
  )
  or exists (
    select 1 from memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = auth.uid() and m.status = 'actif' and m.cm_super_access = true
      and o.organization_type = 'cm_agency'
  );
$$;

comment on function public.is_club_admin(uuid) is
  'v227 — Administre le club : admin, président, directeur sportif, membre du bureau, secrétaire, plus le CM délégué. La propriété reste à is_real_club_admin.';
