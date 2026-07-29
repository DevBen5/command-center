import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import type { Cards } from '../../shared/cards.js'
import Home from '../home.vue'

/*
| Le tableau de bord : ce qu'il survit à ne pas recevoir, et la seule *logique* qu'il porte.
|
| ⚠️ **Ce que ce fichier couvre est un crash, pas une apparence.** Depuis CC-81 le serveur
| n'envoie plus les sections qu'un compte ne peut pas voir : elles arrivent à `null`. Sans le
| `v-if` de chaque bloc, `cards.services.down.length` lève — **côté client**, donc pendant que
| la suite serveur reste verte et que le payload est parfait. C'est exactement le genre de
| panne que le filtrage introduit et qu'aucun test fonctionnel ne verrait.
|
| ⚠️ Le droit, lui, ne se joue pas ici : `HomeController` ne charge ni n'envoie ces données.
| Ce test vérifie que la page survit à leur absence, pas qu'elle les cache.
|
| ⚠️ **L'instance i18n embarque le namespace `dashboard`** (CC-94), et le vrai `fr.json` du
| module — pas un double. Sans lui, chaque `t('dashboard.home.…')` rendrait la clé brute et les
| assertions de texte échoueraient sur la mauvaise cause (piège du CLAUDE.md). Depuis que la page
| appelle `useI18n()`, un mount sans plugin ne dévie même pas : il lève.
*/

vi.mock('@inertiajs/vue3', () => ({
  usePage: () => ({ url: '/', props: {} }),
  router: { post: vi.fn() },
  Link: { props: ['href'], template: '<a :href="href"><slot /></a>' },
  Head: { props: ['title'], template: '<div><slot /></div>' },
}))

const COMPLET: Cards = {
  services: { up: 3, total: 4, down: ['postgres-prod'], highRam: [] },
  agents: { active: 2, running: [], failed: [{ id: 7, name: 'sauvegarde-nocturne' }] },
  veille: { total: 12, queue: 3, untagged: 1 },
  leitner: { due: 5, total: 40 },
}

/**
 * Monte la page avec son namespace i18n — l'unique façon de la monter depuis CC-94.
 *
 * ⚠️ **`Cards` vient de `shared/cards.ts`, pas d'une copie locale.** `vue-shim.d.ts` type les
 * `.vue` en `any` : `mount(Home, …)` ne vérifie rien des props qu'on lui passe. C'est ce
 * paramètre-ci, et lui seul, qui fait rougir `tsc` sur un jeu d'essai devenu faux.
 */
function monter(cards: Cards) {
  return mount(Home, {
    props: { cards },
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: 'fr',
          fallbackLocale: 'fr',
          messages: { fr: { dashboard: fr } },
        }),
      ],
    },
  })
}

