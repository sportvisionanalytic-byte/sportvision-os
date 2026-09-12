-- v189 — Le code d'équipe devient un vrai secret (12/09/2026).
--
-- CE QUI N'ALLAIT PAS. Le code s'écrivait 'SV-' || catégorie || '-' || 4 chiffres tirés par
-- random() : environ 13 bits. Les préfixes sont devinables (U6…U19, SENIORS, FEMININES, CLUB), et
-- `preview_invite_code` est ouverte à `anon` en distinguant introuvable / inactif / expiré /
-- épuisé d'un code valide. Toute la plateforme était donc énumérable depuis un navigateur, sans
-- compte : 10 000 appels par préfixe rendaient la liste des codes actifs, avec le nom du club et
-- celui de l'équipe. Deux codes vivaient en production, tous deux sans expiration ni plafond.
--
-- Ce n'était qu'une faiblesse tant qu'un humain validait l'adhésion. Depuis la v186 (hier),
-- rejoindre PAR CODE se valide tout seul, à dessein : « le coach a donné le code, c'est son
-- accord ». Ce raisonnement n'est vrai que si le code est un secret. Deviner un code, c'était
-- entrer dans un club sans qu'aucun humain ne s'en aperçoive.
--
-- CE QUE FAIT CETTE MIGRATION.
--   1. Un code tiré cryptographiquement : 10 caractères sur un alphabet de 31, soit ~49 bits.
--      L'alphabet exclut I, L, O, 0 et 1, qu'on confond en dictant un code au téléphone.
--   2. L'aperçu public ne répond plus en rafale : au-delà de 20 essais par quart d'heure et par
--      appelant non authentifié, il refuse. L'énumération n'est plus possible même si l'entropie
--      venait à baisser un jour.
--   3. Les deux codes existants sont refaits : l'ancien espace a pu être parcouru. Les deux
--      avaient uses_count = 0, personne ne les avait encore utilisés.
--
-- Ce qui n'est PAS fait ici volontairement : imposer une expiration ou un plafond d'usages par
-- défaut. Un code de saison partagé dans un groupe de messagerie doit continuer de fonctionner ;
-- avec 49 bits, l'expiration n'est plus la protection principale. Les deux réglages restent
-- disponibles par code, à la main du club.
-- Idempotente.

-- ─── 1. Un code réellement imprévisible ──────────────────────────────────────
create or replace function public.generate_team_invite_code(p_team_id uuid)
returns text
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  -- 31 caractères, sans I L O 0 1 (confusions à l'oral et à la lecture).
  v_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  v_i int;
  v_tries int := 0;
begin
  loop
    v_code := 'SV-';
    for v_i in 1..10 loop
      v_code := v_code || substr(v_alpha,
        1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(v_alpha)), 1);
      if v_i = 5 then v_code := v_code || '-'; end if;
    end loop;
    exit when not exists (select 1 from team_invite_codes where code = v_code);
    v_tries := v_tries + 1;
    if v_tries > 20 then raise exception 'Impossible de générer un code unique, réessayez'; end if;
  end loop;
  return v_code;
end;
$function$;

-- ─── 2. L'aperçu public ne se laisse plus parcourir ──────────────────────────
-- La fonction cesse d'être STABLE : elle écrit désormais une trace de débit.
create or replace function public.preview_invite_code(p_code text)
returns table(valide boolean, raison text, club_nom text, team_nom text, saison text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row team_invite_codes;
  v_ip text;
begin
  -- Seul un appelant NON authentifié est limité : un membre connecté qui cherche son équipe n'a
  -- pas à être bridé, et il est identifiable. L'adresse vient de l'en-tête transmis par PostgREST ;
  -- quand elle manque (appel interne, tâche planifiée), on ne limite pas plutôt que de bloquer.
  if auth.uid() is null then
    begin
      v_ip := coalesce(
        split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1),
        current_setting('request.headers', true)::json ->> 'cf-connecting-ip');
    exception when others then v_ip := null;
    end;
    if v_ip is not null and v_ip <> '' then
      if not check_and_record_rate_limit('preview_invite_code:' || v_ip, 20, 900) then
        return query select false, 'trop_d_essais', null::text, null::text, null::text;
        return;
      end if;
    end if;
  end if;

  select * into v_row from team_invite_codes where code = upper(trim(p_code));
  if v_row.id is null then
    return query select false, 'introuvable', null::text, null::text, null::text;
    return;
  end if;
  if not v_row.actif then
    return query select false, 'inactif', null::text, null::text, null::text;
    return;
  end if;
  if v_row.expire_at is not null and v_row.expire_at < now() then
    return query select false, 'expire', null::text, null::text, null::text;
    return;
  end if;
  if v_row.max_uses is not null and v_row.uses_count >= v_row.max_uses then
    return query select false, 'epuise', null::text, null::text, null::text;
    return;
  end if;

  return query
  select true, null::text, c.nom, t.name, c.saison
  from clubs c
  left join club_teams t on t.id = v_row.team_id
  where c.id = v_row.club_id;
end;
$function$;

grant execute on function public.preview_invite_code(text) to anon, authenticated;

-- ─── 3. Les codes de l'ancien espace sont refaits ────────────────────────────
update team_invite_codes
   set code = generate_team_invite_code(team_id)
 where code ~ '^SV-[A-Z0-9]{1,8}-[0-9]{4}$';
