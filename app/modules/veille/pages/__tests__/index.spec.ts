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
function mediaItem(id: number, title: string) {
  return {
    id,
    type: 'video',
    veilleSourceId: null,
    url: null,
    title,
    content: null,
    tags: [] as string[],
    metadata: null,
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

function mountIndex() {
  return mount(Index, {
    props: baseProps(),
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
