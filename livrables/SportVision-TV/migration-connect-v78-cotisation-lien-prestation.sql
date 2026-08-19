-- migration-connect-v78-cotisation-lien-prestation.sql
-- EXÉCUTÉE le 19/08/2026 (Fouka : "ok mais du coup applique ses correction au vrai truc si ya
-- besoin", en réponse à l'audit démo Connect du 19/08 qui a révélé un vrai bug produit, pas
-- seulement un artefact de démo).
--
-- Contexte du bug (voir DEMO_INVOICES dans src/lib/demo/mock-data.ts, corrigé côté démo le
-- même jour en attendant ce fix réel) : group_fundings n'a jamais eu de colonne prestation_id,
-- seulement catalogue_offre_id (le TYPE de prestation, migration-connect-v50). Un client qui
-- réserve deux fois la même offre et ouvre un paiement collectif pour chacune voit les deux
-- cotisations confondues (connect_get_order_funding_link matchait par offre, pas par
-- commande — limite déjà documentée en commentaire dans
-- migration-connect-v74-commande-lien-cotisation.sql). Plus grave : le calcul du "reste dû"
-- côté Stripe (create-checkout-session/index.ts) ne lit QUE la table paiements, jamais
-- funding_contributions — un client qui a déjà fait payer 100€ sur 160€ par ses coéquipiers via
-- un paiement collectif se voit donc réclamer les 160€ en entier au moment de payer le solde
-- lui-même, sans qu'aucune facture ne reflète les 100€ déjà collectés.
--
-- Risque réel au moment du fix : vérifié en base — un seul group_fundings existe au total
-- (statut 'ouverte'), sa seule funding_contributions est un paiement carte ÉCHOUÉ (10€). Aucune
-- somme réelle n'est donc affectée par cette migration.
--
-- Portée de ce fix (voir rapport à Fouka pour ce qui reste manuel côté staff/OS) :
--   1. group_fundings.prestation_id (nouvelle colonne, nullable) — lie désormais une cotisation
--      à LA commande précise pour laquelle elle a été ouverte, pas seulement au type d'offre.
--   2. create_group_funding() — nouveau paramètre optionnel p_prestation_id, revérifié côté
--      serveur (la prestation doit appartenir à l'appelant via connect_client_ids_for_caller,
--      même droit 'cotisation' déjà utilisé pour le bénéficiaire).
--   3. connect_get_order_funding_link() — recherche désormais la cotisation existante d'abord
--      par prestation_id exact, avec repli sur l'ancienne heuristique par offre pour les
--      cotisations créées avant ce fix (prestation_id NULL).
--   Le calcul du "reste dû" Stripe (create-checkout-session/index.ts) est corrigé séparément
--   dans le code de l'edge function, déployé avec cette migration.

alter table group_fundings add column if not exists prestation_id uuid references prestations(id);

