import { test } from '@japa/runner'
import {
  confirmationMessage,
  summarizeSelection,
  toggleAll,
  toggleSelected,
  type SelectableItem,
} from '#modules/veille/shared/item_selection'

/**
 * CC-63 — la logique de sélection de `pages/index.vue`, sortie du `<script setup>` (doctrine
 * CC-60). Japa importe des `.ts` et n'a aucun compilateur Vue : ce qui reste dans un
 * `<script setup>` est structurellement hors de portée de la suite.
 *
 * Ce qui compte ici, c'est **le message de confirmation** : c'est le seul garde-fou entre un clic
 * et trente photos parties à la corbeille d'Immich.
 *
 * Ce que ce fichier ne voit **pas** : le template, et les enveloppes de la page — la couture que
 * l'extraction crée.
 */
test.group('Veille / sélection multiple (CC-63)', () => {
  const items: SelectableItem[] = [
    { id: 1, type: 'article' },
    { id: 2, type: 'image' },
    { id: 3, type: 'video' },
    { id: 4, type: 'note' },
  ]

  test('cocher puis décocher rend une liste, jamais une mutation', ({ assert }) => {
    const une = toggleSelected([], 2)
    assert.deepEqual(une, [2])

    const deux = toggleSelected(une, 3)
    assert.deepEqual(deux, [2, 3])

    // Le geste inverse doit être exactement symétrique — un `push` réactif ne l'est pas.
    assert.deepEqual(toggleSelected(deux, 2), [3])
    // L'entrée n'est pas modifiée en place.
    assert.deepEqual(une, [2])
  })

  test('tout cocher porte sur la page affichée, et rebascule quand tout est coché', ({
    assert,
  }) => {
    assert.deepEqual(toggleAll([], items), [1, 2, 3, 4])
    // Une sélection partielle complète, elle ne vide pas.
    assert.deepEqual(toggleAll([2], items), [1, 2, 3, 4])
    // Tout coché → tout décoché.
    assert.deepEqual(toggleAll([1, 2, 3, 4], items), [])
  })

  test('le résumé ne compte que les items réellement affichés', ({ assert }) => {
    /**
     * ⚠️ Le cas qui porte cette fonction : un id resté sélectionné alors que la page a changé.
     * Sans le recoupement, le dialogue annoncerait un nombre que l'utilisateur ne peut pas
     * vérifier à l'écran — et le lot partirait sur des items qu'il ne voit plus.
     */
    const resume = summarizeSelection(items, [1, 2, 999])

    assert.equal(resume.total, 2)
    assert.equal(resume.media, 1)
  })

  test('le résumé sépare les médias du reste', ({ assert }) => {
    const resume = summarizeSelection(items, [1, 2, 3, 4])

    assert.equal(resume.total, 4)
    // `image` et `video` seulement — un article, un signet et une note n'ont pas d'asset derrière.
    assert.equal(resume.media, 2)
  })

  test('LE test du lot : la confirmation annonce les assets qui partent à la corbeille', ({
    assert,
  }) => {
    const message = confirmationMessage(summarizeSelection(items, [1, 2, 3]), 'selected')

    assert.isNotNull(message)
    assert.include(message!, '3 éléments')
    // ⚠️ Sans ce nombre, le dialogue laisserait croire qu'on ne touche qu'à Command Center.
    assert.include(message!, '2 assets')
    assert.include(message!, 'corbeille')
  })

  test('sans média, la confirmation ne parle pas d’Immich', ({ assert }) => {
    const message = confirmationMessage(summarizeSelection(items, [1, 4]), 'selected')

    assert.isNotNull(message)
    assert.include(message!, '2 éléments')
    // Annoncer une corbeille qui n'est pas concernée rendrait l'avertissement banal — et un
    // avertissement banal ne se lit plus quand il compte vraiment.
    assert.notInclude(message!, 'corbeille')
  })

  test('le singulier et le pluriel sont tenus des deux côtés', ({ assert }) => {
    const seul = confirmationMessage(summarizeSelection(items, [2]), 'selected')
    assert.include(seul!, '1 élément ')
    assert.include(seul!, '1 asset partira')

    const plusieurs = confirmationMessage(summarizeSelection(items, [2, 3]), 'selected')
    assert.include(plusieurs!, '2 éléments')
    assert.include(plusieurs!, '2 assets partiront')
  })

  test('une sélection vide ne demande aucune confirmation', ({ assert }) => {
    assert.isNull(confirmationMessage(summarizeSelection(items, []), 'selected'))
    // Un id qui ne correspond à rien d'affiché revient au même.
    assert.isNull(confirmationMessage(summarizeSelection(items, [999]), 'selected'))
  })
})

/*
| CC-108 — le geste passe de 50 items sous les yeux à *n* que personne n'a lus. Le dialogue est le
| dernier endroit où cette différence peut encore se voir.
*/
test.group('Veille / la confirmation distingue les deux gestes', () => {
  /**
   * ⚠️ **LE test du lot.** « 12 sélectionnés » et « les 12 que ce filtre désigne » ne décrivent
   * pas le même geste : le premier porte sur ce qu'on a coché, le second sur trois pages qu'on
   * n'a pas ouvertes. Les confondre est le moyen le plus simple de supprimer 317 items en croyant
   * en supprimer 12 — et sur le seul geste destructeur du module, la confusion est définitive.
   *
   * L'assertion porte sur les **deux sens** : le mot propre à chaque portée doit être là, et
   * celui de l'autre ne doit pas y être. Ne vérifier que la présence laisserait passer un message
   * qui les cumulerait.
   */
  test('les deux portées ne se ressemblent pas', ({ assert }) => {
    const summary = { total: 12, media: 0 }

    const coches = confirmationMessage(summary, 'selected')
    assert.include(coches!, 'sélectionnés')
    assert.notInclude(coches!, 'filtre')

    const filtres = confirmationMessage(summary, 'filtered')
    assert.include(filtres!, 'ce filtre désigne')
    assert.notInclude(filtres!, 'sélectionné')
  })

  /**
   * ⚠️ L'avertissement Immich ne dépend PAS de la portée : un asset part à la corbeille qu'il ait
   * été coché ou désigné par un filtre. Le distinguer ici ferait croire à deux mécaniques.
   */
  test('l’avertissement Immich vaut pour les deux', ({ assert }) => {
    const summary = { total: 30, media: 4 }

    for (const scope of ['selected', 'filtered'] as const) {
      const message = confirmationMessage(summary, scope)
      assert.include(message!, '4 assets partiront')
      assert.include(message!, 'corbeille')
    }
  })

  test('un filtre qui ne désigne rien ne demande aucune confirmation', ({ assert }) => {
    // Le cas réel : un second onglet a déjà vidé le filtre. Pas de dialogue pour un geste
    // sans effet — et surtout pas un dialogue annonçant « 0 élément ».
    assert.isNull(confirmationMessage({ total: 0, media: 0 }, 'filtered'))
  })
})
