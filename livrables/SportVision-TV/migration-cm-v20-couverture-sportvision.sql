-- ═══════════════════════════════════════════════════════════════════════════════
-- VAGUE C — « SportVision sera présent » : du calendrier Club+ jusqu'à la Production
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Le moteur existe deja : planned_presences prevoit source='cm_initiated', les trois types de
-- couverture, les statuts, le lien au match et au plan mensuel. Rien n'est reconstruit ici. Il
-- manquait quatre choses, et seulement quatre.
--
-- 1. LE CHEMIN D'AUTORISATION. contenus_visible_par_cm() gouverne l'acces aux plans et aux
--    presences, mais il ne connait que l'ANCIEN modele : client_affiliations, clients.cm_id,
--    niveau_cm. Mesure sur le vrai CM de Villeneuve : il renvoie false. Le clic aurait echoue au
--    niveau des permissions. On AJOUTE une branche fondee sur cm_clubs_autorises(), sans rien
--    retirer a l'ancien modele, qui gouverne d'autres contenus herites.
--
-- 2. L'UNICITE. Aucune contrainte n'empechait deux presences sur le meme evenement. Deux clics
--    rapides en creaient deux. Des index uniques partiels s'en chargent, en base, et non par un
--    bouton desactive cote navigateur.
--
-- 3. L'OCCURRENCE VIRTUELLE. Un entrainement projete n'existe pas comme ligne : sa reference est
--    « entrainement:<slot>:<AAAA-MM-JJ> ». Aucune colonne ne pouvait la porter. On l'ajoute, et
--    elle participe a l'unicite, pour que couvrir le 17 decembre ne couvre pas tous les jeudis.
--
-- 4. LE SIGNAL DE MODIFICATION. Un match deplace apres planification doit se voir cote Production.
--    Un declencheur en base, pas un appel dans un gestionnaire d'interface : un match se modifie
--    depuis Club+, depuis l'OS, par import, et demain par une automatisation.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Ce que la presence doit pouvoir designer, et l'etat « evenement modifie »
-- ─────────────────────────────────────────────────────────────────────────────
alter table planned_presences add column if not exists occurrence_ref text;
alter table planned_presences add column if not exists evenement_modifie_at timestamptz;
alter table planned_presences add column if not exists evenement_modifie_detail text;
alter table planned_presences add column if not exists demande_par uuid references auth.users(id) on delete set null;

comment on column planned_presences.occurrence_ref is
  'Reference stable d''une occurrence non materialisee : « entrainement:<slot_id>:<AAAA-MM-JJ> ». Permet de couvrir UNE seance sans couvrir toute la recurrence.';
comment on column planned_presences.evenement_modifie_detail is
  'Ce qui a change depuis la planification, en clair, pour que la Production comprenne sans enqueter.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. L'unicite : un evenement, une couverture
-- ─────────────────────────────────────────────────────────────────────────────
-- Partielle sur `statut <> 'annule'` : une couverture annulee ne doit pas empecher d'en
-- redemander une. Et l'unicite porte sur l'EVENEMENT, pas sur le couple evenement+type : passer
-- de photo a photo+video doit modifier la ligne existante, pas en creer une seconde.
create unique index if not exists pp_un_match_une_couverture
  on planned_presences (match_id) where match_id is not null and statut <> 'annule';
create unique index if not exists pp_une_occurrence_une_couverture
  on planned_presences (occurrence_ref) where occurrence_ref is not null and statut <> 'annule';
create unique index if not exists pp_un_evenement_une_couverture
  on planned_presences (calendar_event_id) where calendar_event_id is not null and statut <> 'annule';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Le nouveau chemin d'autorisation
-- ─────────────────────────────────────────────────────────────────────────────
-- Le rapprochement client ↔ club passe par clubs.portail_client_id, un identifiant, jamais un nom.
-- Et il relit cm_clubs_autorises() a chaque requete : un CM desaffecte perd l'acces immediatement,
-- sans qu'aucune ligne ait besoin d'etre nettoyee.
create or replace function public.cm_client_autorise(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p_client_id is not null
     and exists (select 1 from clubs c
                 where c.portail_client_id = p_client_id
                   and c.id in (select cm_clubs_autorises()));
$function$;

comment on function public.cm_client_autorise(uuid) is
  'Le client appartient-il a un club actuellement confie au CM connecte ? Rapprochement par clubs.portail_client_id. Complement du modele historique contenus_visible_par_cm(), qu''il ne remplace pas.';

drop policy if exists mpp_cm_affecte_select on monthly_production_plans;
create policy mpp_cm_affecte_select on monthly_production_plans for select to authenticated
  using (cm_client_autorise(client_id));

drop policy if exists mpp_cm_affecte_insert on monthly_production_plans;
create policy mpp_cm_affecte_insert on monthly_production_plans for insert to authenticated
  with check (cm_client_autorise(client_id));

drop policy if exists pp_cm_affecte_select on planned_presences;
create policy pp_cm_affecte_select on planned_presences for select to authenticated
  using (exists (select 1 from monthly_production_plans p
                 where p.id = plan_id and cm_client_autorise(p.client_id)));

drop policy if exists pp_cm_affecte_insert on planned_presences;
create policy pp_cm_affecte_insert on planned_presences for insert to authenticated
  with check (exists (select 1 from monthly_production_plans p
                      where p.id = plan_id and cm_client_autorise(p.client_id)));

-- Modification et annulation : le meme garde-fou que le modele historique. Une fois la mission
-- creee par la Production, le CM ne touche plus rien en silence.
drop policy if exists pp_cm_affecte_update on planned_presences;
create policy pp_cm_affecte_update on planned_presences for update to authenticated
  using (statut <> 'mission_creee'
         and exists (select 1 from monthly_production_plans p
                     where p.id = plan_id and cm_client_autorise(p.client_id)))
  with check (statut <> 'mission_creee'
              and exists (select 1 from monthly_production_plans p
                          where p.id = plan_id and cm_client_autorise(p.client_id)));

commit;

select 'OK — socle de la couverture SportVision en place' as verdict;
