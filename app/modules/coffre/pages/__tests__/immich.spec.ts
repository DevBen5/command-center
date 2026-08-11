import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import Immich from '../immich.vue'

/*
| CC-239 : la page est un en-tête + `CatalogGrid` verrouillée sur `immich_locked`. La logique de
| grille (débounce, pagination, throttle) est déjà prouvée par `catalog_grid.spec.ts` — ce test-ci
| ne vérifie QUE ce qui est propre à la page : le titre affiché, le lien retour, et que la source
| transmise à la grille est bien la bonne, jamais un sélecteur laissé au choix de l'utilisateur.
*/

vi.mock('@inertiajs/vue3', () => ({
  Head: { props: ['title'], template: '<div><slot /></div>' },
  Link: { props: ['href'], template: '<a><slot /></a>' },
}))

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body }
}

function emptyPage() {
  return { items: [], page: 1, perPage: 30, total: 0, totalPages: 1 }
}

describe('Coffre / immich — la page', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(emptyPage()))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('affiche le titre de la page et un lien retour vers l’accueil', async () => {
    const wrapper = mount(Immich, {
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
    await flushPromises()

    expect(wrapper.text()).toContain(fr.immich.title)
    expect(wrapper.text()).toContain(fr.index.backToCoffre)

    wrapper.unmount()
  })

  test('la grille interroge le catalogue avec la source verrouillée `immich_locked`', async () => {
    const wrapper = mount(Immich, {
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
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('source=immich_locked')

    wrapper.unmount()
  })
})
