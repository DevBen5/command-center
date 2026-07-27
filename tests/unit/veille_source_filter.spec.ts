import { test } from '@japa/runner'
import { NO_SOURCE, parseSourceFilter } from '#modules/veille/shared/source_filter'

/**
 * CC-105 — le filtre par source a **trois** états, et c'est ce parse qui les porte.
 *
 * ⚠️ Ce qu'il remplace : `Number(request.input('sourceId')) || null`. Cette forme-là ne peut pas
 * exprimer un troisième état, et sa manière d'échouer est muette — `Number('none')` vaut `NaN`,
 * donc `NaN || null` vaut `null`, donc **aucun filtre n'est posé**. La liste ne change pas, rien
 * n'est levé, et l'écran est indiscernable d'un filtre qui ne trouverait rien.
 */
test.group('Veille / le filtre par source', () => {
  test('la sentinelle désigne les items sans source', ({ assert }) => {
    assert.equal(parseSourceFilter('none'), NO_SOURCE)
  })

  test('un identifiant reste un identifiant, chaîne ou nombre', ({ assert }) => {
    // Un paramètre d'URL arrive toujours en chaîne ; les tests et le code appellent aussi ce
    // parse avec un vrai nombre.
    assert.equal(parseSourceFilter('5'), 5)
    assert.equal(parseSourceFilter(5), 5)
  })

  /**
   * ⚠️ **LE test du ticket.** `Number('0') || null` valait `null` : `0` subissait exactement le
   * sort de `'none'`. Sans conséquence tant qu'aucun identifiant ne vaut zéro — et fatal le jour
   * où quelqu'un choisit `0` comme sentinelle, puisque `applyFilters` le retirerait *aussi* de
   * l'URL. C'est la raison pour laquelle la sentinelle est une chaîne, et ce test est là pour que
   * la raison ne se perde pas.
   */
  test('zéro n’est pas un identifiant, et n’est pas la sentinelle non plus', ({ assert }) => {
    assert.isNull(parseSourceFilter('0'))
    assert.isNull(parseSourceFilter(0))
  })

  test('une URL tapée à la main ne filtre rien, elle ne casse pas', ({ assert }) => {
    // Aucune de ces valeurs ne doit lever : une query string bricolée rend la liste complète,
    // ce qui est le comportement le moins surprenant.
    assert.isNull(parseSourceFilter(undefined))
    assert.isNull(parseSourceFilter(null))
    assert.isNull(parseSourceFilter(''))
    assert.isNull(parseSourceFilter('abc'))
    assert.isNull(parseSourceFilter('-1'))
    assert.isNull(parseSourceFilter('5.5'))
    assert.isNull(parseSourceFilter([]))
  })

  /**
   * ⚠️ La comparaison est stricte, pas un `startsWith` ni un `trim`. `'none '` n'est pas la
   * sentinelle : ce que la page pose est exact, et tout le reste vient d'une URL bricolée.
   */
  test('la sentinelle ne s’approche pas, elle s’écrit', ({ assert }) => {
    assert.isNull(parseSourceFilter('none '))
    assert.isNull(parseSourceFilter('None'))
    assert.isNull(parseSourceFilter('nonexistent'))
  })
})
