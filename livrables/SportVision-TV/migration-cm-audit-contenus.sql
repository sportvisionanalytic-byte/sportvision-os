-- Migration : journal d'audit pour le cycle de vie des contenus CM.
--
-- ─── Contexte ────────────────────────────────────────────────────────────
-- audit_logs existe depuis migration-portail-v1.sql (créée pour tracer le
-- mode "voir en tant que client" — jamais implémenté, la table est donc
-- restée totalement vide jusqu'ici). Le cahier des charges CM demande une
-- traçabilité des contenus (création, changement de statut, modification,
-- suppression) : plutôt qu'une nouvelle table, on réutilise audit_logs telle
-- quelle (id, acteur_id, action, cible_type, cible_id, details jsonb,
-- created_at) — l'écriture y est déjà ouverte à tout staff authentifié
-- ("audit_staff_insert"), aucun changement nécessaire côté INSERT.
--
-- Seule la LECTURE manque pour un usage CM : "audit_admin_read" restreint le
-- SELECT à role='admin', un Lead CM ne peut donc rien y lire. Ajoute une
-- policy additive, strictement scopée à cible_type='contenu' (n'ouvre rien
-- sur d'éventuelles futures entrées "voir en tant que client" ou autres),
-- pour le Lead CM uniquement (pas les autres paliers CM — cohérent avec le
-- reste de l'espace CM où seul le Lead a une vue d'équipe).
--
-- Idempotente : DROP ... IF EXISTS avant CREATE.

drop policy if exists "audit_cm_lead_read_contenu" on audit_logs;
create policy "audit_cm_lead_read_contenu" on audit_logs for select using (
  cible_type = 'contenu'
  and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead')
);

-- ─── Durcissement de l'écriture ──────────────────────────────────────────
-- audit_staff_insert (migration-portail-v1.sql) vérifie seulement que
-- l'appelant est un membre du staff authentifié, sans jamais contraindre
-- acteur_id : jusqu'ici sans conséquence puisque rien n'écrivait dans cette
-- table. _logAudit() en fait maintenant un usage réel (traçabilité des
-- contenus) — sans ce correctif, n'importe quel compte staff pourrait
-- forger une entrée attribuée à un collègue (acteur_id arbitraire),
-- fabriquant un faux historique. acteur_id doit désormais être soit
-- l'appelant lui-même, soit null.
drop policy if exists "audit_staff_insert" on audit_logs;
create policy "audit_staff_insert" on audit_logs for insert with check (
  exists (select 1 from profiles where id = auth.uid())
  and (acteur_id = auth.uid() or acteur_id is null)
);
