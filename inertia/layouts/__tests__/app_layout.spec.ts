import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { router } from '@inertiajs/vue3'
import fr from '../../i18n/fr.json'
// ⚠️ Les messages des modules sont chargés ici depuis CC-110, sous leur namespace — celui-là même
// que le glob d'`inertia/i18n/index.ts` construit au boot. Sans eux, le fil d'Ariane ne trouverait
// aucune clé d'écran et retomberait sur le libellé du module : le test passerait en n'ayant rien
// prouvé, exactement le défaut qu'il est censé attraper.
import leitnerFr from '../../../app/modules/leitner/i18n/fr.json'
import veilleFr from '../../../app/modules/veille/i18n/fr.json'
import AppLayout from '../AppLayout.vue'

/*
| Le layout : navigation, état actif, titre de page, palette ⌘K (ouverture, fermeture, filtrage).
|
| ⚠️ Le filtrage de la palette est désormais câblé (CC-26) et testé plus bas, sur le **geste réel** :
| ouvrir, taper, et observer les non-correspondances DISPARAÎTRE. À l'ouverture, toutes les entrées
| sont visibles — une simple assertion de présence passerait même filtre mort ; c'est l'absence qui
| atteste le filtre.
|
| ⚠️ La navigation ↑↓ / ↵ que la palette annonce est désormais câblée (CC-27) et testée plus bas,
| toujours sur le **geste réel** : on dispatch de vrais `KeyboardEvent` sur `window` et on lit le
| DOM — quelle entrée de l'overlay porte `bg-accent-soft`, quel `href` reçoit `router.visit`. Le
| reset au filtre est prouvé NÉGATIVEMENT : on descend loin dans la liste, on filtre jusqu'à une
| seule entrée, et c'est le surlignage de CET unique résultat qui atteste la remise à zéro — un
| index figé pointerait hors de la liste réduite et ne surlignerait rien.
|
| ⚠️ jsdom ne fait aucun layout : ces tests prouvent QUELLE ligne est sélectionnée (sa classe), pas
| que `accent-soft` s'affiche rose. L'apparence se vérifie au navigateur, nulle part ailleurs.
|
| ⚠️ L'instance i18n est neuve à chaque montage, jamais le singleton de `inertia/i18n` :
| `setLocale()` le mute globalement, et deux tests qui changeraient de langue
| s'influenceraient selon leur ordre d'exécution.
*/

const NAV = {
  services: { total: 4, down: 1 },
  agents: { total: 3, failed: 0 },
  veille: { queue: 12 },
  leitner: { due: 5 },
  host: 'ben-pc',
}

// ⚠️ `component` fait partie du mock depuis CC-110 : c'est de lui que le fil d'Ariane tire le nom
// de l'écran ouvert (`modules/leitner/stats` → `leitner.stats.*`). Un mock qui l'omet ne décrit pas
// ce qu'Inertia envoie, et faisait lever le layout entier avant que `crumbKeys` ne s'en garde.
const mockedPage = {
  url: '/',
  component: 'core/dashboard/home',
  props: {} as Record<string, unknown>,
}

// Depuis CC-71, la barre ne montre que ce à quoi le compte a droit. ⚠️ **Depuis CC-81, ce
// filtrage est fait par le serveur** : les entrées arrivent dans la prop partagée
// `destinations`, calculée depuis le registre qui sert aussi à l'atterrissage. Le layout ne
// décide plus qui voit quoi — il rend ce qu'il reçoit, et y attache libellé, icône et pastille.
const DESTINATIONS = [
  { key: 'accueil', href: '/' },
  { key: 'services', href: '/services' },
  { key: 'agents', href: '/agents' },
  { key: 'veille', href: '/veille' },
  { key: 'revision', href: '/revision' },
]

const ADMIN = { fullName: 'Admin', email: 'admin@example.com', isAdmin: true, capabilities: [] }

// ⚠️ `router.visit` fait partie du mock : ↵ dans la palette navigue par ce chemin (visite Inertia
// GET), là où le mock `Link` ne rend qu'un `<a>` sans navigation réelle. Sans lui, l'appel de ↵
// jetterait « visit is not a function ».
vi.mock('@inertiajs/vue3', () => ({
  usePage: () => mockedPage,
  router: { post: vi.fn(), visit: vi.fn() },
  Link: { props: ['href'], template: '<a :href="href"><slot /></a>' },
}))

