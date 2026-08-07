import env from '#start/env'
import { externalServicesIsolated } from '#config/env_isolation'
import { IMMICH_DEFAULT_TIMEOUT_MS } from '#config/immich'

/**
 * La session Immich élevée du coffre — le dossier verrouillé (CC-205).
 *
 * ⚠️ **`baseUrl` relit `IMMICH_BASE_URL`, la même variable que `config/immich.ts`.** Une seule
 * instance Immich, un seul hôte à déclarer — pas de `COFFRE_IMMICH_BASE_URL` distinct à saisir en
 * double. `IMMICH_API_KEY`/`IMMICH_ALBUM_ID` restent propres au proxy à clé d'API (CC-180) : ce
 * fichier ne les lit jamais, une installation coffre-sans-veille peut se passer des deux.
 *
 * ⚠️ **Frontière de confiance identique à `config/immich.ts` et `config/coffre_nas.ts`** : ces
 * valeurs viennent de l'environnement, jamais d'un formulaire, jamais de la base. Contrairement aux
 * deux autres, **le mot de passe et le PIN sont eux-mêmes des secrets de premier ordre** — voir
 * `app/modules/coffre/CLAUDE.md`, « Le dossier verrouillé » : ce fichier met dans le `.env` de quoi
 * ouvrir le contenu du coffre, exception assumée à la doctrine « pas d'APP_KEY ».
 */
export interface CoffreImmichConfig {
  /** Sans slash final : le client concatène. */
  baseUrl: string
  email: string
  /** ⚠️ Pas `trim()`é — même raison que la passphrase du coffre : un espace en fait partie. */
  password: string
  /** ⚠️ Pas `trim()`é non plus, même raison. */
  pinCode: string
  timeoutMs: number
  /** Les quatre valeurs sont-elles présentes ? Sans elles, le dossier verrouillé reste inatteignable. */
  enabled: boolean
}

/** Valeurs brutes telles que lues dans l'environnement, avant nettoyage. */
export interface RawCoffreImmichConfig {
  baseUrl?: string
  email?: string
  password?: string
  pinCode?: string
  timeoutMs?: number
}

/**
 * Fonction **pure**, séparée de la lecture d'`env` — même raison que `normalizeImmichConfig` : un
 * module qui calcule tout à l'import ne se teste pas.
 */
export function normalizeCoffreImmichConfig(raw: RawCoffreImmichConfig): CoffreImmichConfig {
  const baseUrl = (raw.baseUrl ?? '').trim().replace(/\/+$/, '')
  const email = (raw.email ?? '').trim()
  const password = raw.password ?? ''
  const pinCode = raw.pinCode ?? ''

  return {
    baseUrl,
    email,
    password,
    pinCode,
    timeoutMs: raw.timeoutMs ?? IMMICH_DEFAULT_TIMEOUT_MS,
    enabled: baseUrl !== '' && email !== '' && password !== '' && pinCode !== '',
  }
}

/**
 * La configuration effective : celle de l'environnement, **sauf en test** (CC-101, CC-205).
 *
 * ⚠️ **La garde est ici et pas dans `normalizeCoffreImmichConfig`**, même raison que côté Immich et
 * NAS : les tests qui doivent prouver le client de session construisent leur propre configuration
 * **activée**, explicitement.
 */
export function coffreImmichConfigFrom(
  nodeEnv: string | undefined,
  raw: RawCoffreImmichConfig
): CoffreImmichConfig {
  return normalizeCoffreImmichConfig(externalServicesIsolated(nodeEnv) ? {} : raw)
}

const coffreImmichConfig = coffreImmichConfigFrom(env.get('NODE_ENV'), {
  baseUrl: env.get('IMMICH_BASE_URL'),
  email: env.get('COFFRE_IMMICH_EMAIL'),
  password: env.get('COFFRE_IMMICH_PASSWORD'),
  pinCode: env.get('COFFRE_IMMICH_PIN'),
  timeoutMs: env.get('IMMICH_TIMEOUT_MS'),
})

export default coffreImmichConfig
