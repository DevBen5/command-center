import { beforeEach, describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import IngestionTitle from '../IngestionTitle.vue'

/*
| Le titre d'un travail d'ingestion, renommable en ligne.
|
| Ce qui se teste ici, ce sont les deux GARDES de `save()` : un titre vide et un titre
| inchangé n'envoient aucune requête. Le mode d'échec est silencieux — le serveur refuse
| un titre vide, donc une garde retirée ne casserait rien de visible : elle ajouterait
| juste des requêtes qui échouent, sur un écran qui se recharge tout seul.
|
| Le composant ne communique que par effet de bord réseau (`router.put`), jamais par
| événement : l'espionner est le seul moyen d'observer ce qu'il fait.
*/

const put = vi.fn()

vi.mock('@inertiajs/vue3', () => ({
  router: { put: (...args: unknown[]) => put(...args) },
  Link: { props: ['href'], template: '<a :href="href"><slot /></a>' },
}))

function monter(title: string | null) {
  return mount(IngestionTitle, { props: { id: 7, title, maxChars: 120 } })
}

/** Le crayon ouvre l'édition ; en édition, le premier bouton est la coche « Renommer ». */
async function renommer(wrapper: ReturnType<typeof monter>, saisie: string) {
  await wrapper.get('button').trigger('click')
  await wrapper.get('input').setValue(saisie)
  await wrapper.get('button').trigger('click')
}

describe('Leitner / IngestionTitle', () => {
  beforeEach(() => put.mockClear())

  test('un titre vide n’envoie aucune requête', async () => {
    const wrapper = monter('Cours de TLS')

    await renommer(wrapper, '   ')

    expect(put).not.toHaveBeenCalled()
    // L'édition se ferme quand même : on annule, on ne reste pas coincé.
    expect(wrapper.find('input').exists()).toBe(false)
  })

  test('un titre inchangé n’envoie aucune requête', async () => {
    const wrapper = monter('Cours de TLS')

    await renommer(wrapper, 'Cours de TLS')

    expect(put).not.toHaveBeenCalled()
  })

  test('un titre modifié part sur l’URL du travail, sans bouger le scroll', async () => {
    const wrapper = monter('Cours de TLS')

    await renommer(wrapper, 'Handshake TLS')

    expect(put).toHaveBeenCalledTimes(1)
    const [url, payload, options] = put.mock.calls[0] as [
      string,
      object,
      { preserveScroll: boolean },
    ]
    expect(url).toBe('/revision/ingest/7/title')
    expect(payload).toEqual({ title: 'Handshake TLS' })
    // Sans `preserveScroll`, renommer depuis le bas de l'historique renverrait en haut de page.
    expect(options.preserveScroll).toBe(true)
  })

  test('un travail sans titre s’annonce « Sans titre » et reste renommable', async () => {
    const wrapper = monter(null)
    expect(wrapper.text()).toContain('Sans titre')

    await renommer(wrapper, 'Cours de Docker')

    expect(put).toHaveBeenCalledTimes(1)
    expect(put.mock.calls[0][1]).toEqual({ title: 'Cours de Docker' })
  })
})
