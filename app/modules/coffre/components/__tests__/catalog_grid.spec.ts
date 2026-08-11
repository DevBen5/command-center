import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import CatalogGrid from '../CatalogGrid.vue'

/*
| CC-239 : la grille extraite de `pages/catalog.vue`, source verrouillée en prop. Les tests
| reprennent le geste réel de `pages/__tests__/catalog.spec.ts` — débounce, pagination, throttle,
| repli de vignette — PLUS ce qui est propre à cette version : `source` jamais dans la requête
| utilisateur, `initialQuery` qui part sans débounce au montage.
*/

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body }
}

function emptyPage(overrides: Partial<Record<string, unknown>> = {}) {
  return { items: [], page: 1, perPage: 30, total: 0, totalPages: 1, ...overrides }
}

function monter(props: Record<string, unknown> = { lockedSource: 'immich_locked' }) {
  return mount(CatalogGrid, {
    props,
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

describe('Coffre / CatalogGrid', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  test('au montage, interroge /coffre/catalog/items avec la source VERROUILLÉE, jamais un sélecteur', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(emptyPage()))

    const wrapper = monter({ lockedSource: 'nas' })
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('source=nas')
    // ⚠️ Aucun `<select>` de source dans ce composant — contrairement à `pages/catalog.vue`, qui
    // en porte trois (source, nature, tri) : ici, seulement deux (nature, tri).
    expect(wrapper.findAll('select')).toHaveLength(2)

    wrapper.unmount()
  })

  test('`initialQuery` part SANS débounce dès le montage — une recherche déjà tapée avant la bascule', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(jsonResponse(emptyPage()))

    const wrapper = monter({ lockedSource: 'nas', initialQuery: 'plage' })
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('q=plage')

    wrapper.unmount()
  })

  test('la recherche tapée ensuite reste débouncée : rien avant 300 ms, un seul appel après', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(jsonResponse(emptyPage()))

    const wrapper = monter()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const input = wrapper.find('input[type="text"]')
    await input.setValue('ete')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(299)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url] = fetchMock.mock.calls[1] as [string]
    expect(url).toContain('q=ete')
    expect(url).toContain('page=1')

    wrapper.unmount()
  })

  test('cliquer « page suivante » avance la pagination, source verrouillée conservée', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(emptyPage({ total: 40, totalPages: 2 })))
    fetchMock.mockResolvedValueOnce(jsonResponse(emptyPage({ page: 2, total: 40, totalPages: 2 })))

    const wrapper = monter({ lockedSource: 'immich_locked' })
    await flushPromises()

    const suivant = wrapper.findAll('button').find((btn) => btn.text() === fr.catalog.nextPage)!
    await suivant.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url] = fetchMock.mock.calls[1] as [string]
    expect(url).toContain('page=2')
    expect(url).toContain('source=immich_locked')

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
              thumbnailUrl: '/coffre/nas/thumbnail?root=root&path=photo.jpg',
              linkedEntry: null,
            },
          ],
          total: 1,
        })
      )
    )

    const wrapper = monter({ lockedSource: 'nas' })
    await flushPromises()

    const img = wrapper.find('img')
    expect(img.exists()).toBe(true)

    await img.trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain(fr.catalog.naturePhoto)

    wrapper.unmount()
  })
})
