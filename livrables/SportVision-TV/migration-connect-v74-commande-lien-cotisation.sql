-- ============================================================
-- SPORTVISION CONNECT (personnel) — Migration v74
-- Lien manquant "Créer une cotisation" depuis la fiche d'une commande (CommandeDetailView.tsx,
-- Espace joueur + Espace particulier, qui partagent le même composant).
--
-- Contexte (demande Fouka, 16/08) : le wizard de réservation (ReservationWizard.tsx /
-- ReservationWizardParticulier.tsx) affiche déjà, juste après une demande en "Payer à
-- plusieurs", un bouton "Créer une cotisation" (router.push vers /cotisations/creer?offreId=...
-- ou /particulier/cotisations/creer?offreId=...). Mais si l'utilisateur quitte cet écran de
-- confirmation sans cliquer (ferme l'onglet, revient plus tard), il n'a alors PLUS AUCUN moyen
-- de créer cette cotisation depuis la fiche de sa commande (CommandeDetailView.tsx, page "Mes
-- commandes" -> détail) : aucune référence à "cotisation" n'y existe. Cette migration ajoute la
-- seule pièce manquante côté base pour réparer ça côté frontend : une RPC qui, à partir d'une
-- prestation, retrouve l'offre du catalogue à pré-remplir dans le lien, indique si la commande a
-- été passée en "Payer à plusieurs", et si une cotisation ouverte existe déjà pour cette même
-- offre (pour proposer "Voir la cotisation" plutôt que d'en recréer une en double).
--
-- Pourquoi une NOUVELLE RPC plutôt que d'étendre l'Edge Function connect-player-prestations
-- (qui sert déjà get_order) : un autre agent travaille EN PARALLÈLE sur ce fichier précis
-- (paiement espèces des réservations solo) — toute modification dessus créerait un conflit de
-- merge. Cette RPC est un ajout strictement additif (nouvelle fonction Postgres, table
-- `prestations` non modifiée), zéro redéploiement d'Edge Function nécessaire, zéro dépendance
-- sur ce fichier.
--
-- Comment "Payer à plusieurs" est détecté : `prestations` n'a AUJOURD'HUI AUCUNE colonne
-- structurée pour ce choix (vérifié : connect-player-prestations, action "create_request",
-- n'écrit ce choix que sous forme de texte libre dans `description_besoin`, ligne
-- "Paiement souhaité : à plusieurs (cotisation) — ..." — voir son en-tête). Plutôt que de
-- toucher ce fichier interdit pour ajouter une vraie colonne, cette RPC détecte ce texte connu
-- par correspondance (ilike). Fragile en théorie (dépend d'un texte figé côté Edge Function),
-- mais c'est le seul signal qui existe réellement en base aujourd'hui pour ce chantier précis —
-- documenté ici plutôt que remplacé par une colonne qui aurait nécessité de toucher un fichier
-- explicitement hors périmètre.
--
-- Rattachement offre (pas prestation précise) — limite assumée, comme demandé : group_fundings
-- est rattaché à catalogue_offre_id (le TYPE d'offre), jamais à une prestation précise
-- (migration-connect-v50). Un joueur qui réserve deux fois "Match Vidéo" à plusieurs (deux
-- matchs différents) et crée une cotisation depuis la première commande verra donc cette MÊME
-- cotisation proposée en "Voir la cotisation" depuis la seconde commande, si la première est
-- encore ouverte — un faux-positif d'affichage, jamais une erreur d'argent (create_group_funding
-- recalcule toujours son propre montant_cible depuis le catalogue, aucun montant n'est jamais
-- hérité d'une autre commande). Cas jugé suffisamment rare (même offre, même joueur, deux
-- commandes distinctes, la première encore ouverte) pour ne pas justifier un rattachement plus
-- complexe non demandé par Fouka — voir rapport de l'agent.
--
-- Accès : réutilise connect_client_ids_for_caller('commandes') (migration-connect-v51), qui
-- couvre déjà TOUS les cas déjà gérés par get_order côté Edge Function (joueur, particulier
-- "self", sportif lié/géré) en une seule requête — pas besoin de dupliquer la distinction
-- multi/non-multi de l'Edge Function ici.
--
-- Idempotente
-- (create or replace function). Aucun redéploiement d'Edge Function nécessaire.
--
-- EXÉCUTÉE — vérifié en base réelle le 19/08/2026 (audit pré-lancement) :
-- fonction connect_get_order_funding_link existe déjà en base. Cet
-- en-tête disait à tort "NON EXÉCUTÉE".
-- ============================================================

create or replace function connect_get_order_funding_link(p_prestation_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  v_prestation record;
  v_is_collectif boolean;
  v_existing record;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  select p.id, p.offre_id, p.client_id, p.description_besoin
  into v_prestation
  from prestations p
  where p.id = p_prestation_id
    and p.client_id in (select client_id from connect_client_ids_for_caller('commandes'));

  if not found then
    return null;
  end if;

  if v_prestation.offre_id is null then
    -- Prestation sur devis / créée sans offre catalogue (ex. depuis la vitrine publique) :
    -- aucune offre à pré-remplir, create_group_funding() exige de toute façon un
    -- catalogue_offre_id valide (migration-connect-v50).
    return jsonb_build_object('offre_id', null, 'is_collectif', false, 'existing_funding_id', null, 'existing_funding_share_token', null);
  end if;

  v_is_collectif := coalesce(v_prestation.description_besoin, '') ilike '%à plusieurs (cotisation)%';

  select gf.id, gf.share_token into v_existing
  from group_fundings gf
  where gf.catalogue_offre_id = v_prestation.offre_id
    and gf.created_by = auth.uid()
    and gf.statut in ('ouverte', 'objectif_atteint')
  order by gf.created_at desc
  limit 1;

  return jsonb_build_object(
    'offre_id', v_prestation.offre_id,
    'is_collectif', v_is_collectif,
    'existing_funding_id', v_existing.id,
    'existing_funding_share_token', v_existing.share_token
  );
end;
$$;

grant execute on function connect_get_order_funding_link(uuid) to authenticated;
