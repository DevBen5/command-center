import { reactive, ref, type Ref } from 'vue'
import { xsrfToken } from './leitner_csrf.js'
import { PREVIEW_MAX_CHARS, previewTooLong } from '../shared/card_preview.js'

/**
 * L'aperçu du rendu Markdown, côté page (CC-257) — l'unique copie, partagée par les deux écrans
 * qui saisissent du contenu de carte : la modale de `pages/settings.vue` et la relecture des
 * brouillons de `pages/ingest_show.vue`.
 *
 * ⚠️ **Rien ici ne rend du Markdown, et il ne faut jamais que ça change.** Le HTML vient du
 * serveur, de `renderMarkdown` — la même fonction que la révision (CC-133). Un rendu côté client
 * demanderait `markdown-it` **et** `sanitize-html` dans le bundle du navigateur, et créerait un
 * **second** rendu dont la sortie pourrait diverger de celle du serveur sans que rien ne les
 * compare. Ce composable ne fait que trois choses : décider *quand* demander, garantir qu'une
 * seule réponse peut atterrir, et porter l'état affiché.
 *
 * ## Pourquoi aucun `watch`, alors que ce serait le réflexe
 *
 * `ingest_show.vue` a **N** brouillons qui arrivent au fil de l'eau : leurs instances se créent
 * donc à la volée, hors du `setup()` de la page, c'est-à-dire hors de tout `EffectScope`. Un
 * `watch` créé là n'a aucun propriétaire et ne s'arrête jamais tout seul. Le déclenchement est
 * donc **explicite** — la page appelle `onInput()` depuis ses `<textarea>` — ce qui a en prime
 * l'avantage de rendre le comportement lisible à l'endroit où il se produit.
 *
 * ## Les deux règles de coût, mesurées avant d'être choisies
 *
 * Le rendu serveur coûte 0,11 ms sur une carte réelle et l'aller-retour ~10 ms sur ce poste : le
 * coût n'est pas la latence, c'est le **nombre de requêtes**. D'où :
 *
 * 1. **Replié par défaut** — tant que personne n'a demandé d'aperçu, il n'y a **aucune** requête.
 *    C'est ce qui laisse la saisie en série (« Créer et enchaîner ») exactement aussi silencieuse
 *    qu'avant ce lot.
 * 2. **Vivant une fois ouvert**, débouncé. Un aperçu figé qu'il faudrait re-cliquer manquerait sa
 *    cible : le défaut qui a motivé le ticket — une clôture ```` ``` ```` non refermée qui avale
 *    tout le reste de la carte — apparaît **pendant** qu'on tape, pas au moment où on décide de
 *    vérifier.
 */

/** Le délai d'inactivité avant d'émettre. Assez court pour suivre la frappe, assez long pour ne
 *  pas émettre une requête par caractère. */
const DEBOUNCE_MS = 400

/**
 * Ce que la page affiche. `tooLong` et `failed` sont deux états **distincts**, et les fondre
 * serait une régression : le premier est une limite connue (la carte reste enregistrable), le
 * second une panne. Un message unique ferait croire à un bug là où il n'y en a pas, ou l'inverse.
 */
export type PreviewState = 'empty' | 'loading' | 'ready' | 'tooLong' | 'failed'

export interface MarkdownPreview {
  open: Ref<boolean>
  state: Ref<PreviewState>
  html: { front: string; back: string }
  maxChars: number
  toggle: () => void
  onInput: () => void
  refresh: () => void
  dispose: () => void
}

export function useMarkdownPreview(
  endpoint: string,
  source: () => { front: string; back: string }
): MarkdownPreview {
  const open = ref(false)
  const state = ref<PreviewState>('empty')
  const html = reactive({ front: '', back: '' })

  let timer: ReturnType<typeof setTimeout> | null = null
  /**
   * ⚠️ **La requête en vol est ANNULÉE, jamais départagée après coup.** Le mode d'échec est
   * silencieux : deux requêtes débouncées qui se croisent peuvent revenir dans le désordre, et
   * l'aperçu afficherait alors le rendu d'un texte qu'on vient de corriger — en paraissant
   * parfaitement fonctionner. Un compteur de séquence marcherait aussi, mais il se teste ; une
   * annulation rend le cas **impossible** au lieu de le rattraper.
   */
  let inflight: AbortController | null = null

  function cancelPending(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    inflight?.abort()
    inflight = null
  }

  async function request(): Promise<void> {
    const { front, back } = source()

    // Deux champs vides : rien à rendre, et surtout rien à demander. C'est l'état de la modale
    // juste après « Créer et enchaîner », où un aller-retour ne rapporterait qu'une chaîne vide.
    if (!front.trim() && !back.trim()) {
      html.front = ''
      html.back = ''
      state.value = 'empty'
      return
    }

    // Vérifié **avant** d'émettre : sinon le seul retour serait un 422, que la page traduirait en
    // « panne ». Le serveur borne quand même — un contrôle côté client est une politesse, pas une
    // garantie. La borne est la même valeur des deux côtés (`shared/card_preview.ts`).
    if (previewTooLong(front, back)) {
      html.front = ''
      html.back = ''
      state.value = 'tooLong'
      return
    }

    const controller = new AbortController()
    inflight = controller
    state.value = 'loading'

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          // ⚠️ Sans lui, Shield répond par une redirection avec flash — pas par un 403 lisible :
          // le `fetch` la suit et lit de l'HTML. Unique copie, `leitner_csrf.ts`.
          'x-xsrf-token': xsrfToken(),
        },
        body: JSON.stringify({ front, back }),
        signal: controller.signal,
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const payload = (await response.json()) as { frontHtml?: string; backHtml?: string }
      html.front = payload.frontHtml ?? ''
      html.back = payload.backHtml ?? ''
      state.value = 'ready'
    } catch {
      // Une annulation passe aussi par ici : elle ne doit rien afficher, une requête plus récente
      // étant déjà partie. On ne touche donc l'état que si c'est bien nous qui étions en vol.
      if (inflight !== controller) return
      state.value = 'failed'
    } finally {
      if (inflight === controller) inflight = null
    }
  }

  /** La frappe : on repousse. Fermé, on ne planifie rien du tout. */
  function onInput(): void {
    if (!open.value) return
    cancelPending()
    timer = setTimeout(() => {
      timer = null
      void request()
    }, DEBOUNCE_MS)
  }

  /**
   * Le contenu a changé d'un bloc, pas caractère par caractère : on demande **tout de suite**.
   *
   * ⚠️ **Deux appelants, et le second n'est pas une commodité.** Ouvrir le panneau, d'abord :
   * attendre 400 ms pour afficher quelque chose après un clic se lirait comme une panne. Mais
   * surtout, un formulaire qui se remplit ou se vide autrement qu'à la frappe — « Créer et
   * enchaîner » qui vide les champs, une modale d'édition qui s'ouvre sur une autre carte —
   * n'émet **aucun** événement de saisie : sans ce point d'entrée, le panneau continuerait
   * d'afficher la carte précédente à côté de champs qui ne la portent plus.
   */
  function refresh(): void {
    cancelPending()
    if (!open.value) return
    void request()
  }

  function toggle(): void {
    open.value = !open.value
    refresh()
  }

  function dispose(): void {
    cancelPending()
  }

  return { open, state, html, maxChars: PREVIEW_MAX_CHARS, toggle, onInput, refresh, dispose }
}
