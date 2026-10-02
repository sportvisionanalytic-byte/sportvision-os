-- v451 (02/10/2026) — L'XP se gagne, elle ne s'écrit pas.
--
-- MESURÉ par le chemin réel, transaction annulée, jeton d'un opérateur :
--     update profiles set xp = 9999 where id = <lui-même>   →  passe, valeur RELUE = 9999
--
-- `protect_sensitive_profile_fields` tient déjà `role`, `grade`, `niveau_operateur` et
-- `type_contrat`. `xp` ne l'était pas. La v440 a fermé l'écriture directe des inscriptions et des
-- certifications, mais pas le compteur lui-même : il restait un dernier chemin pour se fabriquer
-- une progression.
--
-- CE QUE ÇA COÛTE, ET CE QUE ÇA NE COÛTE PAS. L'XP ne débloque aucune formation — c'est le `grade`
-- qui le fait, et il est protégé — et elle ne fixe aucun montant. Mais elle décide du classement
-- affiché à toute l'équipe, et elle sert de signal pour confier une mission. Un compteur qu'on
-- s'écrit soi-même est un signal qui ne signale plus rien.
--
-- POURQUOI CE N'ÉTAIT PAS FERMÉ PLUS TÔT : trois fonctions créditent `profiles.xp` légitimement
-- (`mission_valider_travail`, `rpc_complete_formation`, `rpc_submit_quiz`), et elles tournent avec
-- l'identité de l'appelant. Un garde qui regarde QUI écrit les aurait donc bloquées aussi. D'où
-- le même choix que v375, v400 et v440 : on n'autorise pas selon le rôle, on EXIGE LE CHEMIN. Les
-- trois posent déjà leur drapeau de transaction (`sv.verdict_travail` pour la première,
-- `sv.formation_serveur` pour les deux autres) — vérifié dans leur définition avant d'écrire ce
-- fichier. Il n'y a donc rien à modifier chez elles.
--
-- L'Admin garde la main : un compteur faux doit pouvoir se corriger, et sa correction se voit dans
-- le journal de ses actions.
--
-- `coalesce(current_setting(..., true), '')` : sans lui, le réglage absent rend NULL, la
-- comparaison rend NULL, et le garde NE LÈVERAIT JAMAIS — dans le cas précis qu'il doit refuser.
-- C'est le piège rencontré quatre fois les 01 et 02/10.

create or replace function public.protect_l_xp_se_gagne()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role text;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.xp is not distinct from old.xp then
    return new;
  end if;

  -- Le chemin légitime : une des trois RPC qui créditent, reconnaissable à son drapeau.
  if coalesce(current_setting('sv.verdict_travail', true), '') = 'oui'
     or coalesce(current_setting('sv.formation_serveur', true), '') = 'oui' then
    return new;
  end if;

  select role into v_role from profiles where id = auth.uid();
  if v_role = 'admin' then
    return new;
  end if;

  raise exception 'L''expérience se gagne en validant une mission ou en terminant une formation ; elle ne s''écrit pas à la main.'
    using errcode = '42501';
end;
$function$;

drop trigger if exists trg_protect_l_xp_se_gagne on public.profiles;

-- « z_ » pour passer APRÈS les autres BEFORE UPDATE de la table : l'ordre se joue sur le nom, et
-- les redirections d'adresse et de logistique doivent avoir fait leur travail avant.
create trigger z_trg_protect_l_xp_se_gagne
  before update on public.profiles
  for each row execute function public.protect_l_xp_se_gagne();
