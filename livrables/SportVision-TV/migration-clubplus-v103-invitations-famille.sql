-- Les invitations joueur et parent menaient nulle part. On les raccorde.
--
-- ── Ce qui a été constaté avant d'écrire ──
-- Le club peut inviter un joueur ou un parent depuis Club+ (`clubplus-family-invite`), ce qui crée
-- un compte, envoie un e-mail Supabase, et insère une ligne dans `player_invitations` ou
-- `parent_invitations`.
--
-- Puis plus rien. AUCUN écran de Connect ne lit ces deux tables : la recherche ne les trouve que
-- dans l'ancienne application vanilla, qui n'est plus servie. `accept_parent_invitation` existe
-- depuis des mois et n'est appelée de nulle part. La personne invitée reçoit donc un e-mail, crée
-- son mot de passe, arrive dans Connect — et rien ne lui dit pourquoi elle est là.
--
-- ── Deux manques, pas un ──
--   1. côté personne : rien pour VOIR ni ACCEPTER son invitation ;
--   2. côté joueur : il n'existe même pas de fonction d'acceptation, là où le parent a la sienne.
--
-- ── Et le principe de Fouka ──
-- « Le CM ne crée pas un compte. Il crée l'accès potentiel, la personne prend possession du
-- sien. » Ces deux fonctions rendent ça possible : plus besoin que le club fabrique le compte
-- pour que l'invitation existe. La personne s'inscrit seule, et retrouve son invitation parce
-- qu'elle porte son adresse — les policies `pinv_recipient_select` et `parinv_recipient_select`
-- (`email = auth.email()`) le permettaient déjà, personne ne s'en servait.
--
-- Aucun jeton n'est introduit ici, volontairement : l'adresse EST le jeton. Une invitation ne se
-- transfère pas, et une personne qui change d'adresse redemande au club — c'est exactement la
-- garantie qu'on veut, et une chaîne de moins à sécuriser.

begin;

