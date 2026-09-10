-- Préparer, envoyer, révoquer, accepter. Les quatre gestes d'une invitation nominative.
--
-- ── Le point délicat : ma propre garde v97 bloque l'acceptation ──
-- La v97 gèle `club_members.teams` pour quiconque n'est ni administrateur du club ni staff : le
-- champ porte des droits (`is_team_educateur`), il ne se réécrit pas soi-même. C'était juste, et
-- ça reste juste — mais un coach déjà membre qui accepte une SECONDE invitation (§17, coach de
-- Seniors R2 et de U18) doit voir son périmètre s'élargir, et c'est lui qui déclenche l'écriture.
--
-- Deux façons de s'en sortir, une seule acceptable :
--
--   un drapeau de session que la fonction d'acceptation poserait et que le trigger honorerait.
--   Refusé : un drapeau qui désarme un garde-fou est un garde-fou qui dépend de qui l'appelle.
--
--   une exception ADOSSÉE À LA DONNÉE : on peut élargir son propre périmètre uniquement tant
--   qu'une invitation valide, adressée à SON adresse, est ouverte sur ce club. Elle se referme
--   d'elle-même à l'acceptation, puisque l'invitation change alors d'état. C'est ce qui suit.
--
-- L'écriture reste donc impossible sans une invitation qu'un opérateur du club a créée.

begin;

create or replace function public.protect_sensitive_club_member_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  is_os_staff boolean;
  is_this_club_admin boolean;
  is_self_accepting_own_invitation boolean;
  a_une_invitation_ouverte boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'com', 'sec')
  ) into is_os_staff;

  select is_club_admin(old.club_id) into is_this_club_admin;

  if new.club_id is distinct from old.club_id then
    raise exception 'Modification non autorisée : club_id est immuable, une adhésion ne se déplace pas par UPDATE.';
  end if;

  -- 19/08/2026 (audit pré-lancement, migration-connect-v15) : un admin ne peut pas
  -- modifier SA PROPRE ligne pour perdre son statut d'admin actif (se suspendre ou
  -- se rétrograder lui-même) via un appel API direct hors UI. Seul le staff OS peut
  -- le faire (branche is_os_staff ci-dessus), pour un transfert de propriété
  -- légitime. Additive : ne touche à rien d'autre du comportement existant.
  if is_this_club_admin and not is_os_staff and old.user_id = auth.uid()
     and (new.status is distinct from 'actif' or new.role is distinct from 'admin')
  then
    raise exception 'Un administrateur ne peut pas se retirer ses propres droits d''administration.';
  end if;

  -- 10/09/2026 — L'acceptation d'une invitation nominative. Étroite par construction : sa propre
  -- ligne, sur un club où une invitation à son adresse est encore ouverte et non expirée. Dès que
  -- l'invitation passe à « acceptee » ou « revoquee », cette porte se referme.
  select exists (
    select 1
      from club_invitations ci
      join auth.users u on u.id = auth.uid()
     where ci.club_id = old.club_id
       and lower(ci.email) = lower(u.email)
       and ci.statut in ('preparee', 'envoyee')
       and ci.expire_at > now()
  ) into a_une_invitation_ouverte;

  -- 09/09/2026 — `teams` porte des droits (is_team_educateur), pas une préférence d'affichage :
  -- il se gèle comme role et status.
  if not is_os_staff and not is_this_club_admin
     and new.teams is distinct from old.teams
     and not (old.user_id = auth.uid() and a_une_invitation_ouverte)
  then
    raise exception 'Modification non autorisée : le périmètre d''équipes est fixé par l''administrateur du club.';
  end if;

  -- Auto-acceptation de sa propre invitation : la seule transition qu'un
  -- non-admin/non-staff peut déclencher sur role/status. Rôle strictement
  -- inchangé, statut strictement invitation -> actif, et uniquement sur sa
  -- propre ligne (auth.uid() = old.user_id, jamais un tiers).
  is_self_accepting_own_invitation :=
    auth.uid() = old.user_id
    and old.status = 'invitation'
    and new.status = 'actif'
    and new.role = old.role;

  if not is_os_staff and not is_this_club_admin and not is_self_accepting_own_invitation then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
    then
      raise exception 'Modification non autorisée : rôle et statut sont réservés à l''administrateur du club ou au staff SportVision.';
    end if;
  end if;

  return new;
end;
$function$;

-- ── Préparer ──
-- Idempotente sur (club, adresse) : recliquer met à jour la personne et son périmètre, sans
-- fabriquer un second lien. Le jeton déjà émis reste valable — c'est exactement ce que demande le
-- §30 : « Ne crée pas deux invitations différentes parce qu'il clique sur les deux boutons. »
create or replace function public.preparer_invitation_club(
  p_club_id uuid,
  p_email text,
  p_role text,
  p_prenom text default null,
  p_nom text default null,
  p_telephone text default null,
  p_teams jsonb default '[]'::jsonb
)
returns club_invitations
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row club_invitations;
  v_email text := lower(btrim(p_email));
