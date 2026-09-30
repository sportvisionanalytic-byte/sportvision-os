-- v377 — LA LISTE DES GESTES DE L'OPÉRATEUR SORT DU CORPS DU DÉCLENCHEUR (01/10/2026)
--
-- ✅ APPLIQUÉE LE 01/10/2026 en production. 16 transitions en table, le déclencheur les lit.
--    Vérifié sur SV-2026-3121, bloquée en `arrivée_sur_place` depuis douze jours : la base
--    propose « Démarrer la production » à Antoine, et rien à quelqu'un d'autre.
--
-- ═══ LE PROBLÈME, ET CE QU'IL A DÉJÀ COÛTÉ ════════════════════════════════════════════════════
--
-- La liste des changements de statut qu'un opérateur terrain a le droit de faire vit à UN seul
-- endroit en base : le corps de `protect_prestation_operational_fields()`, dans un `or` de seize
-- lignes. Rien ne l'expose. Aucune fonction, aucune vue, aucune table.
--
-- Conséquence : chaque interface qui veut proposer un bouton doit RECOPIER cette liste.
--
--   · L'OS web la recopie deux fois, et les deux copies ne disent pas la même chose. Sur le statut
--     `équipe_affectée`, `OPERATEUR_ACTIONS` propose « ✓ Kit prêt, je peux partir » (vers `prête`)
--     et `JJ_STATUT_ACTION` propose « 🚗 Je prends la route » (vers `équipe_en_route`). Deux écrans
--     du même logiciel, deux gestes différents pour la même mission.
--   · La dérive a déjà été payée. Le commentaire v151 du déclencheur dit, mot pour mot : « ✓ Kit
--     prêt, je peux partir, proposé à l'opérateur mais refusé jusqu'ici ». Autrement dit : pendant
--     un temps, le bouton existait à l'écran et la base le refusait. C'est exactement le
--     bouton-qui-mène-à-un-refus que le contrat de l'application interdit (règle 5).
--   · L'application native doit à son tour recopier la liste, faute de pouvoir la demander.
--
-- ═══ CE QUE FAIT CETTE MIGRATION ═══════════════════════════════════════════════════════════════
--
-- 1. Une table `operateur_transitions` : une ligne par geste, avec son libellé et la colonne
--    d'horodatage personnel associée. C'est LA liste, et il n'y en a plus qu'une.
-- 2. `protect_prestation_operational_fields()` LIT cette table au lieu de porter la liste en dur.
--    Le déclencheur et les écrans ne peuvent donc plus diverger : ajouter un geste, c'est insérer
--    une ligne, et les deux le voient au même instant.
-- 3. `operateur_action_suivante(p_prestation_id)` rend, pour UNE mission, le geste que la personne
--    connectée peut faire maintenant — ou rien. C'est ce que l'écran appelle avant de dessiner son
--    bouton, au lieu de deviner.
--
-- ═══ CE QUE ÇA NE CHANGE PAS ═══════════════════════════════════════════════════════════════════
--
-- AUCUNE RÈGLE MÉTIER. Les 16 lignes insérées ci-dessous sont EXACTEMENT celles du `or` actuel,
-- dans le même ordre. Vérifié avant d'écrire : les 14 transitions du parcours terrain ont été
-- tentées une par une le 01/10/2026 avec le jeton d'Antoine Blin (`set local role authenticated`,
-- statut de départ forcé, transaction annulée) — les 14 passent. Trois témoins hors liste
-- (`prêt_validation → à_valider_client`, `prête_à_livrer → livrée`, `livrée → clôturée`) sont
-- refusés, avant comme après.
--
-- `validate_prestation_statut_transition()` n'est PAS touché : c'est le garde-fou du workflow
-- entier, tous rôles confondus, et il reste au-dessus. Les rôles privilégiés (`admin`, `sec`,
-- `prod`, `compta`) continuent de sortir du déclencheur avant tout contrôle, comme aujourd'hui.
--
-- ═══ APRÈS APPLICATION ═════════════════════════════════════════════════════════════════════════
--
-- Dans `livrables/SportVision-OS-App/src/lib/os-terrain.ts`, remplacer le tableau `PARCOURS` et la
-- fonction `actionSuivante()` par un appel à `operateur_action_suivante`. Le commentaire de tête de
-- ce fichier dit déjà qu'il attend cette migration.

begin;

-- ── 1. La liste, en table ─────────────────────────────────────────────────────────────────────