create or replace function public.create_group_funding(
  p_group_id uuid,
  p_catalogue_offre_id uuid,
  p_contexte text,
  p_repartition_mode text,
  p_nb_participants integer,
  p_date_limite date,
  p_beneficiary_kind text default null::text,
  p_beneficiary_owner_user_id uuid default null::uuid,
  p_beneficiary_managed_id uuid default null::uuid,
  p_prestation_id uuid default null::uuid
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_offre catalogue_offres;
  v_montant numeric(10,2);
  v_id uuid;
  v_token text;
  v_label text;
begin
  if p_group_id is not null and not is_member_of_user_group(p_group_id) then
    raise exception 'Vous n''êtes pas membre de ce groupe.';
  end if;

  if p_repartition_mode not in ('egale', 'libre') then
    raise exception 'Mode de répartition invalide.';
  end if;

  if p_repartition_mode = 'egale' and (p_nb_participants is null or p_nb_participants < 2) then
    raise exception 'Indiquez au moins 2 participants pour une répartition à parts égales.';
  end if;

  if p_date_limite is null or p_date_limite < current_date then
    raise exception 'La date limite doit être une date future.';
  end if;

  select * into v_offre from catalogue_offres where id = p_catalogue_offre_id and actif = true;
  if not found then
    raise exception 'Prestation introuvable ou indisponible.';
  end if;
  if v_offre.tarif_type <> 'fixe' or v_offre.prix_ht is null then
    raise exception 'Cette prestation est sur devis : elle ne peut pas être financée par cotisation.';
  end if;

  -- Commande précise (facultatif, migration-connect-v78) : vérification serveur que la
  -- prestation appartient bien à l'appelant (mêmes client_id accessibles que pour le droit
  -- "cotisation"), jamais une confiance dans l'id envoyé par l'écran.
  if p_prestation_id is not null then
    if not exists (
      select 1 from prestations p
      where p.id = p_prestation_id
        and p.client_id in (select client_id from connect_client_ids_for_caller('cotisation'))
    ) then
      raise exception 'Commande introuvable ou accès refusé.';
    end if;
  end if;

  -- Bénéficiaire (facultatif) : vérification serveur du droit "cotisation"
  -- avant toute écriture, jamais une confiance dans ce que l'écran affiche.
  if p_beneficiary_kind is not null then
    if p_beneficiary_kind = 'linked' then
      if p_beneficiary_owner_user_id is null or not exists (
        select 1 from connect_access_relationships
        where owner_user_id = p_beneficiary_owner_user_id and grantee_user_id = auth.uid()
          and status = 'acceptee' and right_cotisation
      ) then
        raise exception 'Autorisation de cotisation manquante pour ce sportif.';
      end if;
      select coalesce(nullif(trim(concat(pp.prenom, ' ', pp.nom)), ''), 'Sportif') into v_label
        from player_profiles pp where pp.user_id = p_beneficiary_owner_user_id;
    elsif p_beneficiary_kind = 'managed' then
      if p_beneficiary_managed_id is null or not exists (
        select 1 from managed_athlete_profiles where id = p_beneficiary_managed_id and owner_user_id = auth.uid()
      ) then
        raise exception 'Profil géré introuvable.';
      end if;
      select prenom || ' ' || nom into v_label from managed_athlete_profiles where id = p_beneficiary_managed_id;
    elsif p_beneficiary_kind <> 'self' then
      raise exception 'Type de bénéficiaire invalide.';
    end if;
  end if;

  v_montant := round(v_offre.prix_ht * (1 + coalesce(v_offre.tva_pct, 20) / 100), 2);

  insert into group_fundings (
    group_id, created_by, catalogue_offre_id, titre, contexte,
    montant_cible, repartition_mode, nb_participants_prevu, date_limite,
    beneficiary_kind, beneficiary_owner_user_id, beneficiary_managed_id, beneficiary_label,
    prestation_id
  ) values (
    p_group_id, auth.uid(), p_catalogue_offre_id, v_offre.nom, nullif(trim(coalesce(p_contexte, '')), ''),
    v_montant, p_repartition_mode, case when p_repartition_mode = 'egale' then p_nb_participants else null end, p_date_limite,
    p_beneficiary_kind, p_beneficiary_owner_user_id, p_beneficiary_managed_id, v_label,
    p_prestation_id
  )
  returning id, share_token into v_id, v_token;

  return jsonb_build_object('id', v_id, 'share_token', v_token, 'montant_cible', v_montant);
end;
$function$;

-- IMPORTANT (constaté à l'exécution) : CREATE OR REPLACE FUNCTION ne remplace une fonction que
-- si la signature d'arguments est IDENTIQUE. Ajouter p_prestation_id en paramètre supplémentaire
-- a donc créé une SURCHARGE (les deux versions, 9 et 10 arguments, coexistaient) au lieu de
-- remplacer l'originale. Comme tous les appels côté code sont mis à jour pour toujours passer
-- p_prestation_id (même null), l'ancienne signature à 9 arguments est explicitement supprimée
-- pour éviter toute ambiguïté PostgREST côté RPC.
drop function if exists public.create_group_funding(uuid, uuid, text, text, integer, date, text, uuid, uuid);

create or replace function public.connect_get_order_funding_link(p_prestation_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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

  -- v78 : priorité à une cotisation liée EXACTEMENT à cette commande (prestation_id), avec
  -- repli sur l'ancienne heuristique par type d'offre pour les cotisations créées avant ce fix
  -- (prestation_id encore NULL) — évite de faire disparaître les paiements collectifs existants.
  select gf.id, gf.share_token into v_existing
  from group_fundings gf
  where gf.created_by = auth.uid()
    and gf.statut in ('ouverte', 'objectif_atteint')
    and (
      gf.prestation_id = p_prestation_id
      or (gf.prestation_id is null and gf.catalogue_offre_id = v_prestation.offre_id)
    )
  order by (gf.prestation_id = p_prestation_id) desc, gf.created_at desc
  limit 1;

  return jsonb_build_object(
    'offre_id', v_prestation.offre_id,
    'is_collectif', v_is_collectif,
    'existing_funding_id', v_existing.id,
    'existing_funding_share_token', v_existing.share_token
  );
end;
$function$;
