import { test } from '@japa/runner'
import {
  BULK_ACTIONS,
  bulkNotification,
  isBulkAction,
  requiresTag,
} from '#modules/veille/shared/bulk_actions'

/**
 * CC-109 — ce que les actions groupées permettent, et ce que leur retour annonce.
 *
 * ⚠️ **Deux tons, jamais trois.** La suppression en a un troisième parce qu'elle écrit dans Immich
 * et peut échouer à mi-chemin ; aucune de ces actions ne sort de Command Center. Un `UPDATE` qui
 * lève remonte en 500, il n'a pas de ton.
 */
test.group('Veille / les actions groupées', () => {
  test('seules les deux actions de tag en demandent un', ({ assert }) => {
    assert.isTrue(requiresTag('tag.add'))
    assert.isTrue(requiresTag('tag.remove'))

    for (const action of ['read', 'unread', 'queue.add', 'queue.remove'] as const) {
      assert.isFalse(requiresTag(action), `${action} ne devrait pas exiger de tag`)
    }
  })

  test('la liste est fermée', ({ assert }) => {
    assert.isTrue(isBulkAction('read'))
    assert.isFalse(isBulkAction('delete'))
    assert.isFalse(isBulkAction(''))
    assert.isFalse(isBulkAction(null))
  })

  /**
   * ⚠️ **Le ton `info` n'est pas du décor, et le cas arrive pour de vrai** : marquer lu une
   * sélection déjà lue, retirer un tag qu'aucun item ne porte, un second onglet passé avant.
   * Sans message, le bouton paraît cassé — et le réflexe est de recliquer, ce qui ne changera
   * rien non plus.
   */
  test('zéro ligne touchée n’est ni un succès ni une erreur', ({ assert }) => {
    for (const action of BULK_ACTIONS) {
      const notification = bulkNotification(action, 0)

      assert.equal(notification.type, 'info', `${action} devrait rendre un constat`)
      assert.isNotEmpty(notification.message, `${action} ne doit jamais rester muet`)
    }
  })

  /**
   * ⚠️ **Chaque action a son propre message dans les deux cas.** Un libellé partagé du genre
   * « action appliquée » laisserait un ton `info` indiscernable d'un autre : « rien à faire » sur
   * un tag absent et sur une sélection déjà lue n'appellent pas le même geste correctif.
   */
  test('chaque action parle d’elle-même, dans les deux tons', ({ assert }) => {
    const faits = new Set(BULK_ACTIONS.map((action) => bulkNotification(action, 3).message))
    const riens = new Set(BULK_ACTIONS.map((action) => bulkNotification(action, 0).message))

    assert.lengthOf([...faits], BULK_ACTIONS.length)
    assert.lengthOf([...riens], BULK_ACTIONS.length)
  })

  /**
   * ⚠️ **Le compte annoncé est celui des lignes RÉELLEMENT modifiées**, jamais la taille de la
   * sélection. Les deux diffèrent dès qu'une partie était déjà dans l'état visé, et annoncer la
   * seconde ferait croire à un effet qui n'a pas eu lieu.
   */
  test('le compte et son pluriel', ({ assert }) => {
    assert.include(bulkNotification('read', 1).message, '1 élément ')
    assert.include(bulkNotification('read', 12).message, '12 éléments')
    assert.equal(bulkNotification('read', 12).type, 'success')
  })
})
