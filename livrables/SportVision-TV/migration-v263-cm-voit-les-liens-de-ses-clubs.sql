-- v263 — Le CM d'un club atteint les fichiers d'origine de ses prestations (25/09/2026)
--
-- DEMANDE DE FOUKA : « Il faudrait que le CM affilié au club voie les liens affiliés à une
-- prestation, pour qu'il puisse télécharger directement les fichiers sans dégradation de qualité,
-- et faire la communication correctement. »
--
-- CE QUI BLOQUAIT, ET CE N'ÉTAIT PAS LES LIENS. Un CM lit déjà `media_liens` : la policy `ml_read`
-- demande `is_staff()`, et le rôle 'cm' en fait partie. Le mur était ailleurs — la policy de
-- `prestations` n'ouvre au CM que les prestations de type `réseaux_sociaux`. Une prestation photo
-- ou vidéo, justement celle dont il veut les fichiers, lui est invisible. Il voyait donc les
-- liens sans pouvoir savoir de quelle prestation ni de quel client ils venaient : 21 lignes
-- anonymes, inutilisables.
--
-- POURQUOI UNE FONCTION PLUTÔT QU'UNE POLICY PLUS LARGE. Ouvrir `prestations` au CM lui donnerait
-- aussi les montants, les marges et le statut financier du client. La règle du 11/09 — les
-- données d'un club se donnent par rôle, pas en bloc — l'interdit. Cette fonction rend donc
-- exactement ce dont un CM a besoin pour récupérer des fichiers : le lien, son fournisseur, sa
-- date d'expiration, et de quoi reconnaître la prestation. Aucun euro n'en sort.
--
-- LE PÉRIMÈTRE N'EST PAS RÉINVENTÉ : `contenus_visible_par_cm(client_id, uid)` fait déjà foi pour
-- décider ce qu'un CM voit d'un client — responsable global, affiliation explicite, ou désignation
-- directe. On l'appelle, on ne la recopie pas. Une cinquième définition du périmètre d'un CM
-- serait une cinquième occasion de diverger.
--
-- Idempotente. À exécuter dans Supabase → SQL Editor.

create or replace function public.cm_liens_de_mes_prestations()
returns table (
  lien_id         uuid,
  nom             text,
  url             text,
  fournisseur     text,
  type_media      text,
  date_expiration date,
  prestation_id   uuid,
  reference       text,
  client_nom      text,
  date_prestation date,
  type_prestation text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    l.id, l.nom, l.url, l.fournisseur::text, l.type_media::text, l.date_expiration,
    p.id, p.reference, c.nom, p.date_prestation, p.type_prestation
  from media_liens l
  join prestations p on p.id = l.prestation_id
  join clients c on c.id = p.client_id
  where not public.compte_os_desactive()
    -- `contenus_visible_par_cm` exige déjà le rôle 'cm' dans chacune de ses branches : un autre
    -- rôle appelant cette fonction n'obtient rien, sans qu'on ait à le dire deux fois.
    and public.contenus_visible_par_cm(p.client_id, auth.uid())
    -- Un lien douteux ou périmé n'est pas un fichier à récupérer, c'est une fausse piste.
    and l.statut = 'valide'
    and (l.date_expiration is null or l.date_expiration >= (now() at time zone 'Europe/Paris')::date)
  order by p.date_prestation desc nulls last, l.created_at desc;
$function$;

-- Une fonction SECURITY DEFINER ouverte a PUBLIC est exploitable sans compte : on la referme, et
-- on ne l'ouvre qu'aux personnes connectees. `auth.uid()` vaut null pour anon, la fonction ne
-- rendrait donc rien — mais compter sur ce hasard plutot que sur un GRANT explicite est
-- exactement l'erreur fermee lors de l'audit securite du 09/09.
revoke all on function public.cm_liens_de_mes_prestations() from public, anon;
grant execute on function public.cm_liens_de_mes_prestations() to authenticated;

comment on function public.cm_liens_de_mes_prestations() is
  'Les liens de transfert des prestations des clients d''un CM, pour recuperer les fichiers '
  'd''origine. Perimetre delegue a contenus_visible_par_cm. Ne rend aucune donnee financiere.';
