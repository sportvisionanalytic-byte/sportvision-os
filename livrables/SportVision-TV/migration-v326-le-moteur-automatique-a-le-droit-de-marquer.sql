-- v326 — 28/09/2026 : le moteur automatique de reconnaissance n'avait pas de compte
--
-- LE PROBLÈME. Les trois fonctions du parcours — `visage_reference_ajouter`,
-- `visage_rapprocher_direct`, `marquer_par_reconnaissance` — exigent un membre du staff média,
-- parce qu'elles étaient appelées depuis l'OS, par un humain connecté. Un moteur qui tourne tout
-- seul n'a pas de compte : il porte la clé de service.
--
-- CE QU'ON NE FAIT PAS : recopier ces trois fonctions en versions « moteur ». Ce serait la sixième
-- fois aujourd'hui qu'une règle métier existe en double, et les cinq précédentes ont toutes fini
-- par diverger. Une règle recopiée est une règle qu'on oubliera de corriger.
--
-- CE QU'ON FAIT : `media_upload_staff()` reconnaît la clé de service. Un seul endroit, et les trois
-- fonctions suivent, puisque `peut_marquer_galerie` s'appuie déjà dessus.
--
-- CE QUE ÇA N'ÉLARGIT PAS, et c'est le point qui compte : la clé de service contourne DÉJÀ toutes
-- les policies de la base, par construction. Elle ne gagne donc aucun pouvoir ici — elle gagne le
-- droit d'appeler des fonctions qui, elles, portent les règles métier. C'est exactement l'inverse
-- d'un contournement : le moteur passe par les mêmes portes que l'OS, avec les mêmes contrôles de
-- consentement, de club et d'équipe.
--
-- La clé de service ne quitte jamais le serveur : elle n'est ni dans l'application, ni dans un
-- navigateur, ni dans le dépôt.
--
-- Idempotent.

create or replace function public.media_upload_staff()
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $f$
  select
    -- Le moteur automatique de reconnaissance (v326). Aucun humain derriere, donc aucun profil :
    -- c'est la cle de service qui l'identifie.
    auth.role() = 'service_role'
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.actif and p.role in ('admin','sec','prod','photo')
    );
$f$;
