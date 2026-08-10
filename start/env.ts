/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  /**
   * ⚠️ **Cet enum porte l'isolation des clients externes** (CC-101). `config/env_isolation.ts`
   * reconnaît la valeur `'test'`, et elle seule ; c'est ce qui éteint Immich, YouTube et la
   * configuration LLM du poste pendant `npm test`. Le chargeur d'AdonisJS, lui, traite **aussi**
   * `'testing'` comme un environnement de test — c'est cette liste-ci qui le rend inatteignable.
   * Ajouter une valeur ici sans l'ajouter à `externalServicesIsolated` **désarmerait l'isolation
   * en silence** : les tests repartiraient vers la vraie instance Immich et l'API de Google.
   */
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | URL publique de l'application — dérive le `secure` des cookies (CC-136)
  |----------------------------------------------------------
  |
  | ⚠️ **Remplace la dérivation depuis `NODE_ENV`.** `config/session.ts` et `config/app.ts`
  | posaient `secure: app.inProduction` : sur l'image Docker (`NODE_ENV=production` imposé par
  | le `Dockerfile`), le cookie de session ET le cookie CSRF de Shield portaient donc `secure`
  | même pour qui ouvre `http://localhost:8080` en local — le navigateur refuse d'émettre un
  | cookie `secure` en HTTP nu, la session ne s'établit jamais, et `/login` se recharge sans le
  | moindre message d'erreur. La vraie question n'est pas « suis-je en production ? » mais
  | « suis-je servi en TLS ? », et les deux divergent dès qu'il existe plus d'une installation.
  |
  | ⚠️ **Obligatoire, et l'oubli va vers le refus** — même doctrine que `LIMITER_STORE` (CC-78) :
  | un défaut permissif dégraderait en silence la connexion d'une installation déjà en ligne, et
  | un cookie non-`secure` ne se remarque qu'en lisant l'onglet Application d'un navigateur. Une
  | application qui refuse de démarrer se diagnostique en dix secondes.
  |
  | `format: 'url', tld: false` valide un schéma (`http:`/`https:`) et un hôte, sans exiger de
  | domaine — `http://localhost:8080` et `http://192.168.1.50:8080` sont des valeurs légitimes.
  | La dérivation elle-même (`secure`, et la détection d'un HTTP non local) vit dans
  | `config/app_url.ts`, fonction pure pour rester testable sans dépendre du `.env` de la
  | machine qui lance les tests.
  */
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

  /*
  |----------------------------------------------------------
  | Commit court injecté à la construction de l'image (CC-151)
  |----------------------------------------------------------
  |
  | ⚠️ N'existe que sur une image construite avec `--build-arg APP_COMMIT=...` (Dockerfile,
  | étage `production`) — le `.git` du dépôt n'entre jamais dans le contexte de build
  | (`.dockerignore`). Absente en développement (pas de build Docker) et sur une image
  | construite sans l'ARG : `/reglages` l'affiche alors comme telle (repli explicite en i18n),
  | jamais comme une chaîne vide. Optionnelle pour ne RIEN casser de `npm run dev`, `npm test`,
  | ni la CI — aucun d'eux ne construit d'image.
  */
  APP_COMMIT: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Modules activés sur cette installation (CC-137)
  |----------------------------------------------------------
  |
  | ⚠️ **Vide ou absente = noyau seul**, même doctrine que les routes (l'oubli va vers le
  | refus). Liste séparée par des virgules parmi `services`, `agents`, `veille`, `leitner`
  | (`config/modules.ts`, qui seul connaît le nom des modules). Un nom inconnu fait échouer
  | le démarrage plutôt que d'être ignoré en silence.
  */
  MODULES: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Fichier de déclaration des agents (CC-141)
  |----------------------------------------------------------
  |
  | ⚠️ Optionnelle, défaut `agents.json` (racine du dépôt, `config/agents.ts`). Lu au démarrage,
  | jamais par une route : c'est ce qui garantit que `config.command` (une commande shell
  | exécutée telle quelle, voir `app/modules/agents/CLAUDE.md`) reste hors d'atteinte de toute
  | requête HTTP. Absent : module vide, pas une erreur.
  */
  AGENTS_CONFIG_PATH: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Fuseau des collectes de veille à heure fixe
  |----------------------------------------------------------
  |
  | ⚠️ **Distinct de `TZ`, et pas un doublon.** `TZ` est le fuseau du process, dans
  | lequel s'écrivent et se relisent les `timestamp` de la base. `APP_TIMEZONE` ne
  | situe que la fenêtre horaire d'une source de veille en mode `daily` : « 7h » veut
  | dire 7h ici, pas 7h UTC. Défaut et validation dans `config/veille.ts` — un nom de
  | fuseau invalide y fait échouer le démarrage, faute de quoi la collecte se tairait
  | en silence.
  */
  APP_TIMEZONE: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Second facteur obligatoire pour les administrateurs (CC-114)
  |----------------------------------------------------------
  |
  | ⚠️ **Défaut `false`, et l'oubli va vers l'ouverture — délibérément, ici.** C'est
  | l'inverse de la règle des routes (point 5 du CLAUDE.md), pour une raison qui ne
  | vaut que pour cette variable : la fermer par défaut enfermerait dehors l'unique
  | administrateur d'une installation existante au premier `git pull`, et plus
  | personne n'atteindrait l'écran qui distribue les droits. Le second facteur reste
  | de toute façon disponible sans elle — elle ne fait que le rendre exigible.
  |
  | Ne l'allumer qu'après avoir vérifié l'enrôlement au navigateur, avec un vrai
  | téléphone : le QR ne se prouve nulle part ailleurs.
  */
  ADMIN_2FA_REQUIRED: Env.schema.boolean.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring session package
  |----------------------------------------------------------
  */
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory'] as const),

  /*
  |----------------------------------------------------------
  | Store des compteurs du throttle de connexion (CC-78)
  |----------------------------------------------------------
  |
  | `database` partout sauf en test : les compteurs survivent aux redémarrages,
  | un restart ne rouvre donc pas une fenêtre de brute-force. `memory` est
  | réservé à `.env.test` — chaque exécution repart à zéro, et rien ne s'écrit
  | dans `app_test` hors des transactions de test.
  */
  LIMITER_STORE: Env.schema.enum(['database', 'memory'] as const),

  /*
  |----------------------------------------------------------
  | Proxys de confiance pour X-Forwarded-For (CC-78)
  |----------------------------------------------------------
  |
  | Le throttle de connexion compte par IP : derrière le reverse proxy DSM,
  | sans cette variable, toutes les requêtes porteraient l'IP du proxy — un
  | seul attaquant bloquerait tout le monde. Liste d'IP, de CIDR ou de noms
  | `proxy-addr` (`loopback`, `linklocal`, `uniquelocal`), séparés par des
  | virgules. Défaut : `loopback`, le défaut d'AdonisJS, explicité.
  |
  | ⚠️ Trop large, c'est l'inverse : un client joignant le port en direct
  | forgerait son X-Forwarded-For et contournerait le throttle par IP.
  */
  TRUST_PROXY: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Accès Docker du déploiement — bannière « hors service » (CC-116)
  |----------------------------------------------------------
  |
  | ⚠️ Ce n'est pas une sonde : « docker échoue » se manifeste identiquement sur
  | le poste de dev (pas de conteneurs réels, le catch {} de SystemStatsService
  | simule — assumé) et sur le NAS (socket jamais monté, décision CC-73). Seule
  | une déclaration du déploiement distingue les deux. Le défaut dépend de
  | NODE_ENV (config/docker.ts) : disponible en development/test, indisponible
  | en production — l'oubli va vers la vérité (bannière), jamais vers le
  | mensonge. Ne poser la variable que pour contredire ce défaut.
  */
  DOCKER_AVAILABLE: Env.schema.boolean.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring database connection
  |----------------------------------------------------------
  */
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Chiffrement des dumps de sauvegarde (CC-223)
  |----------------------------------------------------------
  |
  | ⚠️ La clé PUBLIQUE age (`age1...`) seulement — celle qui permet de chiffrer sans jamais
  | pouvoir déchiffrer. Optionnelle : absente, `db:backup` continue de produire des dumps en
  | clair, comme avant CC-223, et l'annonce à chaque exécution.
  |
  | ⚠️ **Ce nom est déclaré ici, contrairement à `BACKUP_MIRROR_DIR`/`BACKUP_KEEP`** — et ce
  | n'est pas une incohérence : ces deux-là sont lues en `process.env` direct par le script du
  | poste de dev (`scripts/db-backup.js`, hors de l'app Adonis), le conteneur utilisant à leur
  | place des chemins FIXES (`config/backup.ts`). Cette variable-ci, en revanche, doit être lue
  | à la fois par ce script ET par l'app : elle a donc besoin d'une entrée ici pour que `env.get`
  | la connaisse côté Adonis.
  |
  | ⚠️ **Le seul `env.get` de cette variable vit dans `config/backup.ts`** (CC-231), qui la
  | neutralise sous `NODE_ENV=test` via `externalServicesIsolated` — `BackupService` lit la
  | config, plus l'environnement. La lire à nouveau en direct rejouerait le défaut : `.env.test`
  | ne la déclare pas, le chargeur fusionne par truthiness (CC-88), et la suite se remettrait à
  | chiffrer avec la clé réelle du poste sans qu'aucun vert en CI ne le dise.
  |
  | ⚠️ La clé PRIVÉE (`AGE-SECRET-KEY-1...`) n'a AUCUNE variable ici, et ce n'est pas un
  | oubli : elle ne vit jamais sur cette machine. `db:restore` la lit directement dans
  | `process.env.BACKUP_DECRYPTION_KEY`, passée en ligne à l'invocation — la déclarer dans ce
  | schéma lui donnerait un statut de config persistable qu'elle ne doit jamais avoir, même
  | doctrine que le rejet d'`ADMIN_PASSWORD` (CC-75, CC-138).
  */
  BACKUP_ENCRYPTION_RECIPIENT: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Serveur LLM local (compatible OpenAI) — ingestion Leitner
  |----------------------------------------------------------
  |
  | ⚠️ La configuration du LLM vient **de l'environnement, jamais de la base** : c'est
  | ce qui garantit qu'aucune requête HTTP ne peut changer l'hôte que le serveur
  | appelle. `/revision/llm` aide à fabriquer ce bloc (détection, test), sous liste
  | blanche et sans rien persister — il ne remplace pas ces variables.
  | Les valeurs par défaut vivent dans `config/llm.ts`.
  */
  LLM_BASE_URL: Env.schema.string.optional(),
  LLM_MODEL: Env.schema.string.optional(),
  LLM_API_KEY: Env.schema.string.optional(),
  LLM_TIMEOUT_MS: Env.schema.number.optional(),

  /*
  |----------------------------------------------------------
  | Instance Immich — source média de la veille (CC-55)
  |----------------------------------------------------------
  |
  | ⚠️ Même frontière de confiance que le LLM : la configuration vient **de
  | l'environnement, jamais de la base**, faute de quoi l'hôte que le serveur
  | interroge serait modifiable par une requête HTTP. Il n'existe donc, à dessein,
  | aucun formulaire pour ces valeurs.
  |
  | `IMMICH_ALBUM_ID` désigne l'album qui sert de source — un seul, jamais la
  | bibliothèque entière (photos personnelles). Les trois sont optionnelles : sans
  | elles, la collecte Immich reste simplement inactive. Défauts et validation dans
  | `config/immich.ts`.
  */
  IMMICH_BASE_URL: Env.schema.string.optional(),
  IMMICH_API_KEY: Env.schema.string.optional(),
  IMMICH_ALBUM_ID: Env.schema.string.optional(),
  IMMICH_TIMEOUT_MS: Env.schema.number.optional(),

  /*
  |----------------------------------------------------------
  | Racines de médias du coffre — lecture depuis le NAS (CC-181)
  |----------------------------------------------------------
  |
  | ⚠️ Même frontière de confiance qu'Immich et le LLM : ces chemins viennent DE
  | l'environnement, jamais de la base ni d'un formulaire. Une racine persistée
  | depuis une requête HTTP serait une lecture arbitraire du disque, permanente.
  |
  | Liste séparée par des virgules, CHAQUE racine sous la forme « nom=chemin »
  | (CC-233) — l'identifiant entre dans les références du catalogue, il évite
  | que deux racines portant chacune un fichier de même chemin relatif ne
  | s'écrasent en silence dans le catalogue. Le chemin est celui que LE
  | PROCESSUS le voit — un chemin réel du poste en dev, le chemin FIXE monté
  | dans le conteneur en production (voir docker-compose.install.yml, où seul
  | le côté HÔTE du montage se règle). Optionnelle : sans elle, la lecture de
  | médias NAS du coffre reste simplement inactive (toute référence rend 404).
  | Couvre photos ET vidéos — une seule garde de chemin pour les deux, la
  | nature du fichier ne change rien à la sécurité de l'accès. Une racine sans
  | identifiant, un identifiant vide, un identifiant portant un « / », ou deux
  | racines de même identifiant font échouer le démarrage. Normalisation dans
  | `config/coffre_nas.ts`.
  */
  COFFRE_NAS_ROOTS: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Playlist « Veille » YouTube — seconde source média (CC-85)
  |----------------------------------------------------------
  |
  | ⚠️ Même frontière de confiance qu'Immich : la configuration vient **de
  | l'environnement, jamais de la base**. Il n'existe donc, à dessein, aucun
  | formulaire pour ces valeurs.
  |
  | ⚠️ Ce n'est pas « À regarder plus tard » : cette playlist-là n'est plus
  | lisible par l'API depuis ~2016, aucun scope OAuth ne la rend accessible et
  | elle n'a pas de flux RSS. `YOUTUBE_PLAYLIST_ID` désigne une playlist
  | **dédiée**, non-répertoriée, que l'utilisateur alimente lui-même — donc
  | lisible par une simple clé API, sans OAuth ni jeton à rafraîchir.
  |
  | Les deux premières sont optionnelles : sans elles, la collecte YouTube reste
  | simplement inactive. Défauts et normalisation dans `config/youtube.ts`.
  */
  YOUTUBE_API_KEY: Env.schema.string.optional(),
  YOUTUBE_PLAYLIST_ID: Env.schema.string.optional(),
  YOUTUBE_TIMEOUT_MS: Env.schema.number.optional(),
})
