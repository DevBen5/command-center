import { DateTime } from 'luxon'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCardProgress from '#modules/leitner/models/leitner_card_progress'

/**
 * Fabriques du module Leitner, depuis que la progression a quitté la carte (CC-119).
 *
 * ⚠️ **`makeCard` ne pose AUCUNE progression, et c'est le point de ce fichier.** Une
 * carte neuve n'a pas de ligne : l'absence *est* « boîte 1, due aujourd'hui », pour tout
 * le monde. Un helper qui en sèmerait une par commodité ferait passer au vert des tests
 * qui ne prouvent alors plus rien du cas réel — celui d'un compte qui découvre le paquet.
 *
 * Pour une carte dans un autre état, il faut donc dire **pour qui** : `setProgress`.
 */

export async function makeCard(
  front: string,
  options: { back?: string; themeId?: number | null } = {}
): Promise<LeitnerCard> {
  return LeitnerCard.create({
    front,
    back: options.back ?? 'Verso',
    leitnerThemeId: options.themeId ?? null,
  })
}

/**
 * Place une carte dans une boîte et une échéance **pour une personne**.
 *
 * `dueDaysAgo` compte en arrière depuis aujourd'hui : `0` = due aujourd'hui, `3` = en
 * retard de trois jours. Une valeur négative la met dans le futur, donc hors file.
 */
export async function setProgress(
  userId: number,
  cardId: number,
  options: { box?: number; dueDaysAgo?: number } = {}
): Promise<LeitnerCardProgress> {
  return LeitnerCardProgress.updateOrCreate(
    { userId, leitnerCardId: cardId },
    {
      box: options.box ?? 1,
      nextReview: DateTime.now().minus({ days: options.dueDaysAgo ?? 0 }),
    }
  )
}

/** La boîte d'une personne sur une carte — `1` quand elle ne l'a jamais notée. */
export async function boxOf(userId: number, cardId: number): Promise<number> {
  const progress = await LeitnerCardProgress.query()
    .where('user_id', userId)
    .where('leitner_card_id', cardId)
    .first()

  return progress?.box ?? 1
}

/** L'échéance d'une personne sur une carte, ou `null` si elle ne l'a jamais notée. */
export async function nextReviewOf(userId: number, cardId: number): Promise<DateTime | null> {
  const progress = await LeitnerCardProgress.query()
    .where('user_id', userId)
    .where('leitner_card_id', cardId)
    .first()

  return progress?.nextReview ?? null
}
