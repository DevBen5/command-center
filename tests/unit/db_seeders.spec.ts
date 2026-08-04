import { test } from '@japa/runner'
import dbConfig from '#config/database'

/**
 * Ce qui a le droit de tourner à chaque `node ace db:seed` : RIEN (CC-138).
 *
 * CC-106 avait réduit la liste aux seeders « légitimes » ; CC-138 finit le geste — les trois
 * derniers (services, agents, auth) écrivaient du contenu de démo ou l'identité du
 * propriétaire en dur, et le premier compte se crée désormais depuis l'écran d'installation,
 * le rôle « Lecteur » depuis une migration. La liste vide est donc une décision, pas un état
 * transitoire : un path réenregistré ici rejouerait le mode d'échec de CC-106 (un seeder de
 * contenu réécrit du contenu réel à chaque passage, en silence).
 *
 * ⚠️ Le test asserte la **liste déclarée**, pas l'effet : aucun runner n'exécute
 * `node ace db:seed` de bout en bout. Il attrape la régression qui s'est produite — un path
 * de seeder réenregistré — pas un seeder qui écrirait depuis un path légitime.
 */
test.group('Core / seeders déclarés', () => {
  test('aucun path de seeder n’est déclaré', ({ assert }) => {
    const connection = dbConfig.connections.postgres

    assert.deepEqual(connection.seeders?.paths, [])
  })
})
