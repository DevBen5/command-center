import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import Index from '../index.vue'

/*
| CC-239 : l'accueil bascule vers deux cartes de source. Ce test porte de la vraie logique — les
| compteurs de la rangée second niveau viennent de `sectionCardsFor`, calculée côté client sur ce
| que le serveur envoie déjà déchiffré — donc un test de composant, pas une relecture.
*/

vi.mock('@inertiajs/vue3', () => ({
  Head: { props: ['title'], template: '<div><slot /></div>' },
  Link: { props: ['href'], template: '<a :href="href"><slot /></a>' },
  router: { post: vi.fn() },
}))

function monter(entries: unknown[] = []) {
  return mount(Index, {
    props: { entries, immichFolderAvailable: false },
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

describe('Coffre / index — les deux cartes de source', () => {
  test('affiche EXACTEMENT deux cartes de source, vers /coffre/nas et /coffre/immich', () => {
    const wrapper = monter()

    const versNas = wrapper.find('a[href="/coffre/nas"]')
    const versImmich = wrapper.find('a[href="/coffre/immich"]')

    expect(versNas.exists()).toBe(true)
    expect(versNas.text()).toContain(fr.index.sourceNasTitle)
    expect(versImmich.exists()).toBe(true)
    expect(versImmich.text()).toContain(fr.index.sourceImmichTitle)

    // ⚠️ Aucun `<select>`, aucune quatrième carte par nature d'entrée : le renversement du
    // ticket — deux cartes de source, pas quatre cartes par nature.
    expect(
      wrapper.findAll('a').filter((link) => link.classes().includes('rounded-[14px]'))
    ).toHaveLength(2)

    wrapper.unmount()
  })
})

describe('Coffre / index — la rangée second niveau (Notes/Liens/Identifiants/Photos)', () => {
  test('les quatre restent atteignables, TOUJOURS les quatre — même sans aucune entrée', () => {
    const wrapper = monter([])

    for (const href of [
      '/coffre/notes',
      '/coffre/liens',
      '/coffre/identifiants',
      '/coffre/photos',
    ]) {
      expect(wrapper.find(`a[href="${href}"]`).exists()).toBe(true)
    }

    wrapper.unmount()
  })

  test('les compteurs reflètent réellement les entrées — pas un chiffre figé', () => {
    const wrapper = monter([
      { id: 1, type: 'url', title: 'un lien', media: [], nasFiles: [] },
      { id: 2, type: 'url', title: 'un second lien', media: [], nasFiles: [] },
      { id: 3, type: 'note', title: 'une note', media: [], nasFiles: [] },
      // Un `type: 'note'` porteuse d'un média sort en Photos, jamais en Notes (CC-204, réutilisé
      // tel quel) — c'est ce qui distingue un vrai calcul d'un compteur codé en dur.
      { id: 4, type: 'note', title: 'note-photo', media: [{ id: 9 }], nasFiles: [] },
    ])

    const liens = wrapper.find('a[href="/coffre/liens"]')
    const notes = wrapper.find('a[href="/coffre/notes"]')
    const photos = wrapper.find('a[href="/coffre/photos"]')

    expect(liens.text()).toContain('2')
    expect(notes.text()).toContain('1')
    expect(photos.text()).toContain('1')

    wrapper.unmount()
  })
})
