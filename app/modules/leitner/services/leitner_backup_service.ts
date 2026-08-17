import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCardProgress from '#modules/leitner/models/leitner_card_progress'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerCourse, { type CourseSource } from '#modules/leitner/models/leitner_course'
import LeitnerCourseSection from '#modules/leitner/models/leitner_course_section'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import { hashCourseMarkdown } from '#modules/leitner/services/leitner_course_sections'
import { DEFAULT_BOX } from '#modules/leitner/services/leitner_progress'
import type { Grade, ReviewKind, Verdict } from '#modules/leitner/services/leitner_service'
import { applyVisibility } from '#modules/leitner/services/leitner_visibility'

/**
 * Version du format d'échange. Un fichier qui déclare une autre version est
 * refusé à l'import : mieux vaut un refus net qu'un import « au mieux » qui
 * écrirait des données fausses en silence. Un fichier **sans** `version` est
 * un fichier écrit à la main : il est lu comme la version courante.
 *
 * ⚠️ **Ajouter un champ optionnel ne bump PAS cette valeur, et c'est un choix.**
 * Les cinq colonnes de trace d'une révision (CC-51) sont arrivées ainsi : l'ajout
 * est strictement **additif**, donc un fichier antérieur reste intégralement
 * lisible — le déclarer « autre format » serait faux. Ce que le bump aurait acheté
 * est l'inverse : qu'un build **antérieur** refuse net un fichier neuf au lieu de
 * le tronquer. Coût assumé, et c'est le seul : un checkout d'avant CC-51 qui
 * importerait un fichier d'aujourd'hui en perdrait les cinq champs **sans un mot**.
 * Bump-la le jour où un champ change de sens ou devient obligatoire — là, un
 * ancien fichier serait vraiment illisible.
 *
 * ⚠️ **C'est arrivé en CC-119, d'où le `2`** : `box`, `nextReview` et `reviews` ne
 * décrivent plus « le paquet », ils décrivent **la progression de celui qui exporte**.
 * Les clés n'ont pas bougé, leur sens si — exactement le critère posé ci-dessus. Un
 * fichier v1 relu par un build d'avant CC-119 ne serait pas *faux*, mais un fichier v2
 * importé sur une installation multi-comptes attribuerait à une personne un historique
 * qui n'est pas le sien, sans que rien ne le dise.
 *
 * ⚠️ **Et c'est arrivé une deuxième fois en CC-139, d'où le `3`** : le fichier ne rend
 * plus « tout le contenu communal », mais **le visible par celui qui exporte** — sa
 * propre carte privée, plus tout ce qui est marqué partagé. Un fichier v3 relu par un
 * build d'avant CC-139 ne serait pas faux (le nouveau champ `shared` est ignoré), mais un
 * fichier v1/v2 importé après CC-139 attribuerait un sens à une absence de champ qu'il
 * faut trancher explicitement — voir `shared` sur `BackupCard`.
 *
 * ⚠️ **Une troisième fois en CC-260, d'où le `4`**, et c'est le même critère : `kind`
 * **manque** dans un fichier antérieur, et son absence doit se trancher (`'normal'`, voir
 * `resolveReviewKind`) plutôt que se deviner. Un aller-retour qui relirait l'absence comme
 * autre chose transformerait un entretien en révision normale, en silence.
 *
 * ⚠️ **UNE seule montée pour les cinq colonnes du lot**, et c'est délibéré : chaque bump
 * est une occasion d'oublier le `snapshot()` de `leitner_backup.spec.ts`, et cet oubli
 * fait perdre des données sans qu'aucun test ne rougisse (c'est ce qui a laissé passer
 * CC-51).
 *
 * ⚠️ **Une quatrième fois en CC-251, d'où le `5`** : le fichier gagne un champ `courses`
 * entièrement nouveau, jamais lu par un build antérieur. Ce n'est pas le même critère
 * que les trois bumps précédents (un champ existant qui change de sens) — mais un champ
 * absent d'un fichier v < 5 doit se lire « aucun cours », jamais planter l'import : voir
 * `courses` sur `backupValidator`, `.optional()`.
 */
export const BACKUP_VERSION = 5

/**
 * Les versions qu'un import accepte, et la seule raison de la liste : **refuser v1/v2
 * rendrait illisibles toutes les sauvegardes déjà faites**. Un fichier v1/v2 se relit
 * sans ambiguïté — son contenu était visible de tous au moment de l'export (avant
 * CC-139), il le reste après import (`shared: true`, voir `resolveShared`). C'est
 * exactement le choix que fait le backfill de la migration sur le contenu déjà en base.
 */
