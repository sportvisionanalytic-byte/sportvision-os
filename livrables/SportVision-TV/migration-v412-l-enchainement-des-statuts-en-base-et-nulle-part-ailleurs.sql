-- v412 — L'ENCHAÎNEMENT DES STATUTS EN BASE, ET NULLE PART AILLEURS (01/10/2026)
--
-- == CE QUE L'AUDIT A TROUVÉ ====================================================================
--
-- QUATRE MISSIONS PASSÉES NE SE CLÔTURENT PAS, et SV-2026-3121 est bloquée en `arrivée_sur_place`
-- depuis le 19 septembre. Le journal financier dit exactement ce qui s'est passé : Antoine Blin a
-- tapé « Je suis arrivé » à 11 h 07 ce 19 septembre, et plus rien. Il a pourtant déposé huit liens
-- les 23 et 25 septembre. La mission est faite, livrée, et son statut dit encore qu'il est debout
-- au bord du terrain, douze jours plus tard.
--
-- SV-2026-3843 et SV-2026-3957 sont garées sur `médias_complets`, toutes les deux. Ce n'est pas un
-- hasard : c'est la dernière marche que l'opérateur franchit sans la Production.
--
-- LE RESPONSABLE DE PRODUCTION N'A AUCUN BOUTON POUR AVANCER UNE MISSION DEPUIS SON TÉLÉPHONE.
-- Mesuré : `prod/` ne contient aucune écriture sur `prestations`, ni `validate_production`, ni
-- `mission_valider_travail`. L'OS web, lui, a le bouton « → » (`avancerStatutPrestation`), ouvert
-- aux rôles admin/sec/prod. Mesuré aussi, par le chemin réel avec le jeton de Mikael et en
-- transaction annulée : les quatre transitions dont ces missions ont besoin PASSENT. Le droit
-- existe, le geste n'existe pas sur le téléphone.
--
-- == POURQUOI UNE TABLE, ET PAS UN TROISIÈME BOUTON ============================================
--
-- La liste des enchaînements légaux existe aujourd'hui DEUX fois :
--
--   · en SQL, dans `validate_prestation_statut_transition()`, sous forme d'un grand `or` ;
--   · en JavaScript, dans `_NEXT_ST` de l'OS web, qui décide ce que le bouton « → » propose.
--
-- Écrire une troisième copie dans l'application en ferait trois, et la v377 a déjà tranché ce débat
-- pour la moitié opérateur de la même chaîne : elle a sorti sa liste de
-- `protect_prestation_operational_fields()` pour la mettre dans la table `operateur_transitions`,
-- « que les interfaces lisent aussi, pour qu'un bouton ne puisse plus proposer ce que cette ligne
-- refuse ». On termine le travail commencé : `prestation_transitions` porte TOUTE la chaîne, le
-- trigger la consulte, et les interfaces la lisent au lieu de la deviner.
--
-- == L'ÉQUIVALENCE EST PROUVÉE, PAS AFFIRMÉE ====================================================
--
-- La table est remplie à l'identique du `or` qu'elle remplace, et la migration compare les deux
-- verdicts sur LES 33 × 33 = 1 089 COUPLES de l'énumération `statut_prestation`. Un seul écart et
-- la migration lève : on ne remplace pas une règle de production sur la foi d'une relecture.
--
-- `annulée` reste traitée à part dans le trigger, comme avant : toute mission non clôturée peut
-- être annulée depuis n'importe quel statut, ce n'est pas une arête de la chaîne.

create table if not exists public.prestation_transitions (
  statut_depuis statut_prestation not null,
  statut_vers   statut_prestation not null,
  -- Ce que le bouton doit écrire. Les libellés sont ceux de l'OS web (règle : l'OS fait foi).
  libelle       text not null,
  -- L'ordre d'affichage quand plusieurs suites sont possibles : la marche normale d'abord.
  ordre         integer not null,
  -- Vrai quand c'est la suite NORMALE du parcours. Les autres sont des raccourcis ou des retours
  -- en arrière, que l'interface ne doit pas proposer en premier.
  est_la_suite  boolean not null default false,
  primary key (statut_depuis, statut_vers)
);

comment on table public.prestation_transitions is
  'Les enchaînements légaux de statut_prestation. Source unique : le trigger validate_prestation_statut_transition la consulte, et les interfaces la lisent pour ne proposer que ce qu''elle autorise (v412).';

alter table public.prestation_transitions enable row level security;

drop policy if exists prestation_transitions_select on public.prestation_transitions;
create policy prestation_transitions_select on public.prestation_transitions
  for select to authenticated using (true);
-- Aucune policy d'écriture : la chaîne se change par migration, pas depuis un écran.

