import { test } from '@japa/runner'
import { groupEntriesByNature, type SectionableEntry } from '#modules/coffre/shared/entry_sections'

/*
|--------------------------------------------------------------------------
| CC-204 — le regroupement de l'écran du coffre par nature
|--------------------------------------------------------------------------
| Le regroupement vit dans une fonction pure (`shared/entry_sections.ts`) précisément pour être
| atteignable ici : `pages/index.vue` est hors de portée de Japa comme de Vitest sur ce dépôt (pas
| de test de composant sur les pages du coffre).
|
| ⚠️ Ce que ces tests ne voient PAS : le rendu réel des en-têtes de section, leur position à
| l'écran — jsdom ne fait aucun layout, ce poste n'a aucun outil de pilotage de navigateur.
*/

function entry(
  over: Partial<SectionableEntry> & { id: number }
): SectionableEntry & { id: number } {
  return { type: 'note', media: [], nasFiles: [], ...over }
}

test.group('Coffre — regroupement par nature', () => {
  test('chaque type sans média va dans sa propre section', ({ assert }) => {
    const sections = groupEntriesByNature([
      entry({ id: 1, type: 'note' }),
      entry({ id: 2, type: 'url' }),
      entry({ id: 3, type: 'credential' }),
    ])

    assert.deepEqual(
      sections.map((s) => s.key),
      ['note', 'url', 'credential']
    )
    assert.deepEqual(
      sections.map((s) => s.entries.map((e) => e.id)),
      [[1], [2], [3]]
    )
  })

  test('l’ordre des sections est FIXE — notes, liens, identifiants, photos', ({ assert }) => {
    // Entrées postées dans le désordre : la section « credential » doit rester après « url »,
    // pas dans l'ordre d'apparition des entrées.
    const sections = groupEntriesByNature([
      entry({ id: 1, type: 'credential' }),
      entry({ id: 2, type: 'note' }),
      entry({ id: 3, type: 'url' }),
    ])

    assert.deepEqual(
      sections.map((s) => s.key),
      ['note', 'url', 'credential']
    )
  })

  test('un média Immich fait primer « photo » sur le type déclaré', ({ assert }) => {
    const sections = groupEntriesByNature([
      entry({ id: 1, type: 'credential', media: [{ id: 10 }] }),
    ])

    assert.deepEqual(
      sections.map((s) => s.key),
      ['photo']
    )
    assert.equal(sections[0].entries[0].id, 1)
  })

  test('un fichier NAS fait aussi primer « photo » sur le type déclaré', ({ assert }) => {
    const sections = groupEntriesByNature([
      entry({ id: 1, type: 'note', nasFiles: [{ id: 20, kind: 'video' }] }),
    ])

    assert.deepEqual(
      sections.map((s) => s.key),
      ['photo']
    )
  })

  test('média Immich ET fichier NAS sur la même entrée ne créent qu’une seule section', ({
    assert,
  }) => {
    const sections = groupEntriesByNature([
      entry({ id: 1, type: 'url', media: [{ id: 10 }], nasFiles: [{ id: 20, kind: 'photo' }] }),
    ])

    assert.equal(sections.length, 1)
    assert.equal(sections[0].key, 'photo')
    assert.equal(sections[0].entries.length, 1)
  })

  test('une section sans entrée est ABSENTE du résultat, jamais rendue vide', ({ assert }) => {
    const sections = groupEntriesByNature([entry({ id: 1, type: 'note' })])

    assert.deepEqual(
      sections.map((s) => s.key),
      ['note']
    )
    assert.isUndefined(sections.find((s) => s.key === 'url'))
    assert.isUndefined(sections.find((s) => s.key === 'credential'))
    assert.isUndefined(sections.find((s) => s.key === 'photo'))
  })

  test('aucune entrée → aucune section', ({ assert }) => {
    assert.deepEqual(groupEntriesByNature([]), [])
  })

  test('l’ordre interne d’une section suit l’ordre d’arrivée, sans re-tri', ({ assert }) => {
    // La fonction ne trie pas : elle suppose `created_at desc` déjà appliqué par le serveur.
    const sections = groupEntriesByNature([
      entry({ id: 3, type: 'note' }),
      entry({ id: 1, type: 'note' }),
      entry({ id: 2, type: 'note' }),
    ])

    assert.deepEqual(
      sections[0].entries.map((e) => e.id),
      [3, 1, 2]
    )
  })

  test('chaque entrée apparaît exactement une fois — aucune perte, aucun doublon', ({ assert }) => {
    const input = [
      entry({ id: 1, type: 'note' }),
      entry({ id: 2, type: 'url', media: [{ id: 10 }] }),
      entry({ id: 3, type: 'credential' }),
      entry({ id: 4, type: 'note', nasFiles: [{ id: 20, kind: 'photo' }] }),
      entry({ id: 5, type: 'credential', media: [{ id: 11 }] }),
    ]

    const sections = groupEntriesByNature(input)
    const seen = sections.flatMap((s) => s.entries.map((e) => e.id))

    assert.sameMembers(seen, [1, 2, 3, 4, 5])
    assert.equal(seen.length, input.length)
  })
})
