import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import CourseSectionView from '../CourseSectionView.vue'

/*
| Le lien « Voir dans le cours » (CC-273) est le seul comportement de ce composant qui
| ne soit pas déjà couvert ailleurs (le rendu du corps, lui, est prouvé par
| `leitner_card_preview.spec.ts` et `leitner_markdown.spec.ts` côté serveur). Ce test
| n'assert que l'`href` construit — le défilement vers l'ancre, lui, vit dans
| `cours_show.vue` et reste hors de portée de Vitest (jsdom, aucun layout).
*/

vi.mock('@inertiajs/vue3', () => ({
  Link: { props: ['href'], template: '<a :href="href"><slot /></a>' },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'fr',
  fallbackLocale: 'fr',
  messages: { fr: { leitner: fr } },
})

function mountView(overrides: Partial<{ id: number; courseId: number }> = {}) {
  return mount(CourseSectionView, {
    props: {
      section: {
        id: overrides.id ?? 12,
        courseId: overrides.courseId ?? 5,
        headingPath: ['Réseaux', 'TLS'],
        bodyHtml: '<p>Le handshake négocie les clés.</p>',
        aliases: null,
      },
    },
    global: { plugins: [i18n] },
  })
}

describe('CourseSectionView', () => {
  test('le lien pointe vers le cours, ancré sur l’id de la section', () => {
    const wrapper = mountView({ courseId: 5, id: 12 })
    const link = wrapper.get('a')
    expect(link.attributes('href')).toBe('/revision/cours/5#section-12')
  })

  test('l’ancre suit l’id, pas le courseId', () => {
    const wrapper = mountView({ courseId: 3, id: 99 })
    const link = wrapper.get('a')
    expect(link.attributes('href')).toBe('/revision/cours/3#section-99')
  })
})