grant select on public.prestation_transitions to authenticated;

-- ── La chaîne, reprise terme pour terme du `or` qu'elle remplace ───────────────────────────────
insert into public.prestation_transitions (statut_depuis, statut_vers, libelle, ordre, est_la_suite) values
  ('demande_reçue','à_qualifier','Qualifier la demande',10,true),
  ('à_qualifier','offre_en_préparation','Préparer l''offre',20,true),
  ('offre_en_préparation','devis_envoyé','Devis envoyé',30,true),
  ('devis_envoyé','en_attente_réponse','En attente de réponse',40,true),
  ('en_attente_réponse','devis_accepté','Devis accepté',50,true),
  ('devis_accepté','en_attente_signature','En attente de signature',60,true),
  ('en_attente_signature','en_attente_acompte','En attente d''acompte',70,true),
  ('en_attente_acompte','documents_complets','Documents complets',80,true),
  ('documents_complets','à_valider_production','À valider par la Production',90,true),
  ('à_valider_production','confirmée','Confirmer la mission',100,true),
  ('confirmée','à_planifier','À planifier',110,true),
  ('à_planifier','planifiée','Planifier',120,true),
  ('planifiée','équipe_affectée','Équipe affectée',130,true),
  ('équipe_affectée','prête','Mission prête',140,true),
  ('prête','équipe_en_route','Équipe en route',150,true),
  ('équipe_en_route','arrivée_sur_place','Arrivée sur place',160,true),
  ('arrivée_sur_place','production_démarrée','Démarrer la production',170,true),
  ('production_démarrée','production_terminée','Prestation terminée',180,true),
  ('production_terminée','médias_à_transférer','Médias à transférer',190,true),
  ('médias_à_transférer','médias_complets','Médias complets',200,true),
  ('médias_complets','à_monter','Passer au montage',210,true),
  ('à_monter','montage_en_cours','Montage démarré',220,true),
  ('montage_en_cours','prêt_validation','Prêt pour validation',230,true),
  ('prêt_validation','à_valider_client','À valider par le client',240,true),
  ('à_valider_client','prête_à_livrer','Prête à livrer',250,true),
  ('prête_à_livrer','livrée','Livrer au client',260,true),
  -- INC-021 (20/08) : `livrée` va DIRECTEMENT à `clôturée`. Le financier avance de son côté, par
  -- `statut_financier`, et `statut` n'a jamais à valoir « payée ».
  ('livrée','clôturée','Clôturer la mission',270,true),
  -- ── Les raccourcis et les retours en arrière. Légaux, mais jamais « la suite ». ──────────────
  ('demande_reçue','offre_en_préparation','Préparer l''offre sans qualifier',310,false),
  ('demande_reçue','devis_envoyé','Devis envoyé directement',320,false),
  ('à_qualifier','devis_envoyé','Devis envoyé directement',330,false),
  ('prêt_validation','livrée','Livrer sans validation client',340,false),
  ('à_valider_production','refusée','Refuser la demande',350,false),
  ('confirmée','équipe_en_route','Équipe en route',360,false),
  ('équipe_affectée','équipe_en_route','Équipe en route',370,false),
  ('planifiée','équipe_en_route','Équipe en route',380,false),
  ('prête','production_démarrée','Démarrer la production',390,false),
  -- 28/08 : un opérateur qui refuse une mission déjà à `équipe_affectée`, personne d'autre n'étant
  -- resté `acceptée`, la ramène en attribution.
  ('équipe_affectée','planifiée','Remettre en attribution',400,false)
on conflict (statut_depuis, statut_vers) do nothing;

-- ── L'ÉQUIVALENCE, SUR LES 1 089 COUPLES ──────────────────────────────────────────────────────
do $equiv$
declare
  v_ecarts text[] := '{}';
  r record;
