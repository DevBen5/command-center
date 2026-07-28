import { test } from '@japa/runner'
import {
  activeFilters,
  clearAllPatch,
  type FiltersView,
} from '#modules/veille/shared/active_filters'

/**
 * CC-65 — le rappel des filtres actifs, sorti du `<script setup>` (règle CC-60).
 *
 * ⚠️ **C'est la SEULE partie testable de ce lot.** Le reste — le langage visuel unifié, l'état
 * d'une source désactivée — est du décor : la règle du dépôt interdit d'asserter une classe CSS,
 * et jsdom ne fait de toute façon aucun layout. Ça se vérifie au navigateur, et nulle part
 * ailleurs.
 *
 * ⚠️ **Un test qui n'asserterait que le cas vide ne prouverait rien** : `[]` est aussi ce que
 * rendrait une implémentation qui ne détecte jamais rien. D'où les deux sens — le vide, et
 * chaque champ pris isolément.
 */

const SOURCES = [
  { id: 4, title: 'Immich — album de veille' },
  { id: 5, title: 'Korben- Full' },
]

function filters(attrs: Partial<FiltersView> = {}): FiltersView {
  return {
    type: null,
    tag: null,
    search: null,
    sourceId: null,
    unread: false,
    readingQueue: false,
    ...attrs,
  }
}

test.group('Veille / les filtres actifs', () => {
  test('sans filtre, il n’y a rien à rappeler', ({ assert }) => {
    assert.isEmpty(activeFilters(filters(), SOURCES))
  })

  test('un type posé se nomme par sa clé de traduction', ({ assert }) => {
    const [chip] = activeFilters(filters({ type: 'article' }), SOURCES)

    assert.equal(chip.field, 'type')
    assert.equal(chip.labelKey, 'veille.index.filters.chip.type')
    // Les types sont un ensemble fermé, déjà traduit ailleurs : la clé se dérive du nom.
    assert.equal(chip.valueKey, 'veille.index.types.article')
    assert.isNull(chip.valueText)
    assert.deepEqual(chip.patch, { type: null })
  })

  test('une source posée se nomme par son titre, qui vient de la base', ({ assert }) => {
    const [chip] = activeFilters(filters({ sourceId: 5 }), SOURCES)

    assert.equal(chip.field, 'sourceId')
    assert.isNull(chip.valueKey)
    assert.equal(chip.valueText, 'Korben- Full')
  })

  test('la sentinelle « sans source » se traduit, elle ne s’invente pas', ({ assert }) => {
    const [chip] = activeFilters(filters({ sourceId: 'none' }), SOURCES)

    assert.equal(chip.valueKey, 'veille.index.filters.noSource')
    assert.isNull(chip.valueText)
    assert.deepEqual(chip.patch, { sourceId: null })
  })

  /**
   * ⚠️ **Le repli ne masque jamais** — même raisonnement que `item_provenance`. Un chip sans
   * valeur serait à la fois inexplicable et impossible à relier au filtre qu'il retire.
   * Inatteignable aujourd'hui (`ON DELETE SET NULL`, et `index` charge toutes les sources), mais
   * c'est le genre de garantie qu'un `where('active', true)` défait sans le dire.
   */
  test('une source introuvable affiche son identifiant plutôt que rien', ({ assert }) => {
    const [chip] = activeFilters(filters({ sourceId: 999 }), SOURCES)

    assert.equal(chip.valueText, '#999')
  })

  test('un tag et une recherche portent leur texte brut', ({ assert }) => {
    const [tag] = activeFilters(filters({ tag: 'ia' }), SOURCES)
    assert.equal(tag.valueText, 'ia')
    assert.deepEqual(tag.patch, { tag: null })

    const [search] = activeFilters(filters({ search: 'rust' }), SOURCES)
    assert.equal(search.valueText, 'rust')
    assert.deepEqual(search.patch, { search: null })
  })

  /**
   * ⚠️ Les deux bascules se retirent par `false`, pas par `null` : `applyFilters` traite les
   * deux pareil pour l'URL, mais la prop `filters` est typée booléenne — un `null` y arriverait
   * en `false` par coïncidence, jusqu'au jour où quelqu'un teste `=== false`.
   */
  test('les bascules n’ont pas de valeur : leur nom est le libellé', ({ assert }) => {
    const [unread] = activeFilters(filters({ unread: true }), SOURCES)
    assert.equal(unread.labelKey, 'veille.index.filters.unreadOnly')
    assert.isNull(unread.valueKey)
    assert.isNull(unread.valueText)
    assert.deepEqual(unread.patch, { unread: false })

    const [queue] = activeFilters(filters({ readingQueue: true }), SOURCES)
    assert.equal(queue.labelKey, 'veille.index.filters.readingQueue')
    assert.deepEqual(queue.patch, { readingQueue: false })
  })

  /**
   * ⚠️ **L'ordre est fixe, et ce n'est pas cosmétique.** Dérivé de l'ordre d'insertion, il
   * changerait selon le filtre posé en dernier : les chips sauteraient de place entre deux
   * navigations, et une cible qui bouge sous le curseur fait cliquer sur le mauvais ✕.
   */
  test('tous les filtres posés sortent dans un ordre fixe', ({ assert }) => {
    const tous = activeFilters(
      filters({
        type: 'video',
        tag: 'ia',
        search: 'rust',
        sourceId: 4,
        unread: true,
        readingQueue: true,
      }),
      SOURCES
    )

    assert.deepEqual(
      tous.map((chip) => chip.field),
      ['type', 'sourceId', 'tag', 'search', 'unread', 'readingQueue']
    )
  })

  /**
   * `applyFilters` retire de l'URL tout ce qui vaut `null`, `false` ou `''` — une chaîne vide
   * arrive donc quand on efface le champ de recherche sans valider. Elle ne doit pas produire un
   * chip vide, cliquable et sans effet.
   */
  test('une chaîne vide n’est pas un filtre posé', ({ assert }) => {
    assert.isEmpty(activeFilters(filters({ type: '', tag: '', search: '' }), SOURCES))
  })

  /**
   * ⚠️ **LE cas que des `null` explicites ne peuvent pas attraper.** `request.input('type')` rend
   * `undefined` quand le paramètre est absent, et `JSON.stringify` **supprime les clés
   * `undefined`** : la prop arrive donc sans le champ du tout. Un test `!== null` y répond vrai,
   * et une chip s'affiche alors qu'aucun filtre n'est posé — visible à l'écran, invisible à toute
   * fixture construite avec des `null`.
   *
   * Le contrôleur normalise en `null` depuis CC-108 ; ceci est la seconde barrière, et elle est
   * là parce que la première est une ligne qu'on peut défaire sans s'en apercevoir.
   */
  test('un champ absent n’est pas un filtre posé', ({ assert }) => {
    assert.isEmpty(activeFilters({}, SOURCES))
    assert.isEmpty(activeFilters({ type: undefined, tag: undefined, sourceId: undefined }, SOURCES))
  })

  test('« tout effacer » fusionne les patchs de ce qui est posé', ({ assert }) => {
    const posed = activeFilters(filters({ type: 'note', tag: 'ia', unread: true }), SOURCES)

    assert.deepEqual(clearAllPatch(posed), { type: null, tag: null, unread: false })
  })

  test('« tout effacer » sur rien ne demande rien', ({ assert }) => {
    assert.deepEqual(clearAllPatch([]), {})
  })
})