export const READABLE_BACKUP_VERSIONS = [1, 2, 3, 4, 5]

/**
 * Une révision : sa note, son horodatage, et **la trace de ce qui l'a précédée**.
 *
 * Les champs optionnels sont **omis quand ils valent `null`**, comme le sont
 * `category`/`theme` d'une carte non classée : le fichier se relit et se retouche à
 * la main, et un objet à deux clés vaut mieux qu'un objet à sept dont cinq disent
 * « rien ». L'import relit l'absence **comme `null`**, jamais comme `0` ni `''` —
 * voir la nullabilité, plus bas.
 *
 * ⚠️ **`kind` est TOUJOURS présent, et c'est la raison du bump v4** : son absence dans un
 * fichier se relit `'normal'` (`resolveReviewKind`), donc un export qui l'omettrait
 * transformerait silencieusement un entretien en révision normale. Il est déclaré non
 * optionnel ici, et posé hors du bloc `omitNull` pour que ça se voie.
 *
 * ⚠️ **Le placer hors d'`omitNull` est documentaire, pas load-bearing — mesuré**, contre
 * ce que le ticket de CC-260 affirmait : `kind` n'étant jamais `null`, `omitNull` ne le
 * supprimerait pas, et l'y ranger laisse la suite **entièrement verte**. Ce qui tient
 * réellement la promesse est le `snapshot()` de `leitner_backup.spec.ts`, qui rougit dès
 * que la clé disparaît de l'export. Ne prends donc pas cette ligne pour une garde.
 *
 * ⚠️ **`boxBefore`/`boxAfter` sont omis quand ils valent `null`, et là c'est sans
 * ambiguïté** : `null` veut dire « révision antérieure à CC-260, boîte inconnue », ce qui
 * est exactement ce que l'absence signifie. Ils sont exportés parce que le module l'exige
 * (« une colonne ajoutée à `leitner_reviews` s'ajoute au `snapshot()` dans le même lot, ou
 * elle n'est pas sauvegardée ») : sans eux, chaque aller-retour les perdrait en silence.
 */
export interface BackupReview {
  grade: Grade
  reviewedAt: string
  kind: ReviewKind
  answer?: string
  verdict?: Verdict
  latencyMs?: number
  thinkingMs?: number
  totalMs?: number
  boxBefore?: number
  boxAfter?: number
}

/**
 * ⚠️ **`box`, `nextReview` et `reviews` sont la progression de CELUI QUI EXPORTE**
 * (v2, CC-119) — pas celle du paquet, qui n'en a plus. Le fichier est donc une
 * sauvegarde **personnelle du contenu communal** : la taxonomie et les cartes valent
 * pour tout le monde, la progression pour une seule personne. Exporter à deux produit
 * deux fichiers au même contenu et aux progressions différentes.
 *
 * ⚠️ **Depuis CC-139, « le contenu » n'est plus « tout le communal » mais « le visible
 * par l'exportateur »** — sa carte privée, plus tout ce qui est marqué partagé. `shared`
 * porte ce que dit `isShared` en base ; son absence à l'import (fichier v1/v2, ou v3
 * écrit à la main) se résout par `resolveShared`.
 */
export interface BackupCard {
  front: string
  back: string
  /** Absents quand la carte n'est pas classée. Le classement va toujours par paire. */
  category?: string
  theme?: string
  box: number
  /** Colonne `date` : jour calendaire, sans heure. */
  nextReview: string
  /**
   * Les **marques de maîtrise** de celui qui exporte (CC-260), aux côtés de `box` et
   * `nextReview` : elles décrivent la même progression personnelle. Omises quand elles
   * valent `null` — ici l'absence *est* `null` (« pas en boîte 5 », « pas maîtrisée »), il
   * n'y a rien à trancher, contrairement à `kind` sur une révision.
   */
  box5EnteredAt?: string
  masteredAt?: string
  createdAt: string
  updatedAt: string
  reviews: BackupReview[]
  shared: boolean
}

export interface BackupCategory {
  name: string
  themes: string[]
}

/**
 * Une section, exportée **telle quelle en base** — jamais re-dérivée du markdown à
 * l'export ni à l'import. C'est ce qui préserve l'historique des pierres tombales
 * (`obsoleteAt`) d'un cours à travers une restauration : re-découper le markdown au
 * chargement perdrait la trace de tout slug disparu depuis.
 */
