-- v385 — LA PHOTO ATTEND L'ACCORD, ELLE NE LE DEVANCE PAS (01/10/2026)
--
-- Fouka : « quand les parents vont créer le compte, il y aura déjà le nom, prénom de l'enfant, ils
-- vont dire c'est bien mon enfant, et boum, il y a déjà les photos. Ils auront juste à valider
-- l'autorisation d'image. »
--
-- ═══ LA RÈGLE QUI COMMANDE TOUT ════════════════════════════════════════════════════════════════
--
-- ON STOCKE LA PHOTO. ON NE CALCULE PAS L'EMPREINTE AVANT L'ACCORD.
--
-- Une photo est une photo. `visages_reference.empreinte` est un gabarit biométrique : sur un mineur,
-- il ne se calcule qu'APRÈS l'accord du titulaire de l'autorité parentale. La chaîne est donc :
-- fiche créée avec sa photo → le parent reconnaît son enfant et donne l'accord → à ce moment
-- seulement l'empreinte se calcule.
--
-- ═══ CE QUE LA BASE FAISAIT DÉJÀ, ET POURQUOI ÇA BLOQUAIT ══════════════════════════════════════
--
-- Mesuré avant d'écrire. L'ordre est DÉJÀ tenu, et bien tenu — trois verrous indépendants :
--
--   1. `player_face_refs.consentement_id` est NOT NULL et référence `consentements_biometrie`.
--   2. `trg_verifier_consentement_face_ref` refuse (42501) toute ligne dont l'accord n'est pas
--      `accorde` POUR CET ENFANT.
--   3. la policy de stockage `sv_media_prive_visages_insert` exige, pour écrire sous
--      `visages/<player_id>/`, d'être parent confirmé ou le sportif lui-même ET d'avoir un accord
--      actif. Mesuré : même l'administration ne peut pas y déposer un fichier.
--
-- Conséquence directe : AUJOURD'HUI, DÉPOSER LA PHOTO D'AVANCE EST IMPOSSIBLE. Et on ne va surtout
-- pas desserrer ces trois verrous — c'est la bonne configuration pour de la biométrie de mineur.
--
-- ═══ CE QU'ON FAIT À LA PLACE ══════════════════════════════════════════════════════════════════
--
-- Une table d'attente, SÉPARÉE, que la chaîne de reconnaissance ne lit nulle part. Ce n'est pas un
-- drapeau sur `player_face_refs` : c'est une autre table, et c'est la différence entre une garantie
-- et une intention. `reconnaissance_joueurs_prets` ne connaît que `player_face_refs` ; une photo en
-- attente est donc, pour le moteur, inexistante — pas « ignorée ».
--
-- Le jour où l'accord arrive, la photo PASSE dans `player_face_refs`, le trigger existant la met en
-- file, et le moteur calcule l'empreinte. Rien à changer dans le moteur : il est déjà derrière la
-- porte, et cette migration ne la déplace pas.
--
-- ═══ POURQUOI PAS `player_profiles.photo_url` ══════════════════════════════════════════════════
--
-- Parce que ce champ est public. Mesuré dans Connect (AthleteDetailView) : la photo que le PARENT
-- pose part dans le seau `portail-media`, qui est public, et `photo_url` reçoit son adresse
-- publique. Un parent qui publie la photo de son enfant le décide pour lui-même. Un club qui verse
-- 27 catégories de portraits de mineurs dans un seau public ne décide pas pour lui.
--
-- La photo que le club dépose va donc dans `sportvision-media-prive`, sous un préfixe à elle,
-- `effectif/<player_id>/`, avec sa propre règle. Le préfixe `visages/` et sa policy ne bougent pas
-- d'une ligne.

begin;

-- ═══ 1. LA TABLE D'ATTENTE ═════════════════════════════════════════════════════════════════════

create table if not exists public.photos_reference_attente (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete set null,
  storage_bucket text not null default 'sportvision-media-prive',
  storage_path text not null,
  deposee_par uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- La photo promue n'est pas effacée d'ici : on garde la trace de qui l'avait déposée et quand
  -- elle est devenue une référence. Sans ça, plus personne ne sait d'où vient une empreinte.
  promue_le timestamptz,
  face_ref_id uuid references public.player_face_refs(id) on delete set null,
  refusee_le timestamptz,
  refusee_par uuid references auth.users(id) on delete set null
);

create unique index if not exists photos_attente_un_fichier_par_sportif
  on public.photos_reference_attente (player_id, storage_path);
