import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import Catalog from '../catalog.vue'

/*
| CC-227 : la grille du catalogue porte de la vraie logique (débounce de la recherche, pagination,
| repli de vignette, message de throttle) — c'est ce qui justifie un test de composant plutôt qu'une
| relecture (CLAUDE.md racine : « un composant qui ne fait que disposer des <div> — non »).
|
| ⚠️ Chaque test reproduit le GESTE réel (taper, cliquer, déclencher `error`) plutôt que d'observer
| l'état de montage — piège nommé par le CLAUDE.md racine (TaxonomyCombobox).
*/

vi.mock('@inertiajs/vue3', () => ({
  Head: { props: ['title'], template: '<div><slot /></div>' },
  Link: { props: ['href'], template: '<a><slot /></a>' },
}))

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body }
}

function emptyPage(overrides: Partial<Record<string, unknown>> = {}) {
  return { items: [], page: 1, perPage: 30, total: 0, totalPages: 1, ...overrides }
}

function monter() {
  return mount(Catalog, {
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: 'fr',
          fallbackLocale: 'fr',
          messages: { fr: { coffre: fr } },
        }),
      ],
    },
  })
}

describe('Coffre / catalog — la grille', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  test('au montage, la page interroge /coffre/catalog/items en page 1 et affiche les résultats', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        emptyPage({
          items: [
            {
              id: 1,
              source: 'nas',
              nature: 'photo',
              displayName: 'plage',
              capturedAt: null,
              sizeBytes: null,
              missingSince: null,
              thumbnailUrl: '/coffre/catalog/nas/1/thumbnail',
              linkedEntry: null,
            },
          ],
          total: 1,
        })
      )
    )

    const wrapper = monter()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/coffre/catalog/items?')
    expect(url).toContain('page=1')
    expect(wrapper.text()).toContain('plage')

    wrapper.unmount()
  })

  test('la recherche est débouncée : rien avant 300 ms, un seul appel après, page remise à 1', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(jsonResponse(emptyPage()))

    const wrapper = monter()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const input = wrapper.find('input[type="text"]')
    await input.setValue('plage')

    // Rien de plus n'est parti tout de suite — c'est tout le sens du débounce.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(299)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url] = fetchMock.mock.calls[1] as [string]
    expect(url).toContain('q=plage')
    expect(url).toContain('page=1')

    wrapper.unmount()
  })

  test('cliquer « page suivante » avance la pagination', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(emptyPage({ total: 40, totalPages: 2 })))
    fetchMock.mockResolvedValueOnce(jsonResponse(emptyPage({ page: 2, total: 40, totalPages: 2 })))

    const wrapper = monter()
    await flushPromises()

    const suivant = wrapper.findAll('button').find((btn) => btn.text() === fr.catalog.nextPage)!
    await suivant.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url] = fetchMock.mock.calls[1] as [string]
    expect(url).toContain('page=2')

    wrapper.unmount()
  })

  test('un 429 affiche le message de throttle, jamais une grille vide silencieuse', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'trop' }, 429))

    const wrapper = monter()
    await flushPromises()

    expect(wrapper.text()).toContain(fr.catalog.throttled)

    wrapper.unmount()
  })

  test('une vignette en échec de chargement retombe sur la pastille de nature', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        emptyPage({
          items: [
            {
              id: 7,
              source: 'nas',
              nature: 'photo',
              displayName: 'photo-cassee',
              capturedAt: null,
              sizeBytes: null,
              missingSince: null,
              thumbnailUrl: '/coffre/catalog/nas/7/thumbnail',
              linkedEntry: null,
            },
          ],
          total: 1,
        })
      )
    )

    const wrapper = monter()
    await flushPromises()

    const img = wrapper.find('img')
    expect(img.exists()).toBe(true)

    await img.trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain(fr.catalog.naturePhoto)

    wrapper.unmount()
  })
})
