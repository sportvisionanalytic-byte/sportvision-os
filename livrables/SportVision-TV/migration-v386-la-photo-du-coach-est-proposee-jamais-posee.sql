-- v386 — LA PHOTO DU COACH EST PROPOSÉE, JAMAIS POSÉE (01/10/2026)
--
-- Fouka : « Le coach peut voir les photos de ses enfants. Pour le coach, on lui PROPOSE sa photo de
-- profil, il gère. »
--
-- « Il gère » est la règle entière. On a sa photo, on la lui montre, il dit oui ou il dit non. Une
-- photo de quelqu'un qui apparaît sur son profil sans qu'il l'ait acceptée n'est pas un service
-- rendu, c'est une publication décidée à sa place.
--
-- ═══ CE QUE LA BASE N'AVAIT PAS DU TOUT ════════════════════════════════════════════════════════
--
-- Mesuré avant d'écrire, et c'est net : `club_members` porte `prenom, nom, telephone, teams, fonction`
-- et AUCUNE colonne de photo. Et aucun des 7 membres de club actifs n'a de ligne dans `profiles` —
-- vérifié un par un : `profiles` est la table du personnel SportVision, pas celle des gens du club.
-- Son `avatar_url` ne concerne donc pas un coach.
--
-- Il n'y avait donc ni photo, ni proposition, ni refus. Tout est neuf ici.
--
-- ═══ POURQUOI UNE TABLE DE PROPOSITIONS, ET PAS JUSTE UNE COLONNE ══════════════════════════════
--
-- Parce que `cm_admin_update` et `cm_operateur_update` autorisent le bureau du club et le CM à
-- écrire sur N'IMPORTE QUELLE ligne de `club_members`. Une simple colonne `photo_path` serait donc
-- posable par quelqu'un d'autre que l'intéressé, et la règle de Fouka serait fausse dès le premier
-- écran. La colonne existe, mais son écriture est fermée par le garde-fou de la table : seul le
-- chemin d'acceptation la pose, et il ne s'ouvre que pour la personne concernée.

begin;

-- ═══ 1. LA PHOTO ACCEPTÉE ══════════════════════════════════════════════════════════════════════
-- Dans le seau PRIVÉ, servie par adresse signée. Pas dans `portail-media` : une photo de
-- collaborateur n'a pas à être lisible par qui connaît l'adresse.

alter table public.club_members
  add column if not exists photo_bucket text,
  add column if not exists photo_path text,
  add column if not exists photo_acceptee_le timestamptz;

-- ═══ 2. LES PROPOSITIONS ═══════════════════════════════════════════════════════════════════════