create table if not exists public.operateur_transitions (
  statut_depuis   statut_prestation not null,
  statut_vers     statut_prestation not null,
  -- Le mot affiché à l'opérateur. Il vit ici pour la même raison que la transition : un libellé
  -- recopié dans trois interfaces finit par en avoir trois versions.
  libelle         text not null,
  -- La colonne de `mission_suivi_operateur` que ce geste horodate, quand il y en a une.
  champ_suivi     text,
  -- Vrai pour la fin de la couverture terrain : l'interface doit alors dire que la mission
  -- continue (sécurisation, livraison, validation Production).
  fin_du_terrain  boolean not null default false,
  ordre           smallint not null,
  primary key (statut_depuis, statut_vers),
  constraint operateur_transitions_champ_suivi_connu check (
    champ_suivi is null or champ_suivi in
      ('kit_prepare_at','parti_at','arrive_at','prestation_terminee_at',
       'fichiers_securises_at','postproduction_terminee_at','livre_at')
  )
);

comment on table public.operateur_transitions is
  'Les changements de statut qu''un collaborateur AFFECTÉ a le droit de faire lui-même. Source '
  'unique : lue par protect_prestation_operational_fields() ET par les interfaces, via '
  'operateur_action_suivante(). Ne jamais recopier cette liste dans un écran (v377, 01/10/2026).';

insert into public.operateur_transitions
  (statut_depuis, statut_vers, libelle, champ_suivi, fin_du_terrain, ordre) values
  -- Les allers-retours d'attribution : ils ne sont pas des « gestes », ils existent parce que la
  -- cascade d'acceptation et de refus (cascade_prestations_equipe_reponse) les emprunte.
  ('planifiée',            'équipe_affectée',    'Mission acceptée',              null,                     false,  1),
  ('équipe_affectée',      'planifiée',          'Mission refusée',               null,                     false,  2),
  -- Le parcours terrain proprement dit.
  ('équipe_affectée',      'prête',              'Kit prêt, je peux partir',      'kit_prepare_at',         false, 10),
  ('confirmée',            'équipe_en_route',    'Je suis en route',              'parti_at',               false, 11),
  ('équipe_affectée',      'équipe_en_route',    'Je suis en route',              'parti_at',               false, 12),
  ('planifiée',            'équipe_en_route',    'Je suis en route',              'parti_at',               false, 13),
  ('prête',                'équipe_en_route',    'Je suis en route',              'parti_at',               false, 14),
  ('prête',                'production_démarrée','Démarrer la production',        null,                     false, 15),
  ('équipe_en_route',      'arrivée_sur_place',  'Je suis arrivé',                'arrive_at',              false, 16),
  ('arrivée_sur_place',    'production_démarrée','Démarrer la production',        null,                     false, 17),
  ('production_démarrée',  'production_terminée','Prestation terminée',           'prestation_terminee_at', true,  18),
  -- La sauvegarde et la post-production. Elles restent ouvertes à l'opérateur, exactement comme
  -- aujourd'hui : c'est l'écran « Sauvegarde » de l'OS qui les porte, pas le Mode Jour J.
  ('production_terminée',  'médias_à_transférer','Fichiers sauvegardés',          'fichiers_securises_at',  false, 20),
  ('médias_à_transférer',  'médias_complets',    'Copie vérifiée',                null,                     false, 21),
  ('médias_complets',      'à_monter',           'Passer au montage',             null,                     false, 22),
  ('à_monter',             'montage_en_cours',   'Montage démarré',               null,                     false, 23),
  ('montage_en_cours',     'prêt_validation',    'Envoyer à la Production',       'postproduction_terminee_at', false, 24)
on conflict (statut_depuis, statut_vers) do nothing;

-- Tout le monde la lit : elle ne contient aucune donnée, seulement des règles. Personne ne l'écrit
-- depuis l'API — une transition s'ajoute par migration, au même titre qu'un statut.
alter table public.operateur_transitions enable row level security;
drop policy if exists operateur_transitions_lecture on public.operateur_transitions;
create policy operateur_transitions_lecture on public.operateur_transitions
  for select to authenticated using (true);

-- ── 2. Le déclencheur lit la table au lieu de porter la liste ─────────────────────────────────

create or replace function public.protect_prestation_operational_fields()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  is_privileged boolean;
  is_valid_transition boolean;
