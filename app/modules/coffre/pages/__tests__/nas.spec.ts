import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import Nas from '../nas.vue'

/*
| CC-239 : la navigation par dossier NAS porte de la vraie logique (racines → dossier → recherche),
| donc un test de composant — CLAUDE.md racine : « un composant qui ne fait que disposer des <div> —
| non ». Chaque test reproduit le GESTE réel (cliquer une racine, cliquer un sous-dossier, taper une
| recherche) plutôt que d'observer l'état de montage.
*/

vi.mock('@inertiajs/vue3', () => ({
  Head: { props: ['title'], template: '<div><slot /></div>' },
  Link: { props: ['href'], template: '<a><slot /></a>' },
}))

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body }
}

function rootsListing(roots: string[]) {
  return { level: 'roots', roots: roots.map((name) => ({ name })) }
}

function folderListing(root: string, path: string, entries: unknown[]) {
  return { level: 'folder', root, path, entries }
}

/** Ce fichier vit sous `app/**`, hors de la lib DOM de `tsconfig.json` (voir `vue-shim.d.ts`) :
 * pas de `HTMLInputElement` nommé, un cast structurel suffit (même patron qu'`entry_form_modal.spec.ts`). */
function valueOf(element: { value: string }): string {
  return element.value
}

function monter() {
  return mount(Nas, {
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

describe('Coffre / nas — la navigation par dossier', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('au montage, liste les racines déclarées', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(rootsListing(['photos'])))

    const wrapper = monter()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('/coffre/nas/browse')
    expect(wrapper.text()).toContain('photos')

    wrapper.unmount()
  })

  test('cliquer une racine ouvre son contenu — dossiers et fichiers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(rootsListing(['photos'])))
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        folderListing('photos', '', [
          { name: '2026', path: '2026', kind: 'dir', sizeBytes: null, capturedAt: null },
          {
            name: 'plage.jpg',
            path: 'plage.jpg',
            kind: 'photo',
            sizeBytes: 1024,
            capturedAt: '2026-01-01T00:00:00.000Z',
          },
        ])
      )
    )

    const wrapper = monter()
    await flushPromises()

    const racine = wrapper.findAll('button').find((btn) => btn.text().includes('photos'))!
    await racine.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url] = fetchMock.mock.calls[1] as [string]
    expect(url).toBe('/coffre/nas/browse?root=photos&path=')
    expect(wrapper.text()).toContain('2026')
    expect(wrapper.text()).toContain('plage.jpg')

    wrapper.unmount()
  })

  test('cliquer un SOUS-DOSSIER navigue dedans — un FICHIER, lui, ne déclenche aucun appel de plus', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(rootsListing(['photos'])))
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        folderListing('photos', '', [
          { name: '2026', path: '2026', kind: 'dir', sizeBytes: null, capturedAt: null },
          { name: 'plage.jpg', path: 'plage.jpg', kind: 'photo', sizeBytes: 10, capturedAt: null },
        ])
      )
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(folderListing('photos', '2026', [])))

    const wrapper = monter()
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((btn) => btn.text().includes('photos'))!
      .trigger('click')
    await flushPromises()

    // ⚠️ Le fichier d'abord : cliquer dessus ne doit RIEN déclencher (`entry.kind !== 'dir'`).
    const fichier = wrapper.findAll('button').find((btn) => btn.text().includes('plage.jpg'))!
    await fichier.trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Le dossier ensuite : navigue, un appel de plus avec le chemin mis à jour.
    const dossier = wrapper.findAll('button').find((btn) => btn.text().includes('2026'))!
    await dossier.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [url] = fetchMock.mock.calls[2] as [string]
    expect(url).toBe('/coffre/nas/browse?root=photos&path=2026')

    wrapper.unmount()
  })

  test('le fil d’Ariane remonte au niveau cliqué', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(rootsListing(['photos'])))
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        folderListing('photos', '', [
          { name: '2026', path: '2026', kind: 'dir', sizeBytes: null, capturedAt: null },
        ])
      )
    )
    fetchMock.mockResolvedValueOnce(jsonResponse(folderListing('photos', '2026', [])))
    fetchMock.mockResolvedValueOnce(jsonResponse(folderListing('photos', '', [])))

    const wrapper = monter()
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((btn) => btn.text().includes('photos'))!
      .trigger('click')
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((btn) => btn.text().includes('2026'))!
      .trigger('click')
    await flushPromises()

    // Le fil d'Ariane porte maintenant « photos / 2026 » — cliquer « photos » y remonte.
    const segmentRacine = wrapper.findAll('nav button').find((btn) => btn.text() === 'photos')!
    await segmentRacine.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(4)
    const [url] = fetchMock.mock.calls[3] as [string]
    expect(url).toBe('/coffre/nas/browse?root=photos&path=')

    wrapper.unmount()
  })

  test('taper une recherche bascule vers la grille du catalogue, verrouillée sur `nas`', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(rootsListing(['photos'])))
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [], page: 1, perPage: 30, total: 0, totalPages: 1 })
    )

    const wrapper = monter()
    await flushPromises()

    const recherche = wrapper.find('input[type="text"]')
    await recherche.setValue('plage')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url] = fetchMock.mock.calls[1] as [string]
    expect(url).toContain('/coffre/catalog/items?')
    expect(url).toContain('source=nas')
    expect(url).toContain('q=plage')

    // La navigation par dossier a disparu de l'écran pendant la recherche.
    expect(wrapper.text()).not.toContain(fr.nas.rootsEmpty)

    wrapper.unmount()
  })

  test('« retour à la navigation » vide la recherche et réaffiche le dossier courant', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(rootsListing(['photos'])))
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [], page: 1, perPage: 30, total: 0, totalPages: 1 })
    )

    const wrapper = monter()
    await flushPromises()
    await wrapper.find('input[type="text"]').setValue('plage')
    await flushPromises()

    const retour = wrapper.findAll('button').find((btn) => btn.text() === fr.nas.backToBrowse)!
    await retour.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('photos')
    expect(valueOf(wrapper.find('input[type="text"]').element)).toBe('')

    wrapper.unmount()
  })
})
