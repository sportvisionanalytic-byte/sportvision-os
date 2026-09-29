-- v349 — UN LONG ALBUM INTERROMPU NE DOIT PAS ÊTRE ABANDONNÉ (29/09/2026)
--
-- v348 a mis un compteur d'essais pour qu'une galerie qui plante ne bloque plus la file. Bien.
-- Mais l'essai se compte AVANT le travail, et rien ne le remet à zéro. Conséquence mesurée
-- aujourd'hui : « Villemomble vs OPB », 161 photos, environ 40 minutes de calcul, affiche
-- essais = 2 — non pas parce qu'elle plante, mais parce que le service a redémarré deux fois
-- pendant qu'elle avançait (un déploiement, un `bootout`). Au troisième redémarrage, une galerie
-- parfaitement saine sortirait de la file avec le motif « abandonné après 3 essais sans succès ».
--
-- Sur le Mac de Fouka, qui tourne en permanence et qu'on redémarre de temps en temps, c'est la
-- panne la plus probable du moteur : les GROSSES galeries, celles qui prennent le plus de temps,
-- sont exactement celles qui ont le plus de chances d'être interrompues. On perdrait les albums
-- les plus lourds, silencieusement, et on garderait les petits.
--
-- Le compteur doit mesurer l'ÉCHEC, pas l'interruption. Un travail qui a calculé de vraies photos
-- a prouvé qu'il n'est pas cassé : son budget repart de zéro. Un travail qui plante toujours au
-- même endroit n'en calcule aucune et atteint bien ses trois essais.

create or replace function public.reconnaissance_progresse(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Réservé au moteur.' using errcode = '42501';
  end if;

  update reconnaissance_a_faire f
     set essais = 0
   where f.id = any(p_ids) and f.traite_le is null and f.essais <> 0;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.reconnaissance_progresse(uuid[]) from public, anon, authenticated;
grant execute on function public.reconnaissance_progresse(uuid[]) to service_role;

comment on function public.reconnaissance_progresse(uuid[]) is
  'Le moteur signale qu''un travail avance vraiment (des photos calculées) : son compteur d''essais '
  'repart de zéro. Sans ça, un long album interrompu par des redémarrages serait abandonné alors '
  'qu''il fonctionne. v349, 29/09/2026.';

-- Et on répare les lignes déjà comptées à tort : les deux essais de Villemomble ne sont pas des
-- échecs. Une correction qui ne répare pas le passé laisse la prochaine panne arriver quand même.
update reconnaissance_a_faire
   set essais = 0
 where traite_le is null and essais > 0;

notify pgrst, 'reload schema';

-- ET LE DROIT D'APPEL. `reconnaissance_commencer` (v348) était exécutable par anon et
-- authenticated. Sa garde interne la protège — elle lève 42501 si l'appelant n'est pas le moteur —
-- mais un droit inutile est une garde de plus à ne jamais casser. Le moteur seul en a besoin.
revoke all on function public.reconnaissance_commencer(uuid[], smallint) from public, anon, authenticated;
grant execute on function public.reconnaissance_commencer(uuid[], smallint) to service_role;
