import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createUserWith } from '#tests/helpers/users'
import { createVault, PASSPHRASE } from '#tests/helpers/coffre'

/**
 * Ce qu'une validation ratée renvoie dans la session (CC-179).
 *
 * ⚠️ **Le mode d'échec que ce fichier ferme, et il était réel.** `@adonisjs/session` accroche
 * `renderValidationErrorAsHTML` sur l'`ExceptionHandler`, et son `flashValidationErrors` appelle
 * `flashExcept(['_csrf', '_method', 'password', 'password_confirmation'])` : **tout le corps
 * soumis repart dans la session** dès qu'un champ ne valide pas, sauf ces quatre clés écrites en
 * dur dans le paquet. Le store de session est `cookie` (`config/session.ts`), donc ce corps part
 * chiffré par `APP_KEY` chez le client — précisément la dépendance que le coffre existe pour
 * refuser (`app/modules/coffre/CLAUDE.md`, « pourquoi PAS `APP_KEY` »).
 *
 * ⚠️ **Le test porte sur `passphrase`, et ce choix est le nerf du fichier.** C'est un nom que la
 * liste du vendeur ne connaît pas : un test écrit sur `password` passerait au vert sans notre
 * correctif, la liste en dur suffisant à l'exclure. Seul un champ hors liste prouve que c'est
 * bien *notre* mécanisme qui ferme.
 *
 * ⚠️ **Le plancher n'est pas décoratif.** Écraser l'input rejoué se fait à un cheveu d'écraser
 * *aussi* les messages d'erreur : sans l'assertion « les erreurs sont toujours là », un correctif
 * qui aurait cassé l'affichage des erreurs de formulaire passerait au vert.
 */
test.group('Validation / ce qui repart dans la session', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un champ secret n’est jamais rejoué dans la session sur une erreur de validation', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    await createVault(user)

    // `code` échoue au validateur (six chiffres attendus) : la passphrase, elle, est valide et
    // n'a aucune raison d'être renvoyée où que ce soit.
    const response = await client
      .post('/coffre/ouvrir')
      .form({ code: 'pas-un-code', passphrase: PASSPHRASE })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    // ⚠️ **Le corps rejoué s'étale à la RACINE du bagage de flash**, il ne se range pas sous une
    // clé `input` — c'est ce qui fait marcher `old('champ')` côté Edge. Chercher `flashed.input`
    // rendrait `undefined`, et l'assertion passerait au vert sans avoir rien regardé.
    const flashed = response.flashMessages() as Record<string, unknown>

    assert.notProperty(flashed, 'passphrase')
    // Et pas davantage sous une autre clé : c'est la VALEUR qui ne doit pas voyager.
    assert.notInclude(JSON.stringify(flashed), PASSPHRASE)
  })

  test('⚠️ plancher — les messages d’erreur, eux, sont bien flashés', async ({
    client,
    assert,
  }) => {
    // Sans ce test, un correctif qui viderait la totalité du bagage de flash — erreurs comprises —
    // rendrait le précédent vert en ayant cassé l'affichage des erreurs de tous les formulaires.
    const user = await createUserWith(['coffre.view'])
    await createVault(user)

    const response = await client
      .post('/coffre/ouvrir')
      .form({ code: 'pas-un-code', passphrase: PASSPHRASE })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    const flashed = response.flashMessages() as Record<string, unknown>

    assert.property(flashed, 'errors')
    assert.property(flashed.errors as object, 'code')
  })
})
