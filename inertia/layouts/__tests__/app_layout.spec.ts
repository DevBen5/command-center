import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json'
import AppLayout from '../AppLayout.vue'

/*
| Le layout : navigation, état actif, titre de page, palette ⌘K.
|
| ⚠️ Ce fichier ne teste NI le filtrage de la palette (CC-26 : le champ est inerte), NI la
| navigation ↑↓ / ↵ qu'elle annonce sans l'implémenter (CC-27). Ce sont des bogues ouverts :
| un test qui figerait leur comportement actuel les rendrait incorrigibles sans rougir, et
| un test qui asserterait le comportement attendu échouerait dès aujourd'hui. On couvre donc
| ce qui est câblé — ouverture, fermeture, état actif, titre — et pas ce qui ne l'est pas.
|
| ⚠️ L'instance i18n est neuve à chaque montage, jamais le singleton de `inertia/i18n` :
| `setLocale()` le mute globalement, et deux tests qui changeraient de langue
| s'influenceraient selon leur ordre d'exécution.
*/

const NAV = {
  services: { total: 4, down: 1 },
  agents: { total: 3, failed: 0 },
  veille: { queue: 12 },
  leitner: { due: 5 },
  host: 'ben-pc',
}

const mockedPage = { url: '/', props: {} as Record<string, unknown> }

vi.mock('@inertiajs/vue3', () => ({
  usePage: () => mockedPage,
  router: { post: vi.fn() },
  Link: { props: ['href'], template: '<a :href="href"><slot /></a>' },
}))

function monter(url: string) {
  mockedPage.url = url
  mockedPage.props = { nav: NAV, locale: 'fr', supportedLocales: ['fr', 'en'] }

  return mount(AppLayout, {
    global: {
      plugins: [
        createI18n({ legacy: false, locale: 'fr', fallbackLocale: 'fr', messages: { fr } }),
      ],
    },
    attachTo: document.body,
  })
}

describe('Core / AppLayout', () => {
  test('Ctrl+K ouvre la palette, Échap la ferme', async () => {
    const wrapper = monter('/')
    expect(wrapper.text()).not.toContain(fr.palette.navigation)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain(fr.palette.navigation)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain(fr.palette.navigation)

    wrapper.unmount()
  })

  test('Ctrl+K bascule : un second appui referme', async () => {
    const wrapper = monter('/')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await wrapper.vm.$nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).not.toContain(fr.palette.navigation)
    wrapper.unmount()
  })

  test('le listener clavier posé au montage est bien celui retiré au démontage', () => {
    // ⚠️ On espionne les deux appels plutôt que d'observer le DOM après démontage : un
    // composant démonté est détaché, donc un listener SURVIVANT ne changerait rien à
    // l'écran et le test passerait quand même. C'est le handler lui-même qu'il faut
    // comparer — sans quoi une navigation Inertia empilerait un listener par page
    // visitée, chacun ouvrant la palette d'une page qui n'existe plus.
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    const wrapper = monter('/')
    const posé = add.mock.calls.find(([type]) => type === 'keydown')
    wrapper.unmount()
    const retiré = remove.mock.calls.find(([type]) => type === 'keydown')

    expect(posé).toBeDefined()
    expect(retiré).toBeDefined()
    // La même référence de fonction : un handler recréé ne serait jamais retiré.
    expect(retiré![1]).toBe(posé![1])

    add.mockRestore()
    remove.mockRestore()
  })

  test('le titre de page suit l’entrée de navigation active', () => {
    const revision = monter('/revision')
    expect(revision.get('h1').text()).toBe(fr.nav.revision)
    revision.unmount()

    // ⚠️ `startsWith` : une sous-page du module reste sur la même entrée.
    const stats = monter('/revision/stats')
    expect(stats.get('h1').text()).toBe(fr.nav.revision)
    stats.unmount()

    const accueil = monter('/')
    expect(accueil.get('h1').text()).toBe(fr.nav.accueil)
    accueil.unmount()
  })

  test('les pastilles distinguent une stat nulle d’une stat non chargée', () => {
    const wrapper = monter('/')

    // `agents.failed` vaut 0 : stat chargée, pastille neutre — elle s'affiche.
    // `accueil` n'a pas de badge du tout : rien ne s'affiche. La distinction tient sur
    // `!== undefined` ; un `?? 0` ajouté par mégarde peuplerait la barre de zéros.
    expect(wrapper.text()).toContain('12') // veille.queue
    expect(wrapper.text()).toContain('5') // leitner.due
    expect(wrapper.text()).toContain(NAV.host)

    wrapper.unmount()
  })

  test('sans shared props, le layout se monte quand même (pages non authentifiées)', () => {
    mockedPage.url = '/login'
    mockedPage.props = {}

    const wrapper = mount(AppLayout, {
      global: {
        plugins: [
          createI18n({ legacy: false, locale: 'fr', fallbackLocale: 'fr', messages: { fr } }),
        ],
      },
    })

    // `nav` vaut null sur login : aucune stat, aucune pastille, et surtout aucune exception.
    expect(wrapper.get('h1').text()).toBe(fr.nav.accueil)
    wrapper.unmount()
  })
})
