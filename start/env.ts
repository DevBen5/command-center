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
})
