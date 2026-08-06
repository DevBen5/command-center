import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { reactive } from 'vue'
// ⚠️ L'attribut `with { type: 'json' }` n'est pas décoratif : ce spec vit sous `app/**`, donc
// dans le graphe de `tsc` (`tsconfig.json` n'exclut qu'`inertia/**`), et `module: NodeNext`
// refuse un import JSON sans lui — `npm run build` échoue, pas Vitest. Les specs voisins de
// `inertia/` n'en ont pas besoin pour cette seule raison.
//
// ⚠️ Les messages sont montés sous le namespace `settings`, **exactement comme le fait le glob
// d'`inertia/i18n/index.ts`** : le nom du dossier module. Les monter à plat ferait passer ce
// spec pendant que l'écran réel n'afficherait que des clés brutes.
import settingsFr from '../../i18n/fr.json' with { type: 'json' }
import Settings from '../index.vue'

/*
| L'écran de réglages d'un compte (CC-114) : second facteur et langue.
|
| Ce qu'il porte de logique, et donc ce qui est couvert ici : **quel bloc s'affiche selon
| l'état**, et surtout **le bouton de désactivation qui disparaît quand la règle
| `ADMIN_2FA_REQUIRED` s'applique**. Le reste est de la disposition, que la relecture décrit
| mieux qu'un test.
|
| ⚠️ **Masquer ce bouton n'est PAS le contrôle** : `SettingsController.disable` lève un
| refus dans le même cas, et `tests/functional/auth/two_factor.spec.ts` le prouve en postant la
| route. Ce test-ci vérifie seulement qu'on ne propose pas une action qui échouerait — les deux,
| jamais l'un sans l'autre.
|
| ⚠️ Instance i18n neuve à chaque montage, jamais le singleton d'`inertia/i18n` : `setLocale()`
| le mute globalement, et deux tests s'influenceraient selon leur ordre.
*/

vi.mock('@inertiajs/vue3', () => ({
  router: { post: vi.fn(), reload: vi.fn() },
  usePage: () => ({ props: { locale: 'fr', supportedLocales: ['fr', 'en'] } }),
  Head: { template: '<div><slot /></div>' },
  // ⚠️ Un objet réactif minimal, pas le vrai `useForm` : suffisant pour que `v-model` et
  // `form.errors`/`form.processing` fonctionnent dans le template, sans dépendre d'une visite
  // Inertia réelle que jsdom ne fait de toute façon pas.
  useForm: (fields: Record<string, unknown>) =>
    reactive({ ...fields, errors: {}, processing: false, post: vi.fn(), reset: vi.fn() }),
}))

vi.mock('~/layouts/AppLayout.vue', () => ({
  default: { template: '<div><slot /></div>' },
}))

const ENROLLMENT = {
  secret: 'JBSWY3DPEHPK3PXP',
  uri: 'otpauth://totp/Command%20Center:a@b.c?secret=JBSWY3DPEHPK3PXP',
  qr: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
}

function monter(props: {
  enabled: boolean
  enrollment?: typeof ENROLLMENT | null
  remainingCodes?: number
  required?: boolean
  version?: string
  commit?: string | null
}) {
  return mount(Settings, {
    props: {
      enabled: props.enabled,
      enrollment: props.enrollment ?? null,
      remainingCodes: props.remainingCodes ?? 0,
      required: props.required ?? false,
      version: props.version ?? '1.1.0',
      commit: props.commit ?? null,
    },
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: 'fr',
          fallbackLocale: 'fr',
          messages: { fr: { settings: settingsFr } },
        }),
      ],
    },
  })
}

