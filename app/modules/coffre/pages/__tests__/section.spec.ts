import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import Section from '../section.vue'

/*
| CC-221 : l'accordéon d'une entrée n'annonçait aucun état à un lecteur d'écran. Ce fichier est le
| premier test de composant de cette page (CLAUDE.md du module : « le rendu de section.vue n'est
| couvert par rien ») — il ne prouve QUE le geste ajouté par ce lot, pas le reste de l'écran
| (révélation de secret, suppression, édition), qui reste un passage navigateur pour le propriétaire.
|
| ⚠️ `aria-expanded` doit suivre l'état RÉEL, sur le geste (déplier PUIS replier), jamais l'état de
| montage seul — piège nommé par le CLAUDE.md racine (exemple TaxonomyCombobox) : un composant qui
| part déjà dans l'état observé rend un test décoratif.
*/

vi.mock('@inertiajs/vue3', () => ({
  Head: { props: ['title'], template: '<div><slot /></div>' },
  Link: { props: ['href'], template: '<a><slot /></a>' },
  router: { post: vi.fn(), delete: vi.fn() },
}))

function baseEntry() {
  return {
    id: 1,
    type: 'note' as const,
    title: 'Une note',
    content: 'Le contenu',
    createdAt: '2026-01-01T00:00:00.000Z',
    media: [] as { id: number }[],
    nasFiles: [] as { id: number; kind: 'video' | 'photo' }[],
  }
}

function monter() {
  return mount(Section, {
    props: {
      section: 'note' as const,
      entries: [baseEntry()],
      immichFolderAvailable: false,
    },
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

describe('Coffre / section — accordéon', () => {
  test('le bouton d’une entrée annonce aria-expanded/aria-controls sur le geste réel', async () => {
    const wrapper = monter()

    const bouton = () => wrapper.find('button.flex-1')
    expect(bouton().attributes('aria-expanded')).toBe('false')
    expect(bouton().attributes('aria-controls')).toBeUndefined()

    await bouton().trigger('click')

    expect(bouton().attributes('aria-expanded')).toBe('true')
    const panelId = bouton().attributes('aria-controls')!
    expect(panelId).toBe('coffre-entry-panel-1')
    expect(wrapper.find(`#${panelId}`).exists()).toBe(true)

    await bouton().trigger('click')

    expect(bouton().attributes('aria-expanded')).toBe('false')
    expect(bouton().attributes('aria-controls')).toBeUndefined()
    expect(wrapper.find('#coffre-entry-panel-1').exists()).toBe(false)

    wrapper.unmount()
  })
})
