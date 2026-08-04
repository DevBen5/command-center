import { test } from '@japa/runner'
import env from '#start/env'
import enabledModules, { KNOWN_MODULES, parseModules, migrationPathsFor } from '#config/modules'
import VeilleProvider from '#providers/veille_provider'
import LeitnerProvider from '#providers/leitner_provider'

/**
 * Les modules activables de l'installation (CC-137).
 *
 * ⚠️ **Le test « tous les modules sont activés en environnement de test » est le cœur du
 * lot** — c'est lui, et lui seul, qui empêche `.env.test` de se mettre au vert en
 * n'exécutant plus la moitié du dépôt (le mode d'échec « garde qui naît inerte » documenté
 * par CC-112 et CC-113). Sans lui, un `.env.test` qui perdrait sa ligne `MODULES` ferait
 * disparaître silencieusement toutes les routes, capacités et migrations des quatre
 * modules — et la suite resterait verte en ayant cessé de les exercer.
 */
test.group('Core / modules activables (CC-137)', () => {
  test('MODULES active tous les modules connus en environnement de test', ({ assert }) => {
    const manquants = KNOWN_MODULES.filter((module) => !enabledModules.has(module))

    assert.deepEqual(
      manquants,
      [],
      `MODULES doit activer tous les modules en test (.env.test) — manquants : ${manquants.join(', ')}`
    )
  })

  test('parseModules : vide ou absente = aucun module (noyau seul)', ({ assert }) => {
    assert.deepEqual(parseModules(undefined), new Set())
    assert.deepEqual(parseModules(''), new Set())
    assert.deepEqual(parseModules('   '), new Set())
  })

  test('parseModules : une liste séparée par des virgules, espaces tolérés', ({ assert }) => {
    assert.deepEqual(parseModules('leitner,veille'), new Set(['leitner', 'veille']))
    assert.deepEqual(parseModules(' leitner , veille ,'), new Set(['leitner', 'veille']))
  })

  test('parseModules : un nom inconnu fait échouer le démarrage plutôt que d’être ignoré', ({
    assert,
  }) => {
    // ⚠️ C'est le point du lot : une faute de frappe (« leitnre ») ne doit jamais désactiver
    // un module en silence. `assert.throws` prouve que ce n'est pas juste filtré.
    assert.throws(() => parseModules('leitnre'), /modules inconnus/)
    assert.throws(() => parseModules('leitner,veille,inconnu'), /inconnu/)
  })

  test('migrationPathsFor : filtre et ordonne selon KNOWN_MODULES, jamais selon l’ordre de MODULES', ({
    assert,
  }) => {
    assert.deepEqual(migrationPathsFor(new Set(['leitner', 'veille'])), [
      'app/modules/veille/migrations',
      'app/modules/leitner/migrations',
    ])
    assert.deepEqual(migrationPathsFor(new Set()), [])
    assert.deepEqual(migrationPathsFor(new Set(KNOWN_MODULES)), [
      'app/modules/services/migrations',
      'app/modules/agents/migrations',
      'app/modules/veille/migrations',
      'app/modules/leitner/migrations',
    ])
  })

  test('la valeur brute lue par env.get correspond à ce que le singleton expose', ({ assert }) => {
    // Garde contre une désynchronisation entre `env.ts` (schéma) et `modules.ts` (lecture) :
    // si l'un des deux cesse de lire MODULES, cette assertion le dit avant qu'un module ne
    // disparaisse en silence d'une installation réelle.
    assert.deepEqual(enabledModules, parseModules(env.get('MODULES')))
  })

  /**
   * ⚠️ **Régression du bug trouvé à la vérification manuelle du lot** : sans garde, ces deux
   * providers tournent au boot quel que soit `MODULES` — `VeilleProvider` alignait Immich/YouTube
   * et démarrait une boucle qui échouait ensuite à CHAQUE tick contre `veille_sources`, absente
   * d'une installation `MODULES=leitner`. Aucun boot Japa ne les exerce (`environment: ['web']`,
   * jamais `test`) : la seule façon de couvrir la garde est de les instancier directement.
   *
   * Le `app` factice (`{}`) est la preuve elle-même : si la garde `modules.has(...)` disparaît,
   * `ready()`/`shutdown()` tentent `this.app.container.make(...)` sur un objet qui n'a pas de
   * `container` et lèvent aussitôt — c'est ce qui fait rougir ce test si la garde régresse.
   */
  test('VeilleProvider ne fait rien au boot si veille est désactivé', async ({ assert }) => {
    const provider = new VeilleProvider({} as never)
    enabledModules.delete('veille')

    try {
      await assert.doesNotReject(() => provider.ready())
      await assert.doesNotReject(() => provider.shutdown())
    } finally {
      enabledModules.add('veille')
    }
  })

  test('LeitnerProvider ne fait rien au boot si leitner est désactivé', async ({ assert }) => {
    const provider = new LeitnerProvider({} as never)
    enabledModules.delete('leitner')

    try {
      await assert.doesNotReject(() => provider.ready())
    } finally {
      enabledModules.add('leitner')
    }
  })
})
