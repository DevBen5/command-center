import { describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import UserShow from '../user_show.vue'

/*
| La fiche d'un compte : elle se rend avec une invitation en attente comme sans.
|
| ⚠️ **Ce fichier ne couvre PAS la régression qui a rendu cette page blanche, et il ne le peut
| pas.** La cause était une collision de props — la page rendait `user`, qui est la prop
| *partagée* du compte connecté, et c'est `AppLayout` qui tombait en lisant un objet d'une
| autre forme. Or Inertia enveloppe la page dans le layout au runtime ; `mount()` ne le fait
| pas, donc le composant montré ici se rendait très bien pendant que l'écran réel était blanc.
|
| Le garde-fou de cette collision vit côté serveur : `tests/functional/modules/pages.spec.ts`
| vérifie sur **chaque** page que la prop partagée `user` est toujours le compte connecté.
| Ne rapatrie pas ce test ici en croyant l'y renforcer : il y serait aveugle.
*/

vi.mock('@inertiajs/vue3', () => ({
  usePage: () => ({ url: '/admin/users/2', props: {} }),
  router: { put: vi.fn(), post: vi.fn(), delete: vi.fn() },
  Link: { props: ['href'], template: '<a :href="href"><slot /></a>' },
  Head: { template: '<div><slot /></div>' },
}))

const CATALOG = [{ module: 'leitner', capabilities: ['leitner.view'] }]

function monter(
  invitation: { expiresAt: string; issuedAt: string } | null,
  twoFactor: { enabled: boolean; remainingCodes: number } = { enabled: false, remainingCodes: 0 }
) {
  return mount(UserShow, {
    props: {
      account: {
        id: 2,
        fullName: 'Carine',
        email: 'carine@example.com',
        isAdmin: false,
        isActive: true,
        roleId: 2,
        effective: ['leitner.view'],
        twoFactor,
      },
      overrides: [],
      roles: [{ id: 2, name: 'Leitner view' }],
      catalog: CATALOG,
      invitation,
      deletable: false,
    },
  })
}

describe('Core / fiche utilisateur', () => {
  test('se rend pour un compte sans invitation', () => {
    const wrapper = monter(null)
    expect(wrapper.text()).toContain('carine@example.com')
    wrapper.unmount()
  })

  test('se rend pour un compte dont l’invitation est en attente', () => {
    // ⚠️ Le cas qui tombait : les dates de l'invitation sont formatées au rendu.
    const wrapper = monter({
      expiresAt: '2026-07-29T16:43:48.912+00:00',
      issuedAt: '2026-07-22T16:43:48.912+00:00',
    })

    expect(wrapper.text()).toContain('carine@example.com')
    expect(wrapper.text()).toContain('Invitation en attente')
    wrapper.unmount()
  })

  test('le bouton de réinitialisation du second facteur n’apparaît que s’il y en a un', () => {
    // ⚠️ **Le geste réel, dans les deux sens** : monter uniquement le cas « actif » passerait
    // même si le `v-if` disparaissait. C'est la version négative qui prouve la garde — proposer
    // de réinitialiser un facteur inexistant enverrait chercher une panne là où il n'y a rien.
    const sans = monter(null, { enabled: false, remainingCodes: 0 })
    expect(sans.text()).not.toContain('Réinitialiser le second facteur')
    sans.unmount()

    const avec = monter(null, { enabled: true, remainingCodes: 7 })
    expect(avec.text()).toContain('Réinitialiser le second facteur')
    expect(avec.text()).toContain('7 code(s) de secours restant(s)')
    avec.unmount()
  })
})
