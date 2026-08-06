/**
 * La copie vers le presse-papiers — l'unique copie de ce geste dans le dépôt (CC-179).
 *
 * ⚠️ **`navigator.clipboard` n'existe QUE dans un contexte sécurisé** (HTTPS, ou `localhost` que
 * la spécification traite comme tel). En développement tout marche ; sur une installation jointe
 * en HTTP depuis une autre machine du réseau, l'objet est `undefined` et l'appel lève. Avant ce
 * fichier, les deux appelants du dépôt écrivaient `await navigator.clipboard.writeText(…)` puis
 * `copied = true` **sans garde** : la promesse rejetait, la ligne suivante ne s'exécutait pas, et
 * l'utilisateur voyait un écran muet en croyant avoir copié.
 *
 * Pour des codes de secours c'est fâcheux ; pour un mot de passe de coffre c'est le mode d'échec
 * du lot — on colle autre chose, et rien ne le dit. D'où : **la disponibilité se teste, l'échec se
 * rend**, et c'est à l'appelant d'en faire quelque chose de visible.
 *
 * ⚠️ **Ce fichier vit sous `inertia/`, et c'est le seul emplacement possible.** Ses trois
 * appelants sont dans `app/core/settings/`, `app/modules/leitner/` et `app/modules/coffre/` : le
 * seul alias que Vite résout depuis un `.vue` de n'importe lequel des trois est `~/`, qui pointe
 * ici. Un `#core/*` ne serait **pas** résolu par Vite (il mappe vers `./app/core/*.js`, qui
 * n'existe qu'après un build) — c'est le piège nommé dans le `CLAUDE.md` de Leitner.
 *
 * ⚠️ **Contrepartie à connaître : `tsconfig.json` exclut `inertia/**`, ce fichier n'est donc pas
 * couvert par `npm run typecheck`.** Même situation que `inertia/layouts/breadcrumb.ts` et
 * `inertia/i18n/messages.ts`, et même remède : il est **pur et testé** par Vitest
 * (`__tests__/clipboard.spec.ts`), ce qui est précisément la raison de le sortir des `<script
 * setup>` où aucun exécuteur ne l'atteindrait.
 */

/**
 * Ce qu'une tentative de copie a donné.
 *
 * ⚠️ **Trois cas, jamais un booléen.** `unavailable` et `refused` appellent deux phrases
 * différentes à l'écran : le premier dit « cette machine ne peut pas, prends l'autre chemin », le
 * second « ça a échoué, réessaie ». Les fondre en « ça n'a pas marché » redonnerait l'écran muet
 * qu'on vient de supprimer.
 */
export type CopyOutcome = 'ok' | 'unavailable' | 'refused'

/** Le délai après lequel une copie sensible s'efface du presse-papiers. */
export const CLIPBOARD_CLEAR_MS = 30_000

/**
 * Le presse-papiers est-il utilisable ici ?
 *
 * ⚠️ **Les deux conditions, pas une.** L'objet peut manquer (contexte non sécurisé) et le
 * contexte peut être non sécurisé sans que l'objet manque — un navigateur exotique, un `about:`.
 * Vérifier `isSecureContext` en plus permet surtout de **nommer la cause** à l'écran plutôt que
 * de dire « échec ».
 */
export function clipboardAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.writeText === 'function' &&
    globalThis.isSecureContext === true
  )
}

/**
 * Copie un texte. **Ne lève jamais** — elle rend ce qui s'est passé.
 *
 * Un `throw` obligerait chaque appelant à un `try/catch` qu'il oubliera : c'est exactement
 * l'oubli qu'on répare ici.
 */
export async function copyText(text: string): Promise<CopyOutcome> {
  if (!clipboardAvailable()) return 'unavailable'

  try {
    await navigator.clipboard.writeText(text)

    return 'ok'
  } catch {
    // Le refus le plus courant n'est pas la permission mais « Document is not focused » :
    // l'onglet a perdu le focus entre le clic et l'écriture.
    return 'refused'
  }
}

/**
 * Programme l'effacement du presse-papiers, et rend de quoi l'annuler.
 *
 * ⚠️ **On n'écrase PAS après relecture, et c'est une décision.** Ne remplacer que si le contenu
 * est toujours le nôtre exigerait `navigator.clipboard.readText()`, qui déclenche une **demande
 * de permission** du navigateur au milieu d'une action de coffre — et un refus rendrait
 * l'effacement impossible. On écrit donc à l'aveugle : si quelque chose a été copié entre-temps,
 * il est perdu. L'écran doit **annoncer le délai** ; c'est le prix de « ne pas l'oublier
 * indéfiniment dans le presse-papiers ».
 *
 * ⚠️ **L'effacement peut échouer silencieusement**, et rien n'y peut : sur un onglet qui n'a plus
 * le focus au moment dit, `writeText` lève « Document is not focused ». Le secret reste alors
 * dans le presse-papiers. C'est une atténuation, jamais une garantie — ne l'écris pas autrement.
 *
 * ⚠️ **L'annulateur n'est pas décoratif** : sans lui, quitter la page laisserait un minuteur
 * effacer le presse-papiers d'un écran qu'on a quitté depuis longtemps.
 */
export function clearClipboardIn(delayMs: number = CLIPBOARD_CLEAR_MS): () => void {
  const minuteur = setTimeout(() => {
    void copyText('')
  }, delayMs)

  return () => clearTimeout(minuteur)
}
