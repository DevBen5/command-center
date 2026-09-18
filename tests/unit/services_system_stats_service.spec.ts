import { test } from '@japa/runner'
import { execFile } from 'node:child_process'
import Service from '#modules/services/models/service'
import SystemStatsService from '#modules/services/services/system_stats_service'

type AppelDocker = { commande: string; arguments: string[] }

function serviceAvec(containerName: string) {
  let sauvegardes = 0
  const service = {
    name: 'Service par defaut',
    config: { containerName },
    status: 'unknown',
    async save() {
      sauvegardes++
    },
  } as unknown as Service

  return { service, sauvegardes: () => sauvegardes }
}

function execFileFactice(appels: AppelDocker[], erreur: Error | null = null): typeof execFile {
  return ((commande: string, arguments_: string[], callback: (erreur_: Error | null) => void) => {
    appels.push({ commande, arguments: [...arguments_] })
    callback(erreur)
  }) as typeof execFile
}

test.group('Services / SystemStatsService.control() — frontière Docker (CC-13)', () => {
  test('un nom conforme part vers execFile avec un tableau d’arguments', async ({ assert }) => {
    const appels: AppelDocker[] = []
    const { service, sauvegardes } = serviceAvec('command-center.web-1')

    const resultat = await new SystemStatsService(execFileFactice(appels)).control(
      service,
      'restart'
    )

    assert.equal(appels.length, 1)
    assert.equal(appels[0].commande, 'docker')
    assert.isArray(appels[0].arguments)
    assert.deepEqual(appels[0].arguments, ['restart', 'command-center.web-1'])
    assert.equal(resultat.status, 'up')
    assert.equal(sauvegardes(), 1)
  })

  for (const [nom, containerName] of [
    ['un espace', 'web service'],
    ['un point-virgule', 'web; whoami'],
    ['un &&', 'web && whoami'],
    ['un pipe', 'web | whoami'],
    ['une substitution $()', '$(whoami)'],
    ['un backtick', '`whoami`'],
    ['un chemin relatif', '../docker'],
  ]) {
    test(`refuse ${nom} sans tenter d’action`, async ({ assert }) => {
      const appels: AppelDocker[] = []
      const { service, sauvegardes } = serviceAvec(containerName)

      const resultat = await new SystemStatsService(execFileFactice(appels)).control(
        service,
        'restart'
      )

      assert.isEmpty(appels)
      // Le refus est absorbé par le catch volontaire, comme un Docker indisponible en développement.
      assert.equal(resultat.status, 'up')
      assert.equal(sauvegardes(), 1)
    })
  }

  test('un échec Docker reste simulé comme un succès en base', async ({ assert }) => {
    const appels: AppelDocker[] = []
    const { service, sauvegardes } = serviceAvec('command-center.web-1')

    const resultat = await new SystemStatsService(
      execFileFactice(appels, new Error('Docker absent'))
    ).control(service, 'stop')

    assert.deepEqual(appels, [{ commande: 'docker', arguments: ['stop', 'command-center.web-1'] }])
    assert.equal(resultat.status, 'down')
    assert.equal(sauvegardes(), 1)
  })
})
