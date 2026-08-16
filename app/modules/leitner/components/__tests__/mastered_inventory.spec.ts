import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import MasteredInventory from '../MasteredInventory.vue'
import type { MasteredCard } from '../../shared/mastery_inventory.js'

/*
| L'inventaire d'acquis (CC-262) — le seul écran du module qui ne parle pas de dette.
|
| ⚠️ **Ce qui se teste ici est le REPLI, et rien d'autre.** Le regroupement par mois vit
| dans `shared/mastery_inventory.ts`, pur et prouvé par Japa ; ce composant ne décide que
| d'ouvrir ou non. C'est peu, et c'est précisément ce qui régresse en silence : une liste de
| centaines de lignes dépliée par défaut sur l'écran de choix ne lève aucune erreur.
|
| ⚠️ **Le test reproduit le GESTE, il ne constate pas l'état de départ.** Monter puis
| assertir « la liste est absente » ne prouverait rien : le composant démarre replié. Il faut
| cliquer, voir apparaître, recliquer, voir disparaître — sans quoi la garde passerait au
| vert avec un bouton mort.
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

function card(id: number, masteredAt: string, nextReview = '2027-01-12T00:00:00+01:00') {
  return {
    id,
    front: `Carte ${id}`,
    path: 'DevOps · Docker',
    masteredAt,
    nextReview,
  } as MasteredCard
}

function monter(cards: MasteredCard[], counts: Partial<{ thisMonth: number; lost: number }> = {}) {
  return mount(MasteredInventory, {
    props: {
      cards,
      total: cards.length,
      thisMonth: counts.thisMonth ?? 0,
      lostThisYear: counts.lost ?? 0,
    },
    global: { plugins: [i18n] },
  })
}

describe('Leitner / inventaire d’acquis', () => {
  const CARDS = [
    card(1, '2026-08-12T10:00:00+02:00'),
    card(2, '2026-08-02T10:00:00+02:00'),
    card(3, '2026-05-20T10:00:00+02:00'),
  ]

  test('la liste n’est dépliée qu’au clic, et se replie au suivant', async () => {
    const wrapper = monter(CARDS)

    // Replié au montage : la liste n'est **pas** dans le DOM (`v-if`, jamais `v-show`).
    expect(wrapper.findAll('ul')).toHaveLength(0)

    await wrapper.get('button').trigger('click')
    expect(wrapper.findAll('ul').length).toBeGreaterThan(0)
    expect(wrapper.text()).toContain('Carte 1')

    // Et le geste inverse referme : un bouton qui n'ouvrirait que dans un sens passerait
    // un test qui s'arrêterait à l'assertion précédente.
    await wrapper.get('button').trigger('click')
    expect(wrapper.findAll('ul')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('Carte 1')
  })

  test('dépliée, la liste est groupée par mois', async () => {
    const wrapper = monter(CARDS)
    await wrapper.get('button').trigger('click')

    // Deux mois pour trois cartes : le regroupement est bien appliqué, et non une liste
    // plate. (Son ordre et ses bornes sont prouvés côté Japa, sur la fonction pure.)
    expect(wrapper.findAll('ul')).toHaveLength(2)
    expect(wrapper.findAll('li')).toHaveLength(3)
  })

  test('le total et « ce mois-ci » s’affichent sans déplier', () => {
    const wrapper = monter(CARDS, { thisMonth: 2 })

    expect(wrapper.text()).toContain('3 cartes maîtrisées')
    expect(wrapper.text()).toContain('dont 2 ce mois-ci')
    // Le détail, lui, reste replié.
    expect(wrapper.text()).not.toContain('Carte 1')
  })

  test('les pertes de l’année ne s’affichent que s’il y en a', () => {
    // ⚠️ Le chiffre qui rend l'inventaire crédible plutôt qu'auto-congratulant — mais
    // « 0 carte perdue cette année » sur un compte qui n'a rien perdu serait du bruit.
    expect(monter(CARDS, { lost: 2 }).text()).toContain('2 cartes perdues cette année')
    expect(monter(CARDS, { lost: 0 }).text()).not.toContain('perdue')
  })

  test('sans acquis, il explique au lieu d’afficher un zéro nu', () => {
    const wrapper = monter([])

    expect(wrapper.text()).toContain('0 carte maîtrisée')
    expect(wrapper.text()).toContain('boîte 5')
    // Et il n'y a rien à déplier : le bouton disparaît plutôt que d'ouvrir sur du vide.
    expect(wrapper.findAll('button')).toHaveLength(0)
  })
})
