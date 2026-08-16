import { DateTime } from 'luxon'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import { joinProgress, selectWithBox, whereBox } from '#modules/leitner/services/leitner_progress'
import { ALL_CARDS, applyScope, type CardScope } from '#modules/leitner/services/leitner_scope'
import { applyVisibility, assertOwnedOrAdmin } from '#modules/leitner/services/leitner_visibility'

export interface CardFilters {
  search?: string
  categoryId?: number
  themeId?: number
  box?: number
  unclassified?: boolean
}

/**
 * Les filtres de classement de cet écran **sont** un paquet de révision : la même
 * question, posée par une autre page. La traduction SQL vit donc dans `leitner_scope`,
 * en un seul exemplaire — surtout la sous-requête catégorie → thèmes.
 *
 * L'ordre de priorité est celui, historique, de cet écran : « non classées » l'emporte
 * sur un thème, qui l'emporte sur une catégorie.
 */
function filtersToScope(filters: CardFilters): CardScope {
  if (filters.unclassified) return { kind: 'unclassified' }
  if (filters.themeId) return { kind: 'theme', id: filters.themeId }
  if (filters.categoryId) return { kind: 'category', id: filters.categoryId }
  return ALL_CARDS
}

export interface ThemeNode {
  id: number
  name: string
  cardCount: number
}

export interface CategoryNode {
  id: number
  name: string
  cardCount: number
  themes: ThemeNode[]
}

/**
 * Gestion du catalogue : cartes (liste, édition, suppression, reclassement) et
 * taxonomie catégorie → thème. La règle de répétition espacée reste dans
 * `LeitnerService`, qui n'est pas concerné par ce fichier.
 */
export default class LeitnerCatalogService {
  /**
   * Cartes de l'écran de gestion. Volumétrie personnelle : pas de pagination,
   * on renvoie tout ce qui passe les filtres.
   *
   * ⚠️ **Le catalogue est communal, la colonne « boîte » ne l'est pas** (CC-119). Les
   * cartes affichées sont les mêmes pour tout le monde — c'est du contenu partagé — mais
   * la boîte de chaque ligne, et le filtre « boîte N », sont ceux de `userId`. Deux
   * personnes voient donc le même catalogue avec des boîtes différentes, ce qui est le
   * comportement voulu.
   *
   * ⚠️ **La progression est préchargée pour la date d'acquisition** (CC-262) : le
   * catalogue sépare « cartes en cours » et « cartes maîtrisées ». ⚠️ **Il les MARQUE, il
   * ne les filtre pas** — une carte acquise reste listée, y compris sous le filtre
   * « boîte 5 » qui la trouve toujours pendant que la tuile de `/revision` annonce 0.
   * C'est un arbitrage explicite de CC-261 (inventaire de **contenu** d'un côté, file de
   * l'autre) et l'écran de correction : l'y faire disparaître la rendrait inéditable.
   */
  async cards(
    userId: number,
    filters: CardFilters = {},
    isAdmin: boolean = false
  ): Promise<LeitnerCard[]> {
    const query = LeitnerCard.query()
      .preload('theme', (theme) => theme.preload('category'))
      .preload('progress', (progress) => progress.where('user_id', userId))
      .orderBy('leitner_cards.id', 'desc')

    joinProgress(query, userId)
    selectWithBox(query)

    if (filters.search) {
      const needle = `%${filters.search}%`
      query.where((builder) =>
        builder.whereILike('leitner_cards.front', needle).orWhereILike('leitner_cards.back', needle)
      )
    }

    applyScope(query, filtersToScope(filters))
    applyVisibility(query, 'leitner_cards', userId, isAdmin)

    if (filters.box) whereBox(query, filters.box)

    return query
  }

