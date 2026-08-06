-- ============================================================
-- Migration de sécurité : durcissement RLS "colonne non protégée"
-- (généralisation à tout le schéma d'un défaut déjà trouvé et corrigé
-- isolément 4 fois : migration-securite-profiles-rls.sql,
-- migration-securite-club-members-client-users-rls.sql,
-- migration-clubplus-v23.sql).
--
-- Le défaut : RLS restreint les LIGNES qu'un utilisateur peut modifier,
-- pas les COLONNES à l'intérieur de cette ligne. Une policy
-- "for update using (collaborateur_id = auth.uid())" autorise donc à
-- modifier N'IMPORTE QUEL champ de sa propre ligne via un appel PATCH
-- direct à l'API REST Supabase (clé publique + jeton de session, sans
-- passer par l'interface) — y compris des colonnes qui ne devraient
-- être modifiables que par un rôle privilégié (statut, montant,
-- rémunération, validation).
--
-- Cette migration corrige les 6 occurrences les plus graves (impact
-- financier direct ou contournement d'un workflow de validation),
-- identifiées par un audit exhaustif des 257 policies RLS du schéma.
-- Les 11 occurrences restantes (impact moindre) sont documentées en
-- fin de fichier comme backlog, volontairement non corrigées ici pour
-- garder cette migration revue-able en une fois.
--
-- Idempotente : DROP ... IF EXISTS avant chaque CREATE.
-- À exécuter dans Supabase → SQL Editor, après relecture.
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. FRAIS — un collaborateur pouvait déclarer un frais directement
--    avec statut='remboursé' (au lieu de 'en_attente'), contournant
--    totalement la validation admin/prod/compta déjà en place sur
--    frais_update. Fraude financière directe à un seul appel API.
-- ═══════════════════════════════════════════════════════════════

drop policy if exists "frais_insert" on frais;
create policy "frais_insert" on frais for insert with check (
  statut = 'en_attente'
  and (
    collaborateur_id = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod','compta'))
  )
);


-- ═══════════════════════════════════════════════════════════════
-- 2. PRESTATIONS — la policy "prestations_acces" (for all) donne un
--    accès CRUD complet, y compris aux champs financiers, à tout
--    collaborateur simplement affecté à la prestation (vidéaste,
--    photographe) et au CM sur les prestations réseaux sociaux.
--    Fix : trigger de protection des colonnes financières, sans
--    toucher à la policy existante (le reste de la ligne reste
--    modifiable par l'équipe assignée, comme aujourd'hui).
-- ═══════════════════════════════════════════════════════════════

create or replace function protect_sensitive_prestation_fields()
returns trigger language plpgsql security definer as $$
declare
  is_privileged boolean;
begin
  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod','compta')
  ) into is_privileged;

  if not is_privileged then
    if new.montant_ht is distinct from old.montant_ht
       or new.montant_ttc is distinct from old.montant_ttc
       or new.tva_pct is distinct from old.tva_pct
       or new.acompte_montant is distinct from old.acompte_montant
       or new.acompte_recu is distinct from old.acompte_recu
       or new.acompte_date is distinct from old.acompte_date
       or new.statut_financier is distinct from old.statut_financier
       or new.contrat_signe is distinct from old.contrat_signe
       or new.budget_client is distinct from old.budget_client
       or new.client_id is distinct from old.client_id
    then
      raise exception 'Modification non autorisée : les champs financiers et le rattachement client sont réservés à l''administration.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_sensitive_prestation_fields on prestations;
create trigger trg_protect_sensitive_prestation_fields
  before update on prestations
  for each row execute function protect_sensitive_prestation_fields();


-- ═══════════════════════════════════════════════════════════════
-- 3. PRESTATIONS_EQUIPE — même défaut (for all), plus grave ici car
--    la ligne contient directement la rémunération du collaborateur
--    lui-même : remuneration, frais_km, statut_paiement, est_responsable
--    sont modifiables par le collaborateur concerné, y compris via un
--    INSERT (auto-affectation à une prestation avec rémunération
--    fabriquée). Fix : trigger sur INSERT et UPDATE, qui laisse
--    volontairement passer la seule transition légitime en self-service
--    : accepter ou refuser sa propre invitation (statut
--    invitation_envoyée/en_attente → acceptée/refusée), déjà utilisée
--    par l'app (cf. dispatchSVEvent('prestation.confirmed',...) dans
--    SportVision-OS-Full.html). Les déclarations d'heures/km/frais du
--    photographe (heures_declarees, km_declares, frais_declares,
--    notes_declaration, notes_refus) restent libres : ce sont des
--    inputs, pas des validations, examinés ensuite par la Production.
-- ═══════════════════════════════════════════════════════════════