begin
  if not peut_operer_club(p_club_id) then
    raise exception 'Vous n''êtes pas autorisé à inviter sur ce club.';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Cette adresse e-mail n''est pas valide.';
  end if;

  select * into v_row
    from club_invitations
   where club_id = p_club_id and lower(email) = v_email
     and statut in ('preparee', 'envoyee')
   limit 1;

  if v_row.id is not null then
    update club_invitations
       set prenom = coalesce(p_prenom, prenom),
           nom = coalesce(p_nom, nom),
           telephone = coalesce(p_telephone, telephone),
           role = p_role,
           teams = p_teams,
           -- Repréparer une invitation la remet dans sa fenêtre : sans ça, une relance trois
           -- semaines plus tard partirait avec un lien déjà presque périmé.
           expire_at = greatest(expire_at, now() + interval '30 days')
     where id = v_row.id
     returning * into v_row;
    return v_row;
  end if;

  insert into club_invitations (club_id, email, prenom, nom, telephone, role, teams, created_by)
  values (p_club_id, v_email, p_prenom, p_nom, p_telephone, p_role, coalesce(p_teams, '[]'::jsonb), auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

-- ── Marquer comme envoyée ──
-- Le canal (e-mail ou lien copié) ne change pas l'invitation : c'est le même jeton, distribué
-- autrement. On ne trace que le fait qu'elle est partie.
create or replace function public.marquer_invitation_envoyee(p_id uuid)
returns club_invitations
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_row club_invitations;
begin
  select * into v_row from club_invitations where id = p_id;
  if v_row.id is null then raise exception 'Cette invitation n''existe plus.'; end if;
  if not peut_operer_club(v_row.club_id) then
    raise exception 'Vous n''êtes pas autorisé à gérer les invitations de ce club.';
  end if;
  if v_row.statut = 'acceptee' then return v_row; end if;

  update club_invitations
     set statut = 'envoyee', sent_at = coalesce(sent_at, now())
   where id = p_id returning * into v_row;
  return v_row;
end;
$$;

-- ── Révoquer ──
create or replace function public.revoquer_invitation_club(p_id uuid)
returns club_invitations
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_row club_invitations;
begin
  select * into v_row from club_invitations where id = p_id;
  if v_row.id is null then raise exception 'Cette invitation n''existe plus.'; end if;
  if not peut_operer_club(v_row.club_id) then
    raise exception 'Vous n''êtes pas autorisé à gérer les invitations de ce club.';
  end if;
  if v_row.statut = 'acceptee' then
    raise exception 'Cette invitation a déjà été acceptée. Retirez plutôt la personne de l''équipe.';
  end if;

  update club_invitations set statut = 'revoquee' where id = p_id returning * into v_row;
  return v_row;
end;
$$;

-- ── Lire une invitation depuis son jeton ──
-- Appelable sans être connecté : c'est ce que la page d'accueil du lien affiche AVANT que la
-- personne ne se connecte. Ne rend donc que le strict nécessaire — le club, les équipes, le rôle,
-- l'état. Jamais l'adresse e-mail : un jeton qui fuite ne doit pas révéler à qui il était destiné.
create or replace function public.lire_invitation_club(p_token text)
returns table (
  club_id uuid,
  club_nom text,
  prenom text,
  role text,
  teams jsonb,
  statut text,
  valide boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select ci.club_id,
         o.nom,
         ci.prenom,
         ci.role,
         ci.teams,
         case when ci.statut in ('preparee', 'envoyee') and ci.expire_at <= now()
              then 'expiree' else ci.statut end,
         ci.statut in ('preparee', 'envoyee') and ci.expire_at > now()
    from club_invitations ci
    join organizations o on o.id = ci.club_id
   where ci.token = p_token;
$$;

-- ── Accepter ──
create or replace function public.accepter_invitation_club(p_token text)
returns club_members
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv club_invitations;
  v_membre club_members;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Connectez-vous pour accepter cette invitation.';
  end if;

  select * into v_inv from club_invitations where token = p_token;
  if v_inv.id is null then raise exception 'Ce lien d''invitation n''est pas valide.'; end if;
  if v_inv.statut = 'acceptee' then
    raise exception 'Cette invitation a déjà été utilisée.';
  end if;
  if v_inv.statut = 'revoquee' then
    raise exception 'Cette invitation a été annulée par le club.';
  end if;
  if v_inv.expire_at <= now() then
    raise exception 'Cette invitation a expiré. Demandez-en une nouvelle au club.';
  end if;

  -- L'adresse doit correspondre. Une invitation de coach accorde l'administration d'une équipe :
  -- un lien transféré ne doit pas suffire à la prendre. Le prix de cette rigueur est réel — un
  -- coach qui s'inscrit avec une autre adresse est refusé — d'où un message qui le dit
  -- explicitement plutôt qu'un « non autorisé » opaque.
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is distinct from lower(v_inv.email) then
    raise exception 'Cette invitation a été envoyée à une autre adresse e-mail. Connectez-vous avec l''adresse qui l''a reçue, ou demandez au club de la renvoyer.';
  end if;

  select * into v_membre from club_members
   where club_id = v_inv.club_id and user_id = auth.uid();

  if v_membre.id is null then
    insert into club_members (user_id, club_id, role, status, prenom, nom, telephone, teams)
    values (auth.uid(), v_inv.club_id, v_inv.role, 'actif',
            v_inv.prenom, v_inv.nom, v_inv.telephone, coalesce(v_inv.teams, '[]'::jsonb))
    returning * into v_membre;
  else
    -- Déjà membre : on ÉLARGIT, on ne remplace pas. Un coach de Seniors R2 invité sur U18 doit
    -- garder Seniors R2 (§17), et un administrateur du club invité comme coach ne doit pas
    -- perdre son rôle d'administrateur au passage.
    update club_members
       set teams = (
             select coalesce(jsonb_agg(distinct t), '[]'::jsonb)
               from (
                 select jsonb_array_elements_text(coalesce(v_membre.teams, '[]'::jsonb)) as t
                 union
                 select jsonb_array_elements_text(coalesce(v_inv.teams, '[]'::jsonb))
               ) x
           ),
           role = case when v_membre.role in ('admin', 'president') then v_membre.role else v_inv.role end,
           status = 'actif'
     where id = v_membre.id
     returning * into v_membre;
  end if;

  update club_invitations
     set statut = 'acceptee', accepted_at = now(), accepted_by = auth.uid()
   where id = v_inv.id;

  return v_membre;
end;
$$;

commit;
