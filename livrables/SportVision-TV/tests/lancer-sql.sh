#!/bin/bash
# Lance les tests SQL contre la base de production, et les classe correctement.
#
# POURQUOI CE SCRIPT EXISTE. 168 tests SQL vivaient dans ce dossier sans aucun moyen de les
# rejouer d'un coup : chacun se lançait à la main, donc personne ne les lançait tous. Le 26/09/2026
# j'ai cru en voir sept échouer — ils étaient tous verts. La moitié d'entre eux terminent par un
# `raise exception` DÉLIBÉRÉ, qui sert à deux choses à la fois : afficher leur rapport, et annuler
# leur décor. Un lanceur naïf compte donc un test réussi comme un échec.
#
# DEUX FAMILLES DE TESTS, DEUX FAÇONS DE DIRE « ÉCHEC », et il faut lire les deux. Les 14 blocs DO
# terminent par un `raise` qui porte leur rapport dans le MESSAGE d'erreur. Les 154 autres sont des
# `begin; … select verdicts; rollback;` qui RENVOIENT un tableau de lignes ✅/❌. Ce lanceur a
# compté vert tout tableau reçu, sans le lire, du 26 au 28/09/2026 : la grande majorité des tests
# SQL ne pouvait donc pas échouer, et l'annonce « 178 verts » ne valait que pour 14 d'entre eux.
#
# LA RÈGLE DE CLASSEMENT : seul le mot ROUGE (ou ÉCHEC) dans le message signale un défaut. Une
# exception qui porte VERT, RAPPORT ou un titre est une réussite. Une erreur qui n'est pas P0001
# (fonction absente, colonne absente, droit refusé) est un échec réel : le test ne s'est pas
# exécuté, et un test qui ne s'exécute pas ne prouve rien.
#
# Tout est annulé : 154 tests sont des `begin; ... rollback;`, les 14 autres des blocs DO, dont
# l'exception annule tout ce qu'ils ont écrit.
#
#   bash livrables/SportVision-TV/tests/lancer-sql.sh            # tous
#   bash livrables/SportVision-TV/tests/lancer-sql.sh galerie     # ceux dont le nom contient galerie
set -u
RACINE="$(cd "$(dirname "$0")/../../.." && pwd)"
set -a; . "$RACINE/.env"; set +a
REF=$(echo "$SUPABASE_URL" | sed -E 's#https://([a-z0-9]+)\.supabase\.co.*#\1#')
FILTRE="${1:-}"
DOSSIER="$(cd "$(dirname "$0")" && pwd)"

