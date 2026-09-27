-- v307 — 27/09/2026 : ces photos ne sont pas celles de ses clubs
--
-- FOUKA, EN VOYANT LE RÉSULTAT DE LA v296 : « la plupart, c'est des photos que je vends aux autres
-- équipes, c'est pas des photos à nous ou à mes clubs en full communication, donc ils doivent pas
-- apparaître normalement. »
--
-- CE QUE J'AVAIS MAL COMPRIS. La v296 a rattaché 23 galeries à SF Villemomble ou RCP Fontainebleau
-- en lisant leur titre, parce qu'il contenait le nom du club. Mais le nom du club y figure comme
-- ADVERSAIRE ou comme LIEU du tournoi, pas comme sujet des photos. La convention de titre de Fouka
-- est constante, et c'est elle qu'il fallait lire :
--
--     Rcpf U9 VS amiens               le sujet est RCPF        -> ses photos
--     Amiens U9 VS RCP Fontainebleau  le sujet est Amiens      -> vendues a Amiens
--     Villemomble Cup U10 - AS Bondy  le tournoi est chez lui, la galerie est celle de l'invite
--
-- Ces galeries se vendent par leur lien public a l'equipe photographiee. Elles n'ont rien a faire
-- dans l'espace d'une famille de ses clubs : 2 667 photos d'enfants d'AUTRES clubs.
--
-- CE QUE ÇA NE CASSE PAS : la vente par lien est intacte. `media_gallery_open` et le telechargement
-- passent par le jeton du lien, jamais par le club — verifie, `gallery-download` sert
-- `original_path` sans consulter club_id. Le club et le staff SportVision continuent de les voir.
--
-- ET ÇA ANNULE LA RÉGÉNÉRATION DE 48 Go. L'apercu net ne sert qu'au parcours Pass dans l'app ; un
-- acheteur par lien recoit l'ORIGINAL en pleine resolution. Ces 2 667 photos n'en ont donc aucun
-- besoin. Fouka l'avait dit avant moi : « ceux qui ont achete les photos pendant les galeries, apres
-- ils voient, c'est bon comme ca ».
--
-- LES IDENTIFIANTS SONT FIGÉS, et pas deduits d'un motif. « Villemomble Cup U10 » commence par le nom
-- de son club tout en etant la galerie d'une equipe invitee : un motif s'y tromperait, et surtout il
-- toucherait les galeries creees plus tard. Ceci est une correction ponctuelle, elle ne doit valoir
-- que pour ces 23 lignes.
--
-- Idempotent.

update media_albums a
   set club_id = null, team_id = null, team_ids = '{}', updated_at = now()
 where a.id in (
    '5f3e58c2-d39f-4613-a709-b4ea681f9a4a',  -- Amiens U10 VS RCP Fontainebleau  (RCP Fontainebleau, 263 photos)
    '9ac929bb-a331-40f2-a9d3-188b8aac1234',  -- Amiens U11 VS RCP Fontainebleau  (RCP Fontainebleau, 314 photos)
    '4a8dd1d0-d19f-4e1e-b144-d4247b3ccebe',  -- Amiens U9 VS RCP Fontainebleau  (RCP Fontainebleau, 58 photos)
    'ee1b231a-d4a0-49aa-bed6-a539e7eb7010',  -- FC 93 plateau - Villemomble  (SF Villemomble, 203 photos)
    'b82e8f78-4383-4a6d-837a-812217fdf299',  -- Joinville VS fontainebleau  (RCP Fontainebleau, 178 photos)
    '1d09f6d9-4f6b-47b6-bddc-9ed738c06933',  -- Joinville VS Villemomble  (SF Villemomble, 145 photos)
    '833982ee-febb-4a8f-aad3-a0a025876fe6',  -- Mortmant vs fontainebleau  (RCP Fontainebleau, 203 photos)
    'e32e0d25-c7e5-42ae-b7e0-c3f0286d2957',  -- Noisy plateau - Villemomble  (SF Villemomble, 261 photos)
    '1c2a9c5f-e1bc-4fbe-867a-bfb7b39467db',  -- rc argenteuil vs Villemomble  (SF Villemomble, 216 photos)
    'd956788b-bf89-483b-a932-da5e130bb042',  -- Reui malmaison vs Villemomble  (SF Villemomble, 150 photos)
    '10a569ea-53ee-4af6-830f-11a8460c7fdd',  -- Villemomble Cup U10 -  epinay  (SF Villemomble, 16 photos)
    'e762b603-b689-4bec-8da9-bdefa45715c7',  -- Villemomble Cup U10 -  Montreuil  (SF Villemomble, 48 photos)
    '4dba1072-0fc9-4116-a277-786127d9f481',  -- Villemomble Cup U10 - AS Bondy  (SF Villemomble, 34 photos)
    'f558eaff-ad79-4705-8bda-6dcd58a36f00',  -- Villemomble Cup U10 - Courbevoie  (SF Villemomble, 51 photos)
    'f510679f-35f4-4d5b-afbb-a26263ae3fa6',  -- Villemomble Cup U10 - Creil  (SF Villemomble, 41 photos)
    'bf0c8c33-cd78-4feb-8c03-a6978c7580e5',  -- Villemomble Cup U10 - creteil  (SF Villemomble, 100 photos)
    '878aea6e-88fb-4c78-9506-dba2e96bd482',  -- Villemomble Cup U10 - issy  (SF Villemomble, 53 photos)
    '962b7e6d-9381-4d43-8c3d-df7f3d253173',  -- Villemomble Cup U10 - livry gargan  (SF Villemomble, 15 photos)
    '9b0fbbba-a71b-49ed-ab10-a3e48f548db0',  -- Villemomble Cup U10 - massy  (SF Villemomble, 21 photos)
    '2772026a-bcbe-4ae7-8dc0-50c00bd5264f',  -- Villemomble Cup U10 - moissy  (SF Villemomble, 88 photos)
    '12d2b283-1c44-4b1e-a153-5f0946a1e70d',  -- Villemomble Cup U10 - paris acasa  (SF Villemomble, 60 photos)
    'ed4d8ac5-1f67-4e81-9855-730dbe7d20a4',  -- Villemomble Cup U10 - us parisiennes  (SF Villemomble, 108 photos)
    '1fb94ee4-0b2e-4af9-aa1f-12c41e55b74e'   -- Villemomble Cup U10 - Vincennes  (SF Villemomble, 41 photos)
  );

-- Les photos suivent leur galerie : le trigger media_assets_set_club ne s'applique qu'au depot.
update media_assets x
   set club_id = a.club_id
  from media_albums a
 where a.id = x.album_id and x.club_id is distinct from a.club_id;
