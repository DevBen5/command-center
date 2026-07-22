import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import LeitnerTabs from '../LeitnerTabs.vue'

/*
| La barre d'onglets du module. Toute sa logique tient dans le `computed current`, qui
| normalise `page.url` en trois temps (query string, slashes finaux, repli) avant de
| chercher l'onglet par `startsWith`.
|
| ⚠️ `/revision` est le préfixe de tous les autres onglets : il est exclu du `find` puis
| servi en repli. Sans cette exclusion, il resterait allumé sur les cinq écrans — un défaut
| qui se voit à l'œil mais qu'aucun test fonctionnel n'attrape, la route rendant bien le
| bon composant dans tous les cas.
|
| Le composant ne lit que `page.url` — jamais `page.props` : un stub minimal suffit.
*/

vi.mock('@inertiajs/vue3', () => ({
  usePage: () => mockedPage,
  Link: { props: ['href'], template: '<a :href="href"><slot /></a>' },
}))

const mockedPage = { url: '/revision' }

function activeTab(url: string): string {
  mockedPage.url = url
  const wrapper = mount(LeitnerTabs)
  return wrapper.get('a.bg-accent').text()
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
    const wrapper = mount(LeitnerTabs)
    // ⚠️ L'assertion qui compte : UN seul onglet allumé. `/revision` étant préfixe des
    // quatre autres, une régression sur l'exclusion les allumerait tous.
    expect(wrapper.findAll('a.bg-accent')).toHaveLength(1)
  })

  test('un écran du module n’allume jamais Révision en plus du sien', () => {
    mockedPage.url = '/revision/settings'
    const wrapper = mount(LeitnerTabs)

    const actifs = wrapper.findAll('a.bg-accent').map((link) => link.text())
    expect(actifs).toEqual(['Cartes'])
  })
})
