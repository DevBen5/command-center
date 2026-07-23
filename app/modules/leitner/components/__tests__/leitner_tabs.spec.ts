import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import LeitnerTabs from '../LeitnerTabs.vue'

/*
| La barre d'onglets du module. Deux responsabilités, toutes deux ici :
|
| 1. L'onglet ACTIF — le `computed current`, qui normalise `page.url` en trois temps
|    (query string, slashes finaux, repli) avant de chercher l'onglet par `startsWith`.
|    ⚠️ `/revision` est le préfixe de tous les autres : il est exclu du `find` puis servi en
|    repli. Sans cette exclusion, il resterait allumé sur les cinq écrans — un défaut visible
|    à l'œil mais qu'aucun test fonctionnel n'attrape, la route rendant bien le bon composant.
|
| 2. Les onglets VISIBLES — filtrés par capacité (CC-72) : un invité en lecture seule ne voit
|    ni Ingestion ni Configuration, il naviguerait sinon vers un refus. Le masquage double la
|    garde de la route (middleware `can`), il ne la remplace pas.
|
| Le composant lit `page.url` ET `page.props.user` (via `useCan`) : le stub les fournit tous
| les deux.
*/

vi.mock('@inertiajs/vue3', () => ({
  usePage: () => mockedPage,
  Link: { props: ['href'], template: '<a :href="href"><slot /></a>' },
}))

const FULL_ACCESS = { isAdmin: true, capabilities: [] as string[] }

const mockedPage = {
  url: '/revision',
  props: { user: { ...FULL_ACCESS } as { isAdmin: boolean; capabilities: string[] } },
}

/** Monte la barre pour un `url` donné, tous les onglets accessibles, et rend l'onglet actif. */
function activeTab(url: string): string {
  mockedPage.url = url
  mockedPage.props.user = { ...FULL_ACCESS }
  const wrapper = mount(LeitnerTabs)
  return wrapper.get('a.bg-accent').text()
}

/** Monte la barre pour un utilisateur donné et rend la liste des libellés visibles. */
function visibleLabels(user: { isAdmin: boolean; capabilities: string[] }): string[] {
  mockedPage.url = '/revision'
  mockedPage.props.user = user
  const wrapper = mount(LeitnerTabs)
  return wrapper.findAll('nav a').map((link) => link.text())
}

describe('Leitner / LeitnerTabs', () => {
  test('l’onglet actif ignore la query string', () => {
    // Sans le `split('?')`, aucun onglet ne correspondrait et le repli allumerait Révision.
    expect(activeTab('/revision/stats?j=30')).toBe('Stats')
  })

  test('l’onglet actif ignore un slash final', () => {
    expect(activeTab('/revision/stats/')).toBe('Stats')
  })

  test('la page d’UN travail garde l’onglet Ingestion allumé', () => {
    expect(activeTab('/revision/ingest/42')).toBe('Ingestion')
  })

  test('/revision nu allume Révision, et lui seul', () => {
    expect(activeTab('/revision')).toBe('Révision')

    mockedPage.url = '/revision'
    mockedPage.props.user = { ...FULL_ACCESS }
    const wrapper = mount(LeitnerTabs)
    // ⚠️ L'assertion qui compte : UN seul onglet allumé. `/revision` étant préfixe des
    // quatre autres, une régression sur l'exclusion les allumerait tous.
    expect(wrapper.findAll('a.bg-accent')).toHaveLength(1)
  })

  test('un écran du module n’allume jamais Révision en plus du sien', () => {
    mockedPage.url = '/revision/settings'
    mockedPage.props.user = { ...FULL_ACCESS }
    const wrapper = mount(LeitnerTabs)

    const actifs = wrapper.findAll('a.bg-accent').map((link) => link.text())
    expect(actifs).toEqual(['Cartes'])
  })

  test('un invité en lecture seule ne voit que Révision, Cartes et Stats', () => {
    // Le rôle « invité » de CC-72 : lecture des cartes et des stats, rien de plus.
    // Ingestion (`leitner.ingest`) et Configuration (`leitner.llm`) sont masqués — sans quoi
    // il cliquerait vers un 403.
    const labels = visibleLabels({
      isAdmin: false,
      capabilities: ['leitner.view', 'leitner.stats.view'],
    })

    expect(labels).toEqual(['Révision', 'Cartes', 'Stats'])
  })

  test('un administrateur voit les cinq onglets', () => {
    // `isAdmin` passe outre toute capacité : la barre entière, sans énumérer quoi que ce soit.
    const labels = visibleLabels({ isAdmin: true, capabilities: [] })

    expect(labels).toEqual(['Révision', 'Cartes', 'Stats', 'Ingestion', 'Configuration'])
  })
})
