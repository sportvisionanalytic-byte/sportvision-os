-- v387 — REVENDIQUER UNE FICHE PRÉ-CRÉÉE (01/10/2026)
--
-- Fouka : « Admettons je crée un petit qui s'appelle Saiden. Il va créer son compte, moi j'aurai
-- déjà mis ses photos de référence. Ça va lui dire : est-ce bien vous Saiden ? Peut-être que je vais
-- me tromper dans les noms et prénoms, mais ce sera approximativement eux. Il pourra corriger son
-- profil, et après il reprend l'onboarding par-dessus, avec déjà les photos de référence. »
--
-- ═══ CE QUI MANQUAIT, MESURÉ ═══════════════════════════════════════════════════════════════════
--
-- Le chemin du PARENT rapproche déjà : `request_team_membership_for_child` (durcie le 12/09) cherche
-- une fiche du même club, même date de naissance, noms normalisés, et rattache la demande à celle-là
-- plutôt que d'en créer une seconde.
--
-- Le chemin du JOUEUR ne rapproche RIEN. `request_team_membership_as_player` ne cherche la fiche que
-- par `user_id = auth.uid()` — c'est-à-dire par un lien qui n'existe pas encore. Elle crée donc
-- TOUJOURS une seconde fiche. Mesuré en lisant la fonction : c'est exactement le cas de Saiden, et
-- le durcissement du 12/09 n'avait pas touché cette branche.
--
-- Et dans les deux cas, le rapprochement est EXACT sur les noms normalisés. Or Fouka saisira les
-- noms de mémoire. « Seyden » et « Saiden » ne se rapprochent pas, et on repart sur un doublon.
--
-- ═══ POURQUOI PAS UNE RECHERCHE FLOUE ══════════════════════════════════════════════════════════
--
-- Parce qu'une recherche floue sur le fichier des enfants d'un club EST une énumération. On a mesuré
-- `similarity()` sur des fautes réalistes, noms déjà normalisés (accents et casse sont donc gratuits,
-- `normalize_person_name` les gomme déjà) :
--
--     Saiden / Saïden    1,000      Theo / Teo         0,286
--     Ines / Inès        1,000      Saiden / Seyden    0,273
--     Lefevre/Lefebvre   0,545      Dupont / Durand    0,167   ← deux personnes DIFFÉRENTES
--     Nathan / Natan     0,444      Martin / Bernard   0,000
--
-- Un seuil qui attrape « Teo » pour « Theo » (0,286) passe à 0,12 de « Dupont » pour « Durand ». Il
-- n'y a pas de seuil qui sépare proprement une faute de frappe d'un homonyme approximatif, et un
-- seuil bas transforme une case de saisie en sonde sur le fichier d'un club.
--
-- ═══ LA BORNE CHOISIE : LE CODE D'ÉQUIPE, ET RIEN D'AUTRE ══════════════════════════════════════
--
-- On ne cherche pas, on PROPOSE. L'arrivant donne le code de son équipe — celui que le club lui a
-- remis — et on lui montre la liste des sportifs de CETTE équipe qui n'ont pas encore de compte. Il
-- se reconnaît dedans. Une vingtaine de noms, pas une recherche.
--
-- Trois raisons de préférer cette borne aux autres :
--
--   1. Elle existe déjà et elle a un sens métier établi : « donner le code, c'est déjà accepter la
--      personne » (v186, décision de Fouka). Le code est nominatif par construction — le club le
--      remet à ses familles.
--   2. Elle rend le problème d'orthographe SANS OBJET. Saiden reconnaît « Sayden Koné » même mal
--      écrit, parce qu'il le LIT au lieu de le taper. Aucun seuil à régler, donc aucun seuil à se
--      tromper. `similarity` ne sert plus qu'à mettre le plus probable en haut de la liste, et
--      jamais à écarter quoi que ce soit.
--   3. Elle ne peut pas servir à balayer un club : un code ouvre UNE équipe, et seulement les
--      fiches sans compte.
--
-- Ce qu'on NE renvoie pas dans cette liste : la photo, et la date de naissance exacte. Le prénom, le
-- nom et l'ANNÉE suffisent à se reconnaître. Montrer vingt portraits d'enfants à qui détient un code
-- serait rendre la photo plus accessible que la fiche.
--
-- Plafond : 10 appels par quart d'heure et PAR COMPTE, avec `check_and_record_rate_limit`, déjà en
-- place. Par compte et non par IP : « une IP n'est pas une personne » (leçon du 13/09, des familles
-- d'un même réseau bloquées). Quelqu'un qui cherche son enfant s'y prend à une ou deux fois.
--
-- ═══ LE PARENT PROPOSE, LE CLUB CONFIRME ═══════════════════════════════════════════════════════
--
-- Rien ici ne rend un lien actif sur la seule parole de l'arrivant. C'est le trou v102 du 10/09 — un
-- inconnu devenait parent confirmé d'un mineur avec le code d'équipe, le nom et la date de naissance
-- — et il reste fermé.
--
--   • Côté PARENT, on ne construit aucun mécanisme : on alimente celui qui existe.
--     `parent_player_relationships` en `en_attente_confirmation`, que `liens_parents_a_decider` et
--     `decider_lien_parent` traitent déjà. Un second chemin de décision, c'est un second écran, donc
--     une seconde vérité : on s'en passe.
--   • Côté JOUEUR, il n'existait rien : `player_profiles.user_id` ne se déplace pas à la main
--     (`proteger_identite_joueur` le refuse à tous sauf au staff OS). On pose donc une file de
--     revendications, et `player_profiles.user_id` n'est écrit QUE par la décision du club.
--
-- ═══ ET L'EMPREINTE, TOUJOURS APRÈS L'ACCORD ═══════════════════════════════════════════════════
--
-- Revendiquer n'est pas consentir. Cette migration ne touche ni `consentements_biometrie`, ni
-- `player_face_refs`, ni `visages_reference`, et n'appelle `photos_attente_promouvoir` nulle part.
-- La photo déposée d'avance (v385) attend toujours l'accord, et l'empreinte toujours le moteur.

