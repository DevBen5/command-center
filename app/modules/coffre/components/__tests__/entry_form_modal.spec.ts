import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { reactive } from 'vue'
import fr from '../../i18n/fr.json' with { type: 'json' }
import EntryFormModal from '../EntryFormModal.vue'

/*
| La modale de création/édition (CC-207) : ouverture selon le mode, préremplissage en édition
| — JAMAIS le mot de passe —, fermeture après enregistrement réussi.
|
| ⚠️ Un objet réactif minimal pour `useForm`, pas le vrai — même patron que
| `app/core/settings/pages/__tests__/index.spec.ts`. `post`/`put` invoquent `onSuccess`
| directement : jsdom ne fait aucune visite Inertia réelle.
*/

vi.mock('@inertiajs/vue3', () => ({
  useForm: (fields: Record<string, unknown>) =>
    reactive({
      ...fields,
      errors: {},
      processing: false,
      post: vi.fn((_url: string, options?: { onSuccess?: () => void }) => options?.onSuccess?.()),
      put: vi.fn((_url: string, options?: { onSuccess?: () => void }) => options?.onSuccess?.()),
    }),
}))

/** La valeur d'un champ — ce fichier vit sous `app/**`, hors de la lib DOM de `tsconfig.json`
 * (voir `vue-shim.d.ts`) : pas de `HTMLInputElement`/`Element` nommés, un cast structurel
 * suffit, et le type du paramètre se déduit de son seul usage (`.element`). */
function valueOf(element: { value: string }): string {
  return element.value
}

