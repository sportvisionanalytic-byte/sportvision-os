-- Le résolveur d'écusson : ce qu'il doit trouver, et surtout ce qu'il ne doit PAS trouver.
--
-- Chaque ligne « rien » ci-dessous est un faux positif réellement produit un jour par une version
-- du résolveur. Ils comptent plus que les réussites : mettre l'écusson d'un club de volley sur le
-- match d'un enfant est pire que ne pas en mettre.

do $$
declare
  cas constant text[][] := array[
    -- ce que le calendrier écrit        ce qu'on doit trouver
    array['Sevran FC U14 2',             'sevran-football-club'],
    array['Vaujours',                    'vaujours-f-c'],
    array['OL NOISY',                    'noisy-le-grand-fc'],   -- attrapait un club de VOLLEY
    array['Torcy US',                    'torcy-paris-vallee-de-la-marne-football-us'],
    array['Val D''europe FC U16 1',      'val-d-europe-football-club'],
    array['À définir',                   'rien'],
    array['Opposition interne On fait les groupes', 'rien'],
    array['FC',                          'rien'],
    array['FCM Auber',                   'rien'],  -- tombait sur « Etoiles d'Auber », sans logo
    array['Gournay Sur Marne',           'rien'],  -- attrapait un club de BASKET
    array['Montreuil FC',                'rien'],  -- 20 clubs de foot contiennent « montreuil »
    array['AFP 18',                      'rien']
  ];
  i int; attendu text; obtenu text; echecs int := 0;
begin
  for i in 1 .. array_length(cas,1) loop
    attendu := cas[i][2];
    obtenu := coalesce(public.resoudre_club_adverse(cas[i][1]), 'rien');
    if obtenu <> attendu then
      echecs := echecs + 1;
      raise warning 'ROUGE : « % » -> % (attendu %)', cas[i][1], obtenu, attendu;
    end if;
  end loop;
  if echecs > 0 then
    raise exception 'ROUGE : % cas sur % ne se resolvent pas comme prevu', echecs, array_length(cas,1);
  end if;

  -- Le resolveur doit rester mesurable : une fonction qu'on ne peut pas rejouer sur ses propres
  -- donnees ne peut plus evoluer sans risque. C'etait le cas avant la v294 (statement_timeout sur
  -- 303 noms), et c'est ce qui a fait trouver les colonnes generees.
  if not exists (select 1 from pg_attribute where attrelid='public.federation_clubs'::regclass
                   and attname='est_autre_sport' and attgenerated <> '') then
    raise exception 'ROUGE : federation_clubs.est_autre_sport n''est plus une colonne generee, le resolveur relit l''annuaire ligne a ligne';
  end if;

  raise notice 'VERT : % cas de resolution conformes', array_length(cas,1);
end $$;