  /**
   * Arbre catégories → thèmes, avec le nombre de cartes **visibles** de chaque nœud.
   *
   * ⚠️ **La taxonomie ET les comptes sont filtrés.** Une catégorie invisible n'apparaît
   * pas du tout ; une catégorie visible mais dont certaines cartes ne le sont pas
   * (partagée, mais contenant du privé d'un autre) ne doit compter que ce que `userId`
   * peut réellement voir — sinon le nombre affiché fuiterait l'existence de cartes
   * inaccessibles.
   */
  async categoryTree(
    userId: number,
    isAdmin: boolean = false
  ): Promise<{ categories: CategoryNode[]; unclassifiedCount: number }> {
    const categoriesQuery = LeitnerCategory.query()
      .preload('themes', (themes) => {
        applyVisibility(themes, 'leitner_themes', userId, isAdmin)
        themes.withCount('cards', (cards) =>
          applyVisibility(cards, 'leitner_cards', userId, isAdmin)
        )
        themes.orderBy('name')
      })
      .orderBy('name')
    applyVisibility(categoriesQuery, 'leitner_categories', userId, isAdmin)
    const categories = await categoriesQuery

    const unclassifiedQuery = LeitnerCard.query().whereNull('leitner_theme_id').count('* as total')
    applyVisibility(unclassifiedQuery, 'leitner_cards', userId, isAdmin)
    const unclassified = await unclassifiedQuery

    return {
      categories: categories.map((category) => {
        const themes = category.themes.map((theme) => ({
          id: theme.id,
          name: theme.name,
          cardCount: Number(theme.$extras.cards_count),
        }))

        return {
          id: category.id,
          name: category.name,
          cardCount: themes.reduce((total, theme) => total + theme.cardCount, 0),
          themes,
        }
      }),
      unclassifiedCount: Number(unclassified[0].$extras.total),
    }
  }

  /** Le thème doit exister ET être visible : sinon la FK sauterait, ou on classerait
   * une carte sous un thème qu'on ne peut pas soi-même retrouver. */
  private async assertTheme(
    themeId: number | null | undefined,
    userId: number,
    isAdmin: boolean
  ): Promise<number | null> {
    if (themeId === null || themeId === undefined) return null
    const query = LeitnerTheme.query().where('id', themeId)
    applyVisibility(query, 'leitner_themes', userId, isAdmin)
    // Invisible se traite comme inexistant, même exception que `findOrFail` avant ce
    // lot : ni la FK ni un id sondé à l'aveugle ne doivent distinguer les deux cas.
    await query.firstOrFail()
    return themeId
  }

  /**
   * ⚠️ **Aucune progression n'est semée à la création** (CC-119) : l'absence de ligne
   * vaut « boîte 1, due aujourd'hui » **pour tout le monde**, y compris les comptes créés
   * avant cette carte. Poser une ligne par personne ici obligerait à un re-semis à chaque
   * nouveau compte comme à chaque nouvelle carte — et une carte créée entre les deux
   * resterait invisible, sans erreur.
   */
  async createCard(
    payload: { front: string; back: string; leitnerThemeId?: number | null; isShared?: boolean },
    userId: number,
    isAdmin: boolean = false
  ): Promise<LeitnerCard> {
    return LeitnerCard.create({
      front: payload.front,
      back: payload.back,
      leitnerThemeId: await this.assertTheme(payload.leitnerThemeId, userId, isAdmin),
      ownerId: userId,
      isShared: payload.isShared ?? false,
    })
  }

  /**
   * Identité d'une carte dans ce module : **son recto, dans son thème**. Le même recto
   * sous deux thèmes reste deux cartes ; sous le même thème, c'est la même.
   *
   * ⚠️ **Pas de filtre de visibilité ici, délibérément** — c'est la déduplication du
   * catalogue, la même depuis avant CC-139 : elle compare contre TOUT ce qui existe sous
   * ce thème, visible ou non. Un import ou une promotion d'ingestion qui retomberait sur
   * le recto d'une carte privée d'un autre compte n'y touche pas et n'en gagne pas l'accès
   * — il obtient simplement zéro carte créée, comme n'importe quel autre doublon.
   */
  async findDuplicate(front: string, themeId: number | null): Promise<LeitnerCard | null> {
    const query = LeitnerCard.query().where('front', front)

    if (themeId === null) query.whereNull('leitner_theme_id')
    else query.where('leitner_theme_id', themeId)

    return query.first()
  }

  /**
   * Crée la carte **sauf si** son recto existe déjà sous ce thème : la carte existante
   * est alors renvoyée telle quelle, jamais écrasée (son verso survit, et la progression
   * de chacun avec lui — elle ne vit plus sur la carte). Même règle que l'import JSON —
   * c'est le catalogue qui porte
   * la déduplication, et toute nouvelle source de cartes (import, ingestion LLM) passe
   * par ici plutôt que d'écrire sur `LeitnerCard`.
   */
  async createCardUnlessDuplicate(
    payload: { front: string; back: string; leitnerThemeId?: number | null; isShared?: boolean },
    userId: number,
    isAdmin: boolean = false
  ): Promise<{ card: LeitnerCard; created: boolean }> {
    const existing = await this.findDuplicate(payload.front, payload.leitnerThemeId ?? null)
    if (existing) return { card: existing, created: false }

    return { card: await this.createCard(payload, userId, isAdmin), created: true }
  }