create table if not exists public.photos_profil_proposees (
  id uuid primary key default gen_random_uuid(),
  club_member_id uuid not null references public.club_members(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_bucket text not null default 'sportvision-media-prive',
  storage_path text not null,
  proposee_par uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  statut text not null default 'proposee'
    check (statut in ('proposee', 'acceptee', 'refusee')),
  decide_le timestamptz,
  commentaire text
);

create unique index if not exists photos_profil_un_fichier_par_personne
  on public.photos_profil_proposees (user_id, storage_path);
create index if not exists photos_profil_en_attente
  on public.photos_profil_proposees (user_id) where statut = 'proposee';

alter table public.photos_profil_proposees enable row level security;

-- Aucune policy : tout passe par les fonctions, qui disent chacune qui elles refusent.

-- ═══ 3. QUI PROPOSE, QUI VOIT ══════════════════════════════════════════════════════════════════

create or replace function public.peut_proposer_photo_profil(p_club_member_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  -- C'est SportVision qui a pris la photo sur le terrain, et le club qui connaît ses gens. Les deux
  -- peuvent proposer. Personne ne peut accepter à la place de l'intéressé : c'est l'affaire de
  -- `repondre_photo_profil`.
  select exists (
    select 1 from club_members m
     where m.id = p_club_member_id and m.status = 'actif' and m.user_id is not null
       and (public.est_direction_sportvision() or public.peut_operer_club(m.club_id))
  );
$$;

create or replace function public.peut_voir_photo_profil(p_user_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select p_user_id = auth.uid()
      or public.est_direction_sportvision()
      or exists (
        select 1 from club_members m
         where m.user_id = p_user_id and m.status = 'actif'
           and (public.peut_operer_club(m.club_id) or public.is_club_member(m.club_id))
      );
$$;

-- ═══ 4. PROPOSER ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.proposer_photo_profil(p_club_member_id uuid, p_storage_path text,
                                                        p_commentaire text default null)
returns uuid
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_m club_members; v_id uuid; v_en_attente integer;
begin
  select * into v_m from club_members where id = p_club_member_id;
  if not found or v_m.user_id is null then
    raise exception 'Membre introuvable, ou sans compte : il n''y a personne à qui proposer.'
      using errcode = '22023';
  end if;
  if not public.peut_proposer_photo_profil(p_club_member_id) then
    raise exception 'Vous ne pouvez pas proposer de photo à cette personne.' using errcode = '42501';
  end if;
  if p_storage_path is null
     or p_storage_path not like 'profils/' || v_m.user_id::text || '/%' then
    raise exception 'Chemin de photo invalide : attendu profils/<identifiant du compte>/<fichier>.'
      using errcode = '22023';
  end if;

  select id into v_id from photos_profil_proposees
   where user_id = v_m.user_id and storage_path = p_storage_path;
  if v_id is not null then
    return v_id;   -- reproposer le même fichier ne fait rien
  end if;

  -- TROIS PROPOSITIONS EN ATTENTE AU PLUS. Au-delà, ce n'est plus une proposition, c'est une
  -- insistance : la personne ouvre son espace et trouve une pile de photos d'elle à trier.
  select count(*) into v_en_attente from photos_profil_proposees
   where user_id = v_m.user_id and statut = 'proposee';
  if v_en_attente >= 3 then
    raise exception 'Trois propositions en attente suffisent. Attendez sa réponse.' using errcode = '22023';
  end if;

  insert into photos_profil_proposees (club_member_id, club_id, user_id, storage_path, proposee_par,
                                       commentaire)
  values (p_club_member_id, v_m.club_id, v_m.user_id, p_storage_path, auth.uid(),
          nullif(btrim(coalesce(p_commentaire, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

-- ═══ 5. RÉPONDRE — ET C'EST LE SEUL CHEMIN QUI POSE LA PHOTO ════════════════════════════════════

create or replace function public.mes_photos_profil_proposees()
returns table(id uuid, club_id uuid, club text, storage_bucket text, storage_path text,
              commentaire text, created_at timestamptz)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select p.id, p.club_id, c.nom, p.storage_bucket, p.storage_path, p.commentaire, p.created_at
    from photos_profil_proposees p
    join clubs c on c.id = p.club_id
   where p.user_id = auth.uid() and p.statut = 'proposee'
   order by p.created_at;
$$;

create or replace function public.repondre_photo_profil(p_id uuid, p_accepte boolean)
returns boolean
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_p photos_profil_proposees;
begin
  select * into v_p from photos_profil_proposees where id = p_id;
  if not found then return false; end if;
  -- LA PERSONNE CONCERNÉE, ET PERSONNE D'AUTRE. Ni son club, ni SportVision, ni l'administration.
  -- C'est tout l'objet de cette migration.
  if v_p.user_id is distinct from auth.uid() then
    raise exception 'Seule la personne concernée répond à cette proposition.' using errcode = '42501';
  end if;
  if v_p.statut <> 'proposee' then
    return true;   -- déjà tranchée : on ne rejoue pas une décision
  end if;

  if p_accepte then
    update photos_profil_proposees set statut = 'acceptee', decide_le = now() where id = p_id;
    -- Le marqueur dit au garde-fou de la table que l'écriture vient de CE chemin, c'est-à-dire de
    -- la personne elle-même. Il ne vit que le temps de la transaction et aucune autre fonction ne
    -- le pose.
    perform set_config('sv.photo_profil_decidee', 'oui', true);
    update club_members
       set photo_bucket = v_p.storage_bucket, photo_path = v_p.storage_path,
           photo_acceptee_le = now()
     where id = v_p.club_member_id;
  else
    update photos_profil_proposees set statut = 'refusee', decide_le = now() where id = p_id;
    -- UN REFUS EFFACE LE FICHIER. Garder la photo qu'on vient de refuser, c'est n'avoir rien
    -- refusé. L'unicité sur (user_id, storage_path) fait le reste : ce fichier-là ne sera jamais
    -- reproposé.
    insert into biometrie_a_purger (player_id, storage_bucket, storage_path, motif)
    values (null, v_p.storage_bucket, v_p.storage_path, 'photo_profil_refusee');
  end if;
  return true;
end $$;

-- Retirer sa propre photo, à tout moment, sans rien demander.
create or replace function public.retirer_ma_photo_profil(p_club_member_id uuid)
returns boolean
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_m club_members;
begin
  select * into v_m from club_members where id = p_club_member_id;
  if not found or v_m.user_id is distinct from auth.uid() then
    raise exception 'Vous ne pouvez retirer que votre propre photo.' using errcode = '42501';
  end if;
  if v_m.photo_path is null then return true; end if;
  insert into biometrie_a_purger (player_id, storage_bucket, storage_path, motif)
  values (null, v_m.photo_bucket, v_m.photo_path, 'photo_profil_retiree');
  perform set_config('sv.photo_profil_decidee', 'oui', true);
  update club_members set photo_bucket = null, photo_path = null, photo_acceptee_le = null
   where id = p_club_member_id;
  return true;
end $$;

-- ═══ 6. LE GARDE-FOU : LA COLONNE NE S'ÉCRIT QUE PAR CE CHEMIN ═════════════════════════════════
-- On ajoute un contrôle au garde-fou existant de la table, sans toucher aux autres : c'est lui qui
-- décide déjà ce qui se modifie et par qui sur `club_members`. En mettre un second à côté, c'est
-- repartir vers les cinq endroits qui décidaient séparément (leçon du 10/09).

create or replace function public.protect_sensitive_club_member_fields()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  is_os_staff boolean;
  is_this_club_admin boolean;
  is_proprietaire boolean;
  is_self_accepting_own_invitation boolean;
  a_une_invitation_ouverte boolean;
  accepte_une_invitation boolean;
  v_club uuid;
  v_role_privilegie boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  v_club := new.club_id;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'com', 'sec')
  ) into is_os_staff;

  select is_club_admin(v_club) into is_this_club_admin;
  -- `role = 'admin'` strictement : ni le président, ni le CM délégué, ni le super-accès.
  select is_real_club_admin(v_club) into is_proprietaire;

  -- (comptes-clubplus-v1) La personne met à jour SA ligne en acceptant une invitation ouverte qui
  -- lui est adressée sur ce club : le rôle obtenu est le sien (conservé) ou celui de l'invitation.
  accepte_une_invitation := tg_op = 'UPDATE'
    and old.user_id = auth.uid()
    and new.user_id = auth.uid()
    and exists (
      select 1
        from club_invitations ci
        join auth.users u on u.id = auth.uid()
       where ci.club_id = old.club_id
         and lower(ci.email) = lower(u.email)
         and ci.statut in ('preparee', 'envoyee')
         and ci.expire_at > now()
         and (ci.role = new.role or new.role = old.role)
    );

  v_role_privilegie := new.role in ('admin', 'president', 'cm_externe')
                    or (tg_op = 'UPDATE' and old.role in ('admin', 'president', 'cm_externe'));

  if v_role_privilegie and not (is_os_staff or is_proprietaire or accepte_une_invitation) then
    if not (
      tg_op = 'INSERT'
      and new.user_id = auth.uid()
      and exists (
        select 1 from club_invitations ci
        join auth.users u on u.id = auth.uid()
        where ci.club_id = v_club
          and lower(ci.email) = lower(u.email)
          and ci.role = new.role
          and ci.statut in ('preparee', 'envoyee', 'acceptee')
          and ci.expire_at > now() - interval '1 day'
      )
    ) then
      raise exception 'Ce rôle relève de la propriété du club : seul son administrateur peut l''attribuer, le retirer, ou modifier la ligne de qui le porte.';
    end if;
  end if;

  -- v386 : LA PHOTO DE PROFIL EST PROPOSÉE, JAMAIS POSÉE. Même à l'insertion : une ligne créée
  -- avec une photo déjà dedans contournerait toute la mécanique.
  if tg_op = 'INSERT' and new.photo_path is not null
     and coalesce(current_setting('sv.photo_profil_decidee', true), '') <> 'oui' then
    raise exception 'La photo de profil ne se pose pas à la création : elle se propose, et la personne l''accepte.';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.photo_path is distinct from old.photo_path
     and coalesce(current_setting('sv.photo_profil_decidee', true), '') <> 'oui' then
    raise exception 'La photo de profil de cette personne est PROPOSÉE : elle seule peut l''accepter ou la retirer.';
  end if;

  if new.club_id is distinct from old.club_id then
    raise exception 'Modification non autorisée : une adhésion ne se transfère pas d''un club à un autre. Retirez la personne, puis ajoutez-la dans l''autre club.';
  end if;

  if is_this_club_admin and not is_os_staff and old.user_id = auth.uid()
     and (new.status is distinct from 'actif' or new.role is distinct from old.role)
  then
    raise exception 'Un administrateur ne peut pas se retirer ses propres droits d''administration.';
  end if;

  select exists (
    select 1
      from club_invitations ci
      join auth.users u on u.id = auth.uid()
     where ci.club_id = old.club_id
       and lower(ci.email) = lower(u.email)
       and ci.statut in ('preparee', 'envoyee')
       and ci.expire_at > now()
  ) into a_une_invitation_ouverte;

  if not is_os_staff and not is_this_club_admin and not peut_operer_club(old.club_id)
     and new.teams is distinct from old.teams
     and not (old.user_id = auth.uid() and a_une_invitation_ouverte)
  then
    raise exception 'Modification non autorisée : le périmètre d''équipes est fixé par l''administrateur du club.';
  end if;

  is_self_accepting_own_invitation :=
    (auth.uid() = old.user_id
     and old.status = 'invitation'
     and new.status = 'actif'
     and new.role = old.role)
    -- (comptes-clubplus-v1) ou l'acceptation d'une invitation ouverte, statut ramené à « actif ».
    or (accepte_une_invitation and new.status = 'actif');

  if not is_os_staff and not is_this_club_admin and not peut_operer_club(old.club_id)
     and not is_self_accepting_own_invitation then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
    then
      raise exception 'Modification non autorisée : rôle et statut sont réservés à l''administrateur du club ou au staff SportVision.';
    end if;
  end if;

  return new;
end;
$function$;

-- ═══ 7. LE STOCKAGE ════════════════════════════════════════════════════════════════════════════

drop policy if exists sv_media_prive_profils_insert on storage.objects;
create policy sv_media_prive_profils_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'profils'
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    and (
      -- la personne elle-même,
      ((storage.foldername(name))[2])::uuid = auth.uid()
      -- ou quelqu'un qui a le droit de lui proposer une photo dans un de ses clubs.
      or exists (
        select 1 from club_members m
         where m.user_id = ((storage.foldername(name))[2])::uuid and m.status = 'actif'
           and public.peut_proposer_photo_profil(m.id)
      )
    )
  );

drop policy if exists sv_media_prive_profils_select on storage.objects;
create policy sv_media_prive_profils_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'profils'
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    and public.peut_voir_photo_profil(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists sv_media_prive_profils_delete on storage.objects;
create policy sv_media_prive_profils_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'sportvision-media-prive'
    and (storage.foldername(name))[1] = 'profils'
    and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
    and (((storage.foldername(name))[2])::uuid = auth.uid()
         or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'admin'))
  );

revoke all on function public.proposer_photo_profil(uuid, text, text) from public, anon;
revoke all on function public.repondre_photo_profil(uuid, boolean) from public, anon;
revoke all on function public.mes_photos_profil_proposees() from public, anon;
revoke all on function public.retirer_ma_photo_profil(uuid) from public, anon;
grant execute on function public.proposer_photo_profil(uuid, text, text) to authenticated;
grant execute on function public.repondre_photo_profil(uuid, boolean) to authenticated;
grant execute on function public.mes_photos_profil_proposees() to authenticated;
grant execute on function public.retirer_ma_photo_profil(uuid) to authenticated;

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
grant execute on function public.peut_proposer_photo_profil(uuid) to public;
grant execute on function public.peut_voir_photo_profil(uuid) to public;

-- ═══ 8. LES DROITS DE COLONNE ══════════════════════════════════════════════════════════════════
-- MESURÉ, ET C'EST UN PIÈGE. `authenticated` n'a AUCUN droit de lecture sur la table
-- `club_members` : il a des droits de lecture COLONNE PAR COLONNE, sur une liste qui exclut
-- volontairement `telephone` (décision du 11/09 sur les données restreintes d'un club). Une colonne
-- ajoutée par `alter table` hérite donc du droit d'écriture, mais PAS du droit de lecture : le
-- premier essai répondait « permission denied for table club_members » sur un simple select.
--
-- On ouvre donc la lecture des trois colonnes, et on FERME leur écriture : le seul écrivain est
-- `repondre_photo_profil`, qui est SECURITY DEFINER et s'exécute avec les droits du propriétaire.
-- Retirer l'écriture à `authenticated` met la règle de Fouka hors d'atteinte d'un oubli de trigger.
grant select (photo_bucket, photo_path, photo_acceptee_le) on public.club_members to authenticated;
revoke update (photo_bucket, photo_path, photo_acceptee_le) on public.club_members from authenticated, anon;
revoke insert (photo_bucket, photo_path, photo_acceptee_le) on public.club_members from authenticated, anon;

comment on table public.photos_profil_proposees is
  'Photos proposées à un membre de club pour son profil. Elle ne devient sa photo que s''il '
  'l''accepte : repondre_photo_profil est le SEUL chemin qui écrit club_members.photo_path, et le '
  'garde-fou de la table refuse toute autre écriture. Un refus efface le fichier.';

commit;
