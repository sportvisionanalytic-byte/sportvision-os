-- RATTRAPAGE PROPOSÉ : le type des 57 galeries déjà en base (v390, 01/10/2026)
--
-- ═══ CE FICHIER N'A PAS ÉTÉ EXÉCUTÉ, ET IL NE DOIT PAS L'ÊTRE SANS AVOIR ÉTÉ RELU ══════════════
--
-- La v390 pose `media_albums.type_evenement` et laisse les 57 galeries existantes à NULL, donc au
-- comportement d'avant : on demande un numéro de maillot aux familles. C'est volontaire. Le type
-- ci-dessous est DEVINÉ D'APRÈS LE TITRE, et une galerie mal devinée en « entrainement » retire la
-- question du numéro à des familles qui en avaient besoin — sans que personne ne le voie. La leçon
-- du 27/09 est écrite : une correction de données ne se défend pas toute seule.
--
-- CE QUE LA DEVINETTE A FAIT, mesuré sur les titres : 55 galeries classées, 2 impossibles.
--
--     « vs », « VS », « CDF », « coupe »  ->  match
--     « plateau »                         ->  plateau
--     « Cup »                             ->  tournoi
--     « Ecole de foot »                   ->  entrainement
--
-- RELIS LA COLONNE DE DROITE AVANT DE LANCER. Une ligne qui te semble fausse : change le mot, ou
-- supprime la ligne et précise-la depuis l'écran de la galerie.
--
-- AUCUNE de ces 55 lignes ne met « entrainement », SAUF « RCPF AMIENS Ecole de foot ». Autrement
-- dit : ce rattrapage ne retire la question du numéro qu'à UNE galerie. Les 54 autres ne changent
-- rien pour les familles, elles ne servent qu'à ce que l'écran dise de quoi il s'agit.
--
-- À lancer d'un bloc, puis à vérifier :
--     select type_evenement, count(*) from media_albums group by 1 order by 2 desc;

begin;

