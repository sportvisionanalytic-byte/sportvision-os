-- v388 — La photo d'un collaborateur est PROPOSÉE, et la base le fait respecter (01/10/2026)
--
-- ── LE DÉFAUT, MESURÉ APRÈS LA v386 ──────────────────────────────────────────────────────────
--
-- La v386 a posé la promesse : la photo d'un coach lui est proposée, jamais imposée. Seul
-- l'intéressé accepte, et `repondre_photo_profil` pose pour cela un marqueur de session,
-- `sv.photo_profil_decidee`.
--
-- **Personne ne lisait ce marqueur.** Mesuré : `authenticated` garde UPDATE sur `photo_bucket`,
-- `photo_path` et `photo_acceptee_le`, et un droit d'UPDATE AU NIVEAU DE LA TABLE — qui rend de
-- toute façon les droits de colonne inopérants. Joué par le chemin réel avec le jeton d'un
-- président de club : `update club_members set photo_acceptee_le = now() where user_id <> le sien`
-- a modifié **4 lignes**.
--
-- Autrement dit : le président d'un club pouvait poser une photo sur le compte de ses coachs et la
-- marquer acceptée à leur place. La promesse tenait dans l'écran, pas dans la base.
--
-- ── POURQUOI UN DÉCLENCHEUR ET PAS UN RETRAIT DE DROITS ─────────────────────────────────────
--
-- Retirer l'UPDATE de table à `authenticated` pour le rendre colonne par colonne toucherait
-- `club_members`, lue et écrite par des dizaines de policies, sous gel fonctionnel. Un déclencheur
-- qui refuse est le patron déjà employé ici (`protect_sensitive_affectation_fields`,
-- `protect_sensitive_profile_fields`) : il lève une phrase que l'écran peut montrer, là où une
-- policy refuse à zéro ligne et zéro erreur.
--
-- ── LE PIÈGE DU MARQUEUR, PAYÉ DEUX FOIS AUJOURD'HUI ────────────────────────────────────────
--
-- `current_setting('sv.x', true)` rend NULL quand le réglage n'existe pas. Et `not NULL` vaut NULL,
-- donc un `if not (… and current_setting(…) = 'oui') then raise` NE LÈVE JAMAIS quand le marqueur
-- est absent — c'est-à-dire exactement dans le cas qu'on voulait refuser. Ce défaut a été trouvé
-- deux fois ce 01/10, dont une fois dans du code écrit le jour même. D'où le `coalesce(…, '')`.

begin;

create or replace function public.photo_profil_decidee_par_la_personne()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Rien à dire si aucune des trois colonnes ne bouge.
  if new.photo_bucket is not distinct from old.photo_bucket
     and new.photo_path is not distinct from old.photo_path
     and new.photo_acceptee_le is not distinct from old.photo_acceptee_le then
    return new;
  end if;

  -- `coalesce` et pas une comparaison nue : voir l'en-tête. `repondre_photo_profil` et
  -- `retirer_ma_photo_profil` posent ce marqueur, et elles vérifient déjà que l'appelant est bien
  -- la personne concernée. On ne redit donc pas leur règle, on exige leur passage.
  if coalesce(current_setting('sv.photo_profil_decidee', true), '') = 'oui' then
    return new;
  end if;

  raise exception 'Une photo de profil se propose, elle ne se pose pas. Seule la personne concernée l''accepte ou la refuse.'
    using errcode = '42501';
end;
$function$;

drop trigger if exists trg_photo_profil_decidee on public.club_members;
create trigger trg_photo_profil_decidee
  before update on public.club_members
  for each row execute function public.photo_profil_decidee_par_la_personne();

commit;
