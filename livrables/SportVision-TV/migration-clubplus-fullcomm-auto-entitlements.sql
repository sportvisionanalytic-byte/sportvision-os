-- ============================================================================
-- migration-clubplus-fullcomm-auto-entitlements.sql
-- ============================================================================
-- Bug réel trouvé le 22/08/2026 : Fouka a activé le contrat Full Communication
-- de V340 SC (statut passé à 'actif' après signature papier hors plateforme,
-- Yousign n'étant pas encore en production), mais Club+ restait entièrement
-- verrouillé pour ce club — "Club+ gratuit", aucune fonctionnalité.
--
-- Root cause : `organization_entitlements` (qui gate 7 modules Club+ — teams,
-- matchcenter, newsroom, visual_requests, content, sponsors, presences, voir
-- MODULE_TO_CONNECT_MODULE dans app-next/src/lib/supabase/entitlements.ts)
-- n'a JAMAIS été peuplée automatiquement nulle part dans ce projet — vérifié :
-- aucun webhook Stripe, aucune edge function d'activation, aucun trigger
-- n'insère dans cette table. C'est un pont jamais construit entre "contrat
-- Full Communication actif" et "modules Club+ débloqués", pas une régression.
-- Corrigé manuellement pour V340 SC (7 lignes organization_entitlements
-- insérées à la main) ; cette migration construit le pont pour de bon, afin
-- que ça ne se reproduise jamais sur le prochain club Full Communication.
--
-- Choix : uniquement ACTIVER (jamais désactiver automatiquement à la
-- résiliation) — la désactivation d'un accès déjà donné à un club reste une
-- décision staff volontaire, pas un effet de bord automatique d'un trigger.
-- ============================================================================

create or replace function activer_entitlements_full_communication()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
begin
  if new.type_contrat = 'full_communication' and new.statut = 'actif' then
    select id into v_club_id from clubs where portail_client_id = new.client_id;
    if v_club_id is not null then
      insert into organization_entitlements (organization_id, module_key, actif, priorite, source_contrat_id)
      select v_club_id, m.module_key, true, 'prioritaire', new.id
      from (values
        ('equipes'), ('match_center'), ('newsroom'),
        ('demandes_visuels'), ('bibliotheque_contenus'), ('sponsors'), ('presences')
      ) as m(module_key)
      on conflict (organization_id, module_key)
      do update set actif = true, priorite = 'prioritaire', source_contrat_id = excluded.source_contrat_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_activer_entitlements_full_communication on contrats;
create trigger trg_activer_entitlements_full_communication
  after insert or update on contrats
  for each row execute function activer_entitlements_full_communication();
