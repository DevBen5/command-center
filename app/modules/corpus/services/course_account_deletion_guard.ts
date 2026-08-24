import LeitnerCourse from '#modules/corpus/models/leitner_course'

/**
 * Ce que la suppression d'un compte doit vérifier avant d'agir, côté corpus (CC-275,
 * scission de `leitner_account_deletion_guard.ts` à l'extraction du module). Consommée
 * par `AdminUsersController#destroy`, hors module — même doctrine que côté Leitner : FK
 * `owner_id → users` en `SET NULL` (le contenu survit toujours), complétée par ce garde
 * applicatif qui refuse de supprimer un compte tant qu'il possède du contenu **partagé**.
 *
 * ⚠️ **Aucune impasse** : le propriétaire (ou un admin) peut décocher « Partagé » sur ses
 * cours avant de supprimer le compte.
 */
export async function ownedSharedCorpusContentTable(userId: number): Promise<string | null> {
  const shared = await LeitnerCourse.query()
    .where('owner_id', userId)
    .where('is_shared', true)
    .first()

  return shared !== null ? 'leitner_courses' : null
}
