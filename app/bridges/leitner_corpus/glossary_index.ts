import GlossaryTerm from '#modules/corpus/models/glossary_term'
import { applyVisibility } from '#core/shared/services/visibility'

export interface GlossaryIndexTerm {
  term: string
  termId: number
}

/** Pont optionnel : Corpus possède les termes, Leitner ne reçoit que l’index visible. */
export async function glossaryIndex(
  userId: number,
  isAdmin: boolean
): Promise<GlossaryIndexTerm[]> {
  const query = GlossaryTerm.query().orderBy('id', 'asc')
  applyVisibility(query, 'glossary_terms', userId, isAdmin)
  const terms = await query
  return terms.flatMap((term) =>
    [term.term, ...term.aliases].map((value) => ({ term: value, termId: term.id }))
  )
}

/** Création depuis une carte, détenue par le pont : aucun contrôleur Leitner n’importe le modèle Corpus. */
export async function promoteCardToGlossaryTerm(
  card: { front: string; back: string },
  userId: number
): Promise<GlossaryTerm> {
  return GlossaryTerm.create({
    term: card.front.trim(),
    aliases: [],
    definition: card.back,
    ownerId: userId,
    isShared: false,
  })
}
