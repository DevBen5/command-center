import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '../../i18n/fr.json' with { type: 'json' }
import MarkdownPreviewPanel from '../MarkdownPreviewPanel.vue'
import { useMarkdownPreview, type PreviewState } from '../leitner_markdown_preview.js'
import { PREVIEW_MAX_CHARS } from '../../shared/card_preview.js'

/**
 * ⚠️ Le même `declare` que `leitner_csrf.ts`, et pour la même raison exactement : un `.ts` de
 * `app/` est compilé par le tsconfig **serveur**, qui n'a pas la lib `dom`. jsdom fournit bien un
 * vrai `document` à l'exécution ; c'est `tsc` qui ne le sait pas. Un `lib: ["dom"]` global ferait
 * cesser de détecter un service backend qui utiliserait `document` par erreur.
 */
declare const document: { cookie: string }

/*
| L'aperçu du rendu Markdown, côté page (CC-257).
|
| ⚠️ **Ce qui se teste ici est la POLITIQUE DE REQUÊTE, et rien d'autre.** Le rendu vient du
| serveur — c'est tout l'objet du lot, et il est éprouvé par `leitner_preview.spec.ts`. Ce
| composable ne décide que de trois choses, et chacune régresse en silence si elle casse :
| quand demander, quand NE PAS demander, et l'impossibilité qu'une réponse périmée atterrisse.
|
| Le composable ne communique que par effet de bord réseau : espionner `fetch` est le seul
| moyen d'observer ce qu'il fait — et surtout ce qu'il ne fait pas, qui est l'essentiel ici.
*/

const DEBOUNCE_MS = 400

let requetes: {
  body: unknown
  signal: AbortSignal | undefined
  headers: Record<string, string>
}[] = []
let fetchMock: ReturnType<typeof vi.fn>

/** Une réponse serveur, résolue tout de suite. */
function reponse(frontHtml: string, backHtml = '') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ frontHtml, backHtml }),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  requetes = []
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    requetes.push({
      body: JSON.parse(String(init.body)),
      signal: init.signal ?? undefined,
      headers: init.headers as Record<string, string>,
    })
    return reponse('<p>rendu</p>')
  })
  vi.stubGlobal('fetch', fetchMock)
  // Le jeton CSRF est repris du cookie par `leitner_csrf.ts` — jsdom en fournit un vrai.
  document.cookie = 'XSRF-TOKEN=jeton-de-test'
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function creer(source: { front: string; back: string }) {
  const preview = useMarkdownPreview('/revision/cards/preview', () => source)
  return { preview, source }
}

describe('replié, il n’émet rien', () => {
  test('taper ne déclenche aucune requête tant que le panneau est fermé', async () => {
    // ⚠️ **C'est l'assertion qui porte le lot côté coût.** Le rendu serveur est mesuré à 0,11 ms
    // et l'aller-retour à ~10 ms : ce qui se paie, c'est le NOMBRE de requêtes. La saisie en
    // série (« Créer et enchaîner ») doit rester exactement aussi silencieuse qu'avant CC-257.
    const { preview } = creer({ front: 'a', back: 'b' })

    preview.onInput()
    preview.onInput()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(preview.open.value).toBe(false)
  })
})

