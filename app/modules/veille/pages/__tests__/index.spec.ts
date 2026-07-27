import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import Index from '../index.vue'

/*
| La seule *logique* d'affichage introduite par l'externalisation i18n (CC-92) : la pluralisation
| de la barre de sélection. Les libellés `sélectionné{{ >1?'s' }}` et `média{{ >1?'s' }}` passent
| désormais par la pluralisation vue-i18n — un message à deux formes `"{n} sélectionné | {n} sélectionnés"`.
|
| ⚠️ La barre n'apparaît que lorsque `selection.total > 0` : le cas 0 (le piège du test Services,
| où la règle par défaut mappe 0 → pluriel) est ici **inatteignable**. Le seul point qui régresse
| en silence est donc la frontière 1 ↔ 2 — et c'est lui que ce test verrouille.
|
| ⚠️ On reproduit le **geste réel** (cocher une case), pas un état de montage : `selected` démarre
| vide, la barre est absente, monter-puis-assertir ne prouverait rien (piège CLAUDE.md).
|
| ⚠️ L'instance i18n embarque le namespace `veille` : sans lui, `t('veille.index.…')` rendrait la
| clé brute et l'assertion échouerait sur la mauvaise cause.
*/

vi.mock('@inertiajs/vue3', () => ({
  Head: { props: ['title'], template: '<div><slot /></div>' },
  Link: { props: ['href'], template: '<a><slot /></a>' },
  router: { post: vi.fn(), get: vi.fn() },
}))

