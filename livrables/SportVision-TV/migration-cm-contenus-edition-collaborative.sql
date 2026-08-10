-- ============================================================
-- Fix : le WITH CHECK de contenus_update interdit l'édition collaborative
-- documentée comme acquise dans migration-contenus.sql elle-même.
--
-- ─── Faille ──────────────────────────────────────────────────────────────
-- migration-contenus.sql (commentaire lignes ~30-34) affirme : « l'édition/
-- création elle, reste collaborative (tout CM qui voit le client peut créer/
-- modifier son contenu, ex: un Junior prépare, un Confirmé valide) ».
--
-- Mais la policy "contenus_update" réellement créée ne tient pas cette
-- promesse. Son USING (qui gouverne QUELLES lignes sont éligibles à
-- l'update) inclut bien contenus_visible_par_cm(client_id, auth.uid()),
-- donc un CM B (collègue de portefeuille, non propriétaire, non Lead) voit
-- la ligne et peut lancer un UPDATE dessus. Mais son WITH CHECK (qui
-- gouverne si la ligne RÉSULTANTE est acceptée) exige en premier conjoint :
--
--   (cm_id = auth.uid() or exists (... niveau_cm = 'cm_lead'))
--
-- Ce conjoint ignore complètement contenus_visible_par_cm. Résultat : le CM
-- B voit la ligne, l'UPDATE passe le USING, mais échoue systématiquement au
-- WITH CHECK (erreur RLS brute 42501) dès qu'il n'est ni propriétaire
-- (cm_id) ni Lead — y compris quand il ne touche même pas à client_id ou
-- cm_id. avancerContenu() et sauvegarderContenu() (SportVision-OS-Full.html,
-- ~14766 et ~14903) n'envoient jamais cm_id dans leur PATCH, donc ce champ
-- ne bouge jamais dans l'usage réel actuel — l'édition collaborative
-- documentée est simplement impossible en pratique pour tout CM non
-- propriétaire et non Lead.
--
-- ─── Correctif ───────────────────────────────────────────────────────────
-- 1. WITH CHECK de "contenus_update" : on ajoute au premier conjoint la
--    même alternative contenus_visible_par_cm(client_id, auth.uid()) déjà
--    présente dans le USING et dans le second conjoint — un CM qui a un
--    accès de lecture légitime au contenu (via son portefeuille) peut donc
--    aussi le faire avancer / le modifier, pas seulement le propriétaire.
--    Le second conjoint (validation de client_id) est inchangé : il
--    continue d'empêcher tout CM, propriétaire inclus, de déplacer un
--    contenu vers un client hors de son propre périmètre.
--
-- 2. Cet ajout, pris seul, rouvrirait un trou : un CM B non-Lead pourrait
--    envoyer un PATCH avec un cm_id arbitraire (ex: réassigner le contenu à
--    un tiers) — le premier conjoint passerait quand même via l'alternative
--    contenus_visible_par_cm, sans jamais valider la valeur de cm_id
--    elle-même. Un WITH CHECK ne peut pas comparer l'ancienne et la
--    nouvelle valeur d'une colonne (contrairement à USING qui s'évalue sur
--    l'ancienne ligne, WITH CHECK ne voit que la ligne résultante) — donc
--    ce verrou ne peut pas s'exprimer dans la policy elle-même. On ajoute
--    un trigger BEFORE UPDATE dédié (même pattern que
--    protect_sensitive_club_member_fields, migration-connect-v15-fix-club-
--    admin-self-demote.sql) qui bloque tout changement de cm_id sauf pour
--    un CM Lead ou l'admin.
--
-- Additive, idempotente (create or replace policy/function, drop ... if
-- exists avant chaque create). Ne touche à rien d'autre (select/insert/
-- delete de contenus inchangées). À exécuter après migration-contenus.sql.
--
-- NON EXÉCUTÉE PAR L'AGENT. À exécuter par Fouka dans Supabase → SQL Editor
-- après relecture.
-- ============================================================

-- ─── 1. WITH CHECK élargi : lecture légitime du portefeuille suffit ───────
drop policy if exists "contenus_update" on contenus;
create policy "contenus_update" on contenus for update using (
  cm_id = auth.uid()
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
  or contenus_visible_par_cm(client_id, auth.uid())
) with check (
  (
    cm_id = auth.uid()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
    or contenus_visible_par_cm(client_id, auth.uid())
  )
  and (
    client_id is null
    or contenus_visible_par_cm(client_id, auth.uid())
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
  )
);

-- ─── 2. Verrou cm_id : seul un Lead CM (ou l'admin) peut réassigner ───────
-- un contenu à un autre CM. Nécessaire uniquement parce que le WITH CHECK
-- ci-dessus ne peut plus, à lui seul, exclure ce cas maintenant que le
-- premier conjoint accepte aussi les CM du portefeuille (cf. explication
-- ci-dessus) — sans ce trigger, un CM B non-Lead pourrait faire passer un
-- PATCH avec un cm_id arbitraire tant que client_id reste dans son
-- périmètre.
create or replace function contenus_protect_cm_id_reassignment()
returns trigger language plpgsql security definer as $$
begin
  if new.cm_id is distinct from old.cm_id then
    if not exists (
      select 1 from profiles p where p.id = auth.uid()
      and (p.role = 'admin' or (p.role = 'cm' and p.niveau_cm = 'cm_lead'))
    ) then
      raise exception 'Modification non autorisée : seul un CM Lead ou l''admin peut réattribuer un contenu à un autre CM (cm_id).';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contenus_protect_cm_id_reassignment on contenus;
create trigger trg_contenus_protect_cm_id_reassignment
before update on contenus
for each row execute function contenus_protect_cm_id_reassignment();