describe('ouvert, il suit la frappe', () => {
  test('la requête porte les deux en-têtes sans lesquels elle ment', async () => {
    // ⚠️ Les deux pièges de toute route JSON nue de ce module, et ils échouent tous les deux de
    // façon trompeuse :
    //   — sans `x-xsrf-token`, Shield répond par une REDIRECTION avec flash, que le `fetch` suit,
    //     et l'appelant lit de l'HTML en croyant à une panne du serveur ;
    //   — sans `accept: application/json`, un 422 devient lui aussi une redirection Inertia — qui
    //     retombe sur `/` et rend un 403 « Accès refusé », donc un faux problème de droits.
    // Le second a réellement été rencontré en écrivant `leitner_preview.spec.ts`.
    const { preview } = creer({ front: 'a', back: '' })

    preview.toggle()
    await vi.advanceTimersByTimeAsync(0)

    expect(requetes[0].headers['accept']).toBe('application/json')
    expect(requetes[0].headers['x-xsrf-token']).toBe('jeton-de-test')
  })

  test('ouvrir demande tout de suite, sans attendre le débounce', async () => {
    // Attendre 400 ms pour afficher quelque chose après un clic se lirait comme une panne.
    const { preview } = creer({ front: '# Titre', back: '' })

    preview.toggle()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(requetes[0].body).toEqual({ front: '# Titre', back: '' })
    expect(preview.state.value satisfies PreviewState).toBe('ready')
    expect(preview.html.front).toBe('<p>rendu</p>')
  })

  test('une rafale de frappe ne produit qu’une requête', async () => {
    const source = { front: '', back: '' }
    const preview = useMarkdownPreview('/revision/cards/preview', () => source)

    source.front = 'a'
    preview.toggle()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Le geste réel : on tape cinq caractères plus vite que le débounce.
    for (const lettre of 'abcde') {
      source.front += lettre
      preview.onInput()
      await vi.advanceTimersByTimeAsync(50)
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Et c'est bien le texte COMPLET qui part, pas celui d'il y a cinq frappes.
    expect(requetes[1].body).toEqual({ front: 'aabcde', back: '' })
  })

  test('la requête en vol est annulée quand une plus récente part', async () => {
    // ⚠️ Le mode d'échec que ce test ferme est le plus sournois du composable : deux réponses qui
    // se croisent, et l'aperçu affiche le rendu d'un texte qu'on vient de corriger — en paraissant
    // parfaitement fonctionner. L'annulation rend le cas impossible au lieu de le rattraper.
    // ⚠️ Le premier appel ne se résout **jamais** : c'est la seule façon d'observer une requête
    // réellement en vol. Avec un serveur qui répond tout de suite (le cas des autres tests), il
    // n'y a plus rien à annuler quand la seconde part — et le test passerait au vert sans avoir
    // exercé l'annulation du tout.
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      requetes.push({
        body: JSON.parse(String(init.body)),
        signal: init.signal ?? undefined,
        headers: init.headers as Record<string, string>,
      })
      return new Promise(() => {})
    })

    const source = { front: 'un', back: '' }
    const preview = useMarkdownPreview('/revision/cards/preview', () => source)

    preview.toggle()
    await vi.advanceTimersByTimeAsync(0)

    const premier = requetes[0].signal
    expect(premier?.aborted).toBe(false)
    expect(preview.state.value satisfies PreviewState).toBe('loading')

    source.front = 'deux'
    preview.onInput()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(premier?.aborted).toBe(true)
    expect(requetes).toHaveLength(2)
    // La réponse de la seconde a bien pris la main, et la première n'a rien écrit.
    expect(preview.state.value satisfies PreviewState).toBe('ready')
  })

  test('refermer annule le travail en cours', async () => {
    const { preview } = creer({ front: 'a', back: '' })

    preview.toggle()
    await vi.advanceTimersByTimeAsync(0)
    preview.toggle()

    // Fermé, plus rien ne part — même une frappe déjà planifiée.
    preview.onInput()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 3)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('les deux cas qui n’atteignent jamais le réseau', () => {
  test('deux champs vides ne demandent rien', async () => {
    // L'état de la modale juste après « Créer et enchaîner » : l'aller-retour ne rapporterait
    // qu'une chaîne vide. Et l'aperçu doit quand même se vider — sinon il montre la carte qu'on
    // vient d'enregistrer à côté d'un formulaire vierge.
    const source = { front: 'quelque chose', back: '' }
    const preview = useMarkdownPreview('/revision/cards/preview', () => source)

    preview.toggle()
    await vi.advanceTimersByTimeAsync(0)
    expect(preview.html.front).toBe('<p>rendu</p>')

    source.front = '   '
    preview.refresh()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(preview.state.value satisfies PreviewState).toBe('empty')
    expect(preview.html.front).toBe('')
  })

  test('un contenu au-delà de la borne le dit, sans poster', async () => {
    // Vérifié AVANT d'émettre : sinon le seul retour serait un 422 que la page traduirait en
    // « panne », alors que c'est une limite connue — la carte, elle, reste enregistrable.
    const { preview } = creer({ front: 'a'.repeat(PREVIEW_MAX_CHARS + 1), back: '' })

    preview.toggle()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(preview.state.value satisfies PreviewState).toBe('tooLong')
  })
})

describe('la panne se dit, elle ne se confond pas avec un dépassement', () => {
  test('un serveur qui refuse met l’aperçu en échec', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    const { preview } = creer({ front: 'a', back: '' })

    preview.toggle()
    await vi.advanceTimersByTimeAsync(0)

    expect(preview.state.value satisfies PreviewState).toBe('failed')
  })
})

/*
| Le panneau lui-même.
|
| ⚠️ **Ce qui se prouve ici est une SUBTILITÉ DE VUE que rien d'autre n'attraperait** : le
| composable rend un objet **plat** portant des `ref`, et cet objet voyage en **prop**. Les props
| ne sont que superficiellement réactives, donc `open` et `state` restent des `Ref` et s'écrivent
| `preview.open.value` — un `preview.open` nu, qui *paraît* juste (c'est l'écriture qu'on a partout
| ailleurs, où Vue déballe), rendrait un objet toujours truthy : le panneau s'afficherait en
| permanence, y compris replié. `typecheck`, `lint` et le reste de la suite resteraient verts, et
| ça ne se verrait qu'au navigateur.
|
| Il porte aussi l'assertion sur la classe `markdown` **au rendu**, là où
| `leitner_card_preview.spec.ts` ne peut la lire que dans la source.
*/
describe('le panneau', () => {
  function monter(preview: ReturnType<typeof useMarkdownPreview>, side: 'front' | 'back') {
    return mount(MarkdownPreviewPanel, {
      props: { preview, side },
      global: {
        plugins: [
          createI18n({
            legacy: false,
            locale: 'fr',
            fallbackLocale: 'fr',
            // ⚠️ Le `leitner` explicite reproduit ce que fait `inertia/i18n/index.ts` au boot :
            // les traductions d'un module sont rangées sous un namespace **égal au nom de son
            // dossier**, et le fichier ne le porte donc pas lui-même. Sans lui, les clés
            // s'afficheraient en texte brut et les assertions de message seraient vides.
            messages: { fr: { leitner: fr } },
          }),
        ],
      },
    })
  }

  test('replié, il ne rend rien du tout', () => {
    const { preview } = creer({ front: 'a', back: '' })

    expect(monter(preview, 'front').html()).toBe('<!--v-if-->')
  })

  test('ouvert et rendu, il pose le HTML du serveur DANS un conteneur .markdown', async () => {
    const { preview } = creer({ front: '- un', back: '' })

    preview.toggle()
    await vi.advanceTimersByTimeAsync(0)

    const wrapper = monter(preview, 'front')
    const rendu = wrapper.find('.markdown')

    // ⚠️ Sans la classe, le Preflight de Tailwind laisse les listes sans puces et ramène les
    // titres à la taille du texte : l'aperçu s'affiche et ment, avec les trois gates au vert.
    expect(rendu.exists()).toBe(true)
    expect(rendu.html()).toContain('<p>rendu</p>')
  })

  test('le dépassement de borne et la panne ne disent pas la même chose', async () => {
    const trop = creer({ front: 'a'.repeat(PREVIEW_MAX_CHARS + 1), back: '' })
    trop.preview.toggle()
    await vi.advanceTimersByTimeAsync(0)

    // Rien n'est rendu en HTML : c'est un message, et le contenu reste enregistrable.
    const wrapper = monter(trop.preview, 'front')
    expect(wrapper.find('.markdown').exists()).toBe(false)
    expect(wrapper.text()).toContain('trop long')
  })
})