export interface BackupCourseSection {
  slug: string
  headingPath: string[]
  body: string
  /** `undefined` = hors glossaire, même sens que sur le modèle. */
  aliases?: string[]
  obsoleteAt?: string
}

export interface BackupCourse {
  title: string
  markdown: string
  source: CourseSource
  shared: boolean
  createdAt: string
  updatedAt: string
  sections: BackupCourseSection[]
}

export interface Backup {
  version: number
  exportedAt: string
  categories: BackupCategory[]
  cards: BackupCard[]
  courses: BackupCourse[]
}

/*
| Le fichier importé, tel que le validateur le rend : tout est optionnel sauf le
| recto et le verso, pour qu'un fichier écrit à la main tienne en trois champs.
*/

export interface BackupCourseInput {
  title: string
  markdown: string
  source?: CourseSource
  shared?: boolean
  createdAt?: string
  updatedAt?: string
  sections?: {
    slug: string
    headingPath?: string[]
    body: string
    aliases?: string[]
    obsoleteAt?: string | null
  }[]
}

export interface BackupCardInput {
  front: string
  back: string
  category?: string | null
  theme?: string | null
  box?: number
  nextReview?: string
  box5EnteredAt?: string | null
  masteredAt?: string | null
  createdAt?: string
  updatedAt?: string
  shared?: boolean
  reviews?: {
    grade: Grade
    reviewedAt: string
    kind?: ReviewKind
    answer?: string | null
    verdict?: Verdict | null
    latencyMs?: number | null
    thinkingMs?: number | null
    totalMs?: number | null
    boxBefore?: number | null
    boxAfter?: number | null
  }[]
}

export interface BackupInput {
  version?: number
  categories?: { name: string; themes?: string[] }[]
  cards: BackupCardInput[]
  courses?: BackupCourseInput[]
}

export interface ImportReport {
  cardsCreated: number
  /** Cartes ignorées : leur recto existait déjà sous ce thème. */
  cardsSkipped: number
  categoriesCreated: number
  themesCreated: number
  reviewsCreated: number
  coursesCreated: number
  /** Cours ignorés : même empreinte déjà présente pour l'importateur. */
  coursesSkipped: number
}

/**
 * Fichier syntaxiquement valide mais incohérent (un thème sans sa catégorie).
 * Le message est affichable tel quel ; la transaction garantit qu'aucune ligne
 * n'a été écrite.
 */
export class BackupImportError extends Error {}

/*
| Clés d'unicité. `JSON.stringify` d'un tuple, plutôt qu'une concaténation : aucun
| séparateur à choisir, donc aucune collision entre (« DevOps », « Docker ») et
| (« DevOps Docker », « »), quel que soit le texte saisi.
*/

/** Un thème n'est unique que dans sa catégorie : « Docker » peut vivre sous DevOps *et* Cloud. */
function themeKey(category: string, theme: string): string {
  return JSON.stringify([category, theme])
}

/** Identité d'une carte pour la déduplication : son recto, *dans son thème*. */
function cardKey(front: string, themeId: number | null): string {
  return JSON.stringify([themeId, front])
}

/**
 * Retire les clés qui valent `null`, pour que le fichier ne porte que ce qui existe.
 * ⚠️ `0` et `''` sont **conservés** (`=== null`, jamais falsy) : une réponse vide et
 * une absence de réponse ne sont pas la même chose, et un `thinkingMs` de 0 est une
 * mesure — celle d'une frappe immédiate.
 */
function omitNull<T extends object>(fields: T): { [K in keyof T]?: Exclude<T[K], null> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null)) as {
    [K in keyof T]?: Exclude<T[K], null>
  }
}

/**
 * Ce que `isShared` doit valoir à l'import, quand le fichier ne le dit pas explicitement.
 *
 * ⚠️ **Deux règles, pas une, et elles divergent volontairement** (CC-139) :
 * - un fichier **v1/v2** (ou dont le contenu date d'avant CC-139) décrivait un monde où
 *   tout le contenu était visible de tous — le réimporter en `false` ferait disparaître
 *   ce contenu de la vue de tout le monde sauf l'importateur, la même régression que le
 *   backfill de la migration existe pour éviter. Il redevient donc partagé.
 * - un fichier **v3 écrit à la main** sans `shared` obéit au défaut du contenu neuf :
 *   privé. Même doctrine que `box`/`nextReview` absents = une carte neuve.
 */