describe('Core / tableau de bord', () => {
  test('un administrateur voit les quatre sections', () => {
    const wrapper = monter(COMPLET)

    expect(wrapper.text()).toContain('postgres-prod')
    expect(wrapper.text()).toContain('sauvegarde-nocturne')

    // Chaque module reste atteignable — l'en-tête pointe vers sa racine.
    const liens = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(liens).toContain('/services')
    expect(liens).toContain('/agents')
    expect(liens).toContain('/veille')
    expect(liens).toContain('/revision')

    wrapper.unmount()
  })

  test('CC-52 : les lignes internes mènent à des destinations distinctes de l’en-tête', () => {
    // Le fond de la demande : cliquer une ligne doit mener AILLEURS que l'en-tête, là où une vraie
    // cible existe. Un retour d'une ligne vers la racine du module (le comportement d'origine, où
    // tout menait au même endroit) ferait disparaître ces `href` et rougir ce test.
    const wrapper = monter(COMPLET)

    const liens = wrapper.findAll('a').map((a) => a.attributes('href'))
    // Agent en échec → sa sélection + ses logs, pas la liste brute.
    expect(liens).toContain('/agents?id=7')
    // Veille « File de lecture » → la file filtrée, pas tout le flux.
    expect(liens).toContain('/veille?readingQueue=1')
    // Révision « à réviser » → la session sur toutes les dues ; « en mémoire » → le catalogue.
    expect(liens).toContain('/revision?scope=all')
    expect(liens).toContain('/revision/settings')

    wrapper.unmount()
  })

  test('CC-52 : l’en-tête ouvre le module même sans aucune ligne interne', () => {
    // Le cas nominal — tout va bien, donc Services et Agents n'affichent que leur état vide et
    // AUCUNE ligne. Le seul `<a>` vers ces deux modules ne peut alors venir que de l'en-tête :
    // ce test isole donc précisément la zone cliquable ajoutée par CC-52. Il rougirait si
    // l'en-tête redevenait une `<div>` inerte (le bug d'origine : cliquer la carte saine ne
    // menait nulle part).
    const wrapper = monter({
      services: { up: 4, total: 4, down: [], highRam: [] },
      agents: { active: 2, running: [], failed: [] },
      veille: { total: 12, queue: 3, untagged: 1 },
      leitner: { due: 5, total: 40 },
    })

    expect(wrapper.text()).toContain('Tous les services sont sains.')
    expect(wrapper.text()).toContain("Aucun agent ne requiert d'attention.")
    const liens = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(liens).toContain('/services')
    expect(liens).toContain('/agents')

    wrapper.unmount()
  })

  test('la page se rend sans les sections réservées à l’administrateur', () => {
    const wrapper = monter({ ...COMPLET, services: null, agents: null })

    // Rendue, pas cassée — et sans les liens morts vers deux écrans qui répondraient 403.
    expect(wrapper.text()).not.toContain('postgres-prod')
    expect(wrapper.text()).not.toContain('sauvegarde-nocturne')
    const liens = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(liens).not.toContain('/services')
    expect(liens).not.toContain('/agents')
    // Ce à quoi le compte a droit reste affiché.
    expect(liens).toContain('/revision')

    wrapper.unmount()
  })

  test('la page se rend même quand aucune section n’est accordée', () => {
    // Le compte qui porte `dashboard.view` et rien d'autre. L'écran est vide de contenu, mais
    // il s'affiche : une exception ici rendrait la page blanche.
    const wrapper = monter({ services: null, agents: null, veille: null, leitner: null })

    expect(wrapper.findAll('a')).toHaveLength(0)
    expect(wrapper.text()).toContain('Ce qui demande votre attention')

    wrapper.unmount()
  })
})

/*
| CC-94 : la pluralisation des sept libellés comptés qui s'accordent.
|
| ⚠️ **Le cas qui compte est `0`.** La règle de pluralisation par défaut de vue-i18n mappe 0 sur
| la forme 1 : un message à DEUX formes (`"élément | éléments"`) rendrait « 0 éléments ». C'est ce
| cas, et lui seul, qui atteste qu'on a bien gardé la règle française — d'où les trois formes
| (`"{n} élément | {n} élément | {n} éléments"`), comme `services.stats.down` (CC-90).
|
| ⚠️ **L'assertion qui prouve quelque chose est la NÉGATIVE.** « 0 élément » est un préfixe de
| « 0 éléments » : `toContain(singulier)` passerait sur les deux écritures. C'est
| `not.toContain(pluriel)` qui les distingue, donc qui rougit si un message perd sa forme du
| milieu.
|
| ⚠️ **Au pluriel, chaque compteur reçoit une valeur DIFFÉRENTE.** Deux libellés partagent leur
| texte — « actifs » côté Services et côté Agents, « éléments » dans l'en-tête Veille et dans sa
| ligne. Avec la même valeur partout, une assertion satisfaite par l'un couvrirait la faute de
| l'autre ; des valeurs distinctes rendent chaque chaîne attendue unique dans la page.
*/

interface Compteurs {
  up: number
  down: number
  active: number
  running: number
  total: number
  queue: number
  untagged: number
  due: number
  cartes: number
}