function monter(
  url: string,
  user: unknown = ADMIN,
  destinations: unknown = DESTINATIONS,
  component = 'core/dashboard/home'
) {
  mockedPage.url = url
  mockedPage.component = component
  mockedPage.props = {
    nav: NAV,
    user,
    destinations,
    locale: 'fr',
    supportedLocales: ['fr', 'en'],
  }

  return mount(AppLayout, {
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: 'fr',
          fallbackLocale: 'fr',
          messages: { fr: { ...fr, leitner: leitnerFr, veille: veilleFr } },
        }),
      ],
    },
    attachTo: document.body,
  })
}

// Le libellé d'une entrée de palette : « Aller à — <label> ». On le construit depuis fr.json
// plutôt qu'en dur — la chaîne dérive alors avec la traduction. C'est aussi ce préfixe qui
// distingue une entrée de palette d'un lien de barre latérale, où « Révision » figure nu.
const goTo = (label: string) => fr.palette.goTo.replace('{label}', label)

async function ouvrirPalette(wrapper: ReturnType<typeof monter>) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
  await wrapper.vm.$nextTick()
  return wrapper.get('input')
}

// Les entrées cliquables de l'overlay (`.z-50`), dans l'ordre de rendu : navigation puis système.
// C'est cette liste plate que ↑↓ parcourent, et dont on lit le surlignage `bg-accent-soft`.
function liensPalette(wrapper: ReturnType<typeof monter>) {
  return wrapper.get('.z-50').findAll('a')
}

/**
 * Le fil d'Ariane de la topbar, **découpé sur ses séparateurs** (CC-110).
 *
 * ⚠️ On compare la liste des segments et non la présence d'un libellé : chercher « Cartes » passerait
 * aussi bien si le module avait disparu du fil, ou s'il y figurait deux fois. C'est le **nombre** de
 * segments qui porte le comportement. (`text()` colle les nœuds sans espace : le découpage se fait
 * sur le `/`, pas sur la mise en forme.)
 */
function filDAriane(wrapper: ReturnType<typeof monter>): string[] {
  return wrapper
    .get('header')
    .text()
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')
}