create index if not exists photos_attente_par_sportif
  on public.photos_reference_attente (player_id) where promue_le is null and refusee_le is null;

alter table public.photos_reference_attente enable row level security;

-- AUCUNE POLICY. Comme `visages_reference`. Tout passe par les fonctions ci-dessous, qui disent
-- chacune QUI elles refusent. Une table qui contient des photos de mineurs n'a pas de porte
-- d'entrée directe.

-- ═══ 2. QUI PEUT DÉPOSER, QUI PEUT VOIR ════════════════════════════════════════════════════════

create or replace function public.peut_deposer_photo_effectif(p_player_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  -- Exactement la même autorité que pour créer la fiche : celui qui a le droit d'inscrire l'enfant
  -- a le droit de joindre sa photo. Le coach reste borné à SES équipes, par `is_team_educateur`.
  select exists (
    select 1 from player_profiles pp
     where pp.id = p_player_id
       and coalesce(pp.account_status, 'actif') not in ('retire', 'suspendu')
       and (
         public.est_direction_sportvision()
         or public.peut_operer_club(pp.club_id)
         or exists (
           select 1 from team_memberships tm
            where tm.player_id = pp.id and tm.statut = 'active'
              and public.is_team_educateur(tm.team_id)
         )
       )
  );
$$;

create or replace function public.peut_voir_photo_effectif(p_player_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  -- Le club qui l'a déposée, et la FAMILLE — parce que c'est à elle qu'on demande « c'est bien
  -- votre enfant ? » : sans voir la photo, elle ne peut pas répondre, et un accord donné sans voir
  -- ce sur quoi il porte n'est pas un accord.
  select public.peut_deposer_photo_effectif(p_player_id)
      or public.is_confirmed_parent_of(p_player_id)
      or public.is_own_player(p_player_id);
$$;

-- ═══ 3. DÉPOSER ════════════════════════════════════════════════════════════════════════════════

create or replace function public.effectif_deposer_photo(p_player_id uuid, p_storage_path text)
returns uuid
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_id uuid; v_club uuid; v_combien integer;
begin
  if not public.peut_deposer_photo_effectif(p_player_id) then
    raise exception 'Vous ne pouvez pas déposer la photo de ce sportif.' using errcode = '42501';
  end if;
  -- LE CHEMIN EST VÉRIFIÉ, pas accepté sur parole : sans ce contrôle on rattacherait à un enfant
  -- un fichier déposé ailleurs, y compris la photo d'un autre.
  if p_storage_path is null
     or p_storage_path not like 'effectif/' || p_player_id::text || '/%' then
    raise exception 'Chemin de photo invalide : attendu effectif/<identifiant du sportif>/<fichier>.'
      using errcode = '22023';
  end if;

  select pp.club_id into v_club from player_profiles pp where pp.id = p_player_id;

  -- Reposer le MÊME fichier ne crée pas de doublon : on réappuie sur le bouton, rien ne change.
  select a.id into v_id from photos_reference_attente a
   where a.player_id = p_player_id and a.storage_path = p_storage_path;
  if v_id is not null then
    return v_id;
  end if;

  -- CINQ AU PLUS, la même limite que pour les photos de référence d'une famille
  -- (`enregistrer_photo_reference`). Au-delà, un angle de plus n'apprend rien et on accumulerait
  -- des portraits de mineurs sans contrepartie.
  select count(*) into v_combien from photos_reference_attente a
   where a.player_id = p_player_id and a.refusee_le is null;
  if v_combien >= 5 then
    raise exception 'Cinq photos suffisent pour ce sportif. Retirez-en une avant d''en ajouter une autre.'
      using errcode = '22023';
  end if;

  insert into photos_reference_attente (player_id, club_id, storage_path, deposee_par)
  values (p_player_id, v_club, p_storage_path, auth.uid())
  returning id into v_id;

  -- L'accord est peut-être DÉJÀ là (une famille inscrite depuis longtemps). Dans ce cas la photo ne
  -- stationne pas : elle passe tout de suite. Sinon, cet appel ne fait rien.
  perform public.photos_attente_promouvoir(p_player_id);
  return v_id;
end $$;

-- ═══ 4. VOIR, ET RETIRER ═══════════════════════════════════════════════════════════════════════

create or replace function public.photos_effectif_du_sportif(p_player_id uuid)
returns table(id uuid, storage_bucket text, storage_path text, created_at timestamptz,
              promue boolean, refusee boolean)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select a.id, a.storage_bucket, a.storage_path, a.created_at,
         a.promue_le is not null, a.refusee_le is not null
    from photos_reference_attente a
   where a.player_id = p_player_id
     and public.peut_voir_photo_effectif(p_player_id)
   order by a.created_at;
$$;

create or replace function public.effectif_refuser_photo(p_id uuid)
returns boolean
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_a photos_reference_attente;
begin
  select * into v_a from photos_reference_attente where id = p_id;
  if not found then return false; end if;
  -- Le club peut retirer la sienne ; la FAMILLE aussi, et sans rien demander. On dépose la photo
  -- sans qu'elle ait rien demandé : le geste de retrait doit être au moins aussi simple.
  if not public.peut_voir_photo_effectif(v_a.player_id) then
    raise exception 'Vous ne pouvez pas retirer la photo de ce sportif.' using errcode = '42501';
  end if;
  if v_a.refusee_le is not null then return true; end if;

  update photos_reference_attente
     set refusee_le = now(), refusee_par = auth.uid()
   where id = p_id;

  -- LE FICHIER PART POUR DE BON. Marquer la ligne ne supprime pas l'octet : c'est la file de purge
  -- qui le fait, celle que la biométrie utilise déjà.
  insert into biometrie_a_purger (player_id, storage_bucket, storage_path, motif)
  values (v_a.player_id, v_a.storage_bucket, v_a.storage_path, 'photo_effectif_retiree');

  -- Déjà promue : l'empreinte s'en va avec, par la cascade de `player_face_refs`.
  if v_a.face_ref_id is not null then
    delete from player_face_refs where id = v_a.face_ref_id;
  end if;
  return true;
end $$;

-- ═══ 5. LA PROMOTION : LE SEUL ENDROIT OÙ UNE PHOTO DEVIENT UNE RÉFÉRENCE ══════════════════════

create or replace function public.photos_attente_promouvoir(p_player_id uuid)
returns integer
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_consent uuid; v_deja integer; v_n integer := 0; a record; v_ref uuid;
begin
  -- SANS ACCORD ACTIF, CETTE FONCTION NE FAIT RIEN. C'est son seul garde-fou, et il suffit : elle
  -- n'ouvre aucun droit, elle déplace une photo d'un côté à l'autre d'une porte que quelqu'un vient
  -- d'ouvrir.
  select c.id into v_consent from consentements_biometrie c
   where c.player_id = p_player_id and c.statut = 'accorde'
   order by c.accorde_le desc limit 1;
  if v_consent is null then return 0; end if;

  select count(*) into v_deja from player_face_refs where consentement_id = v_consent;

  for a in select * from photos_reference_attente
            where player_id = p_player_id and promue_le is null and refusee_le is null
            order by created_at
  loop
    exit when v_deja >= 5;   -- même plafond que partout ailleurs
    insert into player_face_refs (player_id, consentement_id, moteur, storage_bucket, storage_path,
                                  created_by)
    values (a.player_id, v_consent, 'en_attente', a.storage_bucket, a.storage_path, a.deposee_par)
    returning id into v_ref;
    -- Le trigger `trg_reconnaissance_photo_reference` vient de mettre ce sportif en file. C'est le
    -- moteur, et lui seul, qui calculera l'empreinte — après cet accord, jamais avant.
    update photos_reference_attente set promue_le = now(), face_ref_id = v_ref where id = a.id;
    v_deja := v_deja + 1;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- L'accord arrive : les photos en attente passent. Par un trigger, pour que ce soit vrai quel que
-- soit le chemin qui a créé l'accord — la fonction `donner_consentement_biometrie`, mais aussi la
-- policy `cb_donner`, qui permet une insertion directe.
create or replace function public.promouvoir_photos_a_l_accord()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
begin
  if new.statut = 'accorde' then
    perform public.photos_attente_promouvoir(new.player_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_promouvoir_photos_a_l_accord on public.consentements_biometrie;
create trigger trg_promouvoir_photos_a_l_accord
  after insert on public.consentements_biometrie
  for each row execute function public.promouvoir_photos_a_l_accord();

-- ═══ 6. L'ACCORD RETIRÉ EMPORTE AUSSI CE QUI ATTENDAIT ═════════════════════════════════════════
-- `effacer_biometrie_au_retrait` effaçait les photos de référence et les marquages proposés. Il lui
-- manquait la file d'attente : une famille qui retire son accord verrait sinon les photos que le
-- club avait déposées revenir en référence au prochain accord, sans qu'elle en redécide.

create or replace function public.effacer_biometrie_au_retrait()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
begin
  if new.statut = 'retire' and coalesce(old.statut, '') <> 'retire' then
    new.retire_le := coalesce(new.retire_le, now());
    new.retire_par := coalesce(new.retire_par, auth.uid());
    insert into biometrie_a_purger (player_id, storage_bucket, storage_path)
    select r.player_id, r.storage_bucket, r.storage_path
      from player_face_refs r
     where r.consentement_id = new.id and r.storage_path is not null;
    delete from player_face_refs r where r.consentement_id = new.id;
    delete from media_player_tags t where t.player_id = new.player_id and t.statut = 'propose';

    -- v385 : ce que le club avait déposé part aussi. Retirer son accord, c'est tout retirer.
    insert into biometrie_a_purger (player_id, storage_bucket, storage_path, motif)
    select a.player_id, a.storage_bucket, a.storage_path, 'accord_retire'
      from photos_reference_attente a
     where a.player_id = new.player_id and a.refusee_le is null;
    update photos_reference_attente a
       set refusee_le = now(), refusee_par = coalesce(new.retire_par, auth.uid())
     where a.player_id = new.player_id and a.refusee_le is null;
  end if;
  return new;
end $$;

-- ═══ 7. LE STOCKAGE ════════════════════════════════════════════════════════════════════════════
-- Un préfixe à part, `effectif/<player_id>/`, avec sa règle à lui. `visages/` et ses trois policies
-- ne changent pas : une photo déposée par une famille après son accord suit le chemin d'avant.

drop policy if exists sv_media_prive_effectif_insert on storage.objects;
create policy sv_media_prive_effectif_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'effectif'
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    and public.peut_deposer_photo_effectif(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists sv_media_prive_effectif_select on storage.objects;
create policy sv_media_prive_effectif_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'effectif'
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    and public.peut_voir_photo_effectif(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists sv_media_prive_effectif_delete on storage.objects;
create policy sv_media_prive_effectif_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'effectif'
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    and (public.peut_voir_photo_effectif(((storage.foldername(name))[2])::uuid)
         or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin'))
  );

revoke all on function public.effectif_deposer_photo(uuid, text) from public, anon;
revoke all on function public.effectif_refuser_photo(uuid) from public, anon;
revoke all on function public.photos_effectif_du_sportif(uuid) from public, anon;
grant execute on function public.effectif_deposer_photo(uuid, text) to authenticated;
grant execute on function public.effectif_refuser_photo(uuid) to authenticated;
grant execute on function public.photos_effectif_du_sportif(uuid) to authenticated;

-- ═══ UNE FONCTION DE POLICY NE SE REVOKE PAS ═══════════════════════════════════════════════════
-- Leçon du 12/09, retrouvée ici au premier passage de la suite de tests : une policy s'évalue avec
-- les DROITS DU LECTEUR. Retirer `public` de l'EXECUTE d'une fonction appelée par une policy ne
-- borne rien : elle fait ÉCHOUER la lecture (« permission denied for function ») au lieu de rendre
-- faux. Mesuré : `multiclub-cloisonnement` est passé de vert à cassé.
--
-- Toutes les fonctions de policy de cette base gardent donc `=X` : `peut_operer_club`,
-- `is_club_admin`, `is_team_educateur`, `is_confirmed_parent_of`, `compte_os_desactive`. Les
-- fonctions ci-dessous sont dans ce cas, et le restent. Le revoke ne vaut que pour les fonctions
-- d'ACTION, que personne n'évalue à la place de quelqu'un d'autre.
-- Les deux ci-dessous sont évaluées par les policies de `storage.objects`.
grant execute on function public.peut_deposer_photo_effectif(uuid) to public;
grant execute on function public.peut_voir_photo_effectif(uuid) to public;

-- La promotion n'est PAS appelable depuis une application : elle ne se déclenche que par le trigger
-- de l'accord, ou depuis le dépôt. Personne ne doit pouvoir la provoquer.
revoke all on function public.photos_attente_promouvoir(uuid) from public, anon, authenticated;

comment on table public.photos_reference_attente is
  'Photos de référence déposées par le club AVANT l''accord de la famille. Aucune policy : tout '
  'passe par les fonctions. La chaîne de reconnaissance ne lit jamais cette table — une photo n''y '
  'est pas « ignorée », elle y est invisible. Elle passe dans player_face_refs au moment de '
  'l''accord, et l''empreinte se calcule après, jamais avant.';

commit;