export function resolveShared(
  fileVersion: number | undefined,
  cardShared: boolean | undefined
): boolean {
  const effectiveVersion = fileVersion ?? BACKUP_VERSION
  if (effectiveVersion < 3) return true
  return cardShared ?? false
}

/**
 * Ce que `kind` doit valoir à l'import, quand le fichier ne le dit pas (CC-260). Même
 * patron que `resolveShared` ci-dessus, et pour une raison plus simple encore :
 *
 * ⚠️ **Un fichier v < 4 ne peut porter que des révisions normales, et ce n'est pas une
 * approximation** — c'est vrai par construction, exactement comme le backfill de la
 * migration. Une révision d'entretien ne peut exister qu'après que la maîtrise existe, or
 * elle n'existait pas avant ce lot.
 *
 * Un fichier v4 **écrit à la main** sans `kind` obéit au défaut de la colonne : `'normal'`.
 * C'est la seule valeur qu'on puisse poser sans inventer un entretien qui n'a pas eu lieu.
 */
export function resolveReviewKind(
  fileVersion: number | undefined,
  reviewKind: ReviewKind | undefined
): ReviewKind {
  const effectiveVersion = fileVersion ?? BACKUP_VERSION
  if (effectiveVersion < 4) return 'normal'
  return reviewKind ?? 'normal'
}

/**
 * Export / import du contenu du module, en JSON.
 *
 * Le fichier est **autoportant** : la taxonomie y est désignée par son nom, jamais
 * par un id. Réinjecter les ids casserait les séquences Postgres
 * (`leitner_cards_id_seq` ne suit pas un insert à id explicite) et le prochain ajout
 * depuis l'UI planterait sur un doublon de clé primaire.
 *
 * Les intervalles des boîtes (`leitner_settings`) ne sont **pas** du contenu : ils ne
 * font pas partie du fichier. Les échéances, elles, sont exportées telles quelles
 * (`next_review`), donc une restauration ne dépend pas du réglage en vigueur.
 *
 * ⚠️ **Le fichier est personnel depuis CC-119** : contenu communal, progression et
 * historique de celui qui exporte. Voir `BackupCard` et `BACKUP_VERSION`.
 */
