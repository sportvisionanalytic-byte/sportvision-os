#!/usr/bin/env python3
"""Copie les ecussons des clubs rencontres dans le bucket `federation-logos`.

    python3 livrables/SportVision-TV/scripts/importer-ecussons-federaux.py saison.json

Lit un fichier produit par charger-saison-federale.mjs, en extrait les clubs adverses, telecharge
leur ecusson et le range chez nous. `federation_clubs.logo_url` pointe ensuite sur NOTRE copie,
et `logo_source_url` garde l'origine.

Pourquoi copier : un visuel matchday publie doit continuer de s'afficher dans six mois. Pointer
une affiche vers le stockage d'un tiers, c'est accepter qu'elle casse le jour ou il reorganise ses
fichiers.

Relancable : un ecusson deja copie n'est pas retelecharge, sauf --forcer.
"""

import json
import re
import subprocess
import sys
import unicodedata

BUCKET = 'federation-logos'
SOURCE = 'SPORTCORICO'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0 Safari/537.36')
# L'ecusson generique du fournisseur, servi quand un club n'en a pas. Le copier 40 fois sous
# 40 noms differents ne rendrait service a personne, et donnerait l'illusion d'un vrai logo.
GENERIQUE = 'ecusson-sportcorico'


def env():
    d = {}
    for ligne in open('.env'):
        if '=' in ligne and not ligne.startswith('#'):
            k, v = ligne.split('=', 1)
            d[k.strip()] = v.strip()
    return d


E = env()
URL = E['SUPABASE_URL']
SECRET = E['SUPABASE_SECRET_KEY']
REF = re.sub(r'https://([^.]+)\..*', r'\1', URL)
TOKEN = E['SUPABASE_MANAGEMENT_TOKEN']
FORCER = '--forcer' in sys.argv


def sql(q):
    r = subprocess.run(
        ['curl', '-s', '-X', 'POST',
         f'https://api.supabase.com/v1/projects/{REF}/database/query',
         '-H', f'Authorization: Bearer {TOKEN}',
         '-H', 'Content-Type: application/json', '--data-binary', '@-'],
        input=json.dumps({'query': q}), capture_output=True, text=True)
    d = json.loads(r.stdout)
    if isinstance(d, dict) and d.get('message'):
        sys.exit(f"Erreur SQL : {d['message'][:300]}")
    return d


def norm(s):
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()


def echappe(s):
    return "'" + (s or '').replace("'", "''") + "'"


fichier = next((a for a in sys.argv[1:] if not a.startswith('--')), None)
if not fichier:
    sys.exit('Usage : importer-ecussons-federaux.py <saison.json> [--forcer]')

d = json.load(open(fichier))
clubs = {}
for m in d['matchs']:
    s, u, n = m.get('adversaire_club_slug'), m.get('adversaire_logo'), m.get('adversaire_club')
    if s and u and GENERIQUE not in u:
        clubs.setdefault(s, (n, u))

print(f'{len(clubs)} clubs adverses avec un écusson propre.')

deja = set()
if not FORCER:
    for r in sql(f"select slug from public.federation_clubs "
                 f"where source = '{SOURCE}' and logo_url like '%{BUCKET}%'"):
        deja.add(r['slug'])
    print(f'{len(deja)} déjà copiés, ignorés.')

ok, echecs = 0, []
for slug, (nom, source_url) in sorted(clubs.items()):
    if slug in deja:
        continue
    ext = 'png' if source_url.lower().endswith('.png') else 'jpg'
    chemin = f'{slug}.{ext}'
    tmp = f'/tmp/ecusson-{slug}.{ext}'

    t = subprocess.run(['curl', '-sSL', '-A', UA, '--max-time', '30', '-o', tmp, source_url],
                       capture_output=True, text=True)
    if t.returncode != 0:
        echecs.append((slug, 'téléchargement'))
        continue

    envoi = subprocess.run(
        ['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
         '-X', 'POST', f'{URL}/storage/v1/object/{BUCKET}/{chemin}',
         '-H', f'apikey: {SECRET}', '-H', f'Authorization: Bearer {SECRET}',
         '-H', f"Content-Type: image/{'png' if ext == 'png' else 'jpeg'}",
         '-H', 'x-upsert: true', '--data-binary', f'@{tmp}'],
        capture_output=True, text=True)
    if envoi.stdout.strip() not in ('200', '201'):
        echecs.append((slug, f'envoi {envoi.stdout.strip()}'))
        continue

    public = f'{URL}/storage/v1/object/public/{BUCKET}/{chemin}'
    sql(f"""insert into public.federation_clubs (source, slug, recherche, nom, logo_url, logo_source_url)
values ('{SOURCE}', {echappe(slug)}, {echappe(norm(slug))}, {echappe(nom)},
        {echappe(public)}, {echappe(source_url)})
on conflict (source, slug) do update set
  nom = coalesce(public.federation_clubs.nom, excluded.nom),
  logo_url = excluded.logo_url,
  logo_source_url = excluded.logo_source_url""")
    ok += 1
    print(f'  {slug:<38} {nom or ""}')

print(f'\n{ok} écussons copiés dans {BUCKET}.')
if echecs:
    print(f'{len(echecs)} échecs :')
    for s, r in echecs:
        print(f'  {s} — {r}')