create or replace function protect_sensitive_affectation_fields()
returns trigger language plpgsql security definer as $$
declare
  is_privileged boolean;
begin
  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','prod','sec')
  ) into is_privileged;

  if is_privileged then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.remuneration is not null
       or new.frais_km is not null
       or new.est_responsable is true
       or coalesce(new.statut_paiement,'en_attente') <> 'en_attente'
       or new.date_paiement is not null
       or new.statut is distinct from 'invitation_envoyée'
    then
      raise exception 'Modification non autorisée : rémunération, frais, statut de paiement et responsabilité sont réservés à la Production/Comptabilité.';
    end if;
    return new;
  end if;

  -- UPDATE : champs toujours réservés à la Production/Comptabilité
  if new.remuneration is distinct from old.remuneration
     or new.frais_km is distinct from old.frais_km
     or new.est_responsable is distinct from old.est_responsable
     or new.statut_paiement is distinct from old.statut_paiement
     or new.date_paiement is distinct from old.date_paiement
     or new.prestation_id is distinct from old.prestation_id
     or new.collaborateur_id is distinct from old.collaborateur_id
  then
    raise exception 'Modification non autorisée : rémunération, frais, statut de paiement, responsabilité et affectation sont réservés à la Production/Comptabilité.';
  end if;

  -- Seule transition self-service autorisée : répondre à sa propre invitation
  if new.statut is distinct from old.statut then
    if not (
      old.statut in ('invitation_envoyée','en_attente')
      and new.statut in ('acceptée','refusée')
      and old.collaborateur_id = auth.uid()
    ) then
      raise exception 'Modification non autorisée : seule l''acceptation ou le refus de votre propre invitation est permis sans validation Production.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_sensitive_affectation_fields on prestations_equipe;
create trigger trg_protect_sensitive_affectation_fields
  before insert or update on prestations_equipe
  for each row execute function protect_sensitive_affectation_fields();


-- ═══════════════════════════════════════════════════════════════
-- 4. GRADE_RECOMMENDATIONS — la policy "for all" permettait à un
--    collaborateur d'insérer SA PROPRE recommandation avec
--    statut='valide', grade_propose élevé et valide_par=lui-même :
--    fabrication directe d'une montée en grade sans revue humaine.
--    Fix : on scinde la policy. Un collaborateur peut seulement
--    proposer sa candidature (statut en_attente, non pré-validée) et
--    la consulter ; seul admin/prod peut la faire évoluer ou la
--    supprimer — il n'y a pas de cas d'usage légitime où l'intéressé
--    aurait besoin de modifier sa propre recommandation après l'avoir
--    soumise.
-- ═══════════════════════════════════════════════════════════════

drop policy if exists "grade_rec_access" on grade_recommendations;
drop policy if exists "grade_rec_select" on grade_recommendations;
drop policy if exists "grade_rec_insert" on grade_recommendations;
drop policy if exists "grade_rec_update" on grade_recommendations;
drop policy if exists "grade_rec_delete" on grade_recommendations;