export default class LeitnerBackupService {
  /**
   * Instantané : taxonomie **visible**, cartes **visibles**, et **la progression de
   * `userId`** (boîte, échéance, historique). Les cartes qu'il n'a jamais notées sortent
   * avec les défauts d'une carte neuve — boîte 1, due aujourd'hui — qui est exactement ce
   * que l'absence de ligne veut dire, et ce qu'un import relira.
   *
   * ⚠️ **Le filtre de visibilité n'est pas cosmétique, c'est une correction de
   * confidentialité (CC-139).** Sans lui, exporter son propre historique embarquerait
   * dans le fichier de l'exportateur le contenu privé de tous les autres comptes — la
   * fuite la plus large que ce lot corrige.
   */
  async export(userId: number, isAdmin: boolean = false): Promise<Backup> {
    const categoriesQuery = LeitnerCategory.query()
      .preload('themes', (themes) => {
        applyVisibility(themes, 'leitner_themes', userId, isAdmin)
        themes.orderBy('name')
      })
      .orderBy('name')
    applyVisibility(categoriesQuery, 'leitner_categories', userId, isAdmin)
    const categories = await categoriesQuery

    // ⚠️ Un `preload` filtré, pas la jointure de `leitner_progress.ts` : ici on veut la
    // **ligne** (boîte *et* échéance, typées par Lucid), pas un prédicat de file. Le
    // `hasMany` ne peut rendre qu'une ligne, la contrainte d'unicité s'en charge.
    const cardsQuery = LeitnerCard.query()
      .preload('theme', (theme) => theme.preload('category'))
      .preload('reviews', (reviews) =>
        reviews.where('user_id', userId).orderBy('reviewed_at', 'asc').orderBy('id', 'asc')
      )
      .preload('progress', (progress) => progress.where('user_id', userId))
      .orderBy('id', 'asc')
    applyVisibility(cardsQuery, 'leitner_cards', userId, isAdmin)
    const cards = await cardsQuery

    // Sections exportées telles quelles, tombes comprises (voir `BackupCourseSection`).
    const coursesQuery = LeitnerCourse.query()
      .preload('sections', (sections) => sections.orderBy('id', 'asc'))
      .orderBy('id', 'asc')
    applyVisibility(coursesQuery, 'leitner_courses', userId, isAdmin)
    const courses = await coursesQuery

    return {
      version: BACKUP_VERSION,
      exportedAt: DateTime.now().toISO()!,
      categories: categories.map((category) => ({
        name: category.name,
        themes: category.themes.map((theme) => theme.name),
      })),
      courses: courses.map((course) => ({
        title: course.title,
        markdown: course.markdown,
        source: course.source,
        shared: course.isShared,
        createdAt: course.createdAt.toISO()!,
        updatedAt: course.updatedAt.toISO()!,
        sections: course.sections.map((section) => ({
          slug: section.slug,
          headingPath: section.headingPath,
          body: section.body,
          ...omitNull({ aliases: section.aliases }),
          ...omitNull({ obsoleteAt: section.obsoleteAt?.toISO() ?? null }),
        })),
      })),
      cards: cards.map((card) => ({
        front: card.front,
        back: card.back,
        // Une carte non classée n'a ni l'un ni l'autre : on omet les deux clés
        // plutôt que d'écrire `null`, pour que le fichier reste lisible à la main.
        ...(card.theme ? { category: card.theme.category.name, theme: card.theme.name } : {}),
        // Aucune ligne de progression = « boîte 1, due aujourd'hui » : le fichier écrit
        // ce que la règle dit, plutôt qu'une absence que l'import devrait réinterpréter.
        box: card.progress[0]?.box ?? DEFAULT_BOX,
        nextReview: (card.progress[0]?.nextReview ?? DateTime.now()).toISODate()!,
        // Les marques de maîtrise (CC-260). Une carte sans ligne de progression n'en a
        // aucune — c'est ce que « boîte 1, due aujourd'hui » veut dire.
        ...omitNull({
          box5EnteredAt: card.progress[0]?.box5EnteredAt?.toISO() ?? null,
          masteredAt: card.progress[0]?.masteredAt?.toISO() ?? null,
        }),
        createdAt: card.createdAt.toISO()!,
        updatedAt: card.updatedAt.toISO()!,
        shared: card.isShared,
        reviews: card.reviews.map((review) => ({
          grade: review.grade,
          reviewedAt: review.reviewedAt.toISO()!,
          // ⚠️ **Toujours écrit** : une absence se relit `'normal'` (`resolveReviewKind`),
          // donc l'omettre transformerait un entretien en révision normale, en silence.
          // La position hors du bloc `omitNull` ci-dessous ne fait que le rendre visible —
          // voir `BackupReview` : elle n'est pas une garde, c'est le `snapshot()` du spec
          // qui en est une.
          kind: review.kind,
          // Ce qui vaut `null` est omis, jamais écrit : « aucun juge n'a tranché » et
          // « mesure inexploitable » se relisent comme une absence, pas comme un zéro.
          // `boxBefore`/`boxAfter` s'y rangent sans ambiguïté : leur `null` **est**
          // « révision antérieure à CC-260, boîte inconnue ».
          ...omitNull({
            answer: review.answer,
            verdict: review.verdict,
            latencyMs: review.latencyMs,
            thinkingMs: review.thinkingMs,
            totalMs: review.totalMs,
            boxBefore: review.boxBefore,
            boxAfter: review.boxAfter,
          }),
        })),
      })),
    }
  }

