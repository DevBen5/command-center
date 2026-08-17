import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerCourse from '#modules/leitner/models/leitner_course'
import LeitnerIngestion from '#modules/leitner/models/leitner_ingestion'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'

/**
 * Ce que la suppression d'un compte doit vérifier avant d'agir (CC-139) — consommé par
 * `AdminUsersController#destroy`, hors du module. Voir le `CLAUDE.md` du module pour le
 * raisonnement complet : FK `owner_id → users` en `SET NULL` (le contenu survit toujours),
 * complétée par ce garde applicatif qui refuse de supprimer un compte tant qu'il possède
 * du contenu **partagé** — jamais pour du contenu privé, qui devient simplement orphelin.
 *
 * ⚠️ **Aucune impasse** : le propriétaire (ou un admin, qui peut éditer n'importe quel
 * contenu) peut décocher « Partagé » avant de supprimer le compte. Ce garde n'a donc pas
 * besoin d'une fonctionnalité de transfert de propriété pour rester résoluble.
 */
export async function ownedSharedContentTable(userId: number): Promise<string | null> {
  const checks: Array<[string, () => Promise<boolean>]> = [
    [
      'leitner_cards',
      async () =>
        (await LeitnerCard.query().where('owner_id', userId).where('is_shared', true).first()) !==
        null,
    ],
    [
      'leitner_categories',
      async () =>
        (await LeitnerCategory.query()
          .where('owner_id', userId)
          .where('is_shared', true)
          .first()) !== null,
    ],
    [
      'leitner_themes',
      async () =>
        (await LeitnerTheme.query().where('owner_id', userId).where('is_shared', true).first()) !==
        null,
    ],
    [
      'leitner_ingestions',
      async () =>
        (await LeitnerIngestion.query()
          .where('owner_id', userId)
          .where('is_shared', true)
          .first()) !== null,
    ],
    [
      'leitner_courses',
      async () =>
        (await LeitnerCourse.query().where('owner_id', userId).where('is_shared', true).first()) !==
        null,
    ],
  ]

  for (const [table, check] of checks) {
    if (await check()) return table
  }
  return null
}
