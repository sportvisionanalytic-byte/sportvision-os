-- P1 audit transversal (04-05/09/2026, finding C1b) : 2 fiches clients avec nom+ville
-- identiques faisaient créer 2 lignes clubs totalement distinctes au provisioning, rien
-- ne recherchait de club canonique existant avant création. Décision Fouka (05/09) :
-- empêcher les doublons évidents via un identifiant fort quand il existe (SIRET),
-- détection + confirmation pour les correspondances faibles (nom), jamais d'auto-fusion
-- silencieuse. Audit préalable (05/09) : 0 club avec portail_client_id dupliqué,
-- 0 club avec siret dupliqué (colonne existante mais 0/5 clubs renseignés), clients
-- n'a aucune colonne siret — donc aucune contrainte existante ne casse de ligne historique.

alter table clients add column if not exists siret text;
comment on column clients.siret is
  'Identifiant SIRET du client, saisi à la création (facultatif). Utilisé pour la '
  'détection de doublon de club canonique (find_duplicate_club_candidates), voir '
  'migration-dedup-club-canonique.sql (audit 04-05/09/2026).';

-- Normalisation pour comparaison uniquement (jamais stockée) : minuscules, sans accents,
-- ponctuation neutralisée en espace, espaces superflus retirés. Ne retire pas les mots de
-- forme juridique (FC, Association, etc.) : risque de faux positif jugé trop élevé par
-- Fouka pour un premier jet, laissé tel quel.
create or replace function normalize_org_text(p text)
returns text
language sql
immutable
set search_path = 'public'
as $$
  select trim(regexp_replace(lower(public.unaccent(coalesce(p, ''))), '[^a-z0-9]+', ' ', 'g'));
$$;

-- SIRET : un identifiant est un numéro, l'espacement (123 456 789 00012 vs 12345678900012)
-- est purement cosmétique et ne doit jamais faire manquer une correspondance forte —
-- contrairement à normalize_org_text (noms), qui garde les espaces comme séparateurs de mots.
create or replace function normalize_siret(p text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '');
$$;

-- Recherche de club canonique existant avant toute création. 'forte' = SIRET normalisé
-- identique (jamais de faux positif crédible). 'possible' = nom normalisé identique, à
-- confirmer par un humain, jamais suffisant seul pour réutiliser ou fusionner.
create or replace function find_duplicate_club_candidates(
  p_siret text,
  p_nom text,
  p_exclude_client_id uuid default null
)
returns table (
  club_id uuid,
  club_nom text,
  club_siret text,
  club_portail_client_id uuid,
  match_strength text
)
language sql
stable
security definer
set search_path = 'public'
as $$
  select c.id, c.nom, c.siret, c.portail_client_id, 'forte'::text
  from clubs c
  where p_siret is not null and trim(p_siret) <> ''
    and c.siret is not null and trim(c.siret) <> ''
    and normalize_siret(c.siret) = normalize_siret(p_siret)
    and (p_exclude_client_id is null or c.portail_client_id is distinct from p_exclude_client_id)
  union all
  select c.id, c.nom, c.siret, c.portail_client_id, 'possible'::text
  from clubs c
  where p_nom is not null and trim(p_nom) <> ''
    and normalize_org_text(c.nom) = normalize_org_text(p_nom)
    and (p_exclude_client_id is null or c.portail_client_id is distinct from p_exclude_client_id)
    and not (
      p_siret is not null and trim(p_siret) <> ''
      and c.siret is not null and trim(c.siret) <> ''
      and normalize_siret(c.siret) = normalize_siret(p_siret)
    )
  order by 5 asc
  limit 5;
$$;

revoke all on function find_duplicate_club_candidates(text, text, uuid) from public;
grant execute on function find_duplicate_club_candidates(text, text, uuid) to authenticated;

