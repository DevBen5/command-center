import { test } from '@japa/runner'
import {
  filterPayload,
  isFilterEmpty,
  type SelectableFilters,
} from '#modules/veille/shared/filter_selection'

/**
 * CC-108 — ce que « agir sur tout ce que le filtre affiche » exige avant d'être permis.
 *
 * ⚠️ **`isFilterEmpty` est ce qui remplace le plafond de 200 identifiants de CC-63.** Ce n'est pas
 * une garde contre l'erreur de manipulation : c'est la seule chose qui empêche un geste de bonne
 * foi d'emporter toute la veille derrière un `confirm()` d'une ligne. La suppression est logique,
 * mais rien ne la défait depuis l'interface, et les assets Immich partent réellement à la
 * corbeille.
 */

function filters(attrs: Partial<SelectableFilters> = {}): SelectableFilters {
  return {
    type: null,
    tag: null,
    search: null,
    sourceId: null,
    readingQueue: false,
    unread: false,
    ...attrs,
  }
}

test.group('Veille / un filtre vide n’est pas un filtre', () => {
  test('rien de posé, rien de permis', ({ assert }) => {
    assert.isTrue(isFilterEmpty(filters()))
  })

  /**
   * ⚠️ **Chaque champ testé isolément.** Un test qui n'aurait vérifié que le cas « tout vide »
   * passerait sur une implémentation qui ne regarde qu'un seul champ — et le geste serait alors
   * permis sur cinq filtres sur six.
   */
  test('un seul filtre suffit à ouvrir le geste', ({ assert }) => {
    assert.isFalse(isFilterEmpty(filters({ type: 'article' })))
    assert.isFalse(isFilterEmpty(filters({ tag: 'ia' })))
    assert.isFalse(isFilterEmpty(filters({ search: 'rust' })))
    assert.isFalse(isFilterEmpty(filters({ sourceId: 5 })))
    assert.isFalse(isFilterEmpty(filters({ sourceId: 'none' })))
    assert.isFalse(isFilterEmpty(filters({ readingQueue: true })))
    assert.isFalse(isFilterEmpty(filters({ unread: true })))
  })

  /**
   * ⚠️ `applyFilters` retire de l'URL tout ce qui vaut `null`, `false` ou `''`, mais une chaîne
   * vide peut arriver d'ailleurs — un champ de recherche effacé sans être validé, une URL tapée à
   * la main. Elle ne filtre rien, donc elle n'autorise rien.
   */
  test('une chaîne vide ne filtre rien, donc n’autorise rien', ({ assert }) => {
    assert.isTrue(isFilterEmpty(filters({ type: '', tag: '', search: '' })))
  })
})

test.group('Veille / la charge utile du filtre', () => {
  /**
   * ⚠️ **Une seule forme, deux transports.** Le décompte part en query string, la suppression en
   * corps de requête. Deux constructions permettraient à ce qui est compté de différer de ce qui
   * est supprimé — et l'écart ne se verrait qu'après coup.
   */
  test('tout est en chaînes, ce que la query string sait porter', ({ assert }) => {
    const payload = filterPayload(
      filters({ type: 'video', tag: 'ia', search: 'rust', sourceId: 5, unread: true })
    )

    assert.deepEqual(payload, {
      type: 'video',
      tag: 'ia',
      search: 'rust',
      sourceId: '5',
      unread: 'true',
    })
  })

  test('la sentinelle traverse telle quelle', ({ assert }) => {
    // `String('none')` rend la sentinelle, `String(5)` l'identifiant : la même ligne porte les
    // deux, et le serveur les retranche par `parseSourceFilter`.
    assert.equal(filterPayload(filters({ sourceId: 'none' })).sourceId, 'none')
  })

  /**
   * ⚠️ **Seuls les filtres actifs y figurent**, comme dans `applyFilters` : un champ absent, et
   * jamais un champ présent-et-vide. C'est ce qui fait qu'`isFilterEmpty` et `filterPayload` ne
   * peuvent pas se contredire — un filtre jugé vide produit une charge utile vide, que le serveur
   * jugera vide à son tour.
   */
  test('un filtre inactif est absent, jamais présent et vide', ({ assert }) => {
    assert.deepEqual(filterPayload(filters()), {})
    assert.deepEqual(filterPayload(filters({ type: '', readingQueue: false })), {})
  })

  test('les bascules ne partent que quand elles sont posées', ({ assert }) => {
    assert.deepEqual(filterPayload(filters({ readingQueue: true, unread: true })), {
      readingQueue: 'true',
      unread: 'true',
    })
  })
})
