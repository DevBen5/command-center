/*
|------------------------------------------------------------------------------
| La recherche de l'écran de choix : l'arbre des portées → la liste qu'on propose
|------------------------------------------------------------------------------
|
| Séparé de `LeitnerScopeSearch.vue` parce que c'est le cœur du sujet, et la seule
| partie qui se prouve **sans navigateur** : aucun test de composant Vue n'existe
| dans ce dépôt (la décision reste ouverte), celui-ci est donc unitaire —
| `tests/unit/leitner_scope_search.spec.ts`.
|
| Du code pur : ni requête, ni état. L'arbre entier est déjà dans les props de
| l'écran de choix (5 catégories, 15 thèmes) — filtrer côté client est instantané,
| et il n'y a **aucune route à ajouter**.
*/

/** Un thème, tel que `LeitnerService.dueScopeChoices()` l'envoie. */
export interface ThemeChoice {
  id: number
  name: string
  dueCount: number
}

/** Une catégorie et ses thèmes, tels que `LeitnerService.dueScopeChoices()` les envoie. */
export interface CategoryChoice {
  id: number
  name: string
  dueCount: number
  themes: ThemeChoice[]
}

/** Une portée retenue par la barre : de quoi l'afficher, et l'ouvrir. */
export interface ScopeMatch {
  /** Clé de rendu : une catégorie et un thème peuvent porter le même id. */
  key: string
  kind: 'category' | 'theme'
  /**
   * Le chemin, toujours complet — « Linux » est à la fois une catégorie **et** un
   * thème de DevOps dans les données réelles : un thème affiché seul est ambigu.
   */
  categoryName: string
  themeName: string | null
  dueCount: number
  /** La session : une query string sur `GET /revision`, jamais une route nouvelle. */
  href: string
  /** 0 carte due : la portée se trouve et s'affiche, mais ne s'ouvre pas. */
  selectable: boolean
}

/**
 * La forme comparable d'un nom : sans accent, sans casse, sans espace superflu.
 *
 * ⚠️ **C'est le piège du lot.** Les catégories réelles s'appellent « Sécurité »,
 * « Modèles » — et personne ne tape les accents dans une barre de recherche. Un
 * `toLowerCase().includes()` (ce que fait `TaxonomyCombobox`, sur des noms déjà
 * choisis dans une liste) ne trouve alors rien.
 *
 * Même approche que `draftKey` (`leitner_ingestion_service.ts`) : `NFD` décompose
 * « é » en « e » + accent combinant, que `\p{Diacritic}` retire. La ponctuation
 * finale, elle, n'a pas de sens ici — c'est un nom, pas une phrase.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function categoryMatch(category: CategoryChoice): ScopeMatch {
  return {
    key: `category-${category.id}`,
    kind: 'category',
    categoryName: category.name,
    themeName: null,
    dueCount: category.dueCount,
    href: `/revision?category=${category.id}`,
    selectable: category.dueCount > 0,
  }
}

function themeMatch(category: CategoryChoice, theme: ThemeChoice): ScopeMatch {
  return {
    key: `theme-${theme.id}`,
    kind: 'theme',
    categoryName: category.name,
    themeName: theme.name,
    dueCount: theme.dueCount,
    href: `/revision?theme=${theme.id}`,
    selectable: theme.dueCount > 0,
  }
}

/**
 * Les portées que la saisie retient, dans l'ordre de l'arbre — celui du serveur
 * (alphabétique, une catégorie puis ses thèmes) : la barre ne réordonne rien.
 *
 * - **Requête vide → tout l'arbre.** C'est ce que déplie le bouton de droite.
 * - **Une catégorie retenue emmène tous ses thèmes** : taper `devops` propose la
 *   catégorie *et* ce qu'elle contient.
 * - Sinon, seuls les thèmes retenus paraissent : leur chemin `Catégorie · Thème`
 *   dit d'où ils viennent.
 * - ⚠️ **Une portée à 0 carte due n'est jamais masquée** : elle est rendue non
 *   sélectionnable (`selectable: false`). La faire disparaître ferait croire
 *   qu'elle n'existe pas — c'est la règle de l'écran, pas une règle de la barre.
 */
export function filterScopes(categories: CategoryChoice[], query: string): ScopeMatch[] {
  const needle = normalizeForSearch(query)
  const matches: ScopeMatch[] = []

  for (const category of categories) {
    if (needle === '' || normalizeForSearch(category.name).includes(needle)) {
      matches.push(categoryMatch(category))
      for (const theme of category.themes) matches.push(themeMatch(category, theme))
      continue
    }

    for (const theme of category.themes) {
      if (normalizeForSearch(theme.name).includes(needle)) matches.push(themeMatch(category, theme))
    }
  }

  return matches
}