  /**
   * Charge un fichier validé. L'import **n'ajoute que ce qui manque** et ne
   * supprime jamais rien : une carte dont le recto existe déjà sous le même thème
   * est ignorée. Il n'y a pas d'autre mode — restaurer, c'est importer dans une
   * base vide (nouvelle machine, base perdue), et une fusion la recharge à l'identique.
   *
   * ⚠️ **Une carte ignorée l'est entièrement : ses révisions ne sont pas retouchées**,
   * donc ses colonnes de trace vides ne sont **jamais rétro-remplies** depuis le
   * fichier. La boucle des révisions vit après le `continue` de déduplication, et
   * c'est voulu : apparier deux révisions demanderait une clé qu'on n'a pas
   * (`reviewedAt` n'est pas unique), et un mauvais appariement écrirait des mesures
   * sur la mauvaise carte — donc une référence de fluence fausse, en silence. Le
   * scénario réel — restaurer dans une base vide — n'est de toute façon pas concerné.
   *
   * **Tout ou rien** : une seule transaction, donc un fichier qui casse à la 300ᵉ
   * carte ne laisse pas 299 cartes derrière lui. Le cas le plus probable est la
   * violation d'unicité de la taxonomie (`leitner_categories.name`, et
   * (catégorie, nom) sur `leitner_themes`).
   *
   * ⚠️ **Propriétaire et partage, depuis CC-139** : les cartes créées appartiennent à
   * `userId` — importer le fichier d'un collègue ajoute donc ses cartes **et se les
   * attribue**, avec pour visibilité `resolveShared(backup.version, card.shared)`. Un
   * fichier v1/v2 redevient partagé (c'était sa portée d'origine, avant que « partagé »
   * n'existe) ; un fichier v3 suit son champ `shared`, `false` s'il est absent (le défaut
   * du contenu neuf). La taxonomie créée au passage suit la même règle, faute d'un champ
   * dédié par catégorie/thème dans le fichier.
   *
   * ⚠️ **Progression et historique atterrissent sur `userId`, jamais ailleurs**
   * (CC-119) : la propriété du contenu ne change rien à ça. Importer le fichier d'un
   * collègue ajoute donc ses cartes et s'attribue sa progression — c'est le comportement
   * voulu (le fichier est une sauvegarde personnelle), mais ce n'est évidemment pas un
   * moyen de « rendre ses cartes » à quelqu'un.
   *
   * ⚠️ **Une carte ignorée ne reçoit AUCUNE progression** — même raison que ses
   * révisions : la ligne est écrite après le `continue` de déduplication. Une carte déjà
   * en base garde donc la progression de l'importateur, jamais celle du fichier. C'est ce
   * qui empêche un ré-import d'écraser un planning en cours.
   */
  async import(
    userId: number,
    backup: BackupInput,
    isAdmin: boolean = false
  ): Promise<ImportReport> {
    const report: ImportReport = {
      cardsCreated: 0,
      cardsSkipped: 0,
      categoriesCreated: 0,
      themesCreated: 0,
      reviewsCreated: 0,
      coursesCreated: 0,
      coursesSkipped: 0,
    }

    // Une seule fois : la taxonomie créée en chemin suit la même règle que les cartes,
    // faute d'un champ `shared` par catégorie/thème dans le fichier.
    const defaultShared = resolveShared(backup.version, undefined)

    return db.transaction(async (trx) => {
      const taxonomy = await this.loadTaxonomy(trx, report, userId, isAdmin, defaultShared)

      // La taxonomie déclarée en tête de fichier est créée même si aucune carte ne
      // l'utilise : une catégorie vide est un classement légitime, pas un résidu.
      for (const category of backup.categories ?? []) {
        await taxonomy.ensureCategory(category.name)
        for (const theme of category.themes ?? []) {
          await taxonomy.ensureTheme(category.name, theme)
        }
      }

      // Ce qui est déjà là ne sera pas ré-ajouté. ⚠️ Global, pas filtré par visibilité :
      // l'identité d'une carte (recto, thème) reste celle du catalogue tout entier — un
      // import qui retomberait sur le recto d'une carte privée d'un autre compte n'y
      // touche pas et n'en gagne pas l'accès, il obtient simplement zéro carte créée.
      const seen = new Set<string>()
      for (const card of await LeitnerCard.query({ client: trx })) {
        seen.add(cardKey(card.front, card.leitnerThemeId))
      }

      for (const card of backup.cards) {
        const themeId = await this.resolveTheme(card, taxonomy)

        const key = cardKey(card.front, themeId)
        // Le doublon peut venir de la base comme du fichier lui-même : rejouer deux
        // fois le même fichier ne duplique rien. Revers assumé : deux cartes au même
        // recto sous le même thème n'en font qu'une après un aller-retour.
        if (seen.has(key)) {
          report.cardsSkipped++
          continue
        }
        seen.add(key)

        const created = await LeitnerCard.create(
          {
            front: card.front,
            back: card.back,
            leitnerThemeId: themeId,
            ownerId: userId,
            isShared: resolveShared(backup.version, card.shared),
            // Lucid ne pose `created_at` / `updated_at` que s'ils sont absents : les
            // horodatages du fichier sont donc conservés tels quels. ⚠️ Depuis CC-119 ils
            // ne portent plus l'ordre de la file — c'est l'`updated_at` de la progression
            // qui le fait — mais ils restent le repli des cartes jamais notées, donc
            // toujours l'ordre de départ d'un paquet neuf.
            ...(card.createdAt ? { createdAt: DateTime.fromISO(card.createdAt) } : {}),
            ...(card.updatedAt ? { updatedAt: DateTime.fromISO(card.updatedAt) } : {}),
          },
          { client: trx }
        )
        report.cardsCreated++

        // ⚠️ **La ligne n'est écrite que si le fichier dit autre chose que le défaut.**
        // Boîte 1 due aujourd'hui *est* l'absence de progression : la matérialiser pour
        // chaque carte d'un fichier de saisie en masse (où ni `box` ni `nextReview` ne
        // sont renseignés) remplirait la table de lignes qui ne disent rien, et ferait
        // diverger deux représentations du même état.
        // ⚠️ **La condition n'inclut PAS les marques de maîtrise** (CC-260), et c'est un
        // choix : un fichier écrit à la main qui déclarerait `masteredAt` sans `box`
        // fabriquerait une carte « maîtrisée en boîte 1 », un état que rien ne produit.
        // Un vrai export d'une carte maîtrisée porte toujours `box: 5`, donc la ligne est
        // créée de toute façon et les marques suivent.
        if (card.box !== undefined || card.nextReview !== undefined) {
          await LeitnerCardProgress.create(
            {
              userId,
              leitnerCardId: created.id,
              box: card.box ?? DEFAULT_BOX,
              nextReview: card.nextReview ? DateTime.fromISO(card.nextReview) : DateTime.now(),
              // `?? null` explicite, même doctrine que les traces d'une révision : une
              // absence est un `null`, jamais un `undefined` laissé à knex.
              box5EnteredAt: card.box5EnteredAt ? DateTime.fromISO(card.box5EnteredAt) : null,
              masteredAt: card.masteredAt ? DateTime.fromISO(card.masteredAt) : null,
            },
            { client: trx }
          )
        }

        for (const review of card.reviews ?? []) {
          await LeitnerReview.create(
            {
              userId,
              leitnerCardId: created.id,
              grade: review.grade,
              reviewedAt: DateTime.fromISO(review.reviewedAt),
              // ⚠️ Jamais `review.kind ?? 'normal'` en direct : c'est la **version du
              // fichier** qui tranche, comme pour `shared`. Un fichier v < 4 ne peut porter
              // que des révisions normales — vrai par construction, pas par défaut.
              kind: resolveReviewKind(backup.version, review.kind),
              // ⚠️ `?? null` explicite, jamais `undefined` : la nullabilité est du sens
              // et doit survivre à l'aller-retour. `verdict: null` veut dire « aucun juge
              // n'a tranché », jamais « jugé faux » ; `thinkingMs: null` veut dire « mesure
              // inexploitable », jamais « instantané » — un `0` restauré tirerait la médiane
              // de la carte vers le bas durablement et lui vaudrait `easy`. Passer
              // `undefined` à Lucid laisserait knex décider du binding : on tranche ici.
              answer: review.answer ?? null,
              verdict: review.verdict ?? null,
              latencyMs: review.latencyMs ?? null,
              thinkingMs: review.thinkingMs ?? null,
              totalMs: review.totalMs ?? null,
              // `null` = « révision antérieure à CC-260, boîte inconnue » : c'est aussi ce
              // que l'absence veut dire dans le fichier, aucune ambiguïté à trancher.
              boxBefore: review.boxBefore ?? null,
              boxAfter: review.boxAfter ?? null,
            },
            { client: trx }
          )
          report.reviewsCreated++
        }
      }

      // Le corpus de cours (CC-251, v5). Même doctrine de dédup qu'une carte : une
      // empreinte déjà présente pour `userId` est **entièrement** ignorée — sections
      // comprises, jamais rétro-remplies depuis le fichier.
      //
      // ⚠️ **Le TITRE est dédoublonné au même titre que l'empreinte, et ce n'est pas
      // décoratif** : `leitner_courses` porte AUSSI `unique(owner_id, title)`. Sans ce
      // second filtre, un cours de même titre mais de contenu différent (le cas
      // normal d'un vieux fichier réimporté après édition) ferait lever une violation
      // d'unicité non catchée, qui annulerait tout l'import — cartes et taxonomie
      // comprises, faute d'être une `BackupImportError`. Ignorer silencieusement suit
      // la même doctrine que le reste de l'import : « n'ajoute que ce qui manque »,
      // jamais de remplacement.
      const seenCourseHashes = new Set<string>()
      const seenCourseTitles = new Set<string>()
      for (const course of await LeitnerCourse.query({ client: trx }).where('owner_id', userId)) {
        seenCourseHashes.add(course.contentHash)
        seenCourseTitles.add(course.title)
      }

      for (const course of backup.courses ?? []) {
        const contentHash = hashCourseMarkdown(course.markdown)
        if (seenCourseHashes.has(contentHash) || seenCourseTitles.has(course.title)) {
          report.coursesSkipped++
          continue
        }
        seenCourseHashes.add(contentHash)
        seenCourseTitles.add(course.title)

        const createdCourse = await LeitnerCourse.create(
          {
            title: course.title,
            markdown: course.markdown,
            contentHash,
            source: course.source ?? 'paste',
            ownerId: userId,
            isShared: resolveShared(backup.version, course.shared),
            ...(course.createdAt ? { createdAt: DateTime.fromISO(course.createdAt) } : {}),
            ...(course.updatedAt ? { updatedAt: DateTime.fromISO(course.updatedAt) } : {}),
          },
          { client: trx }
        )
        report.coursesCreated++

        // Sections réinsérées TELLES QUELLES — tombes comprises — jamais re-découpées
        // du markdown : c'est ce qui préserve l'historique des slugs disparus.
        for (const section of course.sections ?? []) {
          await LeitnerCourseSection.create(
            {
              courseId: createdCourse.id,
              slug: section.slug,
              headingPath: section.headingPath ?? [],
              body: section.body,
              aliases: section.aliases ?? null,
              obsoleteAt: section.obsoleteAt ? DateTime.fromISO(section.obsoleteAt) : null,
            },
            { client: trx }
          )
        }
      }

      return report
    })
  }