  async updateCard(
    card: LeitnerCard,
    payload: { front: string; back: string; leitnerThemeId?: number | null; isShared?: boolean },
    userId: number,
    isAdmin: boolean = false
  ): Promise<LeitnerCard> {
    assertOwnedOrAdmin(card, userId, isAdmin)
    card.front = payload.front
    card.back = payload.back
    card.leitnerThemeId = await this.assertTheme(payload.leitnerThemeId, userId, isAdmin)
    if (payload.isShared !== undefined) card.isShared = payload.isShared
    await card.save()
    return card
  }

  /**
   * Suppression unitaire ou multiple. Révisions **et** progressions partent en cascade
   * (FK) — celles de tout le monde qui a noté cette carte : la supprimer efface le
   * travail de chacun dessus, quel que soit son propriétaire. C'est la seule suppression
   * du module qui détruise des données personnelles sans passer par la suppression d'un
   * compte.
   *
   * ⚠️ **Chaque carte est vérifiée avant suppression** (`assertOwnedOrAdmin`), pas
   * seulement filtrée : un `whereIn` qui filtrerait silencieusement les ids non possédés
   * supprimerait un sous-ensemble sans le dire — l'appelant croirait avoir tout supprimé.
   * Refuser net sur la première carte non possédée est le même choix que `resolveScope`
   * fait sur un paquet : jamais de repli silencieux.
   */
  async deleteCards(ids: number[], userId: number, isAdmin: boolean = false): Promise<number> {
    if (ids.length === 0) return 0
    const cards = await LeitnerCard.query().whereIn('id', ids)
    for (const card of cards) assertOwnedOrAdmin(card, userId, isAdmin)

    await LeitnerCard.query().whereIn('id', ids).delete()
    return ids.length
  }

  /** Reclassement multiple. `null` remet les cartes en « non classé ». Même garde que
   * `deleteCards` : chaque carte ciblée doit être possédée (ou l'appelant admin). */
  async assignTheme(
    ids: number[],
    themeId: number | null,
    userId: number,
    isAdmin: boolean = false
  ): Promise<number> {
    if (ids.length === 0) return 0
    await this.assertTheme(themeId, userId, isAdmin)

    const cards = await LeitnerCard.query().whereIn('id', ids)
    for (const card of cards) assertOwnedOrAdmin(card, userId, isAdmin)

    await LeitnerCard.query()
      .whereIn('id', ids)
      .update({ leitner_theme_id: themeId, updated_at: DateTime.now().toSQL() })
    return ids.length
  }

  /**
   * `null` si le nom est déjà pris (l'appelant en fait une erreur de formulaire).
   *
   * ⚠️ **L'unicité est désormais scopée par propriétaire** (CC-139, `unique(owner_id,
   * name)` en base) : deux comptes peuvent chacun avoir une catégorie « DevOps » sans se
   * marcher dessus. Le contrôle applicatif suit exactement la contrainte de base.
   */
  async createCategory(
    name: string,
    userId: number,
    isShared: boolean = false
  ): Promise<LeitnerCategory | null> {
    if (await LeitnerCategory.query().where('name', name).where('owner_id', userId).first()) {
      return null
    }
    return LeitnerCategory.create({ name, ownerId: userId, isShared })
  }

  async renameCategory(
    category: LeitnerCategory,
    name: string,
    userId: number,
    isAdmin: boolean = false
  ): Promise<LeitnerCategory | null> {
    assertOwnedOrAdmin(category, userId, isAdmin)

    // `.where('owner_id', null)` ne trouverait jamais rien (SQL : `= NULL` n'est jamais
    // vrai) — et c'est cohérent : deux lignes `owner_id IS NULL` ne se heurtent déjà pas
    // à `unique(owner_id, name)`, Postgres traitant deux `NULL` comme distincts.
    const clashQuery = LeitnerCategory.query().where('name', name).whereNot('id', category.id)
    if (category.ownerId === null) clashQuery.whereNull('owner_id')
    else clashQuery.where('owner_id', category.ownerId)
    const clash = await clashQuery.first()
    if (clash) return null

    category.name = name
    await category.save()
    return category
  }

