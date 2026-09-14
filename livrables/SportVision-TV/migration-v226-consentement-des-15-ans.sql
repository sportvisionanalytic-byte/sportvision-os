-- v226 — Un joueur de 15 ans et plus donne lui-même son accord biométrique (14/09/2026).
--
-- LA DEMANDE ET SA RAISON. Fouka : « il faut qu'un enfant même sans son parent puisse faire le
-- consentement biométrique ». Le problème réel qu'il vise : un mineur inscrit seul, sans parent
-- rattaché, ne pouvait pas activer la reconnaissance. Ses photos restaient non identifiées, donc
-- invisibles pour lui, donc jamais achetées. L'ouverture des comptes aux mineurs (v217) créait
-- mécaniquement ce cas.
--
-- LA RÉSERVE QUE J'AI POSÉE, ET CE QUI A ÉTÉ DÉCIDÉ. Ici, le consentement n'est pas une formalité :
-- c'est la BASE LÉGALE du traitement. Une donnée biométrique de mineur ne peut être traitée que sur
-- consentement explicite (RGPD, article 9.2.a) ; s'il n'est pas valable, tout le dispositif devient
-- illicite, pas seulement une case. Ouvrir à un enfant de 8 ans aurait été le scénario le plus
-- fragile qui soit.
--
-- Fouka a retenu le seuil de QUINZE ANS. C'est celui que le droit français fixe pour qu'un mineur
-- consente seul à un service en ligne (article 8 du RGPD, transposé à 15 ans par l'article 45 de la
-- loi Informatique et Libertés). Ce n'est pas une garantie absolue pour des données sensibles, mais
-- c'est un seuil existant, écrit, et défendable devant un juriste — au lieu d'un choix arbitraire.
--
-- CE QUE ÇA CHANGE :
--   • 18 ans et plus : inchangé, il consent seul (qualité `joueur_majeur`).
--   • 15 à 17 ans : il consent seul (nouvelle qualité `joueur_15_17`, tracée comme telle pour qu'on
--     sache toujours QUI a accordé quoi, et à quel titre).
--   • Moins de 15 ans : le titulaire de l'autorité parentale, comme avant. Le message le dit et
--     invite à rattacher un parent, au lieu de renvoyer un refus sec.
--
-- Le dépôt de la photo de référence suit la même règle : consentir sans pouvoir déposer la photo
-- n'aurait servi à rien.
--
-- Le RETRAIT ne bouge pas : il reste ouvert au joueur lui-même à tout âge, et au parent. On ne met
-- jamais d'obstacle devant quelqu'un qui veut faire effacer ses données.
--
-- Idempotente.

alter table consentements_biometrie drop constraint if exists consentements_biometrie_qualite_check;
alter table consentements_biometrie
  add constraint consentements_biometrie_qualite_check
  check (qualite in ('parent', 'tuteur', 'joueur_majeur', 'joueur_15_17'));

-- Quinze ans révolus, calculés à Paris comme partout ailleurs.
create or replace function public.joueur_15_ans_ou_plus(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from player_profiles p
                  where p.id = p_player_id and p.date_naissance is not null
                    and p.date_naissance <= (now() at time zone 'Europe/Paris')::date - interval '15 years');
$$;

comment on function public.joueur_15_ans_ou_plus(uuid) is
  'v226 — Quinze ans révolus : le seuil français du consentement numérique autonome.';

create or replace function public.donner_consentement_biometrie(p_player_id uuid, p_texte_version text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_id uuid; v_qualite text; v_club uuid; v_saison uuid;
begin
  if coalesce(btrim(p_texte_version), '') = '' then
    raise exception 'La version du texte accepté est obligatoire : sans elle, on ne sait pas ce qui a été accepté.' using errcode = '22023';
  end if;

  if is_own_player(p_player_id) and joueur_majeur(p_player_id) then
    v_qualite := 'joueur_majeur';
  elsif is_own_player(p_player_id) and joueur_15_ans_ou_plus(p_player_id) then
    -- 15 à 17 ans : il consent seul, et on garde la trace de ce titre-là. Le jour où le seuil est
    -- contesté, il faut pouvoir dire quels accords reposent dessus.
    v_qualite := 'joueur_15_17';
  elsif is_confirmed_parent_of(p_player_id) then
    v_qualite := 'parent';
  elsif is_own_player(p_player_id) then
    raise exception 'Avant 15 ans, cet accord doit être donné par un parent. Invitez le vôtre depuis votre espace : il pourra l''accorder en un clic.' using errcode = '42501';
  else
    raise exception 'Seul le titulaire de l''autorité parentale confirmé, ou le joueur de 15 ans et plus, peut donner cet accord.' using errcode = '42501';
  end if;

  select id into v_id from consentements_biometrie
   where player_id = p_player_id and statut = 'accorde' order by accorde_le desc limit 1;
  if found then return v_id; end if;

  select club_id into v_club from player_profiles where id = p_player_id;
  select id into v_saison from saisons where active order by date_debut desc limit 1;
  insert into consentements_biometrie (player_id, club_id, saison_id, donne_par, qualite, texte_version)
  values (p_player_id, v_club, v_saison, auth.uid(), v_qualite, btrim(p_texte_version))
  returning id into v_id;
  return v_id;
end $$;

comment on function public.donner_consentement_biometrie(uuid, text) is
  'v226 — Accord biométrique : le joueur seul à partir de 15 ans, un parent confirmé en dessous.';

-- Le dépôt de la photo de référence suit la même règle.
create or replace function public.enregistrer_photo_reference(p_player_id uuid, p_storage_path text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_consent uuid; v_id uuid;
begin
  if not (is_confirmed_parent_of(p_player_id)
          or (is_own_player(p_player_id) and joueur_15_ans_ou_plus(p_player_id))) then
    raise exception 'Seul le titulaire de l''autorité parentale, ou le joueur de 15 ans et plus, peut déposer cette photo.' using errcode = '42501';
  end if;
  if p_storage_path is null or p_storage_path not like 'visages/' || p_player_id::text || '/%' then
    raise exception 'Chemin de photo invalide.' using errcode = '22023';
  end if;
  select id into v_consent from consentements_biometrie
   where player_id = p_player_id and statut = 'accorde' order by accorde_le desc limit 1;
  if not found then
    raise exception 'Aucun accord actif : la photo ne peut pas être enregistrée.' using errcode = '42501';
  end if;
  insert into biometrie_a_purger (player_id, storage_bucket, storage_path, motif)
  select r.player_id, r.storage_bucket, r.storage_path, 'photo_remplacee'
    from player_face_refs r where r.consentement_id = v_consent and r.storage_path is not null
      and r.storage_path is distinct from p_storage_path;
  delete from player_face_refs where consentement_id = v_consent;
  insert into player_face_refs (player_id, consentement_id, moteur, storage_bucket, storage_path, created_by)
  values (p_player_id, v_consent, 'en_attente', 'sportvision-media-prive', p_storage_path, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