update media_albums set type_evenement = 'tournoi' where id = '10a569ea-53ee-4af6-830f-11a8460c7fdd';  -- Villemomble Cup U10 -  epinay (16 photos)
update media_albums set type_evenement = 'tournoi' where id = 'e762b603-b689-4bec-8da9-bdefa45715c7';  -- Villemomble Cup U10 -  Montreuil (48 photos)
update media_albums set type_evenement = 'tournoi' where id = '4dba1072-0fc9-4116-a277-786127d9f481';  -- Villemomble Cup U10 - AS Bondy (34 photos)
update media_albums set type_evenement = 'tournoi' where id = 'f558eaff-ad79-4705-8bda-6dcd58a36f00';  -- Villemomble Cup U10 - Courbevoie (51 photos)
update media_albums set type_evenement = 'tournoi' where id = 'f510679f-35f4-4d5b-afbb-a26263ae3fa6';  -- Villemomble Cup U10 - Creil (41 photos)
update media_albums set type_evenement = 'tournoi' where id = 'bf0c8c33-cd78-4feb-8c03-a6978c7580e5';  -- Villemomble Cup U10 - creteil (100 photos)
update media_albums set type_evenement = 'tournoi' where id = '878aea6e-88fb-4c78-9506-dba2e96bd482';  -- Villemomble Cup U10 - issy (53 photos)
update media_albums set type_evenement = 'tournoi' where id = '962b7e6d-9381-4d43-8c3d-df7f3d253173';  -- Villemomble Cup U10 - livry gargan (15 photos)
update media_albums set type_evenement = 'tournoi' where id = '9b0fbbba-a71b-49ed-ab10-a3e48f548db0';  -- Villemomble Cup U10 - massy (21 photos)
update media_albums set type_evenement = 'tournoi' where id = '2772026a-bcbe-4ae7-8dc0-50c00bd5264f';  -- Villemomble Cup U10 - moissy (88 photos)
update media_albums set type_evenement = 'tournoi' where id = '12d2b283-1c44-4b1e-a153-5f0946a1e70d';  -- Villemomble Cup U10 - paris acasa (60 photos)
update media_albums set type_evenement = 'tournoi' where id = 'ed4d8ac5-1f67-4e81-9855-730dbe7d20a4';  -- Villemomble Cup U10 - us parisiennes (108 photos)
update media_albums set type_evenement = 'tournoi' where id = '1fb94ee4-0b2e-4af9-aa1f-12c41e55b74e';  -- Villemomble Cup U10 - Vincennes (41 photos)
update media_albums set type_evenement = 'plateau' where id = 'ee1b231a-d4a0-49aa-bed6-a539e7eb7010';  -- FC 93 plateau - Villemomble (203 photos)
update media_albums set type_evenement = 'match' where id = 'b82e8f78-4383-4a6d-837a-812217fdf299';  -- Joinville VS fontainebleau (178 photos)
update media_albums set type_evenement = 'match' where id = '1d09f6d9-4f6b-47b6-bddc-9ed738c06933';  -- Joinville VS Villemomble (145 photos)
update media_albums set type_evenement = 'match' where id = '833982ee-febb-4a8f-aad3-a0a025876fe6';  -- Mortmant vs fontainebleau (203 photos)
update media_albums set type_evenement = 'plateau' where id = 'e32e0d25-c7e5-42ae-b7e0-c3f0286d2957';  -- Noisy plateau - Villemomble (261 photos)
update media_albums set type_evenement = 'match' where id = '1c2a9c5f-e1bc-4fbe-867a-bfb7b39467db';  -- rc argenteuil vs Villemomble (216 photos)
update media_albums set type_evenement = 'match' where id = 'd956788b-bf89-483b-a932-da5e130bb042';  -- Reui malmaison vs Villemomble (150 photos)
update media_albums set type_evenement = 'match' where id = '5f3e58c2-d39f-4613-a709-b4ea681f9a4a';  -- Amiens U10 VS RCP Fontainebleau (263 photos)
update media_albums set type_evenement = 'match' where id = '9ac929bb-a331-40f2-a9d3-188b8aac1234';  -- Amiens U11 VS RCP Fontainebleau (314 photos)
update media_albums set type_evenement = 'match' where id = '4a8dd1d0-d19f-4e1e-b144-d4247b3ccebe';  -- Amiens U9 VS RCP Fontainebleau (58 photos)
update media_albums set type_evenement = 'match' where id = 'c1a21acb-837f-4e56-8d35-754a79ebf48a';  -- RCPF VS PSG U16 (110 photos)
update media_albums set type_evenement = 'match' where id = 'c337006d-1058-4e64-80b6-0db837bb9bcb';  -- AFP 18 vs Villemomble (135 photos)
update media_albums set type_evenement = 'match' where id = '7cf01fa6-c329-4c65-a4a2-03ebc70d54d4';  -- CSV vs Villemomble U14 (186 photos)
update media_albums set type_evenement = 'plateau' where id = '01c19122-0f5d-4880-9f57-b13fefc7cfea';  -- Etampes plateau (71 photos)
update media_albums set type_evenement = 'match' where id = 'a33f958a-e20f-4c01-a0d5-f025f0526364';  -- Rcpf U10 VS amiens (250 photos)
update media_albums set type_evenement = 'match' where id = 'a3ff909d-b6f2-4116-9c27-8025a4684e89';  -- Rcpf U9 VS amiens (96 photos)
update media_albums set type_evenement = 'match' where id = '2996a937-f913-4138-9115-52c57088618f';  -- RCPF vs LIEUSAINT (186 photos)
update media_albums set type_evenement = 'match' where id = '9d1c28ae-6cc1-42f5-94ef-668e3a12ff25';  -- RCPF VS PSG U16 (110 photos)
update media_albums set type_evenement = 'match' where id = '5536bdea-34d8-47da-a889-82f3b3eef3af';  -- RCPF VS PSG U16 (110 photos)
update media_albums set type_evenement = 'plateau' where id = '142b8dae-4015-4732-bfa7-cc65f10d6ffe';  -- Villemomble plateau U8-U9 (133 photos)
update media_albums set type_evenement = 'plateau' where id = 'ab9a2597-a19d-49b6-8213-92b1c8346002';  -- Villemomble plateau U8-U9 (122 photos)
update media_albums set type_evenement = 'match' where id = 'd2655f83-89a8-4449-bfdf-49269ba3cda4';  -- Villemomble vs CS Villetaneuse (205 photos)
update media_albums set type_evenement = 'match' where id = 'e72e80b6-2f06-43b2-864d-a2abc54592b4';  -- Groslay VS villemomble coupe de france (311 photos)
update media_albums set type_evenement = 'match' where id = '68bdb9f2-ed9b-4e1c-8fa2-dbd066a5a469';  -- Lieusaint vs RCPF (146 photos)
update media_albums set type_evenement = 'match' where id = '1d902bff-97a1-4d3a-8829-1d4b5717e751';  -- Lieusaint vs RCPF (110 photos)
update media_albums set type_evenement = 'match' where id = '83b2bfb8-5eee-40d6-b0e3-4c3f99a1a986';  -- Melun vs RCPF (149 photos)
update media_albums set type_evenement = 'plateau' where id = '0a71458d-a1c7-4871-99b6-e9b112caf2c8';  -- Olympique du Loing plateau (47 photos)
update media_albums set type_evenement = 'plateau' where id = '89fcb3a3-d1ba-494c-9407-7815a1929b25';  -- Plateau RCPF (65 photos)
update media_albums set type_evenement = 'plateau' where id = '02b40490-1ba5-45a2-b368-891fdec21f57';  -- Plateau RCPF 2 (56 photos)
update media_albums set type_evenement = 'match' where id = '57c496c6-c1c4-4246-bc8e-b21aa7476e69';  -- RCPF vs Melun (134 photos)
update media_albums set type_evenement = 'match' where id = '900943de-07de-4be4-948a-85cd78bb7b6f';  -- RCPF vs Val Yerres (72 photos)
update media_albums set type_evenement = 'match' where id = 'f78f884c-f373-449d-90ad-95ab50b6c4ab';  -- Sénior CDF (233 photos)
update media_albums set type_evenement = 'match' where id = '218cde40-ba05-4bb4-a90f-77db2c8bd14b';  -- Val Yerres vs RCPF (18 photos)
update media_albums set type_evenement = 'plateau' where id = '1662cee1-3565-46c2-9b69-de7a240de84f';  -- Villemomble plateau U6-U7 (282 photos)
update media_albums set type_evenement = 'match' where id = 'a91565d6-6da5-43e8-aa36-084817795342';  -- Villemomble vs AFP 18 (138 photos)
update media_albums set type_evenement = 'match' where id = 'e06b3fde-3e3a-450a-aa18-011c7dc52bb2';  -- Villemomble vs OPB (161 photos)
update media_albums set type_evenement = 'match' where id = 'bb66c5f1-a378-4b4c-8986-ea359e1d732b';  -- Melun CDF (153 photos)
update media_albums set type_evenement = 'entrainement' where id = '8b04129d-8977-4d2b-a8c2-4e30510ba9c4';  -- RCPF AMIENS Ecole de foot (96 photos)
update media_albums set type_evenement = 'match' where id = 'f20e9c4c-dad8-446a-a7ee-788bf577c1c6';  -- Rcpf U11 VS amiens (178 photos)
update media_albums set type_evenement = 'match' where id = 'c8423909-155a-4235-b26c-e863c425524b';  -- rcpf U12 VS grigny (163 photos)
update media_albums set type_evenement = 'match' where id = '1a2d40cd-83df-4600-963e-8f1cdf0b9a70';  -- RCPF U14 A vs joinville (312 photos)
update media_albums set type_evenement = 'match' where id = '2b1f27eb-a51b-47e1-82f0-f088a7e80ab9';  -- RCPF U14 B VS Mormant (431 photos)

-- CES DEUX-LÀ SONT À PRÉCISER À LA MAIN : leur titre ne dit rien de ce qui a été photographié.
--   8b605c55-bcef-4460-9c9b-7d833aad7696  Stade de l'est (56 photos)
--   a32a3f9c-4cba-480d-986e-df1195cdf565  RCPF Sénior 2 (85 photos)


commit;
