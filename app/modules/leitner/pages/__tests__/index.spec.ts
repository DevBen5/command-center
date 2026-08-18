import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { router } from '@inertiajs/vue3'
import fr from '../../i18n/fr.json' with { type: 'json' }
import Index from '../index.vue'

/*
| Premier test de composant de cette page (le ticket CC-252 le demande explicitement —
| `pages/index.vue` n'en avait aucun). Trois choses, et rien de plus — le reste de
| l'écran (chrono fantôme, mesure de fluence…) reste couvert par
| `leitner_review_page.spec.ts` côté pur, hors de portée d'un test de composant :
|
| 1. « Je ne sais pas » surligne « À revoir » SANS jamais poster de note (`router.post`
|    n'est appelé par aucun de ces tests).
| 2. « Approfondir » ouvre le panneau et y affiche un résultat de recherche.
| 3. L'état du panneau ET le surlignage forcé se remettent à zéro sur une nouvelle
|    RÉFÉRENCE de `dueCards` portant le MÊME id — le piège n°1 du module (`again` sur une
|    file d'une seule carte renvoie la même carte).
*/

vi.mock('@inertiajs/vue3', () => ({
  Head: { props: ['title'], template: '<div><slot /></div>' },
  Link: { props: ['href'], template: '<a><slot /></a>' },
  router: { post: vi.fn(), get: vi.fn() },
  usePage: () => mockedPage,
}))

const FULL_CAPS = { isAdmin: false, capabilities: ['leitner.review', 'leitner.courses.view'] }
const mockedPage: { url: string; props: { user: { isAdmin: boolean; capabilities: string[] } } } = {
  url: '/revision',
  props: { user: { ...FULL_CAPS } },
}

const i18n = createI18n({
  legacy: false,
  locale: 'fr',
  fallbackLocale: 'fr',
  messages: { fr: { leitner: fr } },
})

/** Une carte due, révisable, avec ses quatre sorties calculées — comme le contrôleur les envoie. */
function card(id = 1) {
  return {
    id,
    front: 'Que négocie le handshake TLS ?',
    back: 'Des clés et des algorithmes.',
    frontHtml: '<p>Que négocie le handshake TLS ?</p>',
    backHtml: '<p>Des clés et des algorithmes.</p>',
    box: 1,
    lastGrade: null,
    mastered: false,
    outcomes: [
      { grade: 'again', box: 1, mastered: false, days: 0 },
      { grade: 'hard', box: 1, mastered: false, days: 1 },
      { grade: 'good', box: 2, mastered: false, days: 2 },
      { grade: 'easy', box: 3, mastered: false, days: 4 },
    ],
    theme: null,
    // La provenance (CC-253) — `[]` est l'état le plus courant, celui qu'aucune de ces
    // trois assertions ne concerne. Un panneau vide ne change rien à leur objet.
    provenance: [],
  }
}

function baseProps(dueCards = [card()]) {
  return {
    view: 'session' as const,
    scope: { label: 'Tout', finished: false },
    queue: 'normal' as const,
    dueCards,
    boxCounts: {},
    masteredCount: 0,
    boxIntervals: { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 },
    stats: {
      dueCount: dueCards.length,
      reviewedToday: 0,
      streak: 0,
      totalCards: dueCards.length,
      retention: null,
    },
  }
}

function mountIndex(props: Record<string, unknown> = {}) {
  return mount(Index, {
    props: { ...baseProps(), ...props },
    global: { plugins: [i18n] },
  })
}

type Wrapper = ReturnType<typeof mountIndex>

/** Trouve un bouton par son texte visible — plus robuste qu'un index de tableau, qui se
 * décale au premier bouton ajouté ailleurs dans le template. */
function buttonByText(wrapper: Wrapper, text: string) {
  return wrapper.findAll('button').find((b) => b.text().trim() === text)
}

