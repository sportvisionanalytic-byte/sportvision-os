# CLAUDE.md — SportVision

> Workspace Jarvis de **SportVision**.
> Mon identité, mon style de communication et l'identité légale Elkana Group sont dans le CLAUDE.md
> global (`~/.claude/CLAUDE.md`), chargé automatiquement à chaque session. Ce fichier ne contient que
> le métier SportVision.

---

## Périmètre de ce workspace

**Ce workspace couvre uniquement SportVision** : captation vidéo et photo d'événements sportifs,
création de contenus pour clubs, joueurs et familles, et tout l'écosystème logiciel autour
(Connect, Club+, l'OS, le site vitrine, SportVision TV).

**Eloria Digital n'a rien à faire ici.** Mon agence de communication a son propre workspace,
`~/Documents/jarvis-eloria/`. Ne cite jamais un client, une offre, un tarif ou un template Eloria dans
un livrable SportVision, et n'écris jamais dans le workspace Eloria depuis cette session. Si ma demande
semble concerner Eloria, dis-le moi et propose que je bascule de dossier plutôt que de répondre ici.

**Objectifs prioritaires actuels :** signer 5 clubs partenaires, et automatiser l'écosystème SportVision
pour qu'il tourne sans intervention constante. Le détail est dans `context/CONTEXT.md`.

---

## Structure du workspace

```
.
├── CLAUDE.md                    # Ce fichier, chargé à chaque session
├── .env                         # Secrets API (jamais versionné)
├── .env.example                 # Template des secrets (versionnable)
├── context/
│   ├── CONTEXT.md               # SportVision : activité, objectifs, projets en cours
│   ├── HISTORY.md               # Journal évolutif des sessions
│   └── import/                  # Documents externes à analyser (PDFs, exports, captures)
├── livrables/                   # Tout ce que Claude produit
│   ├── SportVision/             # Site vitrine public
│   ├── SportVision-Connect/     # Connect (espace personnel : joueur, particulier)
│   ├── SportVision-Connect-App/ # Application Connect
│   ├── SportVision-TV/          # Plateforme de diffusion (projet ~2028)
│   ├── strategie/               # Plans stratégiques, roadmaps, décisions
│   ├── communication/           # Emails, scripts, pitchs, présentations
│   ├── analyses/                # Analyses de marché, audits
│   ├── recrutement/             # Recrutement et organisation
│   └── studio-templates/        # Modèles Studio
├── .claude/
│   ├── commands/                # /prime /update /morning /commit
│   └── skills/                  # recherche-actualites
└── module-installs/             # Modules d'installation
```

| Dossier | Utilité |
|---------|---------|
| `context/` | Tout ce qui concerne SportVision et que Claude doit savoir |
| `context/import/` | Documents externes (PDFs, exports, captures) à analyser |
| `livrables/` | Tous les documents et applications produits par Claude |
| `.claude/commands/` | Commandes personnalisées |
| `.claude/skills/` | Skills |

---

## Commandes

| Commande | Objectif |
|---|---|
| `/prime` | Démarrer une session avec le contexte SportVision chargé |
| `/update` | Mettre à jour CONTEXT.md et HISTORY.md après un changement |
| `/morning` | Veille du jour filtrée sur le contexte SportVision |
| `/commit` | Sauvegarder l'état du workspace dans Git |

---

## Skills disponibles

### recherche-actualites

Veille intelligente filtrée sur mon contexte. Se déclenche sur "fais-moi un point sur les actualités",
"donne-moi les news du jour", ou via `/morning`. L'avantage : pas de bruit, seulement ce qui concerne
vraiment mes objectifs et projets actifs.

---

## Notes importantes

- Les fichiers de contexte restent synthétiques. Si une section devient trop longue, créer un fichier
  dédié dans `context/import/`
- L'historique se construit au fil des sessions, pas besoin de tout y mettre
- Documents externes : toujours dans `context/import/`, jamais à la racine
- Ne pas modifier HISTORY.md à la main, passer par `/update`

---

## Production : règles obligatoires (depuis le 10/09/2026)

SportVision est en **PRODUCTION MULTI-CLUBS — V1 STABLE**. Référence :
`livrables/SportVision-TV/PRODUCTION-MULTI-CLUBS-V1.md`.

- **Gel fonctionnel.** Seuls les P0/P1 et les retours des premiers clubs réels. Pas de nouvelle
  fonctionnalité, pas de refactor, pas de changement de règle métier sans demande explicite.
- **Déployer une Edge Function : uniquement par `bash livrables/SportVision-TV/scripts/deployer-fonction.sh <nom>`.**
  Jamais `supabase functions deploy` nu. Huit fonctions tournent volontairement sans vérification
  JWT (dont `stripe-webhook`) et un déploiement nu la réactive : fin silencieuse de tous les
  paiements. Ne jamais créer de `supabase/config.toml` pour contourner : un `config push` écraserait
  les réglages d'authentification de production. Après tout déploiement, lancer
  `bash livrables/SportVision-TV/tests/fonctions-verification-jwt.test.sh`.