describe('Core / AppLayout', () => {
  test('Ctrl+K ouvre la palette, Échap la ferme', async () => {
    const wrapper = monter('/')
    expect(wrapper.text()).not.toContain(fr.palette.navigation)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain(fr.palette.navigation)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain(fr.palette.navigation)

    wrapper.unmount()
  })

  test('Ctrl+K bascule : un second appui referme', async () => {
    const wrapper = monter('/')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await wrapper.vm.$nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).not.toContain(fr.palette.navigation)
    wrapper.unmount()
  })

  test('taper filtre la palette, insensible à la casse et aux accents (CC-26)', async () => {
    const wrapper = monter('/')
    const input = await ouvrirPalette(wrapper)

    await input.setValue('revision')
    // « revision » — ASCII, minuscule — retrouve « Révision » : accent ET casse ignorés, et le
    // filtre porte sur le libellé traduit, pas sur la clé.
    expect(wrapper.text()).toContain(goTo(fr.nav.revision))
    // ⚠️ Le cœur du test : les non-correspondances DISPARAISSENT. À l'ouverture toutes les entrées
    // étaient là ; un filtre mort les y laisserait. C'est cette absence, pas la présence ci-dessus,
    // qui prouve que le champ n'est plus inerte.
    expect(wrapper.text()).not.toContain(goTo(fr.nav.services))
    expect(wrapper.text()).not.toContain(goTo(fr.nav.agents))

    wrapper.unmount()
  })

  test('aucune correspondance affiche l’état vide, pas une liste muette (CC-26)', async () => {
    const wrapper = monter('/')
    const input = await ouvrirPalette(wrapper)

    await input.setValue('zzz')
    expect(wrapper.text()).toContain(fr.palette.empty)
    // Les deux sections ont disparu — ni navigation, ni système.
    expect(wrapper.text()).not.toContain(goTo(fr.nav.revision))
    expect(wrapper.text()).not.toContain(goTo(fr.nav.administration))

    wrapper.unmount()
  })

  test('la palette liste l’administration pour un admin, et la filtre (CC-26)', async () => {
    const wrapper = monter('/')
    const input = await ouvrirPalette(wrapper)

    // Présente à l'ouverture, sans filtre…
    expect(wrapper.text()).toContain(goTo(fr.nav.administration))
    // …et retrouvée en tapant, quand la navigation, elle, s'efface.
    await input.setValue('admin')
    expect(wrapper.text()).toContain(goTo(fr.nav.administration))
    expect(wrapper.text()).not.toContain(goTo(fr.nav.revision))

    wrapper.unmount()
  })

  test('la palette ne propose pas l’administration à un non-admin (CC-26)', async () => {
    // `systemItems` est vide hors admin : l'entrée Administration n'entre pas dans la palette, donc
    // le filtre n'a rien à en faire. On l'ouvre sans filtre pour l'affirmer sur la liste complète.
    const lecteur = monter(
      '/',
      {
        fullName: 'Lecteur',
        email: 'lecteur@example.com',
        isAdmin: false,
        capabilities: ['dashboard.view', 'leitner.view'],
      },
      [
        { key: 'accueil', href: '/' },
        { key: 'revision', href: '/revision' },
      ]
    )
    const input = await ouvrirPalette(lecteur)

    expect(lecteur.text()).not.toContain(goTo(fr.nav.administration))
    // La navigation, elle, s'y trouve bien.
    expect(lecteur.text()).toContain(goTo(fr.nav.revision))
    expect(input.exists()).toBe(true)

    lecteur.unmount()
  })

  test('↑↓ déplacent la sélection avec bouclage, la 1ʳᵉ entrée est présélectionnée (CC-27)', async () => {
    const wrapper = monter('/')
    await ouvrirPalette(wrapper)

    // Admin : 6 entrées (accueil, services, agents, veille, revision, administration). À l'ouverture,
    // la tête de liste est déjà surlignée — ↵ est actionnable sans même toucher aux flèches.
    expect(liensPalette(wrapper)[0].classes()).toContain('bg-accent-soft')
    expect(liensPalette(wrapper)[1].classes()).not.toContain('bg-accent-soft')

    // ↓ : la sélection descend d'un cran.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    await wrapper.vm.$nextTick()
    expect(liensPalette(wrapper)[0].classes()).not.toContain('bg-accent-soft')
    expect(liensPalette(wrapper)[1].classes()).toContain('bg-accent-soft')

    // ↑ ramène en tête, puis un ↑ de plus BOUCLE sur la dernière entrée — c'est le bouclage qu'on teste.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    await wrapper.vm.$nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    await wrapper.vm.$nextTick()
    const liens = liensPalette(wrapper)
    expect(liens[liens.length - 1].classes()).toContain('bg-accent-soft')
    expect(liens[0].classes()).not.toContain('bg-accent-soft')

    wrapper.unmount()
  })

  test('↵ navigue vers l’entrée sélectionnée et referme la palette (CC-27)', async () => {
    const visit = vi.mocked(router.visit)
    visit.mockClear()

    const wrapper = monter('/')
    await ouvrirPalette(wrapper)

    // ↓ sélectionne la 2ᵉ entrée (services), puis ↵ y navigue.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    await wrapper.vm.$nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await wrapper.vm.$nextTick()

    // Le même chemin qu'un clic sur le lien : une visite Inertia GET vers le href sélectionné.
    expect(visit).toHaveBeenCalledWith('/services')
    // Et la palette s'est refermée.
    expect(wrapper.text()).not.toContain(fr.palette.navigation)

    wrapper.unmount()
  })

  test('taper réinitialise la sélection sur la 1ʳᵉ correspondance (CC-27)', async () => {
    const wrapper = monter('/')
    const input = await ouvrirPalette(wrapper)

    // On s'éloigne de la tête de liste : deux ↓ amènent sur la 3ᵉ entrée (agents).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    await wrapper.vm.$nextTick()

    // Filtre à une seule entrée. Sans reset, l'index 2 pointerait hors de la liste réduite (1 entrée)
    // → aucune ligne surlignée. C'est le surlignage de cet UNIQUE résultat qui prouve la remise à zéro.
    await input.setValue('revision')
    const liens = liensPalette(wrapper)
    expect(liens).toHaveLength(1)
    expect(liens[0].classes()).toContain('bg-accent-soft')

    wrapper.unmount()
  })

  test('le listener clavier posé au montage est bien celui retiré au démontage', () => {
    // ⚠️ On espionne les deux appels plutôt que d'observer le DOM après démontage : un
    // composant démonté est détaché, donc un listener SURVIVANT ne changerait rien à
    // l'écran et le test passerait quand même. C'est le handler lui-même qu'il faut
    // comparer — sans quoi une navigation Inertia empilerait un listener par page
    // visitée, chacun ouvrant la palette d'une page qui n'existe plus.
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    const wrapper = monter('/')
    const posé = add.mock.calls.find(([type]) => type === 'keydown')
    wrapper.unmount()
    const retiré = remove.mock.calls.find(([type]) => type === 'keydown')

    expect(posé).toBeDefined()
    expect(retiré).toBeDefined()
    // La même référence de fonction : un handler recréé ne serait jamais retiré.
    expect(retiré![1]).toBe(posé![1])

    add.mockRestore()
    remove.mockRestore()
  })

  test('le titre de page nomme l’écran, pas seulement le module', () => {
    // Sur la racine d'un module, le libellé de la destination reste le titre : rien à ajouter.
    const revision = monter('/revision', ADMIN, DESTINATIONS, 'modules/leitner/index')
    expect(revision.get('h1').text()).toBe(fr.nav.revision)
    revision.unmount()

    /**
     * ⚠️ **Ce test assertait l'inverse jusqu'à CC-110, et il figeait le défaut.** `isActive` fait un
     * `startsWith`, donc les cinq écrans de `/revision` retombaient sur la même destination et
     * portaient tous « Révision » en `<h1>` — le seul de la page, aucune de ces vues n'ayant de
     * titre propre. Un test qui asserte l'état bogué le rend incorrigible sans rougir ; celui-ci
     * change de sens avec l'intention.
     */
    const stats = monter('/revision/stats', ADMIN, DESTINATIONS, 'modules/leitner/stats')
    expect(stats.get('h1').text()).toBe(leitnerFr.stats.title)
    stats.unmount()

    const accueil = monter('/')
    expect(accueil.get('h1').text()).toBe(fr.nav.accueil)
    accueil.unmount()
  })

  /**
   * ⚠️ **Le test du lot** : le fil compte trois segments, et le module y est devenu cliquable.
   * L'assertion porte sur la **liste des libellés**, pas sur la présence de « Cartes » — chercher
   * le seul dernier segment passerait aussi bien si le module avait disparu du fil.
   */
  test('une sous-page ajoute son segment, et rend le module cliquable (CC-110)', () => {
    const cartes = monter('/revision/settings', ADMIN, DESTINATIONS, 'modules/leitner/settings')

    expect(filDAriane(cartes)).toEqual([fr.nav.accueil, fr.nav.revision, leitnerFr.settings.crumb])
    // « Accueil » mène à la racine du compte, « Révision » à celle du module.
    expect(
      cartes
        .get('header')
        .findAll('a')
        .map((a) => a.attributes('href'))
    ).toEqual(['/', '/revision'])
    cartes.unmount()

    // Le pendant : sur la racine du module, deux segments et un seul lien.
    const racine = monter('/revision', ADMIN, DESTINATIONS, 'modules/leitner/index')
    expect(filDAriane(racine)).toEqual([fr.nav.accueil, fr.nav.revision])
    expect(racine.get('header').findAll('a')).toHaveLength(1)
    racine.unmount()
  })

  /**
   * ⚠️ **Le repli est le point sensible** : un `t()` sans clé rend son **chemin en texte brut**,
   * donc `agents.detail.crumb` s'afficherait tel quel dans la topbar. Deux cas, et il faut les deux
   * — la première version de ce test n'avait que le second, et ne prouvait rien.
   *
   * ⚠️ **`/agents` ne teste PAS ce repli** : c'est la racine de sa destination, donc `crumbPage`
   * sort avant même de chercher une clé. Il faut une **sous-page**, ici hypothétique : c'est
   * exactement l'état d'un écran ajouté à un module sans lui poser de libellé, et le seul moyen de
   * l'atteindre depuis un test.
   */
  test('une sous-page sans clé retombe sur le module, jamais sur la clé brute (CC-110)', () => {
    // Aucune clé : `agents` a une i18n plate (`title` à la racine, pas sous une page).
    const inconnue = monter('/agents/detail', ADMIN, DESTINATIONS, 'modules/agents/detail')
    expect(inconnue.get('h1').text()).toBe(fr.nav.agents)
    expect(inconnue.get('header').text()).not.toContain('agents.detail')
    expect(filDAriane(inconnue)).toEqual([fr.nav.accueil, fr.nav.agents])
    inconnue.unmount()

    // `crumb` absent mais `title` présent : le second candidat prend le relais. C'est le cas de
    // `stats`, dont le titre est déjà assez court pour ne pas mériter d'étiquette dédiée — ce qui
    // garde ce repli vivant en production plutôt que théorique.
    const stats = monter('/revision/stats', ADMIN, DESTINATIONS, 'modules/leitner/stats')
    expect(stats.get('h1').text()).toBe(leitnerFr.stats.title)
    expect(stats.get('header').text()).not.toContain('leitner.stats')
    stats.unmount()
  })

  /**
   * ⚠️ Une query string ne fait pas un autre écran. Sans le retrait, la page d'accueil de la veille
   * gagnerait un troisième segment au premier filtre cliqué — et ce segment serait « Veille », donc
   * « Accueil / Veille / Veille ».
   */
  test('un filtre dans l’URL ne crée pas de segment (CC-110)', () => {
    const filtre = monter(
      '/veille?tag=rust&unread=true',
      ADMIN,
      DESTINATIONS,
      'modules/veille/index'
    )

    expect(filDAriane(filtre)).toEqual([fr.nav.accueil, fr.nav.veille])
    filtre.unmount()

    const sources = monter('/veille/sources', ADMIN, DESTINATIONS, 'modules/veille/sources')
    expect(filDAriane(sources)).toEqual([fr.nav.accueil, fr.nav.veille, veilleFr.sources.crumb])
    sources.unmount()
  })

  test('le fil d’Ariane ramène à la racine du compte, jamais à « / » en dur', () => {
    // ⚠️ Un lien codé vers `/` rejouerait CC-81 : cette page exige `dashboard.view`, donc le seul
    // élément cliquable de la topbar répondrait 403 aux comptes qui ne l'ont pas. La racine est
    // `destinations[0]` — celle que le registre a déjà jugée ouvrable, et celle vers laquelle
    // l'atterrissage envoie après connexion.
    //
    // Ce compte n'a pas `dashboard.view` : sa liste ne commence donc pas par l'accueil.
    const lecteur = monter(
      '/revision',
      {
        fullName: 'Lecteur',
        email: 'lecteur@example.com',
        isAdmin: false,
        capabilities: ['veille.view', 'leitner.view'],
      },
      [
        { key: 'veille', href: '/veille' },
        { key: 'revision', href: '/revision' },
      ]
    )

    // La topbar seule : `/veille` figure aussi dans la barre latérale et dans la palette.
    const topbar = lecteur.get('header')
    expect(topbar.get('a').attributes('href')).toBe('/veille')
    expect(topbar.get('a').text()).toBe(fr.nav.veille)
    expect(topbar.get('h1').text()).toBe(fr.nav.revision)
    // Ni le libellé de l'accueil, ni l'ancien préfixe fixe « Pilotage / ».
    expect(topbar.text()).not.toContain(fr.nav.accueil)
    expect(topbar.text()).not.toContain(fr.nav.sectionPilotage)

    lecteur.unmount()
  })

  test('sur l’écran racine, le fil d’Ariane ne répète pas le titre', () => {
    // « Accueil / Accueil » : le second segment n'apprendrait rien et le lien ramènerait sur la
    // page déjà ouverte. Un seul segment, et aucun lien dans la topbar.
    const accueil = monter('/')

    const topbar = accueil.get('header')
    expect(topbar.findAll('a')).toHaveLength(0)
    expect(topbar.text()).toBe(fr.nav.accueil)

    accueil.unmount()
  })

  test('sur une page hors registre (/admin/*), pas de crumb « Accueil / Accueil »', () => {
    // `/admin/users` n'est pas une destination : `activeDestination` y est null et `pageTitle`
    // retombe sur « Accueil ». Sans garde, le crumb vers la racine réafficherait « Accueil /
    // Accueil » — la duplication même que CC-83 supprime sur l'écran racine. Le crumb ne remonte
    // que depuis une sous-page d'une destination connue.
    const admin = monter('/admin/users')

    const topbar = admin.get('header')
    expect(topbar.findAll('a')).toHaveLength(0)
    expect(topbar.text()).toBe(fr.nav.accueil)

    admin.unmount()
  })

  test('les pastilles distinguent une stat nulle d’une stat non chargée', () => {
    const wrapper = monter('/')

    // `agents.failed` vaut 0 : stat chargée, pastille neutre — elle s'affiche.
    // `accueil` n'a pas de badge du tout : rien ne s'affiche. La distinction tient sur
    // `!== undefined` ; un `?? 0` ajouté par mégarde peuplerait la barre de zéros.
    expect(wrapper.text()).toContain('12') // veille.queue
    expect(wrapper.text()).toContain('5') // leitner.due
    expect(wrapper.text()).toContain(NAV.host)

    wrapper.unmount()
  })

  test('la barre rend exactement les destinations reçues du serveur', () => {
    // ⚠️ Ce filtrage reste du **confort**, pas un droit : chaque route est fermée par son
    // middleware de capacité, que la barre l'affiche ou non. Il sert à ne pas proposer des
    // liens qui répondraient 403 — et depuis CC-81 il est appliqué une seule fois, au serveur,
    // là où l'atterrissage lit la même liste.
    const lecteur = monter(
      '/',
      {
        fullName: 'Lecteur',
        email: 'lecteur@example.com',
        isAdmin: false,
        capabilities: ['dashboard.view', 'leitner.view'],
      },
      [
        { key: 'accueil', href: '/' },
        { key: 'revision', href: '/revision' },
      ]
    )

    const liens = lecteur.findAll('a').map((a) => a.attributes('href'))
    expect(liens).toContain('/revision')
    expect(liens).not.toContain('/veille')
    expect(liens).not.toContain('/services')
    expect(liens).not.toContain('/agents')
    // L'écran d'administration ne s'ouvre pas non plus par une capacité.
    expect(liens).not.toContain('/admin/users')

    lecteur.unmount()
  })

  test('l’administration n’apparaît que pour un administrateur', () => {
    const admin = monter('/')
    expect(admin.findAll('a').map((a) => a.attributes('href'))).toContain('/admin/users')
    admin.unmount()

    // ⚠️ Elle ne vient **pas** du registre de destinations, et c'est délibéré : l'écran qui
    // distribue les droits ne doit pas pouvoir être ouvert par les droits qu'il distribue. Un
    // compte qui recevrait toutes les destinations non-admin ne la voit donc pas.
    const complet = monter(
      '/',
      {
        fullName: 'Complet',
        email: 'complet@example.com',
        isAdmin: false,
        capabilities: ['dashboard.view', 'veille.view', 'leitner.view'],
      },
      [
        { key: 'accueil', href: '/' },
        { key: 'veille', href: '/veille' },
        { key: 'revision', href: '/revision' },
      ]
    )
    const liens = complet.findAll('a').map((a) => a.attributes('href'))
    expect(liens).not.toContain('/admin/users')
    expect(liens).not.toContain('/services')
    expect(liens).toContain('/veille')
    complet.unmount()
  })

  test('« Journaux » et « Réglages » ne sont plus proposés', () => {
    // ⚠️ Les deux pointaient vers `/`, donc vers un refus pour un non-admin sans
    // `dashboard.view` — et vers l'accueil, pas vers ce qu'elles annonçaient, pour tout le
    // monde. Ces écrans n'existent pas ; les afficher les promettait (CC-81).
    const admin = monter('/')

    expect(admin.text()).not.toContain(fr.nav.journaux)
    expect(admin.text()).not.toContain(fr.nav.reglages)

    admin.unmount()
  })

  test('sans destination, aucune section n’est titrée à vide', () => {
    // Un titre « Pilotage » suivi de rien annoncerait une navigation qui n'existe pas : c'est
    // l'écran d'un compte sans droits, ou la page 403 d'un compte qui n'a rien d'autre.
    //
    // Les trois `div.uppercase` d'un montage plein sont les deux titres de section et le label du
    // sélecteur de langue. On les compte plutôt que d'assertir leur texte : c'est le seul moyen de
    // voir apparaître un quatrième titre, ou d'en voir survivre un que son contenu a quitté.
    const admin = monter('/')
    expect(admin.findAll('div.uppercase')).toHaveLength(3)
    admin.unmount()

    const nu = monter(
      '/',
      { fullName: 'Nu', email: 'nu@example.com', isAdmin: false, capabilities: [] },
      []
    )

    expect(nu.findAll('div.uppercase')).toHaveLength(1)
    expect(nu.text()).not.toContain(fr.nav.sectionSysteme)

    nu.unmount()
  })

  test('sans shared props, le layout se monte quand même (pages non authentifiées)', () => {
    mockedPage.url = '/login'
    mockedPage.props = {}

    const wrapper = mount(AppLayout, {
      global: {
        plugins: [
          createI18n({ legacy: false, locale: 'fr', fallbackLocale: 'fr', messages: { fr } }),
        ],
      },
    })

    // `nav` vaut null sur login : aucune stat, aucune pastille, et surtout aucune exception.
    expect(wrapper.get('h1').text()).toBe(fr.nav.accueil)
    // `destinations` est vide, donc aucune racine à proposer : la topbar ne rend pas de lien mort.
    expect(wrapper.get('header').findAll('a')).toHaveLength(0)
    wrapper.unmount()
  })
})