begin;

-- ═══ 1. LA FILE DES REVENDICATIONS ═════════════════════════════════════════════════════════════

create table if not exists public.revendications_fiche (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete cascade,
  team_id uuid references public.club_teams(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  invite_code_id uuid references public.team_invite_codes(id) on delete set null,
  statut text not null default 'en_attente'
    check (statut in ('en_attente', 'confirmee', 'refusee')),
  created_at timestamptz not null default now(),
  decide_le timestamptz,
  decide_par uuid references auth.users(id) on delete set null,
  motif_refus text
);

-- UNE SEULE REVENDICATION EN COURS PAR COMPTE ET PAR FICHE. Sans cet index, réappuyer sur le bouton
-- remplit la file du club de doublons qu'il devra trier un par un.
create unique index if not exists revendication_une_par_compte_et_fiche
  on public.revendications_fiche (player_id, user_id) where statut = 'en_attente';
create index if not exists revendication_a_decider
  on public.revendications_fiche (club_id) where statut = 'en_attente';

alter table public.revendications_fiche enable row level security;
-- Aucune policy : tout passe par les fonctions ci-dessous.

-- ═══ 2. CE QU'ON PROPOSE À L'ARRIVANT ══════════════════════════════════════════════════════════

create or replace function public.fiches_a_revendiquer(p_code text, p_nom text default null)
returns table(player_id uuid, prenom text, nom text, annee_naissance integer,
              club_nom text, equipe_nom text, a_une_photo boolean)
language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $$
declare v_code team_invite_codes;
begin
  -- AUTHENTIFICATION EXIGÉE, et exigée pour ce qu'elle REFUSE : sans elle, cette fonction
  -- transformerait un code d'équipe en liste nominative d'enfants pour n'importe qui. Mesuré avant
  -- d'écrire : `anon` voit ZÉRO ligne de `player_profiles`, et ça ne change pas ici.
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '42501';
  end if;
  -- PAR COMPTE, PAS PAR IP (leçon du 13/09). Dix essais par quart d'heure : se reconnaître dans une
  -- liste de vingt noms n'en demande pas deux.
  if not public.check_and_record_rate_limit('fiches_a_revendiquer:' || auth.uid()::text, 10, 900) then
    raise exception 'Trop d''essais. Réessayez dans un quart d''heure.' using errcode = '42901';
  end if;

  select * into v_code from team_invite_codes
   where code = upper(btrim(coalesce(p_code, '')))
     and actif
     and (expire_at is null or expire_at > now())
     and (max_uses is null or uses_count < max_uses);
  if v_code.id is null or v_code.team_id is null then
    return;   -- code invalide : aucune liste, et aucune explication qui aiderait à en deviner un
  end if;

  return query
  select p.id,
         p.prenom,
         p.nom,
         extract(year from p.date_naissance)::integer,
         c.nom,
         t.name,
         exists (select 1 from photos_reference_attente a
                  where a.player_id = p.id and a.refusee_le is null)
      or exists (select 1 from player_face_refs r where r.player_id = p.id)
    from player_profiles p
    join team_memberships tm on tm.player_id = p.id and tm.statut = 'active'
    join club_teams t on t.id = tm.team_id
    join clubs c on c.id = p.club_id
   where tm.team_id = v_code.team_id
     -- SANS COMPTE, uniquement. Une fiche déjà prise par quelqu'un n'est pas à prendre.
     and p.user_id is null
     and coalesce(p.account_status, 'actif') not in ('retire', 'suspendu')
     -- Ni celles que cette personne a déjà revendiquées : la question est posée, elle attend.
     and not exists (select 1 from revendications_fiche rv
                      where rv.player_id = p.id and rv.user_id = auth.uid()
                        and rv.statut in ('en_attente', 'refusee'))
   -- `similarity` TRIE, elle ne FILTRE pas. C'est la seule chose qu'on peut lui demander
   -- honnêtement : aucun seuil ne sépare « Teo » pour « Theo » (0,286) de « Durand » pour
   -- « Dupont » (0,167). La liste entière reste affichée, le plus probable est simplement en haut.
   order by case when coalesce(btrim(p_nom), '') = '' then 0
                 else -similarity(normalize_person_name(p.prenom || ' ' || p.nom),
                                  normalize_person_name(p_nom)) end,
            normalize_person_name(p.nom), normalize_person_name(p.prenom)
   limit 60;
end $$;

-- ═══ 3. REVENDIQUER ════════════════════════════════════════════════════════════════════════════

create or replace function public.revendiquer_fiche(p_player_id uuid, p_code text, p_qualite text)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare
  v_code team_invite_codes;
  v_p player_profiles;
  v_parent parent_profiles;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '42501';
  end if;
  if p_qualite not in ('joueur', 'parent') then
    raise exception 'Qualité inconnue : « joueur » ou « parent ».' using errcode = '22023';
  end if;
  if not public.check_and_record_rate_limit('revendiquer_fiche:' || auth.uid()::text, 10, 900) then
    raise exception 'Trop d''essais. Réessayez dans un quart d''heure.' using errcode = '42901';
  end if;

  -- LE CODE EST REVÉRIFIÉ ICI. Il n'est pas « déjà vérifié par l'écran d'avant » : un appel direct
  -- ne passe par aucun écran. Et il n'est pas CONSOMMÉ : une revendification refusée ne doit pas
  -- avoir brûlé une utilisation du code de l'équipe.
  select * into v_code from team_invite_codes
   where code = upper(btrim(coalesce(p_code, '')))
     and actif
     and (expire_at is null or expire_at > now())
     and (max_uses is null or uses_count < max_uses);
  if v_code.id is null or v_code.team_id is null then
    raise exception 'Code d''équipe invalide ou expiré.' using errcode = '42501';
  end if;

  select * into v_p from player_profiles where id = p_player_id;
  if not found then
    raise exception 'Cette fiche n''existe plus.' using errcode = '22023';
  end if;
  -- LA FICHE DOIT ÊTRE DANS L'ÉQUIPE DU CODE. Sans ce contrôle, le code d'une équipe servirait à
  -- revendiquer la fiche de n'importe quel enfant du club, voire d'un autre club.
  if not exists (select 1 from team_memberships tm
                  where tm.player_id = p_player_id and tm.team_id = v_code.team_id
                    and tm.statut = 'active') then
    raise exception 'Ce sportif n''est pas dans l''équipe de ce code.' using errcode = '42501';
  end if;
  if v_p.user_id is not null then
    raise exception 'Cette fiche est déjà rattachée à un compte.' using errcode = '42501';
  end if;
  if coalesce(v_p.account_status, 'actif') in ('retire', 'suspendu') then
    raise exception 'Cette fiche n''est plus active.' using errcode = '42501';
  end if;

  if p_qualite = 'parent' then
    -- ON N'INVENTE PAS DE SECOND MÉCANISME. Le club décide déjà des liens parentaux depuis
    -- `liens_parents_a_decider` / `decider_lien_parent` (v102). On alimente cette file, point.
    select * into v_parent from parent_profiles where user_id = auth.uid();
    if v_parent.id is null then
      insert into parent_profiles (user_id) values (auth.uid()) returning * into v_parent;
    end if;
    insert into parent_player_relationships (parent_id, player_id, relation_type, statut)
    values (v_parent.id, p_player_id, 'parent', 'en_attente_confirmation')
    on conflict (parent_id, player_id) do nothing;
    return jsonb_build_object(
      'depose', true, 'qualite', 'parent',
      'message', 'Votre demande est partie au club. Il confirme le lien, et vous voyez alors la fiche de votre enfant.');
  end if;

  -- Qualité « joueur » : rien n'existait. La fiche N'EST PAS rattachée ici — `user_id` reste nul
  -- jusqu'à la décision du club. C'est tout l'objet de cette file.
  insert into revendications_fiche (player_id, club_id, team_id, user_id, invite_code_id)
  values (p_player_id, v_p.club_id, v_code.team_id, auth.uid(), v_code.id)
  on conflict (player_id, user_id) where statut = 'en_attente' do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from revendications_fiche
     where player_id = p_player_id and user_id = auth.uid() and statut = 'en_attente';
  end if;
  return jsonb_build_object(
    'depose', true, 'qualite', 'joueur', 'revendication_id', v_id,
    'message', 'Votre demande est partie au club. Dès qu''il la confirme, votre fiche et vos photos vous appartiennent.');
end $$;

-- ═══ 4. LE CLUB DÉCIDE ═════════════════════════════════════════════════════════════════════════

create or replace function public.revendications_a_decider(p_club_id uuid)
returns table(id uuid, player_id uuid, sportif text, equipe text, demandeur_email text,
              a_une_photo boolean, demande_le timestamptz)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select rv.id, p.id,
         btrim(coalesce(p.prenom, '') || ' ' || coalesce(p.nom, '')),
         t.name, u.email,
         exists (select 1 from photos_reference_attente a
                  where a.player_id = p.id and a.refusee_le is null),
         rv.created_at
    from revendications_fiche rv
    join player_profiles p on p.id = rv.player_id
    left join club_teams t on t.id = rv.team_id
    left join auth.users u on u.id = rv.user_id
   where rv.club_id = p_club_id
     and rv.statut = 'en_attente'
     -- Le même cercle que pour un lien parental : le club, le CM qui l'exploite, et l'éducateur de
     -- l'équipe, qui est celui qui connaît les familles.
     and (public.peut_operer_club(p_club_id)
          or public.is_club_admin(p_club_id)
          or (rv.team_id is not null and public.is_team_educateur(rv.team_id)))
   order by rv.created_at;
$$;

create or replace function public.decider_revendication(p_id uuid, p_decision text,
                                                        p_motif text default null)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_rv revendications_fiche; v_lignes integer; v_relu uuid;
begin
  if p_decision not in ('confirme', 'refuse') then
    raise exception 'Décision invalide.' using errcode = '22023';
  end if;
  select * into v_rv from revendications_fiche where id = p_id;
  if not found then
    raise exception 'Cette demande n''existe plus.' using errcode = '22023';
  end if;
  if v_rv.statut <> 'en_attente' then
    return jsonb_build_object('deja_traitee', true, 'statut', v_rv.statut);
  end if;

  if not (public.peut_operer_club(v_rv.club_id)
          or public.is_club_admin(v_rv.club_id)
          or (v_rv.team_id is not null and public.is_team_educateur(v_rv.team_id))) then
    raise exception 'Vous n''êtes pas autorisé à décider de cette demande.' using errcode = '42501';
  end if;

  if p_decision = 'refuse' then
    update revendications_fiche
       set statut = 'refusee', decide_le = now(), decide_par = auth.uid(),
           motif_refus = nullif(btrim(coalesce(p_motif, '')), '')
     where id = p_id;
    return jsonb_build_object('confirme', false);
  end if;

  -- Entre-temps quelqu'un d'autre a pu prendre la fiche. On relit AVANT d'écrire.
  select user_id into v_relu from player_profiles where id = v_rv.player_id;
  if v_relu is not null then
    update revendications_fiche
       set statut = 'refusee', decide_le = now(), decide_par = auth.uid(),
           motif_refus = 'fiche déjà rattachée à un autre compte'
     where id = p_id;
    raise exception 'Cette fiche a été rattachée à un autre compte entre-temps.' using errcode = '42501';
  end if;

  -- Le marqueur dit au garde-fou de `player_profiles` que le rattachement vient de CE chemin, celui
  -- où le club vient de trancher. `proteger_identite_joueur` refuse `user_id` partout ailleurs, et
  -- c'est précisément ce qui fait la valeur de cette file.
  perform set_config('sv.revendication_decidee', 'oui', true);
  update player_profiles
     set user_id = v_rv.user_id,
         account_status = case when account_status = 'sans_compte' then 'actif' else account_status end,
         updated_at = now()
   where id = v_rv.player_id and user_id is null;
  get diagnostics v_lignes = row_count;
  if v_lignes = 0 then
    raise exception 'Le rattachement n''a rien changé : la fiche n''est plus libre.' using errcode = '42501';
  end if;

  update revendications_fiche
     set statut = 'confirmee', decide_le = now(), decide_par = auth.uid()
   where id = p_id;

  -- ON RELIT LA VALEUR, pas le nombre de lignes. Sur `player_profiles`, des déclencheurs recopient
  -- et effacent des colonnes : un update qui rend 1 ligne peut laisser NULL derrière lui.
  select user_id into v_relu from player_profiles where id = v_rv.player_id;
  if v_relu is distinct from v_rv.user_id then
    raise exception 'Le rattachement n''a pas été enregistré (valeur relue : %).', coalesce(v_relu::text, 'vide')
      using errcode = '42501';
  end if;

  return jsonb_build_object('confirme', true, 'player_id', v_rv.player_id, 'user_id', v_relu);
end $$;

-- ═══ 5. LE GARDE-FOU DE `user_id` LAISSE PASSER CE CHEMIN, ET LUI SEUL ═════════════════════════

create or replace function public.proteger_identite_joueur()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_is_os_staff boolean;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin', 'com', 'sec')
  ) into v_is_os_staff;
  if v_is_os_staff then
    return new;
  end if;

  -- Le rattachement à un compte ne se déplace pas à la main. C'est ce lien qui décide de tout le
  -- reste : le confier à un écran, c'est permettre de s'attribuer la fiche d'un autre.
  if new.user_id is distinct from old.user_id then
    -- v387 (01/10/2026) : UNE SEULE exception, le PREMIER rattachement posé par
    -- `decider_revendication`, c'est-à-dire par le club qui vient de confirmer que cette personne
    -- est bien celle de la fiche. Le marqueur ne vit que le temps de la transaction et aucune autre
    -- fonction ne le pose. `old.user_id is null` est dans la condition : ce chemin ne DÉPLACE jamais
    -- un rattachement existant, il n'en pose qu'un premier.
    --
    -- `coalesce` N'EST PAS DÉCORATIF ICI, ET ÇA A COÛTÉ UN TEST ROUGE. Un réglage jamais posé rend
    -- NULL, donc `A and B and NULL` vaut NULL, donc `not NULL` vaut NULL, et `if NULL then raise`
    -- NE LÈVE RIEN. Première version de cette garde : l'arrivant se rattachait la fiche d'un enfant
    -- par un simple update, sans aucune décision du club — exactement le trou v102, rouvert par un
    -- `current_setting` sans valeur de repli. Une garde se lit à ce qu'elle REFUSE.
    if not (old.user_id is null and new.user_id is not null
            and coalesce(current_setting('sv.revendication_decidee', true), '') = 'oui') then
      raise exception 'Le compte rattaché à une fiche joueur ne se modifie pas depuis cet espace.';
    end if;
  end if;
  if new.client_id is distinct from old.client_id then
    -- 11/09/2026 (blocages-review-4) : seule exception, le PREMIER rattachement (NULL → client)
    -- posé par connect_resolve_beneficiary_client_id ou resolve_player_client_id, qui le signalent
    -- par ce marqueur transactionnel (non réglable depuis l'API). Sans elle, aucun joueur rattaché
    -- à un club ne pouvait ouvrir Mes commandes, Factures & paiements, Réserver ni Messages.
    -- Remplacer un client déjà rattaché reste refusé à tous.
    -- v387 : `coalesce` ajouté ici aussi. La garde avait la MÊME forme, et donc le même trou :
    -- sur une fiche sans client (`old.client_id is null`), un réglage absent rendait la condition
    -- NULL et laissait passer le premier rattachement client à n'importe qui. Trouvé en corrigeant
    -- celle de `user_id` juste au-dessus.
    if not (old.client_id is null and new.client_id is not null
            and coalesce(current_setting('sv.ecriture_systeme', true), '') = 'client_joueur') then
      raise exception 'Le rattachement client d''une fiche joueur ne se modifie pas depuis cet espace.';
    end if;
  end if;

  -- Fiche revendiquée : l'identité appartient à la personne. Elle seule peut la corriger, via
  -- `pp_self_update`. Le club garde la main sur tout ce qui est sportif.
  if old.user_id is not null and old.user_id is distinct from auth.uid() then
    -- v387 : « c'est la famille qui a raison » (Fouka). Le parent CONFIRMÉ corrige aussi, par
    -- `corriger_identite_sportif`, qui trace. Hors de ce chemin, rien ne change.
    if coalesce(current_setting('sv.correction_identite', true), '') <> 'oui'
       and (new.prenom is distinct from old.prenom
            or new.nom is distinct from old.nom
            or new.date_naissance is distinct from old.date_naissance)
    then
      raise exception 'Cette fiche appartient désormais à son titulaire : son identité ne se modifie plus depuis l''espace du club.';
    end if;
  end if;

  return new;
end;
$function$;

-- ═══ 5 bis. L'AUTRE GARDE-FOU DE LA TABLE, ET CE QU'IL BLOQUAIT ════════════════════════════════
-- Mesuré au premier passage du test : le coach de l'équipe se voyait refuser la confirmation, et
-- pas par la fonction — par `guard_player_profile_update`, qui refuse `user_id` ET `account_status`
-- à qui n'est pas dirigeant du club. Or c'est justement le coach qui connaît les familles, et c'est
-- pour ça que `decider_lien_parent` l'autorise depuis le 10/09.
--
-- Même patron que `sv.validation_adhesion`, posé par `validate_team_membership` en v186 pour la même
-- raison : un coach qui valide une adhésion, c'est son rôle, et le garde-fou ne peut pas le savoir.
-- Le droit a déjà été vérifié par `decider_revendication` avant de poser ce marqueur.

create or replace function public.guard_player_profile_update()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Validation d'une demande d'adhésion (v186) : le droit a déjà été vérifié par
  -- validate_team_membership, qui pose ce drapeau juste avant d'activer le compte.
  if coalesce(current_setting('sv.validation_adhesion', true), '') = 'oui' then
    return new;
  end if;

  -- v387 : décision du club sur une revendication de fiche. Même raisonnement, même garantie : le
  -- marqueur ne vit que le temps de la transaction, et `decider_revendication` est la seule
  -- fonction qui le pose, après avoir vérifié qui décide.
  if coalesce(current_setting('sv.revendication_decidee', true), '') = 'oui' then
    return new;
  end if;

  if not is_club_admin(new.club_id) then
    if new.user_id is distinct from old.user_id
       or (
         new.account_status is distinct from old.account_status
         and not (new.account_status = 'retire' and old.user_id = auth.uid())
       )
       or new.club_id is distinct from old.club_id
       or (
         new.date_naissance is distinct from old.date_naissance
         and old.user_id is distinct from auth.uid()
       )
    then
      raise exception 'Modification non autorisée sur ces champs';
    end if;
  end if;
  return new;
end $function$;

-- ═══ 6. CORRIGER L'IDENTITÉ, ET GARDER LA TRACE ════════════════════════════════════════════════
-- Fouka : « Peut-être que je vais me tromper dans les noms et prénoms. » Une fiche pré-créée par
-- SportVision puis corrigée par la famille, c'est la famille qui a raison. Mais une correction
-- d'identité sans trace, c'est un nom qui change sans que personne ne sache qui l'a changé.

create table if not exists public.identite_sportif_corrections (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.player_profiles(id) on delete cascade,
  champ text not null check (champ in ('prenom', 'nom', 'date_naissance')),
  avant text,
  apres text,
  corrige_par uuid references auth.users(id) on delete set null,
  qualite text,
  created_at timestamptz not null default now()
);
create index if not exists identite_corrections_par_sportif
  on public.identite_sportif_corrections (player_id, created_at desc);
alter table public.identite_sportif_corrections enable row level security;

-- La trace se pose par un DÉCLENCHEUR, pas par la fonction de correction. Une trace que l'écrivain
-- doit penser à écrire est une trace qu'on oublie : ici, toute écriture de ces trois champs est
-- consignée, d'où qu'elle vienne — y compris du staff OS et des imports.
create or replace function public.tracer_correction_identite()
returns trigger
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_qualite text;
begin
  if new.prenom is not distinct from old.prenom
     and new.nom is not distinct from old.nom
     and new.date_naissance is not distinct from old.date_naissance then
    return null;
  end if;
  v_qualite := case
    when auth.role() = 'service_role' then 'systeme'
    when old.user_id is not null and old.user_id = auth.uid() then 'titulaire'
    when public.is_confirmed_parent_of(new.id) then 'parent'
    when exists (select 1 from profiles p where p.id = auth.uid() and p.role is not null) then 'sportvision'
    else 'club' end;

  if new.prenom is distinct from old.prenom then
    insert into identite_sportif_corrections (player_id, champ, avant, apres, corrige_par, qualite)
    values (new.id, 'prenom', old.prenom, new.prenom, auth.uid(), v_qualite);
  end if;
  if new.nom is distinct from old.nom then
    insert into identite_sportif_corrections (player_id, champ, avant, apres, corrige_par, qualite)
    values (new.id, 'nom', old.nom, new.nom, auth.uid(), v_qualite);
  end if;
  if new.date_naissance is distinct from old.date_naissance then
    insert into identite_sportif_corrections (player_id, champ, avant, apres, corrige_par, qualite)
    values (new.id, 'date_naissance', old.date_naissance::text, new.date_naissance::text, auth.uid(), v_qualite);
  end if;
  return null;
end $$;

drop trigger if exists trg_tracer_correction_identite on public.player_profiles;
create trigger trg_tracer_correction_identite
  after update of prenom, nom, date_naissance on public.player_profiles
  for each row execute function public.tracer_correction_identite();

create or replace function public.corriger_identite_sportif(
  p_player_id uuid, p_prenom text default null, p_nom text default null,
  p_date_naissance date default null)
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
declare v_p player_profiles; v_prenom text; v_nom text; v_dn date; v_lignes integer;
begin
  select * into v_p from player_profiles where id = p_player_id;
  if not found then
    raise exception 'Cette fiche n''existe plus.' using errcode = '22023';
  end if;
  -- LE TITULAIRE, OU SON PARENT CONFIRMÉ. Pas le club : il a `pp_admin_update` pour ce qui est
  -- sportif, et l'identité d'une personne qui a pris possession de sa fiche lui appartient.
  if not (public.is_own_player(p_player_id) or public.is_confirmed_parent_of(p_player_id)) then
    raise exception 'Seul le sportif, ou son parent confirmé, corrige cette identité.' using errcode = '42501';
  end if;

  v_prenom := coalesce(nullif(btrim(coalesce(p_prenom, '')), ''), v_p.prenom);
  v_nom    := coalesce(nullif(btrim(coalesce(p_nom, '')), ''), v_p.nom);
  v_dn     := coalesce(p_date_naissance, v_p.date_naissance);
  if v_dn > (now() at time zone 'Europe/Paris')::date or v_dn < date '1930-01-01' then
    raise exception 'Date de naissance invraisemblable.' using errcode = '22023';
  end if;
  if v_prenom = v_p.prenom and v_nom = v_p.nom and v_dn = v_p.date_naissance then
    return jsonb_build_object('corrige', false, 'raison', 'rien à corriger');
  end if;

  perform set_config('sv.correction_identite', 'oui', true);
  update player_profiles
     set prenom = v_prenom, nom = v_nom, date_naissance = v_dn, updated_at = now()
   where id = p_player_id;
  get diagnostics v_lignes = row_count;
  if v_lignes = 0 then
    raise exception 'La correction n''a rien changé.' using errcode = '42501';
  end if;

  -- ON RELIT LA VALEUR. Le nombre de lignes ne dit pas ce qui est écrit : sur cette table, des
  -- déclencheurs ont déjà rendu « 1 ligne modifiée » avec la valeur restée nulle.
  select * into v_p from player_profiles where id = p_player_id;
  if v_p.prenom <> v_prenom or v_p.nom <> v_nom or v_p.date_naissance <> v_dn then
    raise exception 'La correction n''a pas été enregistrée (relu : % % %).',
      v_p.prenom, v_p.nom, v_p.date_naissance using errcode = '42501';
  end if;
  return jsonb_build_object('corrige', true, 'prenom', v_p.prenom, 'nom', v_p.nom,
                            'date_naissance', v_p.date_naissance);
end $$;

create or replace function public.corrections_identite_sportif(p_player_id uuid)
returns table(champ text, avant text, apres text, qualite text, created_at timestamptz)
language sql stable security definer set search_path to 'public', 'pg_temp'
as $$
  select c.champ, c.avant, c.apres, c.qualite, c.created_at
    from identite_sportif_corrections c
   where c.player_id = p_player_id
     and (public.is_own_player(p_player_id)
          or public.is_confirmed_parent_of(p_player_id)
          or public.peut_travailler_club((select club_id from player_profiles where id = p_player_id))
          or public.is_club_admin((select club_id from player_profiles where id = p_player_id))
          or public.est_direction_sportvision())
   order by c.created_at desc;
$$;

-- ═══ 7. LES DROITS ═════════════════════════════════════════════════════════════════════════════
-- Aucune de ces fonctions n'est appelée par une policy : le revoke les borne sans rien casser
-- (leçon du 12/09, vérifiée à l'envers sur la v384).

revoke all on function public.fiches_a_revendiquer(text, text) from public, anon;
revoke all on function public.revendiquer_fiche(uuid, text, text) from public, anon;
revoke all on function public.revendications_a_decider(uuid) from public, anon;
revoke all on function public.decider_revendication(uuid, text, text) from public, anon;
revoke all on function public.corriger_identite_sportif(uuid, text, text, date) from public, anon;
revoke all on function public.corrections_identite_sportif(uuid) from public, anon;
grant execute on function public.fiches_a_revendiquer(text, text) to authenticated;
grant execute on function public.revendiquer_fiche(uuid, text, text) to authenticated;
grant execute on function public.revendications_a_decider(uuid) to authenticated;
grant execute on function public.decider_revendication(uuid, text, text) to authenticated;
grant execute on function public.corriger_identite_sportif(uuid, text, text, date) to authenticated;
grant execute on function public.corrections_identite_sportif(uuid) to authenticated;

comment on table public.revendications_fiche is
  'Un compte déclare être le sportif d''une fiche pré-créée. Le CLUB confirme : decider_revendication '
  'est le seul chemin qui pose player_profiles.user_id, et proteger_identite_joueur refuse ce champ '
  'partout ailleurs. Revendiquer n''est PAS consentir : aucune empreinte n''est calculée ici.';


-- ═══ 8. CE QUE LA FERMETURE DU TROU A RÉVÉLÉ ═══════════════════════════════════════════════════
-- En ajoutant `coalesce` à la garde de `client_id` (section 5), un test VERT est devenu ROUGE :
-- `reservation-parent-enfant-club`, « le parent confirmé obtient une fiche client : attendu oui,
-- obtenu refusé ». C'est la mesure la plus utile de cette migration : la règle écrite dans la garde
-- depuis le 11/09 n'était pas appliquée, et une des deux écritures autorisées ne posait pas son
-- marqueur. Personne ne pouvait s'en apercevoir, puisque la garde ne levait jamais.
--
-- On rend donc à cette écriture son marqueur. Le corps de la fonction est inchangé par ailleurs.

CREATE OR REPLACE FUNCTION public.connect_resolve_beneficiary_client_id(p_kind text, p_ref_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$

declare
  v_owner uuid;
  v_client_id uuid;
  v_prenom text;
  v_nom text;
  v_email text;
  v_label text;
  v_client_row jsonb;
  v_created boolean;
  v_sport text;
  v_pole_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  -- ── Enfant affilié à un club partenaire (12/09/2026) ──
  -- Ce cas n'existait pas : un parent confirmé ne pouvait rien réserver pour son enfant, alors
  -- que c'est le cas le plus courant du produit. Il retombait sur un e-mail manuel.
  --
  -- Le client facturé n'est PAS le club : c'est la famille. On crée donc, comme pour un profil
  -- géré, une fiche client au nom de l'enfant — mais avec les coordonnées du PARENT qui réserve,
  -- pour que l'opérateur ait quelqu'un à joindre le jour de la prestation. Sans e-mail ni
  -- téléphone, une mission arrive sur le terrain sans contact.
  if p_kind = 'club' then
    if p_ref_id is null then
      raise exception 'Sportif requis.';
    end if;
    if not is_confirmed_parent_of(p_ref_id) then
      raise exception 'Cet enfant n''est pas le vôtre, ou le rattachement n''est pas confirmé.';
    end if;

    select pp.client_id, pp.prenom, pp.nom, c.discipline
      into v_client_id, v_prenom, v_nom, v_sport
      from player_profiles pp left join clubs c on c.id = pp.club_id
     where pp.id = p_ref_id;
    if v_client_id is not null then
      return v_client_id;
    end if;

    v_pole_id := resolve_pole_by_sport(v_sport);
    select u.email into v_email from auth.users u where u.id = auth.uid();

    insert into clients (nom, type_client, prenom_contact, nom_contact, email, telephone, pole_id, origine_prospect)
    select coalesce(v_prenom, '') || ' ' || coalesce(v_nom, ''), 'particulier',
           pf.prenom, pf.nom, v_email,
           (select cps.telephone from connect_profile_settings cps where cps.user_id = auth.uid()),
           coalesce(v_pole_id, pole_football_id()), 'connect'
      from parent_profiles pf where pf.user_id = auth.uid()
    returning id into v_client_id;

    -- v387 (01/10/2026) — LE MARQUEUR MANQUAIT SUR CETTE ÉCRITURE-LÀ, et personne ne pouvait le
    -- voir. La garde `proteger_identite_joueur` est censée n'autoriser le premier rattachement
    -- client qu'aux deux fonctions désignées, « qui le signalent par ce marqueur transactionnel ».
    -- Cette fonction en a DEUX écritures de `client_id` : la seconde posait le marqueur, celle-ci
    -- ne le posait pas. Elle passait quand même, parce que la garde ne levait rien quand le réglage
    -- était absent — `not (… and NULL)` vaut NULL, et `if NULL then raise` ne lève pas.
    --
    -- En fermant ce trou (même migration, juste au-dessus), cette écriture s'est mise à être
    -- refusée : test `reservation-parent-enfant-club` passé de vert à rouge, « le parent confirmé
    -- obtient une fiche client : attendu oui, obtenu refusé ». C'est le chemin légitime, il reçoit
    -- donc son marqueur, comme l'autre. Le droit, lui, est vérifié plus haut par
    -- `is_confirmed_parent_of`.
    perform set_config('sv.ecriture_systeme', 'client_joueur', true);
    update player_profiles set client_id = v_client_id where id = p_ref_id;
    perform set_config('sv.ecriture_systeme', '', true);
    insert into messages_client (client_id, auteur_type, auteur_staff_id, contenu)
      values (v_client_id, 'staff', null, 'Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.');
    return v_client_id;
  end if;

  if p_kind = 'managed' then
    if not exists (select 1 from managed_athlete_profiles where id = p_ref_id and owner_user_id = auth.uid()) then
      raise exception 'Profil géré introuvable ou accès refusé.';
    end if;

    select client_id, prenom, nom, sport into v_client_id, v_prenom, v_nom, v_sport
      from managed_athlete_profiles where id = p_ref_id;
    if v_client_id is not null then
      return v_client_id;
    end if;

    -- FIX v33 : sport du profil géré (managed_athlete_profiles.sport, saisi dans
    -- ManagedAthleteForm.tsx) résolu en pôle réel s'il en existe un, même logique que
    -- self/linked ci-dessous (resolve_pole_by_sport, v13) — jamais fait avant cette
    -- migration, la ligne clients retombait silencieusement sur pole_football_id().
    v_pole_id := resolve_pole_by_sport(v_sport);

    -- Pas de rattachement par e-mail ici : un profil géré (enfant, proche) n'a pas
    -- d'adresse e-mail propre, donc rien à retrouver dans clients par ce biais.
    insert into clients (nom, type_client, prenom_contact, nom_contact, pole_id)
      values (v_prenom || ' ' || v_nom, 'particulier', v_prenom, v_nom, coalesce(v_pole_id, pole_football_id()))
      returning id into v_client_id;
    update managed_athlete_profiles set client_id = v_client_id, updated_at = now() where id = p_ref_id;
    insert into messages_client (client_id, auteur_type, auteur_staff_id, contenu)
      values (v_client_id, 'staff', null, 'Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.');
    return v_client_id;
  end if;

  if p_kind = 'self' then
    v_owner := auth.uid();
  elsif p_kind = 'linked' then
    if p_ref_id is null then
      raise exception 'Sportif requis.';
    end if;
    if p_ref_id = auth.uid() then
      v_owner := auth.uid(); -- garde-fou : "linked" vers soi-même équivaut à "self"
    elsif not exists (
      select 1 from connect_access_relationships
      where owner_user_id = p_ref_id and grantee_user_id = auth.uid()
        and status = 'acceptee' and right_reserver
    ) then
      raise exception 'Autorisation de réservation manquante pour ce sportif.';
    else
      v_owner := p_ref_id;
    end if;
  else
    raise exception 'Type de bénéficiaire invalide.';
  end if;

  select email, raw_user_meta_data->>'first_name', raw_user_meta_data->>'last_name'
    into v_email, v_prenom, v_nom
    from auth.users where id = v_owner;

  -- BUGFIX v13 : sport choisi à l'inscription (state.sport, /signup/sport),
  -- écrit dans connect_profile_settings.sport au premier login (voir
  -- lib/signup/pending-onboarding.ts côté app-connect) — résolu ici en pôle
  -- réel s'il en existe un, sinon reste NULL (capté comme signal de demande,
  -- voir resolve_pole_by_sport ci-dessus).
  select sport into v_sport from connect_profile_settings where user_id = v_owner;
  v_pole_id := resolve_pole_by_sport(v_sport);

  select client_id into v_client_id
    from player_profiles where user_id = v_owner limit 1;
  if found then
    if v_client_id is not null then
      return v_client_id;
    end if;

    if v_email is not null then
      v_client_row := find_or_create_client_by_email(
        v_email, 'prospect', 'particulier',
        nullif(trim(coalesce(v_prenom, '') || ' ' || coalesce(v_nom, '')), ''),
        v_nom, v_prenom, null, 'connect', null, null, v_pole_id
      );
      v_client_id := (v_client_row->>'id')::uuid;
      v_created := coalesce((v_client_row->>'_created')::boolean, true);
    else
      -- Filet historique : pas d'e-mail résolvable (cas théorique), comportement inchangé
      -- hormis pole_id, désormais posé explicitement comme partout ailleurs dans cette fonction.
      insert into clients (nom, type_client, prenom_contact, nom_contact, pole_id)
        values (coalesce(v_prenom, '') || ' ' || coalesce(v_nom, ''), 'particulier', v_prenom, v_nom, coalesce(v_pole_id, pole_football_id()))
        returning id into v_client_id;
      v_created := true;
    end if;

    -- Premier rattachement de la fiche à son client : marqueur reconnu par proteger_identite_joueur
    -- (blocages-review-4, 11/09/2026), retiré aussitôt la mise à jour faite.
    perform set_config('sv.ecriture_systeme', 'client_joueur', true);
    update player_profiles set client_id = v_client_id where user_id = v_owner;
    perform set_config('sv.ecriture_systeme', '', true);
    if v_created then
      insert into messages_client (client_id, auteur_type, auteur_staff_id, contenu)
        values (v_client_id, 'staff', null, 'Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.');
    end if;
    return v_client_id;
  end if;

  -- Pas de player_profiles (particulier, ou joueur/sportif sans club) :
  -- connect_profile_settings.client_id, provisionné à la demande.
  select client_id into v_client_id from connect_profile_settings where user_id = v_owner;
  if v_client_id is not null then
    return v_client_id;
  end if;

  v_label := nullif(trim(coalesce(v_prenom, '') || ' ' || coalesce(v_nom, '')), '');
  if v_label is null then
    v_label := coalesce(split_part(v_email, '@', 1), 'Client Connect');
  end if;

  if v_email is not null then
    v_client_row := find_or_create_client_by_email(
      v_email, 'prospect', 'particulier', v_label, v_nom, v_prenom, null, 'connect', null, null, v_pole_id
    );
    v_client_id := (v_client_row->>'id')::uuid;
    v_created := coalesce((v_client_row->>'_created')::boolean, true);
  else
    -- Filet historique : pas d'e-mail résolvable (cas théorique), comportement inchangé
    -- hormis pole_id, désormais posé explicitement comme partout ailleurs dans cette fonction.
    insert into clients (nom, type_client, prenom_contact, nom_contact, pole_id)
      values (v_label, 'particulier', v_prenom, v_nom, coalesce(v_pole_id, pole_football_id()))
      returning id into v_client_id;
    v_created := true;
  end if;

  insert into connect_profile_settings (user_id, client_id, account_type)
    values (v_owner, v_client_id, 'particulier')
  on conflict (user_id) do update set client_id = excluded.client_id;

  if v_created then
    insert into messages_client (client_id, auteur_type, auteur_staff_id, contenu)
      values (v_client_id, 'staff', null, 'Bienvenue sur SportVision Connect. Écrivez-nous ici pour toute question sur vos prestations.');
  end if;

  return v_client_id;
end;
$function$;

commit;