describe('Core / écran de réglages', () => {
  test('propose d’activer quand rien n’est en cours', () => {
    const wrapper = monter({ enabled: false })

    expect(wrapper.text()).toContain(settingsFr.security.start)
    expect(wrapper.text()).not.toContain(settingsFr.security.enrollTitle)
    wrapper.unmount()
  })

  test('affiche le QR et la clé pendant un enrôlement', () => {
    const wrapper = monter({ enabled: false, enrollment: ENROLLMENT })

    expect(wrapper.text()).toContain(settingsFr.security.enrollTitle)
    // La clé en clair compte autant que le QR : toutes les applications ne scannent pas, et
    // un enrôlement fait depuis la machine qui affiche la page n'a pas de caméra à lui opposer.
    expect(wrapper.text()).toContain(ENROLLMENT.secret)
    expect(wrapper.find('img').attributes('src')).toBe(ENROLLMENT.qr)
    wrapper.unmount()
  })

  test('le bouton de désactivation disparaît quand la règle l’exige', () => {
    // ⚠️ **Le geste réel, dans les deux sens.** Monter le seul cas « exigé » passerait même si
    // le `v-if` avait disparu : c'est la présence du bouton dans l'autre cas qui prouve que le
    // test observe bien quelque chose.
    const libre = monter({ enabled: true, remainingCodes: 10 })
    expect(libre.text()).toContain(settingsFr.security.disable)
    libre.unmount()

    const contraint = monter({ enabled: true, remainingCodes: 10, required: true })
    expect(contraint.text()).not.toContain(settingsFr.security.disable)
    // La régénération des codes, elle, reste ouverte : la règle exige un second facteur, pas
    // de renoncer à ses codes de secours.
    expect(contraint.text()).toContain(settingsFr.security.regenerate)
    contraint.unmount()
  })

  test('le sélecteur de langue est ici, et marque la langue courante', () => {
    // ⚠️ Il vivait dans la barre latérale faute d'écran où le mettre (CC-114). Ce qu'on vérifie
    // n'est pas sa présence — un bouton se relit — mais que **la langue active est celle qui
    // porte la marque** : l'inverse afficherait « fr » comme choix disponible alors qu'on y est
    // déjà, et le clic serait inerte sans que rien ne le dise.
    const wrapper = monter({ enabled: false })
    const boutons = wrapper.findAll('button').filter((b) => ['fr', 'en'].includes(b.text()))

    expect(boutons).toHaveLength(2)
    expect(boutons[0].classes()).toContain('bg-accent')
    expect(boutons[1].classes()).not.toContain('bg-accent')

    wrapper.unmount()
  })

  test('alerte quand plus aucun code de secours ne reste', () => {
    // Un compte enrôlé sans code de secours est à un téléphone perdu de la porte close, et
    // rien à l'écran ne le dirait sans cette alerte.
    const vide = monter({ enabled: true, remainingCodes: 0 })
    expect(vide.text()).toContain(settingsFr.security.noCodesLeft)
    vide.unmount()

    const pourvu = monter({ enabled: true, remainingCodes: 3 })
    expect(pourvu.text()).not.toContain(settingsFr.security.noCodesLeft)
    pourvu.unmount()
  })

  /*
  | « Quelle version tourne ? » (CC-151). Le cas qui compte est le repli développement : aucun
  | build Docker ne pose `APP_COMMIT`, donc le contrôleur envoie `commit: null` — jamais une
  | chaîne vide ni `undefined` affiché tel quel. Les deux branches sont vérifiées, dans les deux
  | sens, pour la même raison que le bouton de désactivation ci-dessus : monter un seul cas ne
  | prouverait rien si le `v-if`/`v-else` disparaissait.
  */
  test('affiche le commit construit quand il existe', () => {
    const wrapper = monter({ enabled: false, version: '1.2.0', commit: '17c9cc4' })

    expect(wrapper.text()).toContain('1.2.0')
    expect(wrapper.text()).toContain('17c9cc4')
    expect(wrapper.text()).not.toContain(settingsFr.about.dev)
    wrapper.unmount()
  })

  test('sans commit (développement), le repli explicite s’affiche — jamais une valeur vide', () => {
    const wrapper = monter({ enabled: false, version: '1.2.0', commit: null })

    expect(wrapper.text()).toContain('1.2.0')
    expect(wrapper.text()).toContain(settingsFr.about.dev)
    wrapper.unmount()
  })

  /*
  | CC-176 : l'avertissement de CC-147 (« ce changement ne ferme aucune session ouverte
  | ailleurs ») a disparu, parce que l'application sait désormais le faire. Ce qui le remplace
  | porte de la logique, et c'est elle qui est couverte : le bouton ne poste **qu'après**
  | confirmation.
  |
  | ⚠️ Les deux sens, comme pour le bouton de désactivation plus haut : n'observer que le refus
  | passerait même si le `confirm` avait disparu et que le clic postait toujours.
  |
  | ⚠️ **Masquer ou garder un bouton n'est pas le contrôle** — `tests/functional/auth/
  | session_revocation.spec.ts` prouve la route elle-même. Ici on vérifie seulement qu'un clic
  | accidentel ne déconnecte pas les autres appareils sans un mot.
  */
  test('la révocation des sessions n’est postée qu’après confirmation', async () => {
    const { router } = await import('@inertiajs/vue3')
    const post = vi.mocked(router.post)

    const wrapper = monter({ enabled: false })
    const bouton = wrapper
      .findAll('button')
      .find((b) => b.text() === settingsFr.security.sessions.submit)!

    post.mockClear()
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false)
    )
    await bouton.trigger('click')
    expect(post).not.toHaveBeenCalled()

    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    )
    await bouton.trigger('click')
    expect(post).toHaveBeenCalledWith('/reglages/sessions', {}, { preserveScroll: true })

    vi.unstubAllGlobals()
    wrapper.unmount()
  })
})
