import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import Index from '../index.vue'

/*
| La seule *logique* de la page Services : le pluriel de « arrêté ».
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

const STATS = { total: 4, up: 4, down: 0, cpuAvg: 0, ramAvg: 0 }

/** Monte la page pour un nombre d'arrêtés donné et rend le libellé affiché sous le compteur. */
function downLabel(down: number): string {
  const wrapper = mount(Index, {
    props: { services: [], stats: { ...STATS, down } },
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
