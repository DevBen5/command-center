import env from '#start/env'
import { externalServicesIsolated } from '#config/env_isolation'

/**
 * Les racines de médias NAS autorisées pour le coffre — la lecture du lot 4 (CC-181), photos
 * comme vidéos.
 *
 * ⚠️ **Même frontière de confiance que `config/immich.ts`**, pour une raison différente : il ne
 * s'agit pas d'un appel réseau, mais la fusion par *truthiness* de `@adonisjs/env` (CC-88) menace
 * n'importe quelle variable, pas seulement celles d'un client externe. Sans cette isolation, un
 * `.env` de poste de dev qui fixerait `COFFRE_NAS_ROOTS` sur un vrai dossier contaminerait les
 * tests en process — même mécanisme que celui qui a fait recevoir un vrai média Immich à un test.
 */

/**
 * Une racine déclarée, avec son identifiant (CC-233) — voir `normalizeCoffreNasConfig` pour le
 * format `nom=chemin` attendu en entrée.
 */
export interface CoffreNasRoot {
  /** L'identifiant déclaré dans `COFFRE_NAS_ROOTS`, sans transformation. Entre dans une référence. */
  name: string
  /** Chemin tel que LE PROCESSUS le voit — jamais transformé davantage ici. */
  path: string
}

export interface CoffreNasConfig {
  roots: CoffreNasRoot[]
}

/** Valeur brute telle que lue dans l'environnement, avant nettoyage. */
export interface RawCoffreNasConfig {
  roots?: string
}

/**
 * Fonction **pure**, séparée de la lecture d'`env` — même raison que `normalizeImmichConfig` : un
 * module qui calcule tout à l'import ne se teste pas.
 *
 * ⚠️ **Chaque racine doit porter un identifiant, `nom=chemin` — CC-233.** Une référence de
 * catalogue stockée sans l'identité de sa racine (l'ancien format, un chemin relatif nu) rend deux
 * racines distinctes portant chacune un fichier de même chemin relatif **indiscernables** : la
 * seconde écrase la première en base, en silence (aucune contrainte violée, `applyEnumeration`
 * trouve la ligne du premier fichier et la met à jour). Trois formes plus légères ont été écartées :
 * un **index positionnel** (`0/photos/a.jpg`) se casse si l'ordre de `COFFRE_NAS_ROOTS` change dans
 * le `.env` — un réordonnancement réécrirait silencieusement le sens de toutes les références
 * existantes ; une **empreinte du chemin** survit au réordonnancement mais pas au renommage de la
 * racine, et rend les lignes du catalogue illisibles au débogage (un hash ne se lit pas). Un
 * identifiant déclaré explicitement est le plus verbeux des trois, et le seul qui ne se casse sur
 * aucun des deux axes.
 *
 * ⚠️ **Une racine sans `nom=` fait ÉCHOUER LE DÉMARRAGE**, jamais un repli silencieux sur un index
 * — exactement le défaut que ce lot corrige. Le message NOMME le remède, même doctrine que
 * `parseModules` sur un nom de module inconnu. Deux racines partageant le même `nom` échouent aussi
 * : l'identifiant entre dans une référence qui sert de clé, un doublon romprait la même garantie
 * qu'un index dupliqué.
 */
export function normalizeCoffreNasConfig(raw: RawCoffreNasConfig): CoffreNasConfig {
  const entries = (raw.roots ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  const roots: CoffreNasRoot[] = []
  const nomsVus = new Set<string>()

  for (const entry of entries) {
    const indexEgal = entry.indexOf('=')
    if (indexEgal === -1) {
      throw new Error(
        `COFFRE_NAS_ROOTS : la racine « ${entry} » ne porte pas d'identifiant. Chaque racine ` +
          "doit s'écrire « nom=chemin » (ex. « photos=D:\\Medias\\photos »)."
      )
    }

    const nom = entry.slice(0, indexEgal).trim()
    const chemin = entry.slice(indexEgal + 1).trim()

    if (nom.length === 0) {
      throw new Error(
        `COFFRE_NAS_ROOTS : la racine « ${entry} » a un identifiant vide. Chaque racine doit ` +
          "s'écrire « nom=chemin », avec un nom non vide."
      )
    }

    if (nom.includes('/')) {
      throw new Error(
        `COFFRE_NAS_ROOTS : l'identifiant « ${nom} » ne peut pas contenir de « / » — il entre ` +
          'tel quel dans les références du catalogue (« <nom>/<chemin relatif> »).'
      )
    }

    if (nomsVus.has(nom)) {
      throw new Error(
        `COFFRE_NAS_ROOTS : l'identifiant « ${nom} » est déclaré plusieurs fois. Chaque racine ` +
          'doit porter un identifiant unique.'
      )
    }
    nomsVus.add(nom)

    roots.push({ name: nom, path: chemin })
  }

  return { roots }
}

/**
 * La configuration effective : celle de l'environnement, **sauf en test** (CC-101, CC-181).
 *
 * ⚠️ **La garde est ici et pas dans `normalizeCoffreNasConfig`**, pour la même raison que côté
 * Immich : les tests qui doivent prouver le résolveur contre un vrai filesystem construisent leur
 * propre `NasRootsService` avec des racines explicites (fixtures temporaires), jamais en lisant
 * cette configuration — voir `app/modules/coffre/services/nas_roots_service.ts`.
 */
export function coffreNasConfigFrom(
  nodeEnv: string | undefined,
  raw: RawCoffreNasConfig
): CoffreNasConfig {
  return normalizeCoffreNasConfig(externalServicesIsolated(nodeEnv) ? {} : raw)
}

const coffreNasConfig = coffreNasConfigFrom(env.get('NODE_ENV'), {
  roots: env.get('COFFRE_NAS_ROOTS'),
})

export default coffreNasConfig
