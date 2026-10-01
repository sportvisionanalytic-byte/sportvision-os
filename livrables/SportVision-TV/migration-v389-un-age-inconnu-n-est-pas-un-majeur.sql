-- v389 — Un âge inconnu n'est pas un majeur (01/10/2026)
--
-- ── LE DÉFAUT, MESURÉ ────────────────────────────────────────────────────────────────────────
--
-- `sv_age_bracket(null)` rendait NULL. Or les cinq fonctions qui s'en servent écrivent toutes :
--
--     if sv_age_bracket(<date>) <> 'majeur' then  <protections du mineur>  end if;
--
-- et `NULL <> 'majeur'` vaut NULL, pas VRAI. Le bloc ne s'exécute donc PAS : **sans date de
-- naissance, un enfant est traité comme un adulte.** Vérifié en base :
--
--     sv_age_bracket(null)                  → null
--     sv_age_bracket(null) <> 'majeur'      → null   → « PROTECTION SAUTEE »
--     sv_age_bracket('2015-01-01') <> 'majeur' → true
--
-- C'est le même piège que `current_setting(…, true)` rencontré deux fois aujourd'hui : une
-- comparaison avec NULL ne lève jamais, précisément dans le cas qu'elle devait attraper.
--
-- Aujourd'hui `player_profiles.date_naissance` est NOT NULL, ce qui masque le problème sur ce
-- chemin. Mais Fouka a décidé le 01/10 que **les familles renseigneront la date pendant leur
-- inscription** : lui ne saisit que le prénom, le nom, la catégorie et la photo de référence.
-- La colonne doit donc devenir facultative — et ce serait ouvrir le trou si on ne le ferme pas
-- d'abord. On ferme d'abord.
--
-- ── CE QU'ON CHANGE, ET POURQUOI UNE SEULE LIGNE SUFFIT ─────────────────────────────────────
--
-- `sv_age_bracket` rend désormais 'inconnu' au lieu de NULL. Les cinq appelants comparent avec
-- `<> 'majeur'` : 'inconnu' est différent de 'majeur', donc la protection du mineur S'APPLIQUE.
-- Mesuré avant d'écrire : les littéraux 'moins_14' et '14_17' ne sont lus NULLE PART ailleurs,
-- aucune colonne ne stocke une tranche, aucune vue ne la lit. Le seul usage hors comparaison est
-- `validate_team_membership`, qui range la valeur dans une variable sans la tester.
--
-- La règle vit à un seul endroit, et les cinq appelants deviennent sûrs sans être touchés.
--
-- ── ET LA PHOTO N'AVANCE PAS SANS LA DATE ───────────────────────────────────────────────────
--
-- Une photo de référence déposée d'avance attend déjà le consentement (v385). On ajoute qu'elle
-- attend aussi la DATE : tant qu'elle est inconnue, on ne sait pas à qui demander l'accord, donc
-- il n'y a pas d'accord valable à recueillir. Refuser ici, c'est refuser de recueillir un
-- consentement auprès de la mauvaise personne.

begin;

create or replace function public.sv_age_bracket(p_date_naissance date)
returns text
language sql
immutable
as $function$
  select case
    -- 'inconnu' et PAS null : voir l'en-tête. Un NULL rend muette toute comparaison, et les cinq
    -- appelants sautaient alors les protections du mineur.
    when p_date_naissance is null then 'inconnu'
    when age(p_date_naissance) < interval '14 years' then 'moins_14'
    when age(p_date_naissance) < interval '18 years' then '14_17'
    else 'majeur'
  end;
$function$;

-- La date devient facultative : Fouka constitue l'effectif avec ce qu'il a (prénom, nom,
-- catégorie, photo), la famille la renseigne en s'inscrivant.
alter table public.player_profiles alter column date_naissance drop not null;

create or replace function public.photo_reference_attend_la_date()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_dn date;
begin
  select date_naissance into v_dn from player_profiles where id = new.player_id;
  if v_dn is null then
    raise exception 'La date de naissance de ce sportif n''est pas connue : on ne sait pas à qui demander l''accord. Elle est renseignée par la famille à l''inscription.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_photo_reference_attend_la_date on public.player_face_refs;
create trigger trg_photo_reference_attend_la_date
  before insert on public.player_face_refs
  for each row execute function public.photo_reference_attend_la_date();

commit;
