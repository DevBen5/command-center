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
  agents: { active: 2, running: [], failed: [{ id: 7, name: 'sauvegarde-nocturne' }] },
  veille: { total: 12, queue: 3, untagged: 1 },
  leitner: { due: 5, total: 40 },
}

describe('Core / tableau de bord', () => {
  test('un administrateur voit les quatre sections', () => {
    const wrapper = mount(Home, { props: { cards: COMPLET } })

    expect(wrapper.text()).toContain('postgres-prod')
    expect(wrapper.text()).toContain('sauvegarde-nocturne')

    // Chaque module reste atteignable — l'en-tête pointe vers sa racine.
    const liens = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(liens).toContain('/services')
    expect(liens).toContain('/agents')
    expect(liens).toContain('/veille')
    expect(liens).toContain('/revision')

    wrapper.unmount()
  })

  test('CC-52 : les lignes internes mènent à des destinations distinctes de l’en-tête', () => {
    // Le fond de la demande : cliquer une ligne doit mener AILLEURS que l'en-tête, là où une vraie
    // cible existe. Un retour d'une ligne vers la racine du module (le comportement d'origine, où
    // tout menait au même endroit) ferait disparaître ces `href` et rougir ce test.
    const wrapper = mount(Home, { props: { cards: COMPLET } })

    const liens = wrapper.findAll('a').map((a) => a.attributes('href'))
    // Agent en échec → sa sélection + ses logs, pas la liste brute.
    expect(liens).toContain('/agents?id=7')
    // Veille « File de lecture » → la file filtrée, pas tout le flux.
    expect(liens).toContain('/veille?readingQueue=1')
    // Révision « à réviser » → la session sur toutes les dues ; « en mémoire » → le catalogue.
    expect(liens).toContain('/revision?scope=all')
    expect(liens).toContain('/revision/settings')

    wrapper.unmount()
  })

  test('CC-52 : l’en-tête ouvre le module même sans aucune ligne interne', () => {
    // Le cas nominal — tout va bien, donc Services et Agents n'affichent que leur état vide et
    // AUCUNE ligne. Le seul `<a>` vers ces deux modules ne peut alors venir que de l'en-tête :
    // ce test isole donc précisément la zone cliquable ajoutée par CC-52. Il rougirait si
    // l'en-tête redevenait une `<div>` inerte (le bug d'origine : cliquer la carte saine ne
    // menait nulle part).
    const wrapper = mount(Home, {
      props: {
        cards: {
          services: { up: 4, total: 4, down: [], highRam: [] },
          agents: { active: 2, running: [], failed: [] },
          veille: { total: 12, queue: 3, untagged: 1 },
          leitner: { due: 5, total: 40 },
        },
      },
    })

    expect(wrapper.text()).toContain('Tous les services sont sains.')
    expect(wrapper.text()).toContain("Aucun agent ne requiert d'attention.")
    const liens = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(liens).toContain('/services')
    expect(liens).toContain('/agents')

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