  /** Supprime la catégorie, ses thèmes (cascade) ; ses cartes deviennent non classées. */
  async deleteCategory(
    category: LeitnerCategory,
    userId: number,
    isAdmin: boolean = false
  ): Promise<void> {
    assertOwnedOrAdmin(category, userId, isAdmin)
    await category.delete()
  }

  /** La catégorie parente doit être visible : on ne classe rien sous ce qu'on ne
   * retrouve pas soi-même. Le thème créé, lui, appartient à qui le crée — pas
   * nécessairement au propriétaire de la catégorie. */
  async createTheme(
    categoryId: number,
    name: string,
    userId: number,
    isAdmin: boolean = false,
    isShared: boolean = false
  ): Promise<LeitnerTheme | null> {
    const categoryQuery = LeitnerCategory.query().where('id', categoryId)
    applyVisibility(categoryQuery, 'leitner_categories', userId, isAdmin)
    await categoryQuery.firstOrFail()

    const clash = await LeitnerTheme.query()
      .where('leitner_category_id', categoryId)
      .where('name', name)
      .first()
    if (clash) return null

    return LeitnerTheme.create({ leitnerCategoryId: categoryId, name, ownerId: userId, isShared })
  }

  /**
   * Taxonomie désignée **par son nom**, créée à la volée si elle manque. C'est la voie
   * d'entrée de tout ce qui vient de l'extérieur (fichier importé, sortie d'un LLM) :
   * un id venu du dehors n'est jamais fiable, un nom l'est toujours.
   *
   * ⚠️ **La réutilisation ne porte que sur le VISIBLE** (CC-139) : une catégorie/thème
   * « DevOps » déjà présent mais privé chez un autre compte n'est jamais réutilisé — il
   * en naît un second, privé, appartenant à `userId`. Réutiliser l'invisible attacherait
   * silencieusement du contenu neuf à une taxonomie que son créateur ne voit jamais
   * lui-même, et ferait fuiter son existence par la bande.
   */
  async ensureTheme(
    categoryName: string,
    themeName: string,
    userId: number,
    isAdmin: boolean = false
  ): Promise<LeitnerTheme> {
    const categoryQuery = LeitnerCategory.query().where('name', categoryName)
    applyVisibility(categoryQuery, 'leitner_categories', userId, isAdmin)
    let category = await categoryQuery.first()
    if (!category) {
      category = await LeitnerCategory.create({
        name: categoryName,
        ownerId: userId,
        isShared: false,
      })
    }

    const themeQuery = LeitnerTheme.query()
      .where('leitner_category_id', category.id)
      .where('name', themeName)
    applyVisibility(themeQuery, 'leitner_themes', userId, isAdmin)
    const existingTheme = await themeQuery.first()
    if (existingTheme) return existingTheme

    return LeitnerTheme.create({
      leitnerCategoryId: category.id,
      name: themeName,
      ownerId: userId,
      isShared: false,
    })
  }

  /** Renommer et/ou déplacer un thème dans une autre catégorie. */
  async updateTheme(
    theme: LeitnerTheme,
    payload: { name: string; leitnerCategoryId: number; isShared?: boolean },
    userId: number,
    isAdmin: boolean = false
  ): Promise<LeitnerTheme | null> {
    assertOwnedOrAdmin(theme, userId, isAdmin)

    const categoryQuery = LeitnerCategory.query().where('id', payload.leitnerCategoryId)
    applyVisibility(categoryQuery, 'leitner_categories', userId, isAdmin)
    await categoryQuery.firstOrFail()

    const clash = await LeitnerTheme.query()
      .where('leitner_category_id', payload.leitnerCategoryId)
      .where('name', payload.name)
      .whereNot('id', theme.id)
      .first()
    if (clash) return null

    theme.name = payload.name
    theme.leitnerCategoryId = payload.leitnerCategoryId
    if (payload.isShared !== undefined) theme.isShared = payload.isShared
    await theme.save()
    return theme
  }

  /** Supprime le thème ; ses cartes deviennent non classées (FK ON DELETE SET NULL). */
  async deleteTheme(theme: LeitnerTheme, userId: number, isAdmin: boolean = false): Promise<void> {
    assertOwnedOrAdmin(theme, userId, isAdmin)
    await theme.delete()
  }
}
