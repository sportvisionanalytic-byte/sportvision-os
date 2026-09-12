#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
check-pricing-consistency.py — vérifie que chaque prix écrit en dur dans les
pages HTML statiques de livrables/SportVision/ correspond bien à une valeur
présente dans PRICING_CONFIG (../pricing-config.js).

CONTEXTE
Le site n'a pas de build ni de serveur : chaque prix visible (catalogue,
fiches prestations, Club+, <title>/<meta>/JSON-LD...) est donc écrit en dur
dans le HTML, sur plusieurs pages à la fois, VOLONTAIREMENT (contrainte SEO /
aperçus de partage social — voir l'en-tête de pricing-config.js). Ce script ne
peut donc pas empêcher la duplication ; il vérifie seulement qu'elle reste
cohérente, en comparant chaque prix trouvé dans le HTML à la source de vérité.

SOURCE CANONIQUE UTILISÉE PAR CE SCRIPT
Ce script est un script Python sans dépendance externe (stdlib uniquement) :
il n'embarque pas de moteur JavaScript et ne peut donc pas exécuter
pricing-config.js directement. Il lit à la place pricing-config.json, un
miroir strict généré depuis pricing-config.js (voir l'en-tête de ce dernier
pour la procédure de mise à jour). pricing-config.js reste la source
canonique réelle (c'est lui que le navigateur charge) ; pricing-config.json
n'est qu'une projection technique pour ce script.

MÉTHODE
1. Charge pricing-config.json, construit la liste de toutes les valeurs de
   prix valides (prix fixe, "à partir de", prix sans engagement, paliers,
   option tarifée, capital social) avec des mots-clés associés à chaque
   prestation (dictionnaire SLUG_KEYWORDS ci-dessous, maintenu à la main).
2. Scanne chaque fichier .html du dossier à la recherche du motif
   `\d+[,.]?\d*\s*€` (prix) — et, séparément, des remises Club+ en % sur les
   lignes contenant "remise"/"réduction".
3. Pour chaque prix trouvé, regarde le texte autour (quelques lignes avant/
   après, balises HTML retirées) pour repérer quelle(s) prestation(s) sont
   évoquées à proximité. Ajoute aussi le(s) "sujet(s) par défaut" de la page
   (FILENAME_DEFAULT_SLUGS ci-dessous — ex. tout prix trouvé sur
   prestation-camera-isolee.html est probablement Caméra isolée, même si le
   mot-clé exact n'est pas répété juste à côté), puis vérifie que la valeur
   trouvée correspond à une valeur valide pour au moins une prestation
   candidate. Cette heuristique tolère les faux positifs (elle ne "prouve"
   rien formellement) mais suffit à repérer une vraie dérive de prix.
4. Rapport : compte de prix cohérents, liste des prix suspects/non reconnus
   (fichier:ligne + valeur + contexte), code de sortie non nul si un vrai
   problème est trouvé.

USAGE
    cd livrables/SportVision
    python3 scripts/check-pricing-consistency.py

PROCÉDURE EN CAS DE CHANGEMENT DE PRIX
Voir l'en-tête de pricing-config.js : modifier pricing-config.js d'abord,
reporter dans pricing-config.json, relancer ce script, corriger les fichiers
HTML signalés.
"""

import json
import os
import re
import sys
import unicodedata

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(SCRIPT_DIR)  # livrables/SportVision/
CONFIG_PATH = os.path.join(SITE_DIR, 'pricing-config.json')

PRICE_RE = re.compile(r'(\+?)(\d+(?:[.,]\d+)?)\s*€')
PERCENT_RE = re.compile(r'(\d+(?:[.,]\d+)?)\s*%')
TAG_RE = re.compile(r'<[^>]+>')
WS_RE = re.compile(r'\s+')

# ── Mots-clés par prestation (accent-insensible, minuscule) — maintenu à la
# main, à étendre si une nouvelle prestation ou un nouveau libellé apparaît
# sur le site. Sert à associer un prix trouvé dans le HTML à la bonne clé de
# PRICING_CONFIG en regardant le texte autour de lui. ──
SLUG_KEYWORDS = {
    'match-photo': ['match photo'],
    'match-video': ['match video', 'match vidéo'],
    'pack-match': ['pack match', 'pack match complet'],
    'camera-isolee': ['camera isolee', 'caméra isolée', 'cameras isolees'],
    'montage-compilation': ['montage', 'compilation', 'montage & compilation', 'montage et compilation'],
    'match-filme-drone': ['match filme drone', 'match filmé drone'],
    'combo-drone-photo': ['combo drone'],
    'match-camera-veo': ['match filme veo', 'match filmé véo', 'camera veo', 'caméra véo', 'match camera veo'],
    'combo-veo-photo': ['combo veo', 'combo véo'],
    'shooting': ['shooting'],
    'couverture-tournoi': ['tournoi'],
    'couverture-stage': ['stage'],
    'creation-contenu': ['creation graphique', 'création graphique'],
    'coach-preparateur': ['coach', 'preparateur', 'préparateur'],
    'media-day': ['media day'],
    'option-drone-veo': ['drone', 'veo', 'véo', 'plans drone'],
    'club-plus-gratuit': ['club+ gratuit', 'club plus gratuit'],
    'club-plus-start': ['club+ start', 'club plus start'],
    'club-plus-performance': ['club+ performance', 'club plus performance'],
    'full-communication': ['full communication'],
    'capital-social': ['capital social', 'capital de', 'siren'],
}

# ── Sujet(s) par défaut d'une page — utilisé en complément des mots-clés
# locaux : une fiche prestation mono-sujet parle presque toujours de sa
# propre prestation, même quand un prix apparaît près d'un mot générique
# ambigu (ex. "Montage individuel" dans une liste de caractéristiques de la
# fiche Caméra isolée, sans rapport avec la prestation "Montage &
# compilation"). Pages multi-sujets (catalogue, reserver.html, index) n'ont
# volontairement pas d'entrée ici : seul le contexte local y fait foi. ──
FILENAME_DEFAULT_SLUGS = {
    'prestation-match-photo.html': ['match-photo'],
    'prestation-match-video.html': ['match-video'],
    'prestation-pack-match.html': ['pack-match'],
    'prestation-camera-isolee.html': ['camera-isolee'],
    'prestation-montage-compilation.html': ['montage-compilation'],
    'prestation-shooting-joueur.html': ['shooting'],
    'prestation-shooting-equipe.html': ['shooting'],
    'prestation-tournois.html': ['couverture-tournoi', 'couverture-stage'],
    'prestation-creations.html': ['creation-contenu'],
    'prestation-coachs.html': ['coach-preparateur'],
    'prestation-media-day.html': ['media-day'],
    'club-plus.html': ['club-plus-gratuit', 'club-plus-start', 'club-plus-performance'],
    'full-communication.html': ['full-communication'],
    'full-communication-academies.html': ['full-communication'],
    'full-communication-clubs.html': ['full-communication'],
    'full-communication-coachs.html': ['full-communication'],
    'full-communication-evenements.html': ['full-communication'],
}


def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def normalize(s):
    return strip_accents(s).lower()


def parse_price(num_str):
    return float(num_str.replace(',', '.'))


def fmt(v):
    if v == int(v):
        return str(int(v))
    return ('%.2f' % v).rstrip('0').rstrip('.')


def load_config():
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def build_price_entries(config):
    """Retourne {slug: set(valeurs_valides_float)} et l'ensemble global."""
    entries = {}
    all_values = set()
    for slug, cfg in config.items():
        values = set()
        for field in ('price', 'priceFrom', 'priceNoEngagement'):
            v = cfg.get(field)
            if isinstance(v, (int, float)):
                values.add(round(float(v), 2))
        for tier in cfg.get('tiers') or []:
            v = tier.get('price')
            if isinstance(v, (int, float)):
                values.add(round(float(v), 2))
        if values:
            entries[slug] = values
            all_values |= values
    return entries, all_values


def html_files():
    return sorted(f for f in os.listdir(SITE_DIR) if f.endswith('.html'))


def get_context(lines, idx, radius=8):
    start = max(0, idx - radius)
    end = min(len(lines), idx + radius + 1)
    chunk = ' '.join(lines[start:end])
    chunk = TAG_RE.sub(' ', chunk)
    chunk = WS_RE.sub(' ', chunk).strip()
    return chunk


def check_prices(config, entries, all_values):
    ok_count = 0
    suspects = []          # (file, line_no, raw_match, value, context, reason)
    unmatched_context = 0  # cohérent mais contexte non identifié (informatif, pas une erreur)

    for fname in html_files():
        path = os.path.join(SITE_DIR, fname)
        with open(path, 'r', encoding='utf-8') as f:
            raw_lines = f.readlines()

        for i, line in enumerate(raw_lines):
            for m in PRICE_RE.finditer(line):
                sign, num_str = m.groups()
                value = round(parse_price(num_str), 2)
                context = normalize(get_context(raw_lines, i))

                candidates = [slug for slug, kws in SLUG_KEYWORDS.items()
                              if any(kw in context for kw in kws)]
                candidates += FILENAME_DEFAULT_SLUGS.get(fname, [])
                # Ne garder que les candidats qui ont effectivement des
                # valeurs de prix dans la config (ex. full-communication n'en
                # a pas -> jamais candidat pertinent pour une valeur trouvée).
                candidates_with_prices = sorted(set(s for s in candidates if s in entries))

                if candidates_with_prices:
                    if any(value in entries[s] for s in candidates_with_prices):
                        ok_count += 1
                        continue
                    # Total calculé (base + option), ex. "Prestation : 160 € /
                    # Drone : +40 € / Total estimé : 200 €" — on accepte la
                    # somme de deux valeurs venant de deux candidats
                    # différents repérés dans le même contexte, avant de
                    # conclure à une incohérence.
                    if len(candidates_with_prices) >= 2:
                        combo_ok = False
                        for a in candidates_with_prices:
                            for b in candidates_with_prices:
                                if a == b:
                                    continue
                                if any(round(va + vb, 2) == value for va in entries[a] for vb in entries[b]):
                                    combo_ok = True
                                    break
                            if combo_ok:
                                break
                        if combo_ok:
                            ok_count += 1
                            continue

                # Le(s) mot-clé(s) de prestation repéré(s) à proximité ne
                # justifient pas cette valeur (ou aucun mot-clé n'a été
                # repéré) : dernier filet, on tolère si la valeur existe
                # QUELQUE PART dans PRICING_CONFIG (ex. renvoi croisé "160 €
                # TTC pour les deux, au lieu de 120 € + 120 € séparément" sur
                # une fiche qui ne répète pas "Match photo"/"Match vidéo" mot
                # pour mot) — compté à part pour rester honnête sur ce que le
                # script a réellement vérifié. Une vraie régression de prix
                # (valeur inventée, absente de toute la config) reste, elle,
                # toujours détectée.
                if value in all_values:
                    unmatched_context += 1
                    ok_count += 1
                    continue

                if candidates_with_prices:
                    expected = sorted({fmt(v) for s in candidates_with_prices for v in entries[s]})
                    reason = ('Prestation détectée (%s) mais valeur %s€ absente des tarifs attendus (%s €)'
                              % (', '.join(candidates_with_prices), fmt(value), ', '.join(expected)))
                else:
                    reason = 'Aucune prestation reconnue à proximité et valeur %s€ absente de PRICING_CONFIG' % fmt(value)

                suspects.append((
                    fname, i + 1, m.group(0), value,
                    get_context(raw_lines, i)[:160],
                    reason,
                ))

    return ok_count, unmatched_context, suspects


def check_percentages(config):
    """Vérifie les remises Club+ (%) sur les lignes mentionnant remise/réduction."""
    ok_count = 0
    suspects = []
    expected_by_slug = {
        slug: cfg.get('discountPct')
        for slug, cfg in config.items()
        if isinstance(cfg.get('discountPct'), (int, float)) and cfg['discountPct'] > 0
    }
    expected_values = {round(float(v), 2) for v in expected_by_slug.values()}

    for fname in html_files():
        path = os.path.join(SITE_DIR, fname)
        with open(path, 'r', encoding='utf-8') as f:
            raw_lines = f.readlines()
        for i, line in enumerate(raw_lines):
            norm_line = normalize(line)
            if 'remise' not in norm_line and 'reduction' not in norm_line:
                continue
            for m in PERCENT_RE.finditer(line):
                value = round(parse_price(m.group(1)), 2)
                if value in expected_values:
                    ok_count += 1
                else:
                    suspects.append((
                        fname, i + 1, m.group(0), value,
                        get_context(raw_lines, i)[:160],
                        'Remise en %% (%s%%) absente des remises Club+ connues (%s%%)'
                        % (fmt(value), ', '.join(fmt(v) for v in sorted(expected_values))),
                    ))
    return ok_count, suspects


def main():
    if not os.path.isfile(CONFIG_PATH):
        print('ERREUR : %s introuvable. Générez-le depuis pricing-config.js (voir son en-tête).' % CONFIG_PATH)
        return 2

    config = load_config()
    entries, all_values = build_price_entries(config)

    ok_count, unmatched_context, suspects = check_prices(config, entries, all_values)
    pct_ok, pct_suspects = check_percentages(config)

    print('=' * 72)
    print('Vérification de cohérence des tarifs — livrables/SportVision/')
    print('=' * 72)
    print('Fichiers HTML scannés : %d' % len(html_files()))
    print('Prix (€) trouvés cohérents avec PRICING_CONFIG : %d' % ok_count)
    print('  dont sans contexte de prestation identifié (valeur connue ailleurs) : %d' % unmatched_context)
    print('Remises (%%) Club+ trouvées cohérentes : %d' % pct_ok)
    print()

    all_suspects = suspects + [(f, l, raw, v, ctx, why) for (f, l, raw, v, ctx, why) in pct_suspects]

    if not suspects and not pct_suspects:
        print('Aucune incohérence trouvée. Le site est cohérent avec pricing-config.js.')
        return 0

    if suspects:
        print('PRIX SUSPECTS / NON RECONNUS (%d) :' % len(suspects))
        for fname, lineno, raw, value, ctx, why in suspects:
            print('  %s:%d — "%s"' % (fname, lineno, raw))
            print('    Raison  : %s' % why)
            print('    Contexte: %s' % ctx)
        print()

    if pct_suspects:
        print('REMISES SUSPECTES (%d) :' % len(pct_suspects))
        for fname, lineno, raw, value, ctx, why in pct_suspects:
            print('  %s:%d — "%s"' % (fname, lineno, raw))
            print('    Raison  : %s' % why)
            print('    Contexte: %s' % ctx)
        print()

    print('Résultat : %d problème(s) trouvé(s).' % (len(suspects) + len(pct_suspects)))
    return 1


if __name__ == '__main__':
    sys.exit(main())
