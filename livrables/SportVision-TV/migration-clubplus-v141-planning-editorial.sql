-- Le planning éditorial du CM, sur la table existante `contenus` (11/09/2026).
--
-- Demande de Fouka : le Centre communication de Club+ doit être l'outil de travail principal du CM
-- (créer, modifier, reprogrammer, dupliquer, supprimer un contenu non publié). Sur Villemomble, le CM
-- lisait « Rien de programmé pour le moment » sans aucun bouton pour construire le planning.
--
-- Audit avant de toucher au modèle : `contenus` EST le planning éditorial (type, réseau, date prévue,
-- statut brouillon → publié, brief, lien vers une demande du club, un match ou un événement), déjà
-- lu par l'OS et par Club+. Aucune seconde base. Il manquait :
--   • l'heure (date_prevue seule ne dit pas « 18:00 ») ;
--   • l'équipe concernée ;
--   • le lien vers une séance d'entraînement précise (`entrainement:<créneau>:<date>`, la référence
--     des présences et des souhaits, rien de matérialisé).
--
-- Droits, vérifiés en base (déjà en place, sauf un écart) :
--   CM affecté au club      lit et écrit les contenus du club (contenus_visible_par_cm) ;
--   CM d'un autre club      refusé ;  coach   aucune écriture ;
--   président / club        lecture des contenus sortis du brouillon, validation par
--                           client_valider_contenu (workflow existant) ;
--   admin                   tout.
-- L'écart : seul l'AUTEUR d'un contenu pouvait le supprimer — un second CM du club ne pouvait pas
-- supprimer un brouillon du premier. Désormais tout CM du club supprime un contenu NON PUBLIÉ ; un
-- contenu publié ou archivé ne se supprime plus (il s'archive), et ses champs de publication ne se
-- réécrivent plus (date, heure, réseau, type, titre) : il fait partie de l'historique du club.

begin;

alter table public.contenus add column if not exists heure_prevue time;
alter table public.contenus add column if not exists team_id uuid references public.club_teams(id) on delete set null;
alter table public.contenus add column if not exists occurrence_ref text;
create index if not exists idx_contenus_client_date on public.contenus (client_id, date_prevue);

drop policy if exists contenus_delete on public.contenus;
create policy contenus_delete on public.contenus for delete using (
  statut not in ('publie', 'archive')
  and (cm_id = auth.uid()
       or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
       or contenus_visible_par_cm(client_id, auth.uid()))
);

create or replace function public.proteger_contenu_publie()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if old.statut = 'publie'
     and not exists (select 1 from profiles where id = auth.uid() and role = 'admin')
     and (new.date_prevue is distinct from old.date_prevue or new.heure_prevue is distinct from old.heure_prevue
          or new.plateforme is distinct from old.plateforme or new.type_contenu is distinct from old.type_contenu
          or new.titre is distinct from old.titre or new.date_publication is distinct from old.date_publication
          or (new.statut is distinct from old.statut and new.statut <> 'archive')) then
    raise exception 'Ce contenu est publié : il fait partie de l''historique du club. Archivez-le, ou dupliquez-le pour en préparer un nouveau.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_proteger_contenu_publie on public.contenus;
create trigger trg_proteger_contenu_publie before update on public.contenus
  for each row execute function proteger_contenu_publie();

commit;