  /**
   * Taxonomie **visible de `userId`**, indexée par nom, avec de quoi la compléter à la
   * volée. Une catégorie « DevOps » déjà visible (à moi, ou partagée) est **réutilisée**,
   * jamais dupliquée.
   *
   * ⚠️ **La réutilisation ne porte que sur le visible** (CC-139), même doctrine que
   * `LeitnerCatalogService.ensureTheme` : une catégorie/thème « DevOps » privé chez un
   * autre compte n'est jamais réutilisé — l'import en crée un second, privé, appartenant
   * à `userId`. C'est aussi ce qui rend `unique(owner_id, name)` cohérent avec ce
   * chargement : sans ce filtre, deux propriétaires distincts homonymes se
   * marcheraient dessus dans la `Map` indexée par nom seul.
   */
  private async loadTaxonomy(
    trx: TransactionClientContract,
    report: ImportReport,
    userId: number,
    isAdmin: boolean,
    isShared: boolean
  ) {
    const categories = new Map<string, LeitnerCategory>()
    const themes = new Map<string, LeitnerTheme>()

    const existingQuery = LeitnerCategory.query({ client: trx }).preload('themes', (t) =>
      applyVisibility(t, 'leitner_themes', userId, isAdmin)
    )
    applyVisibility(existingQuery, 'leitner_categories', userId, isAdmin)
    const existing = await existingQuery
    for (const category of existing) {
      categories.set(category.name, category)
      for (const theme of category.themes) {
        themes.set(themeKey(category.name, theme.name), theme)
      }
    }

    const ensureCategory = async (name: string): Promise<LeitnerCategory> => {
      const found = categories.get(name)
      if (found) return found

      const created = await LeitnerCategory.create(
        { name, ownerId: userId, isShared },
        { client: trx }
      )
      categories.set(name, created)
      report.categoriesCreated++
      return created
    }

    const ensureTheme = async (categoryName: string, themeName: string): Promise<LeitnerTheme> => {
      const key = themeKey(categoryName, themeName)
      const found = themes.get(key)
      if (found) return found

      const category = await ensureCategory(categoryName)
      const created = await LeitnerTheme.create(
        { leitnerCategoryId: category.id, name: themeName, ownerId: userId, isShared },
        { client: trx }
      )
      themes.set(key, created)
      report.themesCreated++
      return created
    }

    return { ensureCategory, ensureTheme }
  }

  /** `null` = carte non classée. Les deux champs vont ensemble, ou pas du tout. */
  private async resolveTheme(
    card: BackupCardInput,
    taxonomy: { ensureTheme: (category: string, theme: string) => Promise<LeitnerTheme> }
  ): Promise<number | null> {
    const category = card.category ?? null
    const theme = card.theme ?? null

    if (!category && !theme) return null
    if (!category || !theme) {
      throw new BackupImportError(
        `Carte « ${card.front.slice(0, 40)} » : « category » et « theme » vont ensemble — ` +
          `un thème appartient toujours à une catégorie.`
      )
    }

    const resolved = await taxonomy.ensureTheme(category, theme)
    return resolved.id
  }
}