begin
  if auth.uid() is null then
    return new;
  end if;
  -- Le regroupement de missions (v133) tient à jour horaire, équipes et description de la mission
  -- commune, au nom du CM qui ajoute un match. Le marqueur n'est posé que par
  -- rafraichir_mission_regroupee (interne, non exécutable depuis l'API) et ne vit que le temps de
  -- sa mise à jour.
  if current_setting('sv.ecriture_systeme', true) = 'regroupement_mission' then
    return new;
  end if;

  select exists(
    select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod','compta')
  ) into is_privileged;

  if is_privileged then
    return new;
  end if;

  if new.lieu is distinct from old.lieu
     or new.adresse_complete is distinct from old.adresse_complete
     or new.contact_sur_place is distinct from old.contact_sur_place
     or new.telephone_sur_place is distinct from old.telephone_sur_place
     or new.date_prestation is distinct from old.date_prestation
     or new.heure_debut is distinct from old.heure_debut
     or new.heure_fin is distinct from old.heure_fin
     or new.heure_rdv is distinct from old.heure_rdv
     or new.type_prestation is distinct from old.type_prestation
     or new.reference is distinct from old.reference
     or new.description_besoin is distinct from old.description_besoin
     or new.livrables_demandes is distinct from old.livrables_demandes
     or new.notes_internes is distinct from old.notes_internes
     or new.sport is distinct from old.sport
     or new.equipes is distinct from old.equipes
     or new.responsable_prod_id is distinct from old.responsable_prod_id
     or new.responsable_prestation_id is distinct from old.responsable_prestation_id
  then
    raise exception 'Modification non autorisée : le lieu, l''horaire et les informations de mission d''une prestation sont réservés au secrétariat/à la production.';
  end if;

  if new.statut is distinct from old.statut then
    -- v377 : LA LISTE N'EST PLUS ICI. Elle est dans `operateur_transitions`, que les interfaces
    -- lisent aussi, pour qu'un bouton ne puisse plus proposer ce que cette ligne refuse.
    select exists(
      select 1 from operateur_transitions t
      where t.statut_depuis = old.statut and t.statut_vers = new.statut
    ) into is_valid_transition;

    if not is_valid_transition then
      raise exception 'Modification non autorisée : ce changement de statut n''est pas ouvert au collaborateur affecté (réservé au secrétariat/à la production).';
    end if;
  end if;

  return new;
end;
$function$;

-- ── 3. Ce que l'écran demande avant de dessiner son bouton ────────────────────────────────────

create or replace function public.operateur_action_suivante(p_prestation_id uuid)
 returns table (
   statut_vers    text,
   libelle        text,
   champ_suivi    text,
   fin_du_terrain boolean
 )
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_statut statut_prestation;
begin
  -- LA MÊME PORTE QUE LA POLICY `mso_operateur` : on ne renseigne personne sur une mission à
  -- laquelle il n'est pas affecté. Un `security definer` qui répondrait à tout le monde serait une
  -- fuite de plus, sur un statut de mission.
  if not operateur_affecte_prestation(p_prestation_id) then
    return;
  end if;

  select p.statut into v_statut from prestations p where p.id = p_prestation_id;
  if v_statut is null then
    return;
  end if;

  -- Une personne privilégiée n'est pas bornée par cette liste : le déclencheur la laisse passer
  -- avant tout contrôle. Lui rendre « le geste de l'opérateur » serait mentir sur ce qu'elle peut
  -- faire — elle a la fiche complète de l'OS pour ça.
  if exists (select 1 from profiles where id = auth.uid() and role in ('admin','sec','prod','compta')) then
    return;
  end if;

  return query
    select t.statut_vers::text, t.libelle, t.champ_suivi, t.fin_du_terrain
      from operateur_transitions t
     where t.statut_depuis = v_statut
       -- Les deux allers-retours d'attribution ne sont pas des gestes qu'on propose : ils passent
       -- par l'acceptation et le refus d'une invitation, et la cascade s'en charge.
       and t.ordre >= 10
     order by t.ordre
     limit 1;
end;
$function$;

revoke all on function public.operateur_action_suivante(uuid) from public;
grant execute on function public.operateur_action_suivante(uuid) to authenticated;

comment on function public.operateur_action_suivante(uuid) is
  'Le seul geste que le collaborateur connecté peut faire maintenant sur cette mission, lu dans '
  'operateur_transitions — la même table que le déclencheur. Zéro ligne = aucun geste, et '
  'l''interface n''affiche aucun bouton (v377, 01/10/2026).';

commit;

-- ═══ CONTRÔLE APRÈS APPLICATION ════════════════════════════════════════════════════════════════
--
-- Rouge avant, vert après. À passer avec le jeton d'un opérateur réel, dans une transaction
-- annulée, statut de départ forcé — c'est la méthode qui a servi à mesurer la liste :
--
--   begin;
--   select set_config('request.jwt.claims','{"role":"service_role"}', true);
--   update prestations set statut='arrivée_sur_place' where id='<mission de la personne>';
--   set local role authenticated;
--   select set_config('request.jwt.claims','{"sub":"<uuid opérateur>","role":"authenticated"}', true);
--   select * from operateur_action_suivante('<mission>');   -- attendu : production_démarrée
--   update prestations set statut='production_démarrée' where id='<mission>';  -- attendu : 1 ligne
--   update prestations set statut='livrée' where id='<mission>';               -- attendu : refus
--   rollback;
--
-- Et le contrôle qui compte vraiment, celui de la non-régression : pour chacun des 16 couples
-- insérés plus haut, la transition doit passer ; pour tout couple absent, elle doit être refusée
-- avec la phrase du déclencheur. Le script `terrain/matrice.mjs` du bac à sable du 01/10 fait
-- exactement cette boucle.