begin
  for r in
    select a.enumlabel::text as d, b.enumlabel::text as v,
           -- Le verdict de l'ANCIEN `or`, recopié ici une dernière fois pour être comparé puis
           -- jeté. C'est le seul endroit où cette duplication est légitime : elle sert à prouver
           -- qu'on peut la supprimer.
           (
             (a.enumlabel = 'demande_reçue' and b.enumlabel = 'à_qualifier')
             or (a.enumlabel = 'à_qualifier' and b.enumlabel = 'offre_en_préparation')
             or (a.enumlabel = 'offre_en_préparation' and b.enumlabel = 'devis_envoyé')
             or (a.enumlabel = 'devis_envoyé' and b.enumlabel = 'en_attente_réponse')
             or (a.enumlabel = 'en_attente_réponse' and b.enumlabel = 'devis_accepté')
             or (a.enumlabel = 'devis_accepté' and b.enumlabel = 'en_attente_signature')
             or (a.enumlabel = 'en_attente_signature' and b.enumlabel = 'en_attente_acompte')
             or (a.enumlabel = 'en_attente_acompte' and b.enumlabel = 'documents_complets')
             or (a.enumlabel = 'documents_complets' and b.enumlabel = 'à_valider_production')
             or (a.enumlabel = 'à_valider_production' and b.enumlabel = 'confirmée')
             or (a.enumlabel = 'confirmée' and b.enumlabel = 'à_planifier')
             or (a.enumlabel = 'à_planifier' and b.enumlabel = 'planifiée')
             or (a.enumlabel = 'planifiée' and b.enumlabel = 'équipe_affectée')
             or (a.enumlabel = 'équipe_affectée' and b.enumlabel = 'planifiée')
             or (a.enumlabel = 'équipe_affectée' and b.enumlabel = 'prête')
             or (a.enumlabel = 'prête' and b.enumlabel = 'équipe_en_route')
             or (a.enumlabel = 'équipe_en_route' and b.enumlabel = 'arrivée_sur_place')
             or (a.enumlabel = 'arrivée_sur_place' and b.enumlabel = 'production_démarrée')
             or (a.enumlabel = 'production_démarrée' and b.enumlabel = 'production_terminée')
             or (a.enumlabel = 'production_terminée' and b.enumlabel = 'médias_à_transférer')
             or (a.enumlabel = 'médias_à_transférer' and b.enumlabel = 'médias_complets')
             or (a.enumlabel = 'médias_complets' and b.enumlabel = 'à_monter')
             or (a.enumlabel = 'à_monter' and b.enumlabel = 'montage_en_cours')
             or (a.enumlabel = 'montage_en_cours' and b.enumlabel = 'prêt_validation')
             or (a.enumlabel = 'prêt_validation' and b.enumlabel = 'à_valider_client')
             or (a.enumlabel = 'à_valider_client' and b.enumlabel = 'prête_à_livrer')
             or (a.enumlabel = 'prête_à_livrer' and b.enumlabel = 'livrée')
             or (a.enumlabel = 'livrée' and b.enumlabel = 'clôturée')
             or (a.enumlabel = 'demande_reçue' and b.enumlabel = 'offre_en_préparation')
             or (a.enumlabel = 'demande_reçue' and b.enumlabel = 'devis_envoyé')
             or (a.enumlabel = 'à_qualifier' and b.enumlabel = 'devis_envoyé')
             or (a.enumlabel = 'prêt_validation' and b.enumlabel = 'livrée')
             or (a.enumlabel = 'à_valider_production' and b.enumlabel = 'refusée')
             or (a.enumlabel = 'confirmée' and b.enumlabel = 'équipe_en_route')
             or (a.enumlabel = 'équipe_affectée' and b.enumlabel = 'équipe_en_route')
             or (a.enumlabel = 'planifiée' and b.enumlabel = 'équipe_en_route')
             or (a.enumlabel = 'prête' and b.enumlabel = 'production_démarrée')
           ) as ancien,
           exists (select 1 from prestation_transitions t
                    where t.statut_depuis::text = a.enumlabel and t.statut_vers::text = b.enumlabel) as nouveau
      from (select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
             where t.typname = 'statut_prestation') a
      cross join (select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
                   where t.typname = 'statut_prestation') b
  loop
    if r.ancien is distinct from r.nouveau then
      v_ecarts := v_ecarts || (r.d || ' → ' || r.v || ' : ancien=' || r.ancien || ', table=' || r.nouveau);
    end if;
  end loop;

  if array_length(v_ecarts, 1) is not null then
    raise exception 'v412 refusée : la table ne dit pas la même chose que le trigger. Écarts : %',
      array_to_string(v_ecarts, ' | ');
  end if;
  raise notice 'v412 : 1089 couples comparés, aucun écart.';
end $equiv$;

-- ── Le trigger consulte la table, et ne porte plus la liste ───────────────────────────────────
create or replace function public.validate_prestation_statut_transition()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.statut is distinct from old.statut then
    -- L'annulation n'est pas une arête de la chaîne : elle part de partout, sauf d'une mission
    -- déjà clôturée ou déjà annulée. Comportement inchangé.
    if new.statut = 'annulée' and old.statut not in ('clôturée','annulée') then
      return new;
    end if;

    if not exists (
      select 1 from prestation_transitions t
       where t.statut_depuis = old.statut and t.statut_vers = new.statut
    ) then
      raise exception 'Transition de statut non autorisée : % → % ne correspond à aucun enchaînement connu du workflow.', old.statut, new.statut;
    end if;
  end if;

  return new;
end;
$function$;