-- Défense en profondeur : plus jamais 2 clubs pour le même client Full Com (0 violation
-- aujourd'hui, cf. audit préalable), au-delà de la garde applicative déjà en place.
create unique index if not exists clubs_portail_client_id_uniq
  on clubs (portail_client_id) where portail_client_id is not null;

-- Idem sur le SIRET une fois renseigné (0 valeur aujourd'hui, sûr à poser maintenant).
create unique index if not exists clubs_siret_norm_uniq
  on clubs (normalize_siret(siret)) where siret is not null and trim(siret) <> '';

-- Provisioning : cherche un club canonique avant de créer. Correspondance forte (SIRET)
-- réutilisée automatiquement (item 14, confiance suffisante). Correspondance possible
-- (nom seul) : jamais réutilisée ni fusionnée automatiquement — la fonction refuse de
-- créer silencieusement (item 15), p_confirm_create doit être explicitement vrai pour
-- forcer la création malgré le doublon possible (même geste que "Créer quand même" côté
-- création client).
-- CREATE OR REPLACE ne remplace pas une fonction dont la signature change (paramètre
-- ajouté) : sans ce DROP, l'ancienne version à 1 argument resterait en double, ambiguë
-- pour PostgREST.
drop function if exists provisionner_club_plus_full_com(uuid);

create or replace function provisionner_club_plus_full_com(p_client_id uuid, p_confirm_create boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_staff boolean;
  v_club_id uuid;
  v_client_nom text;
  v_client_siret text;
  v_contrat_id uuid;
  v_dup record;
begin
  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'sec')
  ) into v_is_staff;
  if not v_is_staff then
    raise exception 'Accès refusé : seul le staff SportVision peut provisionner un espace Club+.';
  end if;

  -- Idempotent : un club existe déjà pour ce client (provisionné ici, créé via
  -- un lien d'activation manuel, ou tout autre chemin passé) → ne rien recréer.
  select id into v_club_id from clubs where portail_client_id = p_client_id limit 1;
  if v_club_id is not null then
    return v_club_id;
  end if;

  select nom, siret into v_client_nom, v_client_siret from clients where id = p_client_id;
  if v_client_nom is null then
    raise exception 'Client introuvable.';
  end if;

  select * into v_dup from find_duplicate_club_candidates(v_client_siret, v_client_nom, p_client_id)
    order by (match_strength = 'forte') desc limit 1;

  if v_dup.club_id is not null and v_dup.match_strength = 'forte' then
    -- Correspondance forte : réutilise le club existant, ne crée jamais de doublon.
    update clubs set portail_client_id = p_client_id, club_plus_source = 'full_com_included'
      where id = v_dup.club_id;
    v_club_id := v_dup.club_id;
  elsif v_dup.club_id is not null and v_dup.match_strength = 'possible' and not p_confirm_create then
    raise exception 'club_duplicate_possible: % (club_id=%)', v_dup.club_nom, v_dup.club_id;
  else
    insert into clubs (nom, portail_client_id, plan, pilot_mode, credits_monthly, credits_balance, club_plus_source)
    values (v_client_nom, p_client_id, 'free', true, 0, 0, 'full_com_included')
    returning id into v_club_id;
    -- trg_sync_club_to_organization (AFTER INSERT ON clubs, déjà en place) crée
    -- automatiquement la ligne organizations correspondante à ce point, dans la
    -- même transaction, avant la suite de cette fonction.
  end if;

  -- Best-effort : rattache l'entitlement à un contrat Full Com actif déjà
  -- existant pour ce client, s'il y en a un (cas le plus fréquent : le contrat
  -- est déjà 'actif' quand lancerCascadeFullCom() est déclenchée). Sinon NULL
  -- — grant_entitlements_full_communication() l'accepte, et le trigger sur
  -- contrats mettra à jour source_contrat_id plus tard si besoin.
  select id into v_contrat_id from contrats
    where client_id = p_client_id and type_contrat = 'full_communication' and statut = 'actif'
    order by created_at desc
    limit 1;

  perform grant_entitlements_full_communication(v_club_id, v_contrat_id);

  return v_club_id;
end;
$function$;
