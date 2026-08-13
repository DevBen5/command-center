import { test } from '@japa/runner'
import { readFile, readdir } from 'node:fs/promises'
import { PREVIEW_MAX_CHARS, previewTooLong } from '#modules/leitner/shared/card_preview'

/*
|------------------------------------------------------------------------------
| L'aperçu du rendu Markdown — le pur, et les deux régressions muettes (CC-257)
|------------------------------------------------------------------------------
| Le branchement des routes vit dans `tests/functional/modules/leitner_preview.spec.ts`.
| Ici, ce que jsdom ne verra jamais et que le typecheck ne lit pas : les deux façons
| dont cette fonctionnalité peut cesser de marcher SANS que rien ne rougisse.
*/

test.group('Leitner — la borne de l’aperçu', () => {
  test('elle porte sur chaque champ, jamais sur leur somme', ({ assert }) => {
    const plein = 'a'.repeat(PREVIEW_MAX_CHARS)

    // Deux champs pleins restent acceptables : c'est un plafond PAR champ, comme le validateur.
    // Les additionner refuserait côté page ce que la route, elle, accepte — donc un panneau qui
    // annonce « trop long » sur un contenu parfaitement rendable.
    assert.isFalse(previewTooLong(plein, plein))
    assert.isTrue(previewTooLong(plein + 'a', ''))
    assert.isTrue(previewTooLong('', plein + 'a'))
  })

  test('elle mesure ce qui sera envoyé, donc après trim', ({ assert }) => {
    // `cardPreviewValidator` trime avant de borner : mesurer la chaîne brute ferait refuser côté
    // page un contenu que la route accepterait, à cause d'espaces qu'elle allait retirer.
    const limite = `  ${'a'.repeat(PREVIEW_MAX_CHARS)}  `

    assert.isFalse(previewTooLong(limite, ''))
  })
})

/*
|------------------------------------------------------------------------------
| Régression muette n° 1 — la borne recopiée
|------------------------------------------------------------------------------
| C'est exactement CC-60, rejoué. Une borne déclarée deux fois finit par diverger, et le
| symptôme est invisible : la page enverrait un contenu que le validateur refuse, le
| `fetch` recevrait un 422 que personne ne regarde, et le panneau resterait vide **sans
| dire pourquoi**. La constante vit donc dans `shared/card_preview.ts`, importée des deux
| côtés.
|
| ⚠️ Ce test attrape la RECOPIE LITTÉRALE, pas toute réintroduction : un `20 * 1000`
| passerait au travers. Ce n'est pas prétendu couvert — il vise le geste réel, qui est le
| copier-coller.
*/
test.group('Leitner — PREVIEW_MAX_CHARS n’est déclaré qu’une fois', () => {
  const CONSOMMATEURS = [
    'app/modules/leitner/pages/settings.vue',
    'app/modules/leitner/pages/ingest_show.vue',
    'app/modules/leitner/components/MarkdownPreviewPanel.vue',
    'app/modules/leitner/components/leitner_markdown_preview.ts',
  ]

  for (const chemin of CONSOMMATEURS) {
    test(`${chemin} ne redéclare pas la borne`, async ({ assert }) => {
      // Effet de bord voulu : un fichier renommé fait lever `readFile`, donc rougir bruyamment.
      const source = await readFile(new URL(`../../${chemin}`, import.meta.url), 'utf-8')

      assert.notInclude(source, '20_000')
      assert.notInclude(source, '20000')
    })
  }
})

/*
|------------------------------------------------------------------------------
| Régression muette n° 2 — un `v-html` sans la classe `markdown`
|------------------------------------------------------------------------------
| C'est le mode d'échec le plus probable de ce lot, et il est **totalement invisible** :
| `renderMarkdown` rend un fragment SANS classes (c'est écrit dans son en-tête), et sans
| `.markdown` le Preflight de Tailwind laisse les `ul` sans puces et ramène tous les titres
| à la taille du texte courant. L'aperçu s'affiche, paraît fonctionner, et ment sur ce que
| la révision montrera — pendant que `lint`, `typecheck` et les deux suites restent verts,
| jsdom ne faisant aucun layout.
|
| ⚠️ **Le balayage porte sur TOUT le module, pas seulement sur les fichiers de ce lot.**
| Un cinquième `v-html` posé demain sur un écran Leitner tombe dans la règle sans que
| personne n'ait à y penser — et c'est le seul moyen d'attraper le geste qui casse ça : un
| refactor de classes utilitaires qui emporte `markdown` en croyant nettoyer du décor.
*/
test.group('Leitner — tout v-html du module porte la classe markdown', () => {
  /** Le contenu de la balise ouvrante qui porte l'attribut, en remontant jusqu'à son `<`. */
  function baliseOuvrante(source: string, positionDuVHtml: number): string {
    const debut = source.lastIndexOf('<', positionDuVHtml)
    return source.slice(debut, positionDuVHtml)
  }

  async function fichiersVue(dossier: URL): Promise<URL[]> {
    const entrees = await readdir(dossier, { withFileTypes: true })
    const trouves: URL[] = []

    for (const entree of entrees) {
      if (entree.isDirectory()) {
        trouves.push(...(await fichiersVue(new URL(`${entree.name}/`, dossier))))
      } else if (entree.name.endsWith('.vue')) {
        trouves.push(new URL(entree.name, dossier))
      }
    }

    return trouves
  }

  test('aucun n’est rendu sans son habillage', async ({ assert }) => {
    const racine = new URL('../../app/modules/leitner/', import.meta.url)
    const fichiers = await fichiersVue(racine)

    let vus = 0

    for (const fichier of fichiers) {
      const source = await readFile(fichier, 'utf-8')

      for (const occurrence of source.matchAll(/v-html=/g)) {
        vus += 1
        const balise = baliseOuvrante(source, occurrence.index)

        assert.include(
          balise,
          'markdown',
          `${fichier.pathname} : un v-html sans la classe « markdown » — le rendu sera sans ` +
            `puces ni titres, et rien d'autre ne le dira.`
        )
      }
    }

    // ⚠️ Le plancher, sans lequel cette garde peut naître inerte : un balayage cassé (mauvaise
    // racine, extension ratée) ne trouverait AUCUN `v-html` et passerait au vert en n'ayant rien
    // comparé. Même mode d'échec que `tests_index.spec.ts` et `keys.spec.ts`. Le module en porte
    // quatre depuis CC-133 (recto/verso de la révision, les deux champs de l'aperçu LLM) et un
    // cinquième depuis CC-257 — le panneau, mutualisé, donc un seul pour les deux écrans.
    assert.isAtLeast(vus, 5)
  })
})
