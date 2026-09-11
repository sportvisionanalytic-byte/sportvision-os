-- v165 : reporter ou annuler un match le dit aussi aux familles (12/09/2026).
--
-- Un match porte deux colonnes : `status`, le suivi SportVision (à venir, à transmettre, reçu,
-- reportée, annulée), et `sport_status`, l'état sportif (scheduled, postponed, cancelled,
-- completed). Le trigger ne recopiait que dans un sens, sport_status vers status.
--
-- Or le Match Center de Club+ écrit `status`, et le calendrier — celui du club, celui du coach, et
-- ce que voient les familles dans Connect — lit `sport_status`. Un match annulé dans le Match
-- Center restait donc « à venir » partout ailleurs : les parents se déplaçaient pour un match qui
-- n'avait pas lieu. Aucune divergence en base aujourd'hui (677 matchs, tous à venir), le défaut
-- n'avait pas encore eu l'occasion de se produire.
--
-- Le trigger recopie maintenant dans les deux sens, en donnant la priorité à sport_status quand les
-- deux changent dans la même écriture (c'est l'état sportif qui fait foi). Il ne se déclenchait par
-- ailleurs que sur sport_status et saison_id : une écriture qui ne touche que `status` ne le
-- réveillait même pas. Sa liste de colonnes est élargie.
-- Test : tests/match-statut-deux-sens.test.sql

create or replace function public.sync_match_sport_status_to_status()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.saison_id is null then
    select id into new.saison_id from saisons where active order by date_debut desc nulls last limit 1;
  end if;

  if tg_op = 'INSERT' or new.sport_status is distinct from old.sport_status then
    if new.sport_status = 'postponed' then
      new.status := 'reportee';
    elsif new.sport_status = 'cancelled' then
      new.status := 'annulee';
    elsif new.sport_status in ('scheduled','completed')
          and new.status in ('reportee','annulee') then
      new.status := 'a_venir';
    end if;
    return new;
  end if;

  -- L'autre sens (12/09/2026) : ce que la saisie du Match Center écrit doit atteindre le calendrier
  -- et les familles.
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'reportee' then
      new.sport_status := 'postponed';
    elsif new.status = 'annulee' then
      new.sport_status := 'cancelled';
    elsif new.status = 'recu' then
      new.sport_status := 'completed';
    elsif new.status = 'a_venir' and coalesce(new.sport_status,'scheduled') in ('postponed','cancelled') then
      new.sport_status := 'scheduled';
    end if;
  end if;

  return new;
end $$;

-- Le trigger ne se réveillait pas sur une écriture de `status` seul : c'est exactement ce que fait
-- le Match Center.
drop trigger if exists trg_club_matches_sport_status on public.club_matches;
create trigger trg_club_matches_sport_status
  before insert or update of sport_status, saison_id, status on public.club_matches
  for each row execute function public.sync_match_sport_status_to_status();

drop function if exists public.club_matches_sport_status();
