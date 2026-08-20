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
    // Le glossaire (CC-254) — `[]` par défaut : aucune de ces trois assertions ne concerne
    // le surlignage, et un glossaire vide ne change rien à leur objet.
    glossary: [] as Array<{ term: string; sectionId: number }>,
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

  test('« Approfondir » ouvre le panneau et liste titre de cours + chemin, sans afficher le contenu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 42,
              courseId: 9,
              courseTitle: 'Réseaux',
              headingPath: ['TLS', 'Handshake'],
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
    // La ligne compacte (CC-274) : titre de cours + chemin, aucun corps affiché d'office.
    expect(wrapper.text()).toContain('Réseaux')
    expect(wrapper.text()).toContain('TLS › Handshake')
    // Une seule requête : le contenu ne se charge qu'au clic sur la ligne.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  test('cliquer une ligne d’Approfondir ouvre la modale et charge le contenu de la section', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/course-search')) {
          return {
            ok: true,
            json: async () => ({
              results: [
                {
                  id: 42,
                  courseId: 9,
                  courseTitle: 'Réseaux',
                  headingPath: ['TLS'],
                  aliases: null,
                },
              ],
            }),
          }
        }
        return {
          ok: true,
          json: async () => ({
            id: 42,
            courseId: 9,
            courseTitle: 'Réseaux',
            headingPath: ['TLS'],
            bodyHtml: '<p>Le protocole négocie des clés.</p>',
            aliases: null,
          }),
        }
      })
    )
    const wrapper = mountIndex()

    await buttonByText(wrapper, 'verso masqué — cliquer pour révéler')!.trigger('click')
    await flushPromises()
    await buttonByText(wrapper, 'Approfondir')!.trigger('click')
    await flushPromises()
    await buttonByText(wrapper, 'Réseaux · TLS')!.trigger('click')
    await flushPromises()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/revision/cours/sections/42',
      expect.objectContaining({ headers: { accept: 'application/json' } })
    )
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
            { id: 1, courseId: 9, courseTitle: 'Réseaux', headingPath: ['TLS'], aliases: null },
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

/**
 * La provenance en liste compacte (CC-274) : le lien explicite (CC-253) ne rend plus le
 * corps de la section d'office, il liste ses sections et ouvre la modale partagée
 * (`sectionModalOpen`, voir aussi le second `describe` plus bas) au clic.
 */
describe('Leitner / index — provenance en modale (CC-274)', () => {
  beforeEach(() => {
    mockedPage.props.user = { ...FULL_CAPS }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function withProvenance(...sections: Array<{ courseTitle: string; headingPath: string[] }>) {
    return {
      ...card(),
      provenance: sections.map((s, i) => ({
        id: 100 + i,
        courseId: 9,
        courseTitle: s.courseTitle,
        headingPath: s.headingPath,
        aliases: null,
        obsoleteAt: null,
      })),
    }
  }

  test('un seul cours : en-tête unique « Vient de », pas de titre répété par ligne', async () => {
    const wrapper = mountIndex({
      dueCards: [withProvenance({ courseTitle: 'Réseaux', headingPath: ['HTTP'] })],
    })

    await buttonByText(wrapper, 'verso masqué — cliquer pour révéler')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Vient de : Réseaux')
    // Le titre n'est pas répété une seconde fois sur la ligne elle-même.
    expect(buttonByText(wrapper, 'Réseaux · HTTP')).toBeUndefined()
    expect(buttonByText(wrapper, 'HTTP')).toBeDefined()
  })

  test('deux cours différents : pas d’en-tête, le titre est répété sur chaque ligne', async () => {
    const wrapper = mountIndex({
      dueCards: [
        withProvenance(
          { courseTitle: 'Réseaux', headingPath: ['HTTP'] },
          { courseTitle: 'Docker avancé', headingPath: ['Volumes'] }
        ),
      ],
    })

    await buttonByText(wrapper, 'verso masqué — cliquer pour révéler')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Vient de :')
    expect(buttonByText(wrapper, 'Réseaux · HTTP')).toBeDefined()
    expect(buttonByText(wrapper, 'Docker avancé · Volumes')).toBeDefined()
  })

  test('cliquer une ligne de provenance ouvre la modale et charge le contenu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 100,
          courseId: 9,
          courseTitle: 'Réseaux',
          headingPath: ['HTTP'],
          bodyHtml: '<p>Les verbes du protocole.</p>',
          aliases: null,
        }),
      })
    )
    const wrapper = mountIndex({
      dueCards: [withProvenance({ courseTitle: 'Réseaux', headingPath: ['HTTP'] })],
    })

    await buttonByText(wrapper, 'verso masqué — cliquer pour révéler')!.trigger('click')
    await flushPromises()
    await buttonByText(wrapper, 'HTTP')!.trigger('click')
    await flushPromises()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/revision/cours/sections/100',
      expect.objectContaining({ headers: { accept: 'application/json' } })
    )
    expect(wrapper.text()).toContain('Les verbes du protocole.')
  })

  test('aucune provenance : le panneau reste absent, sans message vide', async () => {
    const wrapper = mountIndex({ dueCards: [card()] }) // provenance: [] par défaut

    await buttonByText(wrapper, 'verso masqué — cliquer pour révéler')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Vient de')
  })
})

