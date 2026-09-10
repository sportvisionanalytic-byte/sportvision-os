# Correctif candidat — récursion RLS profiles / club_members

**Statut : PROPOSÉ, NON APPLIQUÉ EN PRODUCTION.** Validé et testé uniquement sur le
projet Supabase Review (`ffjktzmsezfrwmrtlhzo`). Ne pas exécuter contre la production
(projet Supabase Production, distinct de Review) sans validation explicite de Fouka.

## Cause exacte

Deux policies RLS auto-référentes, sans passer par une fonction `SECURITY DEFINER`,
contrairement à toutes les autres vérifications de rôle du système :

1. Sur `profiles` : les policies `Admin lecture tous profils`, `Admin met à jour tous
   profils`, `Admin supprime un profil`, `Lead CM met à jour profils CM` contiennent
   chacune une sous-requête brute `EXISTS (SELECT 1 FROM profiles ... )` — une policy
   de `profiles` qui interroge `profiles` directement. Postgres doit réappliquer les
   policies de `profiles` à cette sous-requête, y compris la policy elle-même →
   régression infinie détectée statiquement (`42P17`).
2. Sur `club_members` : la policy `cm_same_club_select` fait de même — sous-requête
   brute `EXISTS (SELECT 1 FROM club_members cm2 ...)` depuis une policy de
   `club_members`.

Toute autre table (`clubs`, `club_teams`...) qui référence `profiles` en ligne dans une
policy (`clubs_staff_all`, `cm_staff_all`) hérite du problème par ricochet : leur
sous-requête sur `profiles` déclenche à son tour les policies cassées de `profiles`.

## Impact potentiel en production

**Risque probable en production, non prouvé par exécution.** Les définitions de
fonctions, propriétaire, attribut `BYPASSRLS` et policies sont identiques byte pour
byte entre Review et production (vérifié par lecture de métadonnées uniquement —
aucune requête exécutée contre la production). Comme ce comportement est purement
structurel (déterminé par les policies, indépendant des données), l'identité totale
rend probable la même récursion en production, mais ceci reste à démontrer par une
exécution réelle et prudente, décidée séparément par Fouka.

Si confirmé : toute lecture authentifiée de `profiles`, `club_members`, et par
ricochet `clubs`/`club_teams` (via leurs policies `*_staff_all`) échouerait en
HTTP 500 pour les combinaisons de policies concernées.

## Changement SQL proposé

Crée deux fonctions `SECURITY DEFINER` (même pattern que `is_staff()` /
`est_cm_cloisonne()` déjà utilisées partout ailleurs dans le système — aucune
architecture nouvelle), puis remplace les 4+1 policies concernées par des versions
équivalentes appelant ces fonctions au lieu de la sous-requête brute. **Sémantique
strictement identique — aucun élargissement de permission.**

```sql
-- Nouvelles fonctions (mêmes garanties que is_staff/est_cm_cloisonne : STABLE,
-- SECURITY DEFINER, search_path explicite, mêmes grants EXECUTE par défaut
-- anon/authenticated/service_role — aucun élargissement de privilège).
create or replace function public.is_admin_strict()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$function$;

create or replace function public.is_cm_lead()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from profiles where id = auth.uid() and role = 'cm' and niveau_cm = 'cm_lead');
$function$;

create or replace function public.is_club_bureau_member(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from club_members cm2
    where cm2.user_id = auth.uid()
      and cm2.club_id = target_club_id
      and cm2.status = 'actif'
      and cm2.role = any (array['admin','president','tresorier','membre_bureau'])
  );
$function$;

-- profiles : remplace les 4 policies auto-référentes par des versions équivalentes.
drop policy if exists "Admin lecture tous profils" on profiles;
create policy "Admin lecture tous profils" on profiles for select using (is_admin_strict());

drop policy if exists "Admin met à jour tous profils" on profiles;
create policy "Admin met à jour tous profils" on profiles for update using (is_admin_strict());

drop policy if exists "Admin supprime un profil" on profiles;
create policy "Admin supprime un profil" on profiles for delete using (is_admin_strict());

drop policy if exists "Lead CM met à jour profils CM" on profiles;
create policy "Lead CM met à jour profils CM" on profiles for update
  using (role = 'cm' and is_cm_lead());

-- club_members : remplace la policy auto-référente par une version équivalente.
drop policy if exists cm_same_club_select on club_members;
create policy cm_same_club_select on club_members for select
  using (is_club_member(club_id) and is_club_bureau_member(club_id));
```

## Tables / policies / fonctions touchées

