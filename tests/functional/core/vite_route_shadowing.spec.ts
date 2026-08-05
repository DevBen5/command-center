import { existsSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { createUserWith } from '#tests/helpers/users'

/**
 * ⚠️ **Le serveur de dev Vite répond AVANT le routeur, et il résout les fichiers du dépôt.**
 *
 * `@adonisjs/vite/vite_middleware` est un middleware **serveur** (`start/kernel.ts`) : il voit
 * toutes les requêtes, y compris celles qui désignent une route de l'application. Vite traite un
 * chemin sans extension comme une requête JS et le résout contre la racine du projet avec sa
 * liste d'extensions — `.json` comprise. Un fichier `<racine>/services.json` répond donc à
 * `GET /services` **200 `text/javascript`**, sans authentification, sans que la route existe
 * pour lui.
 *
 * C'est arrivé pour de vrai (CC-170) : `agents.json`, le fichier de déclaration de CC-141, a
 * masqué `/agents` — l'écran devenu inatteignable en dev, le fichier qui porte `config.command`
 * servi à un anonyme, et deux specs rouges (`capabilities_access`, `pages`) que la CI ne voyait
 * pas, `agents.json` étant ignoré par git.
 *
 * ⚠️ **Ce test FABRIQUE le fichier masquant plutôt que de compter sur celui du poste.** C'est
 * tout l'intérêt : sans ça, il resterait vert sur un runner — exactement le faux-négatif
 * « invisible en CI » que CC-170 existe pour supprimer.
 */
const FICHIER_MASQUANT = 'services.json'

test.group('Core / le serveur de dev ne masque pas une route', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un fichier à la racine du dépôt ne prend pas la place de la route de même nom', async ({
    client,
    assert,
    cleanup,
  }) => {
    const chemin = app.makePath(FICHIER_MASQUANT)

    // ⚠️ Ne jamais écraser un fichier réel : `agents.json` du poste de dev est le cas qu'on
    // cherche à protéger, pas une variable de test.
    assert.isFalse(
      existsSync(chemin),
      `${FICHIER_MASQUANT} existe déjà à la racine : ce test l’écraserait. Choisis un autre nom.`
    )

    await writeFile(chemin, JSON.stringify({ marqueur: 'CC-170' }), 'utf-8')
    cleanup(() => rm(chemin, { force: true }))

    // Un compte qui porte une capacité — donc authentifié et légitime — mais pas `is_admin` :
    // `/services` doit lui répondre 403, et c'est la route qui le décide, pas Vite.
    const user = await createUserWith(['dashboard.view'])
    const response = await client.get(`/${FICHIER_MASQUANT.replace('.json', '')}`).loginAs(user)

    response.assertStatus(403)
    assert.notInclude(
      String(response.text()),
      'CC-170',
      `GET /services a rendu le contenu de ${FICHIER_MASQUANT} : le serveur de dev a répondu ` +
        `avant le routeur.`
    )
  })
})
