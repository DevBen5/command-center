import { test } from '@japa/runner'
import { parseByteRange } from '#modules/coffre/services/byte_range'

/** Le parseur de l'en-tête `Range` (CC-181) — pur, aucune dépendance au disque ni à la requête. */
test.group('Coffre / le parseur de plage', () => {
  const SIZE = 1000

  test('une plage simple se lit telle quelle', ({ assert }) => {
    assert.deepEqual(parseByteRange('bytes=0-99', SIZE), { start: 0, end: 99 })
  })

  test("une plage ouverte (`start-`) va jusqu'à la fin", ({ assert }) => {
    assert.deepEqual(parseByteRange('bytes=900-', SIZE), { start: 900, end: 999 })
  })

  test('une plage en suffixe (`-N`) rend les N derniers octets', ({ assert }) => {
    assert.deepEqual(parseByteRange('bytes=-100', SIZE), { start: 900, end: 999 })
  })

  test('un suffixe plus grand que la taille est borné au début du fichier', ({ assert }) => {
    assert.deepEqual(parseByteRange('bytes=-5000', SIZE), { start: 0, end: 999 })
  })

  test('une fin déclarée au-delà de la taille est bornée', ({ assert }) => {
    assert.deepEqual(parseByteRange('bytes=0-999999', SIZE), { start: 0, end: 999 })
  })

  test('`start` au-delà de la taille est refusé', ({ assert }) => {
    assert.isNull(parseByteRange('bytes=1000-1001', SIZE))
  })

  test('`start` après `end` est refusé', ({ assert }) => {
    assert.isNull(parseByteRange('bytes=100-50', SIZE))
  })

  test('un suffixe nul est refusé — aucun octet demandé', ({ assert }) => {
    assert.isNull(parseByteRange('bytes=-0', SIZE))
  })

  test('⚠️ un multi-range est refusé, jamais traité comme la première plage', ({ assert }) => {
    assert.isNull(parseByteRange('bytes=0-10,20-30', SIZE))
  })

  test('une syntaxe hors `bytes=` est refusée', ({ assert }) => {
    assert.isNull(parseByteRange('items=0-10', SIZE))
  })

  test('une valeur non numérique est refusée', ({ assert }) => {
    assert.isNull(parseByteRange('bytes=abc-def', SIZE))
  })

  test('aucune plage sur une ressource de taille nulle', ({ assert }) => {
    assert.isNull(parseByteRange('bytes=0-0', 0))
  })
})