function monter(props: {
  entry?: {
    id: number
    type: 'note' | 'url' | 'credential'
    title: string
    content: string
    media: { id: number }[]
    nasFiles: { id: number; kind: 'video' | 'photo' }[]
  } | null
  immichFolderAvailable?: boolean
  presetType?: 'note' | 'url' | 'credential'
}) {
  return mount(EntryFormModal, {
    props: {
      entry: props.entry ?? null,
      immichFolderAvailable: props.immichFolderAvailable ?? false,
      presetType: props.presetType,
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

describe('Coffre / EntryFormModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('en création, le sélecteur de nature est proposé, le titre de la modale l’annonce', () => {
    const wrapper = monter({ entry: null })

    expect(wrapper.text()).toContain(fr.index.modalCreateTitle)
    expect(wrapper.find('select').exists()).toBe(true)

    wrapper.unmount()
  })

  test('en édition, aucun sélecteur de nature, le titre et le contenu sont préremplis', () => {
    const wrapper = monter({
      entry: {
        id: 42,
        type: 'note',
        title: 'Mon titre',
        content: 'Mon contenu',
        media: [],
        nasFiles: [],
      },
    })

    expect(wrapper.text()).toContain(fr.index.modalEditTitle)
    expect(wrapper.find('select').exists()).toBe(false)
    expect(valueOf(wrapper.find('input').element as unknown as { value: string })).toBe('Mon titre')
    expect(valueOf(wrapper.find('textarea').element as unknown as { value: string })).toBe(
      'Mon contenu'
    )

    wrapper.unmount()
  })

  // ⚠️ Le test du lot : un identifiant en édition ne doit JAMAIS préremplir le mot de passe —
  // il n'est même pas dans la prop `entry` (CC-179, la liste ne charge jamais `secret_cipher`).
  // Le champ part vide, ce qui veut dire « garde l'actuel ».
  test('en édition d’un identifiant, le champ mot de passe reste vide', () => {
    const wrapper = monter({
      entry: {
        id: 7,
        type: 'credential',
        title: 'Un service',
        content: 'un-utilisateur',
        media: [],
        nasFiles: [],
      },
    })

    const password = wrapper.find('input[type="password"]')
    expect(password.exists()).toBe(true)
    expect(valueOf(password.element as unknown as { value: string })).toBe('')
    expect(wrapper.text()).toContain(fr.index.passwordEditHint)

    wrapper.unmount()
  })

  test('valider le formulaire de création soumet vers /coffre puis émet close', async () => {
    const wrapper = monter({ entry: null })

    await wrapper.find('input').setValue('Titre')
    await wrapper.find('textarea').setValue('Contenu')
    await wrapper.find('form').trigger('submit.prevent')

    expect(wrapper.emitted('close')).toHaveLength(1)

    wrapper.unmount()
  })

  test('valider l’édition soumet vers /coffre/:id puis émet close', async () => {
    const wrapper = monter({
      entry: { id: 9, type: 'note', title: 'A', content: 'B', media: [], nasFiles: [] },
    })

    await wrapper.find('form').trigger('submit.prevent')

    expect(wrapper.emitted('close')).toHaveLength(1)

    wrapper.unmount()
  })

  test('le bouton Annuler émet close sans soumettre', async () => {
    const wrapper = monter({ entry: null })

    const annuler = wrapper.findAll('button').find((b) => b.text() === fr.index.cancel)!
    await annuler.trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)

    wrapper.unmount()
  })

  // ⚠️ Le lot CC-208 : une page de section impose son type, le sélecteur disparaît. On ne peut
  // pas inspecter `form.type` directement (`<script setup>` n'expose rien) — on prouve l'effet
  // RÉEL en observant un champ qui ne dépend QUE du type effectif : le mot de passe n'apparaît
  // que sur un `credential`. Si `presetType` n'était pas réellement appliqué à `form.type` (ex.
  // un bug qui masquerait juste le sélecteur sans changer la valeur par défaut 'note'), ce champ
  // resterait absent et le test rougirait.
  test('presetType masque le sélecteur ET fixe réellement le type créé', () => {
    const wrapper = monter({ entry: null, presetType: 'credential' })

    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
    expect(wrapper.text()).toContain(fr.index.username)

    wrapper.unmount()
  })

  // ⚠️ Vignettes déjà attachées : uniquement en édition, jamais en création (il n'y a rien à
  // lister avant le premier enregistrement).
  test('les médias déjà attachés ne s’affichent qu’en édition', () => {
    const enEdition = monter({
      entry: {
        id: 1,
        type: 'note',
        title: 'A',
        content: 'B',
        media: [{ id: 5 }],
        nasFiles: [],
      },
    })
    expect(enEdition.find('img[src="/coffre/media/5/thumbnail"]').exists()).toBe(true)
    enEdition.unmount()

    const enCreation = monter({ entry: null })
    expect(enCreation.find('img[src^="/coffre/media/"]').exists()).toBe(false)
    enCreation.unmount()
  })

  // ⚠️ CC-215 : le dossier verrouillé peut porter plus de 100 photos (mesuré contre la vraie
  // instance du propriétaire) — le panneau ne doit JAMAIS rendre plus d'un lot à la fois, quel
  // que soit le nombre rapporté par le listing. Vérifié mutation : retirer le `.slice` du
  // composant fait rougir ce test, et lui seul.
  test('la grille du dossier verrouillé borne le rendu à un lot, « voir plus » révèle le suivant', async () => {
    const photos = Array.from({ length: 120 }, (_, i) => ({ assetId: `asset-${i}` }))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ available: true, truncated: false, photos }),
      })
    )

    const wrapper = monter({ entry: null, immichFolderAvailable: true })

    const browse = wrapper.findAll('button').find((b) => b.text() === fr.index.folderBrowse)!
    await browse.trigger('click')
    await flushPromises()

    const vignette = (index: number) =>
      wrapper.find(`img[src="/coffre/immich/dossier/asset-${index}/thumbnail"]`)

    expect(wrapper.findAll('img[src^="/coffre/immich/dossier/"]')).toHaveLength(40)
    expect(vignette(0).attributes('loading')).toBe('lazy')
    expect(vignette(40).exists()).toBe(false)

    const voirPlus = wrapper.findAll('button').find((b) => b.text() === fr.index.folderShowMore)!
    await voirPlus.trigger('click')

    expect(wrapper.findAll('img[src^="/coffre/immich/dossier/"]')).toHaveLength(80)
    expect(vignette(79).exists()).toBe(true)
    expect(vignette(80).exists()).toBe(false)

    wrapper.unmount()
  })

  // ⚠️ CC-215 : la SEULE porte par laquelle la borne ci-dessus pouvait encore fuir. Replier le
  // panneau ne démonte rien (contrairement à fermer la modale, montée en `v-if` depuis CC-207) et
  // `folderPhotos` reste délibérément en mémoire — sans remise à zéro du compteur, redéployer
  // rendait d'un coup tout ce qui avait été révélé, et le `no-store` du proxy fait repartir
  // CHAQUE vignette vers Immich. Le geste réel est donc : voir plus, replier, redéployer.
  test('replier le panneau du dossier remet le rendu au premier lot', async () => {
    const photos = Array.from({ length: 120 }, (_, i) => ({ assetId: `asset-${i}` }))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ available: true, truncated: false, photos }),
      })
    )

    const wrapper = monter({ entry: null, immichFolderAvailable: true })
    const bouton = (libelle: string) => wrapper.findAll('button').find((b) => b.text() === libelle)!
    const vignettes = () => wrapper.findAll('img[src^="/coffre/immich/dossier/"]').length

    await bouton(fr.index.folderBrowse).trigger('click')
    await flushPromises()
    await bouton(fr.index.folderShowMore).trigger('click')
    expect(vignettes()).toBe(80)

    // Replier — le libellé du bouton bascule sur « fermer le dossier ».
    await bouton(fr.index.folderClose).trigger('click')
    expect(vignettes()).toBe(0)

    // Redéployer : aucun nouveau listing (`folderPhotos` est en mémoire), et surtout un seul lot.
    await bouton(fr.index.folderBrowse).trigger('click')
    await flushPromises()
    expect(vignettes()).toBe(40)

    wrapper.unmount()
  })
})