/** Monte la page avec une valeur par compteur, et rend le texte affiché. */
function texteAvec(c: Compteurs): string {
  const wrapper = monter({
    services: {
      up: c.up,
      total: 99,
      down: Array.from({ length: c.down }, (_, i) => `service-${i}`),
      highRam: [],
    },
    agents: {
      active: c.active,
      running: Array.from({ length: c.running }, (_, i) => ({ id: i, name: `agent-${i}` })),
      failed: [],
    },
    veille: { total: c.total, queue: c.queue, untagged: c.untagged },
    leitner: { due: c.due, total: c.cartes },
  })
  const texte = wrapper.text()
  wrapper.unmount()
  return texte
}

/** Tous les compteurs à la même valeur — pour les bornes 0 et 1, qui n'ont pas de voisines. */
function tousA(n: number): Compteurs {
  return {
    up: n,
    down: n,
    active: n,
    running: n,
    total: n,
    queue: n,
    untagged: n,
    due: n,
    cartes: n,
  }
}

describe('CC-94 : pluriel des libellés comptés', () => {
  test.each([0, 1])('à %i, aucun libellé compté ne passe au pluriel', (n) => {
    const texte = texteAvec(tousA(n))

    // Les sept singuliers sont là…
    expect(texte).toContain(`${n} actif`) // Services, et Agents
    expect(texte).toContain(`${n} arrêté`)
    expect(texte).toContain(`${n} élément`) // en-tête Veille, et sa ligne « À lire plus tard »
    expect(texte).toContain(`${n} capture sans tag`)
    expect(texte).toContain(`${n} due`)
    expect(texte).toContain(`${n} carte à réviser aujourd'hui`)
    expect(texte).toContain(`${n} carte en mémoire`)

    // …et aucun pluriel ne s'est glissé : c'est cette moitié-là qui rougit si un message
    // retombe à deux formes.
    expect(texte).not.toContain(`${n} actifs`)
    expect(texte).not.toContain(`${n} arrêtés`)
    expect(texte).not.toContain(`${n} éléments`)
    expect(texte).not.toContain(`${n} captures sans tag`)
    expect(texte).not.toContain(`${n} dues`)
    expect(texte).not.toContain(`${n} cartes à réviser aujourd'hui`)
    expect(texte).not.toContain(`${n} cartes en mémoire`)
  })

  test('au-delà de 1, chaque libellé prend le pluriel', () => {
    const texte = texteAvec({
      up: 2,
      down: 3,
      active: 4,
      running: 0,
      total: 5,
      queue: 6,
      untagged: 7,
      due: 8,
      cartes: 9,
    })

    expect(texte).toContain('2 actifs') // Services
    expect(texte).toContain('3 arrêtés')
    expect(texte).toContain('4 actifs') // Agents — valeur distincte de Services, exprès
    expect(texte).toContain('5 éléments') // en-tête Veille
    expect(texte).toContain('À lire plus tard — 6 éléments') // sa ligne, autre compteur
    expect(texte).toContain('7 captures sans tag')
    expect(texte).toContain('8 dues')
    expect(texte).toContain("8 cartes à réviser aujourd'hui")
    expect(texte).toContain('9 cartes en mémoire')
  })

  test('les libellés invariables gardent leur forme unique, quel que soit le nombre', () => {
    // « en cours », « à lire » et « au total » ne s'accordent pas : ils restent des messages
    // simples à paramètre. Les écrire en trois formes n'aurait rien changé à l'écran, mais
    // aurait laissé croire à une règle là où il n'y en a pas.
    for (const n of [0, 1, 5]) {
      const texte = texteAvec({ ...tousA(0), running: n, queue: n, cartes: n })

      expect(texte).toContain(`${n} en cours`)
      expect(texte).toContain(`${n} à lire`)
      expect(texte).toContain(`${n} au total`)
    }
  })
})
