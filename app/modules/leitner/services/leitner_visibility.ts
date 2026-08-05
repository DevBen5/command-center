import ForbiddenException from '#core/shared/exceptions/forbidden_exception'

/**
 * Le cloisonnement par propriétaire du contenu (CC-139) — l'unique copie de cette
 * clause, comme `applyScope` est l'unique copie de la sous-requête catégorie → thèmes et
 * `joinProgress` l'unique copie de la jointure de progression.
 *
 * ⚠️ **Renverse la ligne directrice de CC-119** (« le contenu ne connaît aucun
 * utilisateur ») sur `leitner_cards`, `leitner_categories`, `leitner_themes` et
 * `leitner_ingestions` : ces quatre tables portent désormais `owner_id` + `is_shared`.
 * Voir `app/modules/leitner/CLAUDE.md`.
 */

/**
 * Le sous-ensemble de l'API Lucid dont `applyVisibility` a besoin — délibérément **pas**
 * `ModelQueryBuilderContract` : cette fonction s'appelle aussi bien sur un `Model.query()`
 * de premier niveau que dans un callback `preload()`/`withCount()`, dont le type exact
 * (`HasManyQueryBuilderContract`, `RelationSubQueryBuilderContract`…) diffère à chaque
 * relation sur des méthodes (`paginate()`…) que cette fonction n'utilise jamais. Une
 * interface structurelle réduite à `.where()` est satisfaite par tous ces types sans
 * qu'il faille les énumérer.
 */
interface VisibilityWhereBuilder {
  where(column: string, value: unknown): this
  orWhere(column: string, value: unknown): this
  orWhereNull(column: string): this
}
interface VisibilityQuery {
  where(callback: (builder: VisibilityWhereBuilder) => void): unknown
}

/** Visible si : à moi, OU marqué partagé, OU (admin ET orphelin — propriétaire supprimé). */
export function applyVisibility(
  query: VisibilityQuery,
  table: string,
  userId: number,
  isAdmin: boolean
): void {
  query.where((builder) => {
    builder.where(`${table}.owner_id`, userId).orWhere(`${table}.is_shared`, true)
    // ⚠️ **Repli admin ÉTROIT** : seulement l'orphelin (`owner_id IS NULL`), jamais le
    // privé d'un compte actif. Un admin ne voit déjà pas la progression des autres
    // (CC-119) ; ce repli sert à faire le ménage d'un contenu que plus personne d'autre
    // ne peut jamais voir, pas à donner à l'admin un accès général au privé d'autrui.
    if (isAdmin) builder.orWhereNull(`${table}.owner_id`)
  })
}

/**
 * La même règle que `applyVisibility`, appliquée à une ligne déjà chargée — pour les
 * chemins qui relisent par id (`findOrFail`) plutôt que de passer par une requête
 * filtrée : `review()` et `judge()` relisent la carte par son id avant d'agir dessus, et
 * `applyVisibility` ne les protège pas puisqu'elles ne l'appellent jamais.
 */
export function isVisible(
  row: { ownerId: number | null; isShared: boolean },
  userId: number,
  isAdmin: boolean
): boolean {
  return row.ownerId === userId || row.isShared || (isAdmin && row.ownerId === null)
}

/** ⚠️ Lève, ne retourne jamais — voir `assertOwnedOrAdmin`. */
export function assertVisibleOrAdmin(
  row: { ownerId: number | null; isShared: boolean },
  userId: number,
  isAdmin: boolean
): void {
  if (!isVisible(row, userId, isAdmin)) {
    throw new ForbiddenException("Ce contenu n'est pas accessible.")
  }
}

/**
 * Le garde d'écriture : créer/éditer/supprimer/reclasser n'est jamais ouvert par
 * `is_shared` — seul le propriétaire ou un admin peut écrire. Un `is_shared` qui
 * ouvrirait l'écriture viderait la notion de propriété : n'importe qui avec la capacité
 * `cards.write`/`taxonomy.write` pourrait alors modifier le contenu partagé d'un autre.
 *
 * ⚠️ **Lève, ne retourne jamais** (`ForbiddenException`) : un `response.forbidden()` ici
 * court-circuiterait la page 403 — voir `ForbiddenException`. Masquer un bouton n'est pas
 * un droit ; c'est ce garde, appelé côté serveur, qui l'est.
 */
export function assertOwnedOrAdmin(
  row: { ownerId: number | null },
  userId: number,
  isAdmin: boolean
): void {
  if (isAdmin) return
  if (row.ownerId === userId) return
  throw new ForbiddenException("Ce contenu appartient à quelqu'un d'autre.")
}