create policy "grade_rec_select" on grade_recommendations for select using (
  collaborateur_id = auth.uid()
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

create policy "grade_rec_insert" on grade_recommendations for insert with check (
  (
    collaborateur_id = auth.uid()
    and statut = 'en_attente'
    and examine_par is null
    and valide_par is null
  )
  or exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

create policy "grade_rec_update" on grade_recommendations for update using (
  exists (select 1 from profiles where id = auth.uid() and role in ('admin','prod'))
);

create policy "grade_rec_delete" on grade_recommendations for delete using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);


-- ═══════════════════════════════════════════════════════════════
-- 5. XP_EVENTS — "xp_own_insert" (ajoutée par migration-securite-
--    profiles-rls.sql pour corriger un blocage fonctionnel) permet à
--    un collaborateur de s'auto-créditer un montant d'XP arbitraire,
--    y compris type='manuel'/'bonus' — deux types qui, par définition,
--    ne devraient JAMAIS être auto-attribués. Fix minimal : on retire
--    ces deux types du self-service ; ils resteront insérables
--    uniquement par un admin (policy admin déjà existante par
--    ailleurs, non touchée ici).
--    Risque résiduel assumé, déjà documenté par l'auteur de la
--    migration d'origine : le `montant` des types restants (formation,
--    certification, prestation) reste fourni par le client JS, pas
--    calculé côté serveur. Fermer complètement ce risque demande de
--    déplacer le calcul d'éligibilité XP dans une fonction RPC dédiée
--    — hors périmètre de cette migration, à traiter en marge du
--    module Formation/Grade si tu veux durcir ce point plus tard.
-- ═══════════════════════════════════════════════════════════════

drop policy if exists "xp_own_insert" on xp_events;
create policy "xp_own_insert" on xp_events for insert with check (
  collaborateur_id = auth.uid()
  and type in ('formation','certification','prestation')
);


-- ═══════════════════════════════════════════════════════════════
-- 6. CLUB_REQUESTS — deux failles liées, l'une déjà signalée en
--    commentaire dans migration-clubplus-v4.sql ("à durcir avec un
--    trigger si besoin, hors scope de cette v4"), l'autre plus grave
--    trouvée en relisant la fonction associée :
--
--    a) Policy "creq_member_comment" (for update using is_club_member) :
--       tout membre du club peut modifier n'importe quelle colonne de
--       sa demande, y compris status et credits_reserved directement
--       via PATCH REST.
--
--    b) update_club_request_status(p_request_id, p_status) — la
--       fonction censée être le SEUL chemin légitime pour faire
--       évoluer une demande — ne vérifie QUE is_club_member(club_id),
--       PAS que l'appelant est un membre du staff SportVision. Un
--       dirigeant ou éducateur du club peut donc appeler cette RPC
--       lui-même avec p_status='terminee' pour clôturer sa propre
--       demande (et déclencher le débit de crédits, ce qui n'est pas
--       exploitable pour lui) — mais surtout avec p_status='refusee'
--       APRÈS avoir reçu ce qu'il voulait via `comments`, ce qui
--       restitue les crédits réservés sans que SportVision ait
--       officiellement refusé la demande. C'est un vecteur réel
--       d'obtenir une prestation sans qu'elle soit jamais débitée.
--
--    Fix : la RPC n'autorise plus un membre du club qu'à annuler SA
--    PROPRE demande tant qu'elle n'a pas encore été prise en charge
--    (status 'recues' → 'refusee' uniquement) ; toute autre transition
--    exige un rôle staff (admin/cm/sec/prod). Le trigger applique la
--    même règle en défense en profondeur, y compris sur un PATCH REST
--    direct qui contournerait la RPC.
--
--    ⚠️ Hypothèse produit à valider avec toi : je pars du principe
--    qu'un club peut annuler une demande pas encore prise en charge,
--    mais jamais une demande déjà en traitement/prête. Si un club doit
--    pouvoir annuler à tout moment (avec perte de crédits, ou selon
--    une autre règle), dis-le-moi et j'ajuste la condition ci-dessous.
-- ═══════════════════════════════════════════════════════════════

create or replace function update_club_request_status(p_request_id uuid, p_status text)
returns club_requests
language plpgsql security definer as $$
declare
  v_row club_requests;
  v_old_status text;
  v_credits integer;
  v_is_staff boolean;
