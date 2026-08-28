-- ============================================================================
-- migration-media-bank.sql
-- ============================================================================
-- Media Bank SportVision V1 : banque centrale des meilleures séquences
-- réutilisables par la communication SportVision elle-même (la marque, pas un
-- club en particulier), classée par sport puis catégorie.
--
-- Principe non négociable de la spec : pas de duplication. Un média ajouté à
-- la Media Bank reste dans son dossier/lien d'origine (media_liens) — on
-- ajoute juste un tag. Donc PAS de nouvelle table media_bank_items, juste 3
-- colonnes sur media_liens :
--   is_media_bank      : le média est-il retenu comme pépite réutilisable ?
--   media_bank_sport   : sport (texte libre, ex "Football" — pas un enum
--                        rigide, chaque sport aura ses propres catégories)
--   media_bank_category: catégorie (texte libre, ex "Buts", "Célébrations" —
--                        suggestions proposées côté UI via <datalist>, pas
--                        contraintes en base)
--
-- RLS existante (vérifiée avant d'écrire cette migration, cf. pg_policies) :
--   ml_read  (SELECT, roles public, qual = is_staff())
--   ml_write (ALL,    roles public, qual = is_staff())
-- is_staff() n'a AUCUNE notion de club/prestation — elle vérifie seulement
-- que profiles.role fait partie du staff interne SportVision (admin, sec,
-- prod, photo, cm, compta, com) et qu'il n'a pas de rattachement client
-- (membership hors cm_agency, player_profile, connect_profile_settings).
-- Conséquence : le rôle cm a donc DÉJÀ un accès SELECT cross-club à
-- media_liens via ml_read — le principe "Media Bank visible par le CM quel
-- que soit le club" est donc déjà satisfait par la policy existante, que
-- cette migration NE MODIFIE PAS volontairement (elle a été inspectée, pas
-- réécrite).
--
-- En revanche ml_write (ALL, is_staff()) laisse aujourd'hui n'importe quel
-- rôle staff — donc aussi cm — modifier n'importe quelle colonne de
-- media_liens, y compris les 3 nouvelles. Ça viole l'exigence "seuls
-- prod/admin peuvent taguer". Comme cette policy sert aussi à plein d'autres
-- écritures légitimes du CM ailleurs sur cette table (aucune n'existe
-- aujourd'hui en pratique, mais on ne restreint pas ml_write globalement pour
-- ne pas casser un flux existant qu'on n'a pas audité entièrement), la
-- protection est posée au niveau colonne via un trigger dédié — même
-- mécanisme que migration-clubplus-v24-protect-sensitive-fields.sql
-- (protect_sensitive_club_fields / trg_protect_sensitive_club_fields).
--
-- Idempotente. À exécuter dans Supabase → SQL Editor (ou API Management).
-- ============================================================================

alter table media_liens add column if not exists is_media_bank boolean not null default false;
alter table media_liens add column if not exists media_bank_sport text;
alter table media_liens add column if not exists media_bank_category text;

-- Index partiel : la page Media Bank du CM filtre systématiquement sur
-- is_media_bank=true, et la table media_liens grossit en continu (tous les
-- rushs de toutes les prestations) — sans index cette requête finirait par
-- scanner toute la table pour ne retenir qu'une poignée de pépites.
create index if not exists idx_media_liens_media_bank
  on media_liens(is_media_bank)
  where is_media_bank = true;

create or replace function protect_media_bank_tag_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  select role into v_role from profiles where id = auth.uid();

  -- admin/prod : seuls rôles autorisés à taguer/détaguer une pépite Media
  -- Bank (cf. spec "Actions par rôle" — Responsable Production + Admin).
  if v_role in ('admin', 'prod') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_media_bank, false)
       or new.media_bank_sport is not null
       or new.media_bank_category is not null
    then
      raise exception 'Seuls les rôles admin et prod peuvent taguer un média Media Bank.';
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE' : bloque uniquement un changement sur les 3 colonnes du
  -- tag, laisse passer toute autre modification (nom, url, statut, etc.) —
  -- ce n'est pas le rôle de ce trigger de revalider le reste de ml_write.
  if new.is_media_bank is distinct from old.is_media_bank
     or new.media_bank_sport is distinct from old.media_bank_sport
     or new.media_bank_category is distinct from old.media_bank_category
  then
    raise exception 'Seuls les rôles admin et prod peuvent modifier le tag Media Bank.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_media_bank_tag_fields on media_liens;
create trigger trg_protect_media_bank_tag_fields
  before insert or update on media_liens
  for each row execute function protect_media_bank_tag_fields();
