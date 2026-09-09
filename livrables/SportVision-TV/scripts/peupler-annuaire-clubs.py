#!/usr/bin/env python3
"""Peuple `federation_clubs` depuis le sitemap public de la source.

    python3 scripts/peupler-annuaire-clubs.py            # depuis la racine du workspace

Le sitemap ne donne QUE l'identifiant de chaque club : ni son nom exact, ni sa ville, ni son
sport, ni son numero d'affiliation. Ces champs-la ne s'obtiennent qu'en consultant une fiche, un
appel par club. Peupler 34 000 fiches d'un coup ferait 34 000 appels a un service tiers pour une
donnee dont on n'utilisera qu'une poignee : ce script n'ecrit donc que les identifiants, et
l'enrichissement se fait a la consultation (cf. l'en-tete de migration-federation-v1).

Relancable sans risque : les lignes existantes sont mises a jour, aucune n'est supprimee. Un club
qui disparait du sitemap reste dans l'annuaire, avec son enrichissement — on ne perd pas une fiche
parce que la source a change son referencement.
"""

import json
import re
import subprocess
import sys
import unicodedata

SITEMAP = ("https://s3.pub2.infomaniak.cloud/object/v1/"
           "AUTH_7caca171fcb14ede88bd14eb36f90e50/sportcorico-media/sitemap.xml")
SOURCE = "SPORTCORICO"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
LOT = 2000


def lire(url: str) -> str:
    """Passe par curl et non par urllib : certains environnements (proxy TLS d'entreprise, bac a
    sable) presentent un certificat intermediaire que le magasin de Python ne connait pas, la ou
    curl s'appuie sur celui du systeme. Le reste du fichier appelle deja curl pour Supabase."""
    r = subprocess.run(["curl", "-sSL", "-A", UA, "--max-time", "120", url],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"Téléchargement impossible ({url}) : {r.stderr.strip()[:200]}")
    return r.stdout


def normaliser(slug: str) -> str:
    """Même normalisation que `federation_clubs_rechercher` côté SQL : minuscules, sans accent,
    tout ce qui n'est pas alphanumérique devient une espace. Les deux doivent rester identiques,
    sinon la recherche ne trouve rien."""
    s = unicodedata.normalize("NFD", slug)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def config():
    ref, token = None, None
    for ligne in open(".env"):
        if ligne.startswith("SUPABASE_URL="):
            ref = re.sub(r"https://([^.]+)\..*", r"\1", ligne.split("=", 1)[1].strip())
        elif ligne.startswith("SUPABASE_MANAGEMENT_TOKEN="):
            token = ligne.split("=", 1)[1].strip()
    if not ref or not token:
        sys.exit("SUPABASE_URL et SUPABASE_MANAGEMENT_TOKEN sont nécessaires dans .env")
    return ref, token


def sql(ref: str, token: str, requete: str):
    r = subprocess.run(
        ["curl", "-s", "-X", "POST",
         f"https://api.supabase.com/v1/projects/{ref}/database/query",
         "-H", f"Authorization: Bearer {token}",
         "-H", "Content-Type: application/json",
         "--data-binary", "@-"],
        input=json.dumps({"query": requete}), capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
    except json.JSONDecodeError:
        sys.exit(f"Réponse illisible : {r.stdout[:300]}")
    if isinstance(d, dict) and d.get("message"):
        sys.exit(f"Erreur SQL : {d['message'][:400]}")
    return d


def main():
    ref, token = config()

    print("Lecture de l'index des sitemaps…")
    index = lire(SITEMAP)
    parties = [u for u in re.findall(r"<loc>([^<]+)</loc>", index) if "sitemap_clubs" in u]
    if not parties:
        sys.exit("Aucun sitemap de clubs dans l'index : la source a changé de structure.")

    slugs = set()
    for url in parties:
        print(f"  {url}")
        for s in re.findall(r"<loc>https://www\.sportcorico\.com/clubs/([a-z0-9-]+)</loc>", lire(url)):
            slugs.add(s)
    print(f"{len(slugs)} clubs dans le sitemap.")

    slugs = sorted(slugs)
    ecrits = 0
    for depart in range(0, len(slugs), LOT):
        lot = slugs[depart:depart + LOT]
        valeurs = ",".join(
            "(" + "'" + SOURCE + "'," + "'" + s.replace("'", "''") + "'," +
            "'" + normaliser(s).replace("'", "''") + "')"
            for s in lot)
        # `recherche` est remis a jour : si la normalisation evolue, une simple relance realigne
        # l'annuaire sans le reconstruire. Les colonnes enrichies ne sont JAMAIS touchees ici.
        sql(ref, token,
            "insert into public.federation_clubs (source, slug, recherche) values "
            + valeurs +
            " on conflict (source, slug) do update set recherche = excluded.recherche")
        ecrits += len(lot)
        print(f"  {ecrits}/{len(slugs)}")

    total = sql(ref, token, "select count(*) n from public.federation_clubs")[0]["n"]
    print(f"\nAnnuaire : {total} clubs.")


if __name__ == "__main__":
    main()
