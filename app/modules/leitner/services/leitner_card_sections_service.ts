import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCardSection, {
  type CardSectionOrigin,
} from '#modules/leitner/models/leitner_card_section'
import LeitnerCourseSection from '#modules/leitner/models/leitner_course_section'
import { assertOwnedOrAdmin, isVisible } from '#modules/leitner/services/leitner_visibility'

/**
 * Les liens carte ↔ section (CC-253) : posés à la promotion d'une ingestion (`ingestion`,
 * arithmétique, jamais déclarée par le modèle) ou à la main depuis `/revision/settings`
 * (`manuel`). Aucune règle de visibilité propre ici — `leitner_card_sections` n'a pas de
 * propriétaire, elle se dérive des deux tables qu'elle relie (voir la migration).
 */

/**
 * Pose les liens `ingestion` pour les slugs qu'un brouillon promu couvrait réellement.
 *
 * ⚠️ **Tombes comprises** — une section obsolète (remplacement du cours depuis) reste
 * une cible valide : le lien existe toujours, c'est ce qui permet au panneau de dire
 * « cette carte vient d'une section retirée depuis » plutôt que de perdre la trace.
 *
 * Un slug sans section correspondante (appariement dégradé de `chunkCourse`, cours
 * remplacé entre l'ingestion et la promotion) est silencieusement ignoré : c'est déjà
 * l'imprécision que le ticket accepte, pas une nouvelle.
 */
export async function linkIngestionSections(
  cardId: number,
  courseId: number,
  slugs: string[]
): Promise<void> {
  if (slugs.length === 0) return

  const sections = await LeitnerCourseSection.query()
    .where('course_id', courseId)
    .whereIn('slug', slugs)

  for (const section of sections) {
    await LeitnerCardSection.firstOrCreate(
      { leitnerCardId: cardId, leitnerCourseSectionId: section.id },
      { origin: 'ingestion' as CardSectionOrigin }
    )
  }
}

/**
 * Le sélecteur manuel de `/revision/settings` : au plus un lien `manuel` par carte,
 * remplacé à chaque appel — jamais ajouté à côté d'un ancien. Les liens `ingestion`
 * de la même carte ne sont jamais touchés : deux origines, deux gestes distincts.
 *
 * `courseSectionId: null` efface le lien manuel sans en reposer un.
 */
export async function setManualSection(
  card: LeitnerCard,
  courseSectionId: number | null,
  userId: number,
  isAdmin: boolean
): Promise<void> {
  assertOwnedOrAdmin(card, userId, isAdmin)

  await LeitnerCardSection.query()
    .where('leitner_card_id', card.id)
    .where('origin', 'manuel')
    .delete()

  if (courseSectionId === null) return

  // ⚠️ La section doit être VISIBLE de qui pose le lien — même garde que le catalogue
  // sur la taxonomie (`ensureTheme`) : lier une carte à une section qu'on ne peut même
  // pas parcourir soi-même en ferait fuiter l'existence par la bande.
  const section = await LeitnerCourseSection.query()
    .where('id', courseSectionId)
    .preload('course')
    .first()
  if (!section || !isVisible(section.course, userId, isAdmin)) return

  await LeitnerCardSection.create({
    leitnerCardId: card.id,
    leitnerCourseSectionId: section.id,
    origin: 'manuel',
  })
}

/** Une section de provenance, telle qu'exposée au panneau de révision ou à l'export. */
export interface ProvenanceSection {
  id: number
  courseId: number
  courseTitle: string
  slug: string
  headingPath: string[]
  body: string
  aliases: string[] | null
  obsoleteAt: string | null
  origin: CardSectionOrigin
}

/**
 * Les sections de provenance des cartes données, groupées par carte — pour le panneau
 * de révision (`LeitnerController#index`) et l'export (`LeitnerBackupService`).
 *
 * ⚠️ **Filtre par visibilité du COURS**, pas de la carte : une carte peut être visible
 * (promue par un admin sur l'ingestion privée d'un autre compte) tout en pointant vers
 * un cours resté privé à ce compte. Sans ce filtre, le panneau ou l'export d'un admin
 * révélerait le contenu d'un cours qu'il ne peut pas voir par ailleurs.
 */
export async function provenanceSectionsFor(
  cardIds: number[],
  userId: number,
  isAdmin: boolean
): Promise<Map<number, ProvenanceSection[]>> {
  const map = new Map<number, ProvenanceSection[]>()
  if (cardIds.length === 0) return map

  const links = await LeitnerCardSection.query()
    .whereIn('leitner_card_id', cardIds)
    .orderBy('id', 'asc')
    .preload('courseSection', (section) => section.preload('course'))

  for (const link of links) {
    const course = link.courseSection.course
    if (!isVisible(course, userId, isAdmin)) continue

    const list = map.get(link.leitnerCardId) ?? []
    list.push({
      id: link.courseSection.id,
      courseId: course.id,
      courseTitle: course.title,
      slug: link.courseSection.slug,
      headingPath: link.courseSection.headingPath,
      body: link.courseSection.body,
      aliases: link.courseSection.aliases,
      obsoleteAt: link.courseSection.obsoleteAt?.toISO() ?? null,
      origin: link.origin,
    })
    map.set(link.leitnerCardId, list)
  }

  return map
}
