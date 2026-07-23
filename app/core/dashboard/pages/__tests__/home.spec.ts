import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Home from '../home.vue'

/*
| Le tableau de bord, vu par un compte qui n'a pas droit à tout.
|
| ⚠️ **Ce que ce fichier couvre est un crash, pas une apparence.** Depuis CC-81 le serveur
| n'envoie plus les sections qu'un compte ne peut pas voir : elles arrivent à `null`. Sans le
| `v-if` de chaque bloc, `cards.services.down.length` lève — **côté client**, donc pendant que
| la suite serveur reste verte et que le payload est parfait. C'est exactement le genre de
| panne que le filtrage introduit et qu'aucun test fonctionnel ne verrait.
|
| ⚠️ Le droit, lui, ne se joue pas ici : `HomeController` ne charge ni n'envoie ces données.
| Ce test vérifie que la page survit à leur absence, pas qu'elle les cache.
*/

vi.mock('@inertiajs/vue3', () => ({
  usePage: () => ({ url: '/', props: {} }),
  router: { post: vi.fn() },
  Link: { props: ['href'], template: '<a :href="href"><slot /></a>' },
  Head: { template: '<div><slot /></div>' },
}))

const COMPLET = {
  services: { up: 3, total: 4, down: ['postgres-prod'], highRam: [] },
  agents: { active: 2, running: [], failed: ['sauvegarde-nocturne'] },
  veille: { total: 12, queue: 3, untagged: 1 },
  leitner: { due: 5, total: 40 },
}

describe('Core / tableau de bord', () => {
  test('un administrateur voit les quatre sections', () => {
    const wrapper = mount(Home, { props: { cards: COMPLET } })

    expect(wrapper.text()).toContain('postgres-prod')
    expect(wrapper.text()).toContain('sauvegarde-nocturne')
    expect(wrapper.findAll('a').map((a) => a.attributes('href'))).toContain('/services')

    wrapper.unmount()
  })

  test('la page se rend sans les sections réservées à l’administrateur', () => {
    const wrapper = mount(Home, {
      props: { cards: { ...COMPLET, services: null, agents: null } },
    })

    // Rendue, pas cassée — et sans les liens morts vers deux écrans qui répondraient 403.
    expect(wrapper.text()).not.toContain('postgres-prod')
    expect(wrapper.text()).not.toContain('sauvegarde-nocturne')
    const liens = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(liens).not.toContain('/services')
    expect(liens).not.toContain('/agents')
    // Ce à quoi le compte a droit reste affiché.
    expect(liens).toContain('/revision')

    wrapper.unmount()
  })

  test('la page se rend même quand aucune section n’est accordée', () => {
    // Le compte qui porte `dashboard.view` et rien d'autre. L'écran est vide de contenu, mais
    // il s'affiche : une exception ici rendrait la page blanche.
    const wrapper = mount(Home, {
      props: { cards: { services: null, agents: null, veille: null, leitner: null } },
    })

    expect(wrapper.findAll('a')).toHaveLength(0)
    expect(wrapper.text()).toContain('Ce qui demande votre attention')

    wrapper.unmount()
  })
})
