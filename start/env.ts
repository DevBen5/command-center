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
  | Mot de passe du compte propriétaire — lu par le seul seeder (CC-75)
  |----------------------------------------------------------
  |
  | ⚠️ **Sans elle, `node ace db:seed` ne crée aucun compte.** C'est le point du
  | ticket : le seeder posait `motdepasse` en clair dans le code, donc toute base
  | neuve naissait avec une porte ouverte. Absente, la variable ne produit pas un
  | compte affaibli — elle n'en produit aucun, et le seeder le dit.
  |
  | ⚠️ **Elle ne sert qu'au seed, et se retire ensuite.** Rien d'autre ne la lit :
  | une fois le mot de passe posé en base, la garder dans `.env` ne fait que laisser
  | un secret en clair sur la machine. La reposer et relancer `db:seed` est aussi la
  | façon de **changer** le mot de passe du propriétaire — `updateOrCreate` écrase.
  */
  ADMIN_PASSWORD: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring session package
  |----------------------------------------------------------
  */
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory'] as const),

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
