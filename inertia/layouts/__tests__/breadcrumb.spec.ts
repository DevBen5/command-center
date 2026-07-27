import { describe, expect, test } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { crumbKeys, isDestinationRoot } from '../breadcrumb'

/*
| CC-110 — le segment « écran » du fil d'Ariane.
|
| ⚠️ Ce que ce test ne voit **pas** : le rendu. Que le fil s'affiche, qu'il tienne sur une ligne et
| qu'un nom long ne pousse pas le titre hors de la topbar se vérifie au navigateur — jsdom ne fait
| aucun layout.
*/

describe('Fil d’Ariane — les clés candidates', () => {
  test('dérive le module et l’écran du nom de composant Inertia', () => {
    expect(crumbKeys('modules/leitner/stats')).toEqual([
      'leitner.stats.crumb',
      'leitner.stats.title',
    ])
    expect(crumbKeys('modules/veille/sources')).toEqual([
      'veille.sources.crumb',
      'veille.sources.title',
    ])
  })

  /**
   * ⚠️ **La seule page du dépôt dont le nom de fichier tient en deux mots.** Tant qu'un nom est
   * d'un seul mot, snake_case et camelCase coïncident et on peut croire qu'il n'y a pas de règle
   * à appliquer. `ingest_show.vue` → `leitner.ingestShow.*` est ce qui la révèle.
   */
  test('convertit le snake_case du fichier en camelCase de la clé', () => {
    expect(crumbKeys('modules/leitner/ingest_show')).toEqual([
      'leitner.ingestShow.crumb',
      'leitner.ingestShow.title',
    ])
  })

  /**
   * ⚠️ **`crumb` d'abord, `title` en repli, et l'ordre est le contrat.** Ce sont deux besoins :
   * `title` remplit le `<title>` de l'onglet, où « Configuration du LLM » est juste ; un fil
   * d'Ariane veut « Configuration ». Un écran dont le titre est déjà court ne pose que `title` —
   * `stats` est ce cas, et c'est ce qui garde le repli vivant plutôt que théorique.
   */
  test('préfère crumb à title', () => {
    expect(crumbKeys('modules/leitner/llm')[0]).toBe('leitner.llm.crumb')
    expect(crumbKeys('modules/leitner/llm')[1]).toBe('leitner.llm.title')
  })

  test('ne rend rien sur un nom de composant hors format', () => {
    expect(crumbKeys('login')).toEqual([])
    expect(crumbKeys('core/auth')).toEqual([])
    expect(crumbKeys('a/b/c/d')).toEqual([])
    expect(crumbKeys('')).toEqual([])
  })
})

describe('Fil d’Ariane — la racine d’un module', () => {
  test('reconnaît la destination elle-même', () => {
    expect(isDestinationRoot('/veille', '/veille')).toBe(true)
    expect(isDestinationRoot('/', '/')).toBe(true)
  })

  /**
   * ⚠️ **Le test qui porte la fonction.** Sans le retrait de la query string, la page d'accueil de
   * la veille gagnerait un troisième segment dès le premier filtre cliqué — `/veille?tag=rust` n'est
   * pas un autre écran, c'est le même avec un filtre.
   */
  test('ignore la query string et le fragment', () => {
    expect(isDestinationRoot('/veille?page=2', '/veille')).toBe(true)
    expect(isDestinationRoot('/veille?tag=rust&unread=true', '/veille')).toBe(true)
    expect(isDestinationRoot('/veille#haut', '/veille')).toBe(true)
  })

  test('ignore un slash final', () => {
    expect(isDestinationRoot('/veille/', '/veille')).toBe(true)
    expect(isDestinationRoot('/veille', '/veille/')).toBe(true)
  })

  test('distingue une sous-page', () => {
    expect(isDestinationRoot('/veille/sources', '/veille')).toBe(false)
    expect(isDestinationRoot('/revision/stats', '/revision')).toBe(false)
    expect(isDestinationRoot('/revision/ingest/42', '/revision')).toBe(false)
  })
})

/**
 * Le garde-fou structurel : une page ajoutée sans libellé n'apparaîtrait nulle part dans le fil.
 *
 * ⚠️ **Le repli rend ce cas silencieux**, et c'est délibéré — mieux vaut un fil qui s'arrête au
 * module qu'une clé brute dans la topbar. Ce test est donc le seul endroit où l'oubli se voit.
 *
 * ⚠️ **La liste des modules n'est pas écrite ici.** Elle se déduit : un module est concerné dès que
 * son `fr.json` porte une clé au nom d'une de ses pages — ce qui est le cas de `leitner` et
 * `veille`, et pas d'`agents` ni de `services`, dont l'i18n est plate parce qu'ils n'ont qu'un
 * écran. Écrire la liste à la main la ferait vieillir en silence, exactement ce que ce lot évite
 * dans `AppLayout.vue`.
 */
describe('Fil d’Ariane — les clés existent réellement', () => {
  const camel = (v: string) => v.replace(/_([a-z])/g, (_, l: string) => l.toUpperCase())

  const modules = readdirSync('app/modules', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(`app/modules/${name}/pages`))
    .map((name) => {
      const pages = readdirSync(`app/modules/${name}/pages`)
        .filter((file) => file.endsWith('.vue'))
        .map((file) => camel(file.replace(/\.vue$/, '')))
      const path = `app/modules/${name}/i18n/fr.json`
      const messages = existsSync(path)
        ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, string>>)
        : {}
      return { name, pages, messages }
    })
    // Les modules à i18n plate n'ont qu'un écran, qui est leur destination : aucun segment à rendre.
    .filter(({ pages, messages }) => pages.some((p) => messages[p] !== undefined))

  test('les modules à i18n par page sont bien ceux attendus', () => {
    // Si cette liste change, c'est que l'i18n d'un module a changé de forme — relire le bloc
    // ci-dessus avant de simplement mettre le nom à jour.
    expect(modules.map((m) => m.name).sort()).toEqual(['leitner', 'veille'])
  })

  test('chaque page de ces modules porte un crumb ou un title', () => {
    for (const { name, pages, messages } of modules) {
      for (const page of pages) {
        const block = messages[page]
        const label = block?.crumb ?? block?.title

        expect(label, `${name}/${page} n’a ni crumb ni title dans i18n/fr.json`).toBeTruthy()
      }
    }
  })
})
