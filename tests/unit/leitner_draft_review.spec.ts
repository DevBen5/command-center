import { test } from '@japa/runner'
import {
  correctionOf,
  halfClassified,
  isDirty,
  themesFor,
  type EditedDraft,
  type StoredDraft,
} from '#modules/leitner/shared/draft_review'

/*
|--------------------------------------------------------------------------
| CC-60 — la relecture des brouillons d'ingestion (`pages/ingest_show.vue`)
|--------------------------------------------------------------------------
| Ces prédicats vivaient dans le `<script setup>`, donc hors de portée de Japa.
| `isDirty` décide si le bouton *Enregistrer* existe, `halfClassified` si un
| brouillon est signalé comme mal classé : deux décisions qui régressent en silence.
|
| ⚠️ Ce que ces tests ne voient PAS : le `TaxonomyCombobox` lui-même (il a son
| propre test de composant), le câblage du template, et les enveloppes de la page
| qui résolvent un id vers `edited[id]`.
*/

function edited(over: Partial<EditedDraft> = {}): EditedDraft {
  return { front: 'Recto', back: 'Verso', category: '', theme: '', ...over }
}

function stored(over: Partial<StoredDraft> = {}): StoredDraft {
  return { id: 1, front: 'Recto', back: 'Verso', category: null, theme: null, ...over }
}

test.group('Leitner — brouillon à moitié classé', () => {
  test('une catégorie sans thème est signalée, et réciproquement', ({ assert }) => {
    // Le thème seul n'a pas de sens : il appartient toujours à une catégorie.
    assert.isTrue(halfClassified(edited({ category: 'DevOps', theme: '' })))
    assert.isTrue(halfClassified(edited({ category: '', theme: 'Docker' })))
  })

  test('les deux ensemble, ou aucun des deux, ne sont pas signalés', ({ assert }) => {
    assert.isFalse(halfClassified(edited({ category: 'DevOps', theme: 'Docker' })))
    // Une carte non classée est un cas légitime, pas une erreur.
    assert.isFalse(halfClassified(edited({ category: '', theme: '' })))
  })

  test('des espaces seuls ne valent pas un nom', ({ assert }) => {
    assert.isTrue(halfClassified(edited({ category: '   ', theme: 'Docker' })))
    assert.isFalse(halfClassified(edited({ category: '   ', theme: '  ' })))
  })
})

test.group('Leitner — thèmes proposés sous une catégorie', () => {
  const categories = [
    { name: 'DevOps', themes: [{ name: 'Docker' }, { name: 'Kubernetes' }] },
    { name: 'Sécurité', themes: [{ name: 'TLS' }] },
  ]

  test('la casse et les espaces sont ignorés', ({ assert }) => {
    assert.deepEqual(themesFor(categories, 'devops'), ['Docker', 'Kubernetes'])
    assert.deepEqual(themesFor(categories, '  DevOps  '), ['Docker', 'Kubernetes'])
  })

  test('une catégorie inventée n’a, par définition, aucun thème existant', ({ assert }) => {
    // Il sera créé à la volée à la validation — ne rien suggérer est le comportement voulu.
    assert.deepEqual(themesFor(categories, 'Réseau'), [])
  })

  test('sans catégorie choisie, il n’y a rien à suggérer', ({ assert }) => {
    assert.deepEqual(themesFor(categories, ''), [])
    assert.deepEqual(themesFor(categories, '   '), [])
  })
})

test.group('Leitner — la correction en cours', () => {
  test('une taxonomie vide se rend null, jamais une chaîne vide', ({ assert }) => {
    // C'est ce que le serveur attend, ET ce qui fait tenir la comparaison d'`isDirty`.
    const correction = correctionOf(7, edited({ category: '  ', theme: '' }))

    assert.deepEqual(correction, {
      id: 7,
      front: 'Recto',
      back: 'Verso',
      category: null,
      theme: null,
    })
  })

  test('les noms sont débarrassés de leurs espaces', ({ assert }) => {
    const correction = correctionOf(7, edited({ category: ' DevOps ', theme: ' Docker ' }))

    assert.equal(correction.category, 'DevOps')
    assert.equal(correction.theme, 'Docker')
  })
})

/*
|--------------------------------------------------------------------------
| `isDirty` — le prédicat à mode d'échec silencieux
|--------------------------------------------------------------------------
| La base stocke `null` pour un brouillon non classé, la copie éditable manipule
| `''`. Comparer les deux valeurs brutes est TOUJOURS vrai : le bouton
| *Enregistrer* resterait allumé en permanence sur tout brouillon non classé.
| C'est le même piège que `isScheduleDirty` côté veille, sur une autre paire.
*/
test.group('Leitner — y a-t-il quelque chose à enregistrer ?', () => {
  test('un brouillon non classé et non touché n’est PAS modifié', ({ assert }) => {
    // Le test qui porte ce prédicat : `'' !== null` ferait rougir l'assertion.
    assert.isFalse(isDirty(stored({ category: null, theme: null }), edited()))
  })

  test('un brouillon classé et non touché n’est pas modifié non plus', ({ assert }) => {
    const original = stored({ category: 'DevOps', theme: 'Docker' })

    assert.isFalse(isDirty(original, edited({ category: 'DevOps', theme: 'Docker' })))
  })

  test('chacun des quatre champs suffit à rendre le brouillon modifié', ({ assert }) => {
    const original = stored({ category: 'DevOps', theme: 'Docker' })
    const untouched = { category: 'DevOps', theme: 'Docker' }

    assert.isTrue(isDirty(original, edited({ ...untouched, front: 'Autre recto' })))
    assert.isTrue(isDirty(original, edited({ ...untouched, back: 'Autre verso' })))
    assert.isTrue(isDirty(original, edited({ ...untouched, category: 'Cloud' })))
    assert.isTrue(isDirty(original, edited({ ...untouched, theme: 'Podman' })))
  })

  test('vider la taxonomie d’un brouillon classé est une modification', ({ assert }) => {
    const original = stored({ category: 'DevOps', theme: 'Docker' })

    assert.isTrue(isDirty(original, edited({ category: '', theme: '' })))
  })
})