-- ── 1. Ce que la personne voit en arrivant ──
-- SECURITY DEFINER : les tables d'invitation ne portent que des identifiants, et l'invité n'a pas
-- le droit de lire `clubs`, `club_teams` ni `player_profiles` de ce club. La fonction fait la
-- jointure pour lui, et ne rend que ce qui le concerne : les invitations à SON adresse.
create or replace function public.lister_mes_invitations()
returns table (
  id uuid,
  genre text,
  club_id uuid,
  club_nom text,
  equipe_nom text,
  enfant_prenom text,
  enfant_nom text,
  prenom text,
  nom text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select pi.id, 'joueur', pi.club_id, c.nom, t.name, null, null, pi.prenom, pi.nom, pi.created_at
    from player_invitations pi
    join clubs c on c.id = pi.club_id
    left join club_teams t on t.id = pi.team_id
   where lower(pi.email) = lower(auth.email()) and pi.statut = 'envoyee'

  union all

  select pa.id, 'parent', pa.club_id, c.nom, null, pp.prenom, pp.nom, pa.prenom, pa.nom, pa.created_at
    from parent_invitations pa
    join clubs c on c.id = pa.club_id
    left join player_profiles pp on pp.id = pa.player_id
   where lower(pa.email) = lower(auth.email()) and pa.statut = 'envoyee'

  order by created_at desc;
$$;

comment on function public.lister_mes_invitations() is
  'Les invitations en attente adressées à MON adresse, joueur et parent confondus, enrichies des noms de club, équipe et enfant. Ne rend jamais l''invitation de quelqu''un d''autre.';

-- ── 2. Accepter une invitation de joueur ──
-- Le pendant de `accept_parent_invitation`, qui manquait.
--
-- Le club a désigné la personne par son adresse et a saisi son identité. Rattacher la fiche
-- existante correspondante est donc légitime ici — c'est la voie sûre, celle que le master prompt
-- recommande face au lien collectif (§40). La différence avec le lien d'équipe est entière : là,
-- n'importe qui pouvait taper un nom ; ici, le club a écrit l'adresse.
create or replace function public.accepter_invitation_joueur(p_invitation_id uuid)
returns membership_requests
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv player_invitations;
  v_player player_profiles;
  v_req membership_requests;
  v_strong int;
begin
  if auth.uid() is null then
    raise exception 'Connectez-vous pour accepter cette invitation.';
  end if;

  select * into v_inv from player_invitations where id = p_invitation_id;
  if v_inv.id is null then raise exception 'Cette invitation n''existe plus.'; end if;
  if v_inv.statut = 'acceptee' then raise exception 'Cette invitation a déjà été utilisée.'; end if;
  if v_inv.statut <> 'envoyee' then raise exception 'Cette invitation n''est plus valable.'; end if;
  if lower(v_inv.email) is distinct from lower(auth.email()) then
    raise exception 'Cette invitation a été envoyée à une autre adresse e-mail.';
  end if;

  -- Déjà une fiche dans ce club pour ce compte : on la garde. `player_user_club_unique` interdit
  -- de toute façon une seconde ligne, et la contourner créerait le doublon qu'on veut éviter.
  select * into v_player from player_profiles
   where user_id = auth.uid() and club_id = v_inv.club_id;

  if v_player.id is null and v_inv.prenom is not null and v_inv.nom is not null then
    -- La fiche que le club a peut-être déjà créée pour cette personne, sans compte rattaché.
    -- On ne rattache que sur une correspondance FORTE (date de naissance identique) et une seule :
    -- deux homonymes, et on préfère créer une fiche de plus qu'attribuer la mauvaise.
    select count(*) into v_strong
      from find_player_match_candidates(v_inv.club_id, v_inv.prenom, v_inv.nom, v_inv.date_naissance)
     where match_strength = 'forte';
    if v_strong = 1 then
      select pp.* into v_player from player_profiles pp
       where pp.id = (
         select player_id from find_player_match_candidates(v_inv.club_id, v_inv.prenom, v_inv.nom, v_inv.date_naissance)
          where match_strength = 'forte' limit 1
       );
      -- Ne jamais voler la fiche de quelqu'un d'autre : si elle porte déjà un compte, on n'y
      -- touche pas et on repart sur une fiche neuve.
      if v_player.user_id is not null and v_player.user_id <> auth.uid() then
        v_player := null;
      else
        update player_profiles set user_id = auth.uid(), account_status = 'actif'
         where id = v_player.id returning * into v_player;
      end if;
    end if;
  end if;

  if v_player.id is null then
    insert into player_profiles (club_id, user_id, prenom, nom, date_naissance, account_status, created_by)
    values (v_inv.club_id, auth.uid(), v_inv.prenom, v_inv.nom, v_inv.date_naissance, 'actif', v_inv.invited_by)
    returning * into v_player;
  end if;

  -- Une demande d'adhésion déjà ouverte n'est pas doublée.
  select * into v_req from membership_requests mr
   where mr.player_id = v_player.id
     and mr.club_id = v_inv.club_id
     and mr.team_id is not distinct from v_inv.team_id
     and mr.statut <> 'refusee'
   order by mr.created_at desc limit 1;

  if v_req.id is null then
    insert into membership_requests (
      club_id, team_id, requested_by_user_id, player_id, source, statut, validation_mode
    )
    values (
      v_inv.club_id, v_inv.team_id, auth.uid(), v_player.id, 'invitation',
      -- Le mode de validation du club fait foi (§22), et un mineur attend son parent :
      -- `initial_request_status` porte déjà cette règle, on ne la réécrit pas.
      initial_request_status(v_inv.date_naissance),
      coalesce((select membership_validation_mode from clubs where id = v_inv.club_id), 'standard')
    )
    returning * into v_req;
  end if;

  update player_invitations
     set statut = 'acceptee', resulting_request_id = v_req.id
   where id = p_invitation_id;

  return v_req;
end;
$$;

comment on function public.accepter_invitation_joueur(uuid) is
  'Accepte une invitation de joueur adressée à MON adresse : rattache ou crée ma fiche dans le club, puis ouvre la demande d''adhésion selon le mode de validation du club. Ne rattache jamais une fiche qui porte déjà le compte de quelqu''un d''autre.';

commit;