begin
  select * into v_row from club_requests where id = p_request_id;
  if v_row.id is null then
    raise exception 'Demande introuvable.';
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','cm','sec','prod')
  ) into v_is_staff;

  if v_is_staff then
    null; -- le staff peut faire évoluer la demande vers n'importe quel statut du workflow
  elsif is_club_member(v_row.club_id) then
    if p_status <> 'refusee' or v_row.status <> 'recues' then
      raise exception 'Vous ne pouvez annuler qu''une demande non encore prise en charge par SportVision.';
    end if;
  else
    raise exception 'Accès refusé.';
  end if;

  v_old_status := v_row.status;
  v_credits := coalesce(v_row.credits_reserved, 0);

  update club_requests set
    status = p_status,
    credits_reserved = case when p_status in ('terminee','refusee') then 0 else credits_reserved end
    where id = p_request_id
    returning * into v_row;

  if v_credits > 0 and p_status = 'terminee' and v_old_status <> 'terminee' then
    update clubs set
      credits_balance = greatest(0, credits_balance - v_credits),
      credits_reserved = greatest(0, credits_reserved - v_credits)
      where id = v_row.club_id;
    insert into club_credit_transactions (club_id, label, amount, created_by)
      values (v_row.club_id, coalesce(v_row.type,'Demande') || coalesce(' — ' || v_row.team, ''), -v_credits, auth.uid());
  elsif v_credits > 0 and p_status = 'refusee' and v_old_status <> 'refusee' then
    update clubs set credits_reserved = greatest(0, credits_reserved - v_credits) where id = v_row.club_id;
  end if;

  return v_row;
end;
$$;

create or replace function protect_sensitive_club_request_fields()
returns trigger language plpgsql security definer as $$
declare
  v_is_staff boolean;
begin
  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','cm','sec','prod')
  ) into v_is_staff;

  if v_is_staff then
    return new;
  end if;

  if new.club_id is distinct from old.club_id then
    raise exception 'Modification non autorisée : le club d''une demande ne peut pas être changé.';
  end if;

  if new.status is distinct from old.status or new.credits_reserved is distinct from old.credits_reserved then
    if not (old.status = 'recues' and new.status = 'refusee' and new.credits_reserved = 0) then
      raise exception 'Modification non autorisée : le statut et les crédits d''une demande ne peuvent être modifiés que par SportVision, ou pour annuler une demande non encore prise en charge.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_sensitive_club_request_fields on club_requests;
create trigger trg_protect_sensitive_club_request_fields
  before update on club_requests
  for each row execute function protect_sensitive_club_request_fields();


-- ============================================================
-- BACKLOG — 11 occurrences supplémentaires du même défaut, trouvées
-- par le même audit exhaustif, non corrigées dans cette migration
-- (sévérité moindre : pas d'argent ou pas de mineurs directement en
-- jeu). À traiter dans une migration de suivi si tu valides les choix
-- ci-dessus.
--
-- HAUTE
--  - kits (supabase-schema-v2.sql) : "kits_acces" for all permet à un
--    collaborateur ayant réservé un kit de modifier/supprimer sa fiche
--    matériel (valeur, statut).
--  - club_sponsors (migration-clubplus-v5.sql) : "csp_member_insert"/
--    "csp_member_update" permettent à tout membre du club (pas
--    seulement un dirigeant/trésorier) de créer/modifier un sponsor
--    avec un montant fabriqué.
--  - club_creations (migration-clubplus-v8.sql) : "ccr_member_insert"/
--    "ccr_member_update" permettent de faire passer directement une
--    création à status='publie', sans validation.
--  - parent_player_relationships (migration-clubplus-v13.sql) :
--    "ppr_parent_confirm" ne protège pas player_id — un parent peut
--    repointer sa relation vers un enfant qui n'est pas le sien.
--  - club_newsroom_items (migration-clubplus-v3.sql) : même défaut que
--    club_creations sur le statut de publication.
--
-- MOYENNE
--  - formation_inscriptions (migration-formation-v1.sql) : un
--    collaborateur peut s'auto-déclarer une formation "terminee" avec
--    progression_pct=100 et xp_gagnes fabriqué.
--  - incidents (supabase-schema-v2.sql) : le déclarant peut clôturer
--    lui-même son propre incident.
--  - kit_reservations (supabase-schema-v2.sql) : le collaborateur peut
--    modifier librement le statut de sa réservation.
--  - club_matches (migration-clubplus-v3.sql) : un membre peut modifier
--    directement le statut d'un match (faible impact, pas d'argent).
--  - team_projects (migration-clubplus-v21.sql) : "tpr_creator_update_
--    draft" ne protège pas team_id/club_id/montant_cible tant que le
--    projet reste en brouillon.
-- ============================================================