/** Un item média (vidéo) : `selection.media` ne compte que ceux-là. */
function mediaItem(id: number, title: string, metadata: Record<string, unknown> | null = null) {
  return {
    id,
    type: 'video',
    veilleSourceId: null,
    url: null,
    title,
    content: null,
    tags: [] as string[],
    metadata,
    readingQueue: false,
    publishedAt: null,
    readAt: null,
    unavailableAt: null,
    immichAssetId: `uuid-${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

/** Des props fraîches à chaque montage, pour qu'un test n'hérite pas de l'état d'un autre. */
function baseProps() {
  return {
    items: [mediaItem(1, 'Vidéo 1'), mediaItem(2, 'Vidéo 2')],
    pagination: { total: 2, perPage: 50, currentPage: 1, lastPage: 1 },
    stats: { total: 2, articles: 0, queue: 0, unread: 2, tags: 0 },
    tags: [] as string[],
    sources: [] as { id: number; title: string; active: boolean }[],
    filters: {
      type: null,
      tag: null,
      readingQueue: false,
      unread: false,
      search: null,
      sourceId: null,
    },
    immich: { configured: true, webBaseUrl: 'http://immich.test' },
    notification: null,
  }
}

function mountIndex(props: Record<string, unknown> = {}) {
  return mount(Index, {
    props: { ...baseProps(), ...props },
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: 'fr',
          fallbackLocale: 'fr',
          messages: { fr: { veille: fr } },
        }),
      ],
    },
  })
}

/** Le libellé « N sélectionné(s) » de la barre d'action, ou undefined tant qu'elle est absente. */
function selectedLabel(wrapper: ReturnType<typeof mountIndex>): string | undefined {
  return wrapper
    .findAll('span')
    .map((span) => span.text())
    .find((text) => /sélectionné/.test(text))
}

/** Le libellé « dont N média(s)… », ou undefined tant qu'aucun média n'est coché. */
function mediaLabel(wrapper: ReturnType<typeof mountIndex>): string | undefined {
  return wrapper
    .findAll('span')
    .map((span) => span.text())
    .find((text) => /média/.test(text))
}

/** La case d'un item — on saute la case « tout sélectionner » de l'en-tête (index 0). */
function itemCheckbox(wrapper: ReturnType<typeof mountIndex>, index: number) {
  return wrapper.findAll('input[type="checkbox"]')[index + 1]
}

describe('Veille / index — pluralisation de la sélection', () => {
  test('un seul élément sélectionné reste au singulier', async () => {
    const wrapper = mountIndex()
    await itemCheckbox(wrapper, 0).trigger('change')

    expect(selectedLabel(wrapper)).toBe('1 sélectionné')
    expect(mediaLabel(wrapper)).toContain('dont 1 média à')
  })

  test('deux éléments sélectionnés passent au pluriel', async () => {
    const wrapper = mountIndex()
    await itemCheckbox(wrapper, 0).trigger('change')
    await itemCheckbox(wrapper, 1).trigger('change')

    expect(selectedLabel(wrapper)).toBe('2 sélectionnés')
    expect(mediaLabel(wrapper)).toContain('dont 2 médias à')
  })
})

/*
| CC-103 — le nom de chaîne, et surtout **son séparateur**.
|
| ⚠️ C'est le seul endroit où « pas de puce orpheline » se prouve. `channelLabel` est testée
| séparément (`tests/unit/veille_media_item.spec.ts`), mais elle ne dit rien du template : c'est le
| `<template v-if>` qui décide si le `·` disparaît avec le nom, et lui seul. Sortir le séparateur de
| ce bloc laisserait « Vidéo · · 01/01 » sur tout item sans chaîne — un asset Immich, un article,
| toute vidéo collectée avant CC-87.
|
| ⚠️ L'assertion porte sur la ligne **entière, normalisée**, pas sur la présence du nom : chercher
| « Alex so yes » passerait aussi bien avec un séparateur en trop.
*/

/**
 * La ligne de métadonnées d'un item, **découpée sur ses séparateurs**, la date retirée.
 *
 * ⚠️ **La date est écartée volontairement**, pas par paresse : elle est formatée dans le fuseau de
 * la machine, donc `2026-01-01T00:00:00Z` se lit « 01 janv. » ici et « 31 déc. » à l'ouest de
 * Greenwich. L'asserter rendrait le test dépendant du poste, pour une valeur que ce lot ne touche
 * pas. Ce qui compte est ce qui reste : le **nombre de segments**, donc de séparateurs.
 */
function metaParts(wrapper: ReturnType<typeof mountIndex>, index: number): string[] {
  return wrapper
    .findAll('.flex-wrap.text-txt-3')
    [index].text()
    .split('·')
    .map((part) => part.trim())
    .slice(0, -1)
}

describe('Veille / index — le nom de chaîne', () => {
  test('affiche la chaîne entre le type et la date', () => {
    const wrapper = mountIndex({
      items: [mediaItem(1, 'Vidéo 1', { channelTitle: 'Alex so yes' })],
    })

    expect(metaParts(wrapper, 0)).toEqual(['Vidéo', 'Alex so yes'])
  })

  /**
   * ⚠️ **Le test du lot.** Un segment, donc un seul `·` dans la ligne. Sortir le séparateur du
   * `<template v-if>` rendrait `['Vidéo', '']` — la puce orpheline, visible à l'écran sur tout
   * asset Immich et tout article.
   */
  test('sans chaîne, le séparateur disparaît avec elle', () => {
    const wrapper = mountIndex({ items: [mediaItem(1, 'Vidéo 1')] })

    expect(metaParts(wrapper, 0)).toEqual(['Vidéo'])
  })

  /**
   * Le cas réel de la liste : les deux provenances se côtoient dans la même page, servies par la
   * même carte. Chacune doit rendre sa propre ligne.
   */
  test('les deux formes coexistent dans la même liste', () => {
    const wrapper = mountIndex({
      items: [
        mediaItem(1, 'Vidéo YouTube', { channelTitle: 'Kameto Live' }),
        mediaItem(2, 'Asset Immich'),
      ],
    })

    expect(metaParts(wrapper, 0)).toEqual(['Vidéo', 'Kameto Live'])
    expect(metaParts(wrapper, 1)).toEqual(['Vidéo'])
  })
})
