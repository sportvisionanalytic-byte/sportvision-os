-- Migration Club+ v44 — Ajout du plan "free" (Club+ Gratuit)
-- 19/08/2026 — décision Fouka : Club+ Gratuit (1 utilisateur, 1 équipe, 0 crédit inclus,
-- pas de remise, réservation de prestations SportVision au tarif standard). Aucun Price/
-- Product Stripe : ce plan est attribué directement par clubplus-onboarding (self-service
-- instantané, voir app-next/src/app/signup-free/page.tsx) ou par le staff via
-- clubplus-generate-activation/connect-club-signup-review.
--
-- Plafonds utilisateurs/équipes confirmés par Fouka : free=1/1, club(Start)=5/2,
-- performance=illimité/illimité. Le plafond utilisateurs est vérifié côté serveur dans
-- clubplus-invite (service role, avant l'envoi de l'invitation). Le plafond équipes est
-- posé ici en trigger Postgres car AUCUN chemin de création de club_teams n'existe encore
-- dans le code applicatif (ni edge function, ni appel client) — c'est le seul point garanti
-- de passer, quel que soit le futur chemin de création (RLS actuelle : n'importe quel
-- membre du club peut insérer, pas seulement un admin — voir migration-clubplus-v5.sql
-- ctm_member_insert).

-- 1) clubs.plan — élargit la contrainte à 'free'
alter table clubs drop constraint if exists clubs_plan_check;
alter table clubs add constraint clubs_plan_check check (plan in ('free', 'club', 'performance'));
alter table clubs alter column plan set default 'free';

-- 2) clubplus_activation_tokens.plan — même élargissement (staff peut générer un lien
--    d'activation "free", même si le chemin normal pour ce plan est le self-service)
alter table clubplus_activation_tokens drop constraint if exists clubplus_activation_tokens_plan_check;
alter table clubplus_activation_tokens add constraint clubplus_activation_tokens_plan_check
  check (plan in ('free', 'club', 'performance'));

-- 3) Plafond d'équipes par plan club_teams — trigger before insert
create or replace function check_club_teams_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_max_teams int;
  v_current_count int;
begin
  select plan into v_plan from clubs where id = new.club_id;

  v_max_teams := case v_plan
    when 'free' then 1
    when 'club' then 2
    else null -- 'performance' et tout plan non reconnu : pas de plafond posé ici
  end;

  if v_max_teams is not null then
    select count(*) into v_current_count from club_teams where club_id = new.club_id;
    if v_current_count >= v_max_teams then
      raise exception 'Plafond d''équipes atteint pour ce plan (% équipe(s) maximum). Passez à une formule supérieure pour créer davantage d''équipes.', v_max_teams
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ctm_limit on club_teams;
create trigger trg_ctm_limit before insert on club_teams
  for each row execute procedure check_club_teams_limit();
