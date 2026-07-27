import { test } from '@japa/runner'
import dbConfig from '#config/database'

/**
 * Ce qui a le droit de tourner à chaque `node ace db:seed` (CC-106).
 *
 * Le seed n'est pas une commande de mise en route qu'on lance une fois : c'est le **seul**
 * outil de rotation d'`ADMIN_PASSWORD` (CC-75), documenté jusqu'en production. Tout ce qui
 * est enregistré ici s'exécute donc à chaque changement de mot de passe administrateur — et
 * un seeder de contenu y réécrit du contenu réel, que rien d'autre ne sauvegarde.
 *
 * ⚠️ Le test asserte la **liste déclarée**, pas l'effet : aucun runner n'exécute
 * `node ace db:seed` de bout en bout. Il attrape la régression qui s'est produite — un path
 * de seeder de contenu réenregistré — pas un seeder qui écrirait dans une autre table depuis
 * un path légitime.
 */
const PATHS_ATTENDUS = [
  'app/core/auth/seeders',
  'app/modules/services/seeders',
  'app/modules/agents/seeders',
]

test.group('Core / seeders déclarés', () => {
  test('la liste des paths est exactement celle attendue', ({ assert }) => {
    const connection = dbConfig.connections.postgres

    assert.deepEqual(connection.seeders?.paths, PATHS_ATTENDUS)
  })

  test('aucun seeder de contenu saisi à la main', ({ assert }) => {
    const paths = dbConfig.connections.postgres.seeders?.paths ?? []

    // Redondant avec l'assertion ci-dessus tant que la liste ne bouge pas, et c'est le but :
    // l'assertion exacte rougit sur toute modification, celle-ci nomme la raison. Un path
    // ajouté de bonne foi fait relire le commentaire au lieu de faire corriger un tableau.
    assert.notInclude(paths, 'app/modules/veille/seeders')
    assert.notInclude(paths, 'app/modules/leitner/seeders')
  })
})
