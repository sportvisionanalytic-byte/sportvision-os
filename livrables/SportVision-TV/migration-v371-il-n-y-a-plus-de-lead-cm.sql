-- v371 — Il n'y a plus de Lead CM (30/09/2026)
--
-- DÉCISION DE FOUKA, le 30/09 : « il n'y a plus de lead, pour le moment, mais juste CM ».
--
-- ── 1. UNE POLICY QUI NE POUVAIT JAMAIS S'APPLIQUER ──────────────────────────────────────────
--
-- `Lead CM met à jour profils CM` (permissive, UPDATE) dit qu'un CM de niveau `cm_lead` met à jour
-- les profils des autres CM. Elle n'a jamais pu fonctionner : la policy RESTRICTIVE
-- `cm_hors_perimetre_profiles` exige en `with check` que la ligne écrite soit la sienne, et une
-- restrictive ne se contourne pas.
--
-- Mesuré par le chemin réel, dans la peau de chris (le seul cm_lead), sur le profil de Tony :
--     ERROR 42501 : new row violates row-level security policy "cm_hors_perimetre_profiles"
--
-- Elle est donc supprimée. Une policy morte n'est pas inoffensive : elle fait croire, en relisant
-- les droits, qu'une permission existe. C'est comme ça qu'on cherche pendant une heure pourquoi
-- « ça ne marche pas » alors que ça n'a jamais marché.
--
-- ATTENTION SI ON VEUT RÉTABLIR CE DROIT UN JOUR : le supprimer ici ne change rien, mais le
-- recréer ne suffira pas non plus. Il faudrait ouvrir le `with check` de la restrictive, et c'est
-- une décision de sécurité, pas un oubli.
--
-- ── 2. chris n'est plus Lead ─────────────────────────────────────────────────────────────────
--
-- Le niveau `cm_lead` n'est pas décoratif : il est lu par 8 fonctions et 28 policies. Mesuré avant
-- de toucher, dans la peau de chris :
--
--                      clients   contenus   contrats   messages client
--     cm_lead              7         9          2            4
--     cm_interne           2         9          2            0
--
-- Il passe donc de 7 clients à 2 — les deux dont il est le CM affecté — et perd la lecture de 4
-- messages client qui ne le concernent pas. Contenus et contrats ne bougent pas.
--
-- Le niveau retenu est `cm_interne`, que l'application appelle « Community Manager SportVision ».
-- C'est exactement « juste CM », et c'est un état, pas un jugement : le rétrograder en `cm_junior`
-- aurait dit quelque chose de son expérience que personne n'a décidé.
--
-- POUR REVENIR EN ARRIÈRE, une ligne :
--     update profiles set niveau_cm = 'cm_lead' where prenom = 'chris' and role = 'cm';
--
-- Après cette migration, plus personne n'est `cm_lead`. Or `protect_sensitive_profile_fields`
-- réserve l'écriture de `niveau_cm` à l'administrateur OU à un Lead CM : seul l'administrateur
-- peut donc désormais nommer un lead. C'est cohérent avec « il n'y a plus de lead », et c'est
-- réversible depuis l'OS.

begin;

drop policy if exists "Lead CM met à jour profils CM" on public.profiles;

-- L'écriture passe par `security definer` implicite du rôle `postgres` de la migration : le
-- trigger `protect_sensitive_profile_fields` exige un administrateur, et une migration n'a pas
-- d'`auth.uid()`. On le désarme le temps de cette seule ligne, puis on le réarme.
alter table public.profiles disable trigger trg_protect_sensitive_profile_fields;
update public.profiles set niveau_cm = 'cm_interne' where role = 'cm' and niveau_cm = 'cm_lead';
alter table public.profiles enable trigger trg_protect_sensitive_profile_fields;

commit;
