import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import Index from '../index.vue'

/*
| Les deux logiques de la page Services : le pluriel de « arrêté », et le masquage
| hors service (CC-116).
|
| Le libellé sous le compteur des services arrêtés était `arrêté{{ stats.down > 1 ? 's' : '' }}` —
| singulier pour 0 et 1, pluriel au-delà. Externalisé (CC-90), il passe par la pluralisation
| vue-i18n avec un message à TROIS formes `"arrêté | arrêté | arrêtés"`.
|
| ⚠️ Le cas qui compte est `down = 0`. Un message à DEUX formes (`"arrêté | arrêtés"`) rendrait
| « 0 arrêtés » — la règle par défaut mappe 0 → forme 1. C'est ce cas, et lui seul, qui atteste
| qu'on a bien conservé la règle française (0 au singulier). Le monter sans lui laisserait passer
| la régression que ce test existe pour supprimer.
|
| ⚠️ L'instance i18n embarque le namespace `services` : sans lui, `t('services.stats.down', n)`
| rendrait la clé brute et l'assertion échouerait — mais sur la mauvaise cause (piège CLAUDE.md).
*/

vi.mock('@inertiajs/vue3', () => ({
  Head: { props: ['title'], template: '<div><slot /></div>' },
  router: { post: vi.fn(), get: vi.fn() },
}))

interface ServiceProps {
  id: number
  name: string
  category: string
  url: string | null
  status: 'up' | 'down' | 'unknown'
  cpuPercent: number | null
  ramPercent: number | null
}

const STATS = { total: 4, up: 4, down: 0, cpuAvg: 0, ramAvg: 0 }

function mountIndex(props: {
  dockerDisponible: boolean
  services: ServiceProps[]
  stats: typeof STATS
}) {
  return mount(Index, {
    props,
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: 'fr',
          fallbackLocale: 'fr',
          messages: { fr: { services: fr } },
        }),
      ],
    },
  })
}

/** Monte la page pour un nombre d'arrêtés donné et rend le libellé affiché sous le compteur. */
function downLabel(down: number): string {
  const wrapper = mountIndex({
    dockerDisponible: true,
    services: [],
    stats: { ...STATS, down },
  })
  // Le seul nœud dont le texte est exactement « arrêté » ou « arrêtés » : le libellé du compteur.
  // (Le libellé de statut d'une carte est « ARRÊTÉ » en majuscules, et aucune carte n'est rendue.)
  return wrapper
    .findAll('div')
    .find((d) => /^arrêtés?$/.test(d.text()))!
    .text()
}

describe('Services / index', () => {
  test('zéro service arrêté reste au singulier', () => {
    // Le cas témoin : un message à deux formes rendrait « arrêtés » ici.
    expect(downLabel(0)).toBe('arrêté')
  })

  test('un seul service arrêté est au singulier', () => {
    expect(downLabel(1)).toBe('arrêté')
  })

  test('plusieurs services arrêtés passent au pluriel', () => {
    expect(downLabel(3)).toBe('arrêtés')
  })
})

/*
| Hors service (CC-116), la bannière remplace TOUT — pas seulement les cartes.
|
| ⚠️ Les tests montent avec un service EN PROPS : n'asserter que la présence de la bannière
| serait vert même si les cartes restaient rendues à côté. C'est l'absence du nom du service,
| de la bande d'indicateurs et de la barre d'outils qui prouve le masquage. Vérifié en cassant
| le `v-else` : les trois assertions négatives rougissent.
*/

const JELLYFIN: ServiceProps = {
  id: 1,
  name: 'Jellyfin',
  category: 'Média',
  url: null,
  status: 'up',
  cpuPercent: 12,
  ramPercent: 30,
}

describe('Services / hors service (CC-116)', () => {
  test('hors service : la bannière s’affiche et rien d’autre ne se rend', () => {
    const wrapper = mountIndex({
      dockerDisponible: false,
      services: [JELLYFIN],
      stats: { ...STATS, up: 1, total: 1 },
    })

    expect(wrapper.text()).toContain(fr.offline.title)
    expect(wrapper.text()).not.toContain(JELLYFIN.name) // aucune carte
    expect(wrapper.text()).not.toContain(fr.stats.up) // pas de bande d'indicateurs
    expect(wrapper.text()).not.toContain(fr.toolbar.restartAll) // pas de barre d'outils
  })

  test('Docker disponible : pas de bannière, l’écran habituel', () => {
    const wrapper = mountIndex({
      dockerDisponible: true,
      services: [JELLYFIN],
      stats: { ...STATS, up: 1, total: 1 },
    })

    expect(wrapper.text()).not.toContain(fr.offline.title)
    expect(wrapper.text()).toContain(JELLYFIN.name)
  })
})
