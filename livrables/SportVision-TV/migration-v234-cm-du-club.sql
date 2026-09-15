-- v234 — Le Community Manager DU CLUB.
--
-- DEMANDE DE FOUKA, 15/09/2026 : « sur Club+ rajouter aussi le rôle de Community Manager du club,
-- il aura donc le même accès que le Community Manager affilié, tout pareil, ils partagent ensemble
-- les galeries ». Puis : « il faut que je puisse l'inviter ».
--
-- SES CHOIX, posés en questions :
--   · un rôle DISTINCT du CM affilié — pour qu'on sache, dans la liste des membres, qui est
--     SportVision et qui appartient au club ;
--   · accès complet SAUF l'argent (factures, Stripe) et les accès (inviter, paramètres) ;
--   · sur les galeries : il VOIT et PARTAGE, il ne crée pas et ne fixe aucun prix.
--
-- LE RÔLE EXISTE DÉJÀ : `comm` dans club_members, câblé côté écrans sous le nom
-- `communication_manager`. Il portait déjà les actualités, les créations, les réseaux sociaux et
-- les souhaits de couverture. Ce qui lui manquait, c'est le cœur du métier : le PLANNING
-- ÉDITORIAL. Cette migration le lui ouvre.
--
-- ═══ LE POINT DUR : QUI EST L'AUTEUR ? ════════════════════════════════════════════════════════
-- `contenus.cm_id` est NOT NULL et référence `profiles` — la table des collaborateurs
-- SportVision. Un membre de club n'y a pas de ligne, et ne doit pas en avoir : il n'est pas
-- salarié ni prestataire de SportVision.
--
-- On ne rend pas `cm_id` facultatif pour autant. Tout ce qui sort au nom d'un club reste sous la
-- responsabilité du CM SportVision qui suit ce compte : c'est lui qu'on appelle si une
-- publication pose problème, et c'est son planning que l'OS affiche. Un contenu écrit par le club
-- porte donc le CM référent du client, et une colonne dit QUI du club l'a réellement écrit.
--
-- Le trigger s'en charge : le club n'a ni à connaître ni à choisir ce CM référent. S'il n'y en a
-- aucun, l'écriture est refusée avec une phrase qui dit quoi faire, plutôt qu'une erreur de clé
-- étrangère.
--
-- Idempotent.

-- ── 1. Qui a réellement écrit ─────────────────────────────────────────────────────────────────
-- FK vers auth.users et pas profiles : c'est justement quelqu'un qui n'est pas dans profiles.
alter table contenus add column if not exists auteur_club_user_id uuid references auth.users(id) on delete set null;

comment on column contenus.auteur_club_user_id is
  'Membre du club qui a écrit ce contenu, quand il vient du club et non de SportVision (v234). `cm_id` reste le CM SportVision responsable du compte ; cette colonne dit qui a tenu le clavier.';

-- ── 2. Le CM du club ──────────────────────────────────────────────────────────────────────────
create or replace function est_cm_du_club(p_client_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1
    from club_members m
    join clubs c on c.id = m.club_id
    where m.user_id = auth.uid()
      and m.status = 'actif'
      and m.role = 'comm'
      and c.portail_client_id = p_client_id
      and p_client_id is not null
  );
$$;

comment on function est_cm_du_club(uuid) is
  'Community Manager DU CLUB (club_members.role = ''comm''), par opposition au CM affilié de SportVision. Décidé le 15/09/2026 : même travail éditorial, mais ni l''argent ni les accès.';

-- Le CM SportVision qui répond de ce compte : le référent du client, sinon le CM affecté au club.
create or replace function cm_referent_du_client(p_client_id uuid)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select cl.cm_id from clients cl where cl.id = p_client_id and cl.cm_id is not null),
    (select a.cm_id
       from club_cm_affectations a
       join clubs c on c.id = a.club_id
      where c.portail_client_id = p_client_id
        and a.actif
        and (a.date_fin is null or a.date_fin >= (now() at time zone 'Europe/Paris')::date)
      order by case when a.role = 'principal' then 0 else 1 end, a.date_debut
      limit 1)
  );
$$;

-- ── 3. Le club écrit son planning ─────────────────────────────────────────────────────────────
drop policy if exists contenus_club_comm_insert on contenus;
create policy contenus_club_comm_insert on contenus for insert
  with check (est_cm_du_club(client_id));

drop policy if exists contenus_club_comm_update on contenus;
create policy contenus_club_comm_update on contenus for update
  using (est_cm_du_club(client_id))
  with check (est_cm_du_club(client_id));

-- Supprimer : comme le CM, et jamais ce qui est déjà publié ou archivé.
drop policy if exists contenus_club_comm_delete on contenus;
create policy contenus_club_comm_delete on contenus for delete
  using (est_cm_du_club(client_id) and statut <> all (array['publie','archive']));

-- ── 4. L'auteur se pose tout seul ─────────────────────────────────────────────────────────────
create or replace function contenu_auteur_du_club()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_ref uuid;
begin
  -- Un collaborateur SportVision qui écrit : rien ne change.
  if exists (select 1 from profiles p where p.id = auth.uid()) then
    return new;
  end if;
  if auth.uid() is null or not est_cm_du_club(new.client_id) then
    return new;
  end if;

  -- L'ecran envoie l'identifiant de celui qui saisit : pour un membre du club, ce n'est PAS un
  -- profil SportVision et la cle etrangere le rejetterait. On corrige ici plutot que d'obliger
  -- chaque ecran a connaitre le CM referent du compte — il n'a pas a le savoir, ni a le choisir.
  new.auteur_club_user_id := auth.uid();
  v_ref := cm_referent_du_client(new.client_id);
  if v_ref is null then
    raise exception 'Ce club n''a pas encore de Community Manager SportVision référent : demandez-lui de vous en affecter un avant de construire le planning.'
      using errcode = '23502';
  end if;
  new.cm_id := v_ref;
  return new;
end $$;

drop trigger if exists trg_contenu_auteur_du_club on contenus;
create trigger trg_contenu_auteur_du_club
  before insert on contenus
  for each row execute function contenu_auteur_du_club();