/** Le bouton de note actuellement surligné (les quatre restent cliquables, un seul l'est visuellement). */
function highlightedGradeButton(wrapper: Wrapper) {
  return wrapper
    .findAll('button')
    .find((b) => b.classes().includes('border-accent') && b.classes().includes('bg-accent'))
}

describe('Leitner / index — « Je ne sais pas » et « Approfondir » (CC-252)', () => {
  beforeEach(() => {
    mockedPage.props.user = { ...FULL_CAPS }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('surligne « À revoir » sans jamais poster de note', async () => {
    const wrapper = mountIndex()

    await buttonByText(wrapper, 'Je ne sais pas')!.trigger('click')
    await flushPromises()

    // Le verso est dévoilé : le PREMIER bouton de note est désormais visible.
    expect(wrapper.text()).toContain('Des clés et des algorithmes.')
    expect(highlightedGradeButton(wrapper)?.text()).toContain('À revoir')
    expect(router.post).not.toHaveBeenCalled()
  })

  test('masquée sans `leitner.courses.view`, « Approfondir » n’apparaît pas — même après « Je ne sais pas »', async () => {
    mockedPage.props.user = { isAdmin: false, capabilities: ['leitner.review'] }
    const wrapper = mountIndex()

    await buttonByText(wrapper, 'Je ne sais pas')!.trigger('click')
    await flushPromises()

    expect(buttonByText(wrapper, 'Approfondir')).toBeUndefined()
    // Masquer n'est pas fermer : ce test ne prouve que le masquage, la route est
    // couverte séparément par `tests/functional/modules/leitner_course_search.spec.ts`.
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  test('« Approfondir » ouvre le panneau et y affiche le résultat de la recherche', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 42,
              courseTitle: 'Réseaux',
              headingPath: ['TLS', 'Handshake'],
              bodyHtml: '<p>Le protocole négocie des clés.</p>',
              aliases: null,
            },
          ],
        }),
      })
    )
    const wrapper = mountIndex()

    await buttonByText(wrapper, 'verso masqué — cliquer pour révéler')!.trigger('click')
    await flushPromises()
    await buttonByText(wrapper, 'Approfondir')!.trigger('click')
    await flushPromises()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/revision/1/course-search',
      expect.objectContaining({ headers: { accept: 'application/json' } })
    )
    expect(wrapper.text()).toContain('TLS › Handshake')
    expect(wrapper.text()).toContain('Le protocole négocie des clés.')
  })

  /**
   * ⚠️ **Le test qui compte du lot.** Sur une file d'une seule carte, `again` renvoie EXACTEMENT
   * la même carte — même id — dans un tableau `dueCards` neuf (nouvelle référence, comme
   * Inertia le fait à chaque réponse). Un `watch` sur `currentCard.id` ne se déclencherait
   * PAS ici : c'est précisément le piège que ce test verrouille, sur les deux états ajoutés
   * par CC-252 (`forcedHighlight`, le panneau).
   */
  test('l’état du raccourci et du panneau se remet à zéro sur une nouvelle référence de dueCards, même id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 1,
              courseTitle: 'Réseaux',
              headingPath: ['TLS'],
              bodyHtml: '<p>X</p>',
              aliases: null,
            },
          ],
        }),
      })
    )
    const wrapper = mountIndex()

    await buttonByText(wrapper, 'Je ne sais pas')!.trigger('click')
    await flushPromises()

    expect(highlightedGradeButton(wrapper)?.text()).toContain('À revoir')
    expect(wrapper.text()).toContain('TLS')

    // Nouvelle réponse du serveur : MÊME id, NOUVELLE référence de tableau.
    await wrapper.setProps({ dueCards: [card(1)] })
    await wrapper.vm.$nextTick()

    // Le verso est retombé (nouvelle carte « logique »), et plus rien de l'ancien état
    // de présélection/panneau ne doit survivre.
    expect(wrapper.text()).not.toContain('Des clés et des algorithmes.')
    expect(buttonByText(wrapper, 'Approfondir')).toBeUndefined() // revealed = false : bouton absent
  })
})