| Objet | Type de changement |
|---|---|
| `public.is_admin_strict()` | nouvelle fonction |
| `public.is_cm_lead()` | nouvelle fonction |
| `public.is_club_bureau_member(uuid)` | nouvelle fonction |
| `profiles` policy `Admin lecture tous profils` (SELECT) | remplacée, même sémantique |
| `profiles` policy `Admin met à jour tous profils` (UPDATE) | remplacée, même sémantique |
| `profiles` policy `Admin supprime un profil` (DELETE) | remplacée, même sémantique |
| `profiles` policy `Lead CM met à jour profils CM` (UPDATE) | remplacée, même sémantique |
| `club_members` policy `cm_same_club_select` (SELECT) | remplacée, même sémantique |

Aucune table, colonne, contrainte, trigger ni fonction existante n'est modifiée en
dehors de cette liste. Aucune donnée n'est touchée.

## Résultat avant/après sur Review

- Avant : suite de 24 tests RLS (JWT réels) → **19 passed / 5 failed**, tous les échecs
  en `42P17` sur `profiles`/`club_members`/`clubs`.
- Après (schéma appliqué uniquement sur Review) : mêmes 24 tests → **24 passed / 0
  failed**. Plus 7 tests supplémentaires anti-élargissement (vérifient explicitement
  qu'aucune persona n'obtient plus de données qu'avant/que prévu, notamment qu'un
  coach non-bureau ne voit toujours que sa propre ligne dans `club_members`, jamais
  les 5 membres) → **7 passed / 0 failed**. Total **31/31**.

## Risques du correctif

- **Risque de régression fonctionnelle : faible.** Les nouvelles fonctions
  reproduisent exactement la condition des anciennes sous-requêtes, testé
  explicitement par les 7 tests anti-élargissement.
- **Risque de doublon de policy si le nom existe déjà autrement en production** :
  les `DROP POLICY IF EXISTS` protègent contre une absence, mais si une politique de
  même nom existe déjà avec un contenu différent de celui documenté ici (dérive non
  détectée), le remplacement écraserait cette version-là. À vérifier par une lecture
  des policies actuelles de production juste avant d'appliquer, pas en aveugle.
- **Aucun changement de privilège** : les nouvelles fonctions ont les mêmes grants
  `EXECUTE` par défaut que les fonctions équivalentes déjà en production
  (`anon`/`authenticated`/`service_role`), aucune élévation.

## Procédure de rollback

Ré-exécuter les définitions originales (sauvegardées ici) restaure l'état antérieur
à l'identique — y compris son bug, donc uniquement en cas d'effet de bord inattendu
et non prévu par les tests :

```sql
drop policy if exists "Admin lecture tous profils" on profiles;
create policy "Admin lecture tous profils" on profiles for select
  using (exists (select 1 from profiles profiles_1 where profiles_1.id = auth.uid() and profiles_1.role = 'admin'));

drop policy if exists "Admin met à jour tous profils" on profiles;
create policy "Admin met à jour tous profils" on profiles for update
  using (exists (select 1 from profiles profiles_1 where profiles_1.id = auth.uid() and profiles_1.role = 'admin'));

drop policy if exists "Admin supprime un profil" on profiles;
create policy "Admin supprime un profil" on profiles for delete
  using (exists (select 1 from profiles profiles_1 where profiles_1.id = auth.uid() and profiles_1.role = 'admin'));

drop policy if exists "Lead CM met à jour profils CM" on profiles;
create policy "Lead CM met à jour profils CM" on profiles for update
  using (role = 'cm' and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'cm' and p.niveau_cm = 'cm_lead'));

drop policy if exists cm_same_club_select on club_members;
create policy cm_same_club_select on club_members for select
  using (is_club_member(club_id) and exists (
    select 1 from club_members cm2
    where cm2.user_id = auth.uid() and cm2.club_id = club_members.club_id
      and cm2.status = 'actif' and cm2.role = any (array['admin','president','tresorier','membre_bureau'])
  ));

-- Les fonctions is_admin_strict/is_cm_lead/is_club_bureau_member peuvent rester
-- (inoffensives, non référencées ailleurs) ou être supprimées avec DROP FUNCTION.
```

## Tests à effectuer immédiatement après un déploiement production

1. Un compte staff réel (`role = 'admin'`) charge son propre profil — doit réussir
   (pas de 500).
2. Un compte staff réel liste `club_members` d'un club où il est bureau/staff — doit
   réussir et renvoyer les bonnes lignes (pas plus, pas moins qu'avant tout incident).
3. Un compte coach réel (non bureau) liste `club_members` de son club — doit
   renvoyer **uniquement sa propre ligne**, jamais les autres membres.
4. Surveiller les logs d'erreurs Postgres/PostgREST pendant les 30 minutes suivant le
   déploiement pour tout nouveau `42P17` ou `42501` (permission denied) inattendu.
5. Confirmer via `pg_policies` que les 5 policies listées ci-dessus correspondent
   exactement au SQL proposé (pas de dérive introduite par un déploiement partiel).