/**
 * Les mots-clés du recto (CC-254) : le tokeniseur pur est prouvé dans
 * `tests/unit/leitner_glossary_highlight.spec.ts` — ce qui reste hors de sa portée, et que ce
 * fichier couvre :
 *
 * 1. Un terme reconnu du glossaire rend un `<button>` cliquable dans le recto.
 * 2. Le cliquer ouvre la modale et charge le contenu de la section.
 * 3. ⚠️ **Le test qui compte du lot** : ouvrir AVANT la première frappe marque
 *    l'interruption (transmise au juge) ; ouvrir APRÈS ne la marque pas — les deux sens,
 *    sinon la garde peut être inerte sans qu'aucun test ne le voie.
 * 4. Le recto n'utilise plus aucun `v-html` : un terme malicieux dans `front` s'affiche en
 *    texte littéral, jamais exécuté.
 */
describe('Leitner / index — mots-clés du recto (CC-254)', () => {
  const GLOSSARY = [{ term: 'TLS', sectionId: 7 }]

  function fetchMock(): ReturnType<typeof vi.fn> {
    return vi.fn(async (url: string) => {
      if (url.includes('/cours/sections/')) {
        return {
          ok: true,
          json: async () => ({
            id: 7,
            courseId: 3,
            courseTitle: 'Réseaux',
            headingPath: ['TLS'],
            bodyHtml: '<p>Le protocole TLS négocie des clés.</p>',
            aliases: ['TLS', 'Transport Layer Security'],
          }),
        }
      }
      if (url.includes('/judge')) {
        return {
          ok: true,
          json: async () => ({
            verdict: null,
            missing: '',
            latencyMs: null,
            suggestedGrade: null,
            unavailable: false,
          }),
        }
      }
      return { ok: true, json: async () => ({ results: [] }) }
    })
  }

  beforeEach(() => {
    mockedPage.props.user = { ...FULL_CAPS }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('un terme reconnu du glossaire est cliquable dans le recto', () => {
    vi.stubGlobal('fetch', fetchMock())
    const wrapper = mountIndex({ glossary: GLOSSARY })

    expect(buttonByText(wrapper, 'TLS')).toBeDefined()
  })

  test('le clic ouvre la modale et affiche le contenu de la section', async () => {
    vi.stubGlobal('fetch', fetchMock())
    const wrapper = mountIndex({ glossary: GLOSSARY })

    await buttonByText(wrapper, 'TLS')!.trigger('click')
    await flushPromises()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/revision/cours/sections/7',
      expect.objectContaining({ headers: { accept: 'application/json' } })
    )
    expect(wrapper.text()).toContain('Le protocole TLS négocie des clés.')
  })

  test('ouvrir la définition AVANT la première frappe marque l’interruption transmise au juge', async () => {
    vi.stubGlobal('fetch', fetchMock())
    const wrapper = mountIndex({ glossary: GLOSSARY })

    await buttonByText(wrapper, 'TLS')!.trigger('click')
    await flushPromises()

    await wrapper.find('textarea').setValue('Négocie des clés.')
    await buttonByText(wrapper, 'verso masqué — cliquer pour révéler')!.trigger('click')
    await flushPromises()

    const judgeCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url]) => String(url).includes('/judge'))!
    const body = JSON.parse((judgeCall[1] as RequestInit).body as string)
    expect(body.interrupted).toBe(true)
  })

  test('ouvrir la définition APRÈS la première frappe ne marque PAS l’interruption', async () => {
    vi.stubGlobal('fetch', fetchMock())
    const wrapper = mountIndex({ glossary: GLOSSARY })

    await wrapper.find('textarea').setValue('Négocie des clés.')
    await buttonByText(wrapper, 'TLS')!.trigger('click')
    await flushPromises()
    await buttonByText(wrapper, 'verso masqué — cliquer pour révéler')!.trigger('click')
    await flushPromises()

    const judgeCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url]) => String(url).includes('/judge'))!
    const body = JSON.parse((judgeCall[1] as RequestInit).body as string)
    expect(body.interrupted).toBe(false)
  })

  test('le bouton « Fermer » referme la modale', async () => {
    vi.stubGlobal('fetch', fetchMock())
    const wrapper = mountIndex({ glossary: GLOSSARY })

    await buttonByText(wrapper, 'TLS')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Le protocole TLS négocie des clés.')

    await buttonByText(wrapper, 'Fermer')!.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).not.toContain('Le protocole TLS négocie des clés.')
  })

  test('une nouvelle référence de dueCards, même id, ferme toute modale de glossaire ouverte', async () => {
    vi.stubGlobal('fetch', fetchMock())
    const wrapper = mountIndex({ glossary: GLOSSARY })

    await buttonByText(wrapper, 'TLS')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Le protocole TLS négocie des clés.')

    await wrapper.setProps({ dueCards: [card(1)] })
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).not.toContain('Le protocole TLS négocie des clés.')
  })

  test('un recto malicieux s’affiche en texte littéral, jamais en HTML exécuté', () => {
    vi.stubGlobal('fetch', fetchMock())
    const malicious = card()
    malicious.front = 'Que fait <script>alert(1)</script> ?'
    const wrapper = mountIndex({ dueCards: [malicious], glossary: [] })

    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('Que fait <script>alert(1)</script> ?')
  })
})
