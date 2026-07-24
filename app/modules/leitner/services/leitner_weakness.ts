/**
 * Les **points faibles** : ce que l'historique des révisions dit des thèmes et des
 * cartes qui résistent. Tout est déduit de `leitner_reviews` — aucune colonne n'a été
 * ajoutée, et l'historique déjà en base se lit rétroactivement.
 *
 * ⚠️ **Ce fichier est PUR** — ni base, ni horloge, comme `leitner_sessions.ts`. C'est ce
 * qui le rend prouvable unitairement : la doctrine de rétention (`hard` est une réussite),
 * la remontée thème → catégorie et la coercition `bigint` → nombre se testent ici, sans
 * conteneur Postgres. `LeitnerStatsService` charge la base et délègue.
 */

export type Grade = 'again' | 'hard' | 'good' | 'easy'

/**
 * ⚠️ **Convention, pas une vérité** (comme `SESSION_GAP_MINUTES`) : sous ce nombre de
 * révisions, un « taux d'oubli » est du bruit statistique — un thème à 3 révisions dont
 * une ratée afficherait 33 % et trônerait en tête du classement pour rien. Les lignes
 * sous le seuil restent calculées (leur volume compte dans l'agrégat de catégorie), mais
 * ne sont pas données à voir comme un point faible : c'est `enoughData` qui le porte.
 */
export const WEAKNESS_MIN_REVIEWS = 10

/**
 * ⚠️ **Convention** : une carte doit avoir été *tentée* plusieurs fois pour être « coincée ».
 * Une carte neuve (boîte 1, jamais ou à peine révisée) n'a pas échoué à progresser — elle
 * n'a pas encore eu sa chance. Sans ce plancher, la liste des cartes coincées serait
 * remplie de cartes qu'on vient de créer.
 */
export const STUCK_MIN_REVIEWS = 3

/** Le libellé de la ligne des cartes sans thème — jamais absente de l'agrégat. */
export const UNCLASSIFIED_LABEL = 'Non classées'

/**
 * **Rétention** : `grade !== 'again'` = réussite. ⚠️ **`hard` compte comme une réussite**
 * (la réponse a été rappelée, péniblement) ; seul `again` est un échec de rappel. Même
 * doctrine que le `retention` 30 j de `/revision` et que le CLAUDE.md du module.
 *
 * Rend **`null` quand il n'y a rien à mesurer, jamais 0** : « 0 % » se lirait comme une
 * rétention effondrée, alors que c'est l'absence de données. La page affiche `—`.
 */
export function retentionRate(grades: Grade[]): number | null {
  if (grades.length === 0) return null
  const recalled = grades.filter((grade) => grade !== 'again').length
  return Math.round((recalled / grades.length) * 100)
}

/**
 * Une ligne de l'agrégat SQL `group by leitner_theme_id`. ⚠️ `count(*)` revient de
 * Postgres en **`bigint`, donc en chaîne** : `total`/`again` acceptent `string`, et
 * c'est ici — dans le code testé — qu'on les passe par `Number()`.
 */
export interface ThemeAgainRow {
  themeId: number | null
  total: number | string
  again: number | string
}

interface TaxonomyTheme {
  id: number
  name: string
}

interface TaxonomyCategory {
  id: number
  name: string
  themes: TaxonomyTheme[]
}

export interface WeaknessTheme {
  themeId: number
  name: string
  total: number
  again: number
  /** Taux d'`again` en pourcentage entier. `0` quand `total === 0` (jamais atteint ici). */
  rate: number
  /** `total >= WEAKNESS_MIN_REVIEWS` — la page décide de l'afficher au classement. */
  enoughData: boolean
}

export interface WeaknessCategory {
  /** `null` = la catégorie synthétique « Non classées » (cartes sans thème). */
  categoryId: number | null
  name: string
  total: number
  again: number
  rate: number
  enoughData: boolean
  /** Vide pour « Non classées ». Trié décroissant par taux. */
  themes: WeaknessTheme[]
}

/**
 * Agrège les lignes `(themeId, total, again)` en catégories, triées **décroissant** par
 * taux d'`again`. C'est la mesure la plus utile du lot : elle désigne les points faibles
 * réels.
 *
 * ⚠️ **Une carte ne connaît que son thème** (`leitner_cards` n'a pas de
 * `leitner_category_id`) : c'est la taxonomie qui remonte le thème à sa catégorie, **en
 * JS**, exactement comme `dueScopeChoices`. Aucune 3ᵉ copie de la sous-requête
 * catégorie → thèmes n'est écrite.
 *
 * ⚠️ **`themeId === null` (cartes non classées) tombe dans « Non classées », jamais
 * exclu** de l'agrégat — le ticket l'exige. Un thème introuvable dans la taxonomie (cas
 * théorique : `ON DELETE SET NULL` nullifie le thème d'une carte, donc ça ne devrait pas
 * arriver) y retombe aussi, par sécurité, plutôt que de disparaître.
 */
export function aggregateWeakness(
  rows: ThemeAgainRow[],
  taxonomy: TaxonomyCategory[]
): WeaknessCategory[] {
  const themeIndex = new Map<
    number,
    { categoryId: number; categoryName: string; themeName: string }
  >()
  for (const category of taxonomy) {
    for (const theme of category.themes) {
      themeIndex.set(theme.id, {
        categoryId: category.id,
        categoryName: category.name,
        themeName: theme.name,
      })
    }
  }

  interface Bucket {
    categoryId: number | null
    name: string
    total: number
    again: number
    themes: Map<number, WeaknessTheme>
  }
  const buckets = new Map<number | null, Bucket>()
  const bucketFor = (categoryId: number | null, name: string): Bucket => {
    let bucket = buckets.get(categoryId)
    if (bucket === undefined) {
      bucket = { categoryId, name, total: 0, again: 0, themes: new Map() }
      buckets.set(categoryId, bucket)
    }
    return bucket
  }

  for (const row of rows) {
    // ⚠️ `Number()` ICI : sans lui, `'12' + '7'` ferait `'127'` et le total de catégorie
    // concatènerait au lieu d'additionner (le piège bigint de CC-46).
    const total = Number(row.total)
    const again = Number(row.again)

    const info = row.themeId === null ? undefined : themeIndex.get(row.themeId)

    if (info === undefined) {
      const bucket = bucketFor(null, UNCLASSIFIED_LABEL)
      bucket.total += total
      bucket.again += again
      continue
    }

    const bucket = bucketFor(info.categoryId, info.categoryName)
    bucket.total += total
    bucket.again += again
    bucket.themes.set(row.themeId as number, {
      themeId: row.themeId as number,
      name: info.themeName,
      total,
      again,
      rate: rateOf(again, total),
      enoughData: total >= WEAKNESS_MIN_REVIEWS,
    })
  }

  return [...buckets.values()]
    .map((bucket) => ({
      categoryId: bucket.categoryId,
      name: bucket.name,
      total: bucket.total,
      again: bucket.again,
      rate: rateOf(bucket.again, bucket.total),
      enoughData: bucket.total >= WEAKNESS_MIN_REVIEWS,
      themes: [...bucket.themes.values()].sort(byRateDesc),
    }))
    .sort(byRateDesc)
}

function rateOf(again: number, total: number): number {
  return total === 0 ? 0 : Math.round((again / total) * 100)
}

/** À taux égal, le plus gros volume d'abord — sinon l'ordre serait celui de la Map. */
function byRateDesc(
  a: { rate: number; total: number },
  b: { rate: number; total: number }
): number {
  return b.rate - a.rate || b.total - a.total
}