vert=0; rouge=0; casse=0; muet=0; rapport="$(mktemp)"
for f in "$DOSSIER"/*.test.sql; do
  nom=$(basename "$f" .test.sql)
  [ -n "$FILTRE" ] && [[ "$nom" != *"$FILTRE"* ]] && continue
  python3 -c "import json,sys;print(json.dumps({'query':open(sys.argv[1]).read()}))" "$f" > /tmp/_t.json
  curl -s --max-time 120 -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" \
    --data @/tmp/_t.json > /tmp/_r.json
  verdict=$(python3 - "$nom" <<'PY'
import json,sys,re
nom = sys.argv[1]
try:
    d = json.loads(open('/tmp/_r.json').read(), strict=False)
except Exception:
    print("CASSE|reponse illisible"); raise SystemExit
if isinstance(d, list):
    # DEFAUT CORRIGE LE 28/09/2026, ET IL RENDAIT LE VERT DE CE LANCEUR CREUX. Ces tests-la ne
    # levent pas d'exception : ils RENVOIENT un tableau de verdicts (colonnes ok / attendu /
    # obtenu, ou un ✅ / ❌ par ligne). Le lanceur imprimait « vert » des que la reponse etait un
    # tableau, sans jamais lire son contenu — donc 154 des 168 tests SQL ne POUVAIENT pas echouer.
    # On lit maintenant les lignes : d'abord en comparant attendu/obtenu quand les deux colonnes
    # sont la (c'est la mesure, pas le symbole), puis en cherchant un marqueur d'echec partout.
    # CHAQUE TEST PORTE SA PROPRE COLONNE `ok`, ET ELLE FAIT FOI. Premiere version de ce lecteur
    # (28/09, quelques minutes de vie) : je comparais moi-meme `attendu` a `obtenu` et je traitais
    # « non » comme un echec. Resultat : 25 faux rouges. Deux raisons, mesurees sur les tests eux-
    # memes plutot que supposees :
    #   `attendu '+7000 c'` contre `obtenu '+7000'`  — le « c » annote des centimes pour un humain,
    #                                                   la comparaison du test est plus fine que la mienne
    #   `attendu 'non'` contre `obtenu 'non'`        — « non » EST la bonne reponse (« le message ne
    #                                                   cite plus client_id ? non »)
    # Le test sait ce qu'il mesure. On lit son verdict, on ne le refait pas.
    def echoue(v):
        if v is True: return False
        if v is False: return True
        t = str(v).strip()
        return ('❌' in t) or t.upper() in ('KO', 'NON', 'FALSE', 'F', 'ECHEC', 'ÉCHEC', 'ROUGE')

    echecs = []
    lignes = [l for l in d if isinstance(l, dict)]
    avec_ok = [l for l in lignes if any(k.lower() == 'ok' for k in l)]
    if avec_ok:
        for l in avec_ok:
            cle_ok = next(k for k in l if k.lower() == 'ok')
            if echoue(l[cle_ok]):
                libelle = next((str(v) for k, v in l.items()
                                if k.lower() in ('controle','control','cas','verification','quoi')), '')
                echecs.append(f"{libelle[:90]} : attendu {l.get('attendu')!r}, obtenu {l.get('obtenu')!r}"
                              if 'attendu' in l else f"{libelle[:120]}")
    else:
        # TROISIEME FORME, 31 tests : une seule colonne de texte qui porte son verdict en clair
        # (« renommage-equipe : OK — le coach garde ses droits », « ✅ les 8 taches du cron sont
        # fermees »). Ni exception, ni colonne ok. Un lecteur qui ne connaît que deux formes les
        # compte muets, et un test muet ne prouve rien — donc on lit le texte.
        texte = ' '.join(str(v) for l in lignes for v in l.values())
        haut = texte.upper()
        if '❌' in texte or 'ROUGE' in haut or 'ECHEC' in haut or 'ÉCHEC' in haut or re.search(r'\bKO\b', haut):
            for l in lignes:
                for v in l.values():
                    t = str(v)
                    if '❌' in t or 'ROUGE' in t.upper() or 'ECHEC' in t.upper() or re.search(r'\bKO\b', t.upper()):
                        echecs.append(t[:160]); break
        elif '✅' in texte or re.search(r'\bOK\b', haut):
            print("VERT|%d ligne(s) de rapport, verdict OK" % len(lignes)); raise SystemExit
        elif lignes:
            print("MUET|%d ligne(s) sans verdict lisible : %s" % (len(lignes), texte[:120])); raise SystemExit

    if echecs:
        print("ROUGE|" + " ; ".join(echecs)[:500])
    elif not d:
        # Un tableau VIDE ne prouve rien : le test n'a rien mesure, ou son dernier ordre etait un
        # rollback muet. On ne le compte pas vert.
        print("MUET|aucun verdict renvoye")
    else:
        print("VERT|%d verdicts, tous conformes" % len(d))
    raise SystemExit
msg = ' '.join(str(d.get('message','')).split())
code = re.search(r'ERROR:\s*([0-9A-Z]{5})', msg)
code = code.group(1) if code else '?'
if 'ROUGE' in msg.upper() or 'ECHEC' in msg.upper() or 'ÉCHEC' in msg.upper():
    print("ROUGE|" + msg[:400])
elif code == 'P0001':
    print("VERT|" + msg[:200])
else:
    print("CASSE|" + msg[:300])
PY
)
  etat=${verdict%%|*}; detail=${verdict#*|}
  case "$etat" in
    VERT)  vert=$((vert+1));  printf "  \033[32mvert \033[0m %s\n" "$nom" ;;
    ROUGE) rouge=$((rouge+1)); printf "  \033[31mROUGE\033[0m %s\n" "$nom"; printf "ROUGE %s\n      %s\n" "$nom" "$detail" >> "$rapport" ;;
    CASSE) casse=$((casse+1)); printf "  \033[33mCASSE\033[0m %s\n" "$nom"; printf "CASSE %s\n      %s\n" "$nom" "$detail" >> "$rapport" ;;
    MUET)  muet=$((muet+1));  printf "  \033[33mMUET \033[0m %s\n" "$nom"; printf "MUET  %s\n      %s\n" "$nom" "$detail" >> "$rapport" ;;
  esac
done

echo
echo "  $vert verts, $rouge rouges, $casse ne s'executent pas, $muet muets"
if [ -s "$rapport" ]; then echo; echo "  --- detail ---"; cat "$rapport"; fi
rm -f "$rapport"
[ "$rouge" -eq 0 ] && [ "$casse" -eq 0 ] && [ "$muet" -eq 0 ]
