import type { HttpContext } from '@adonisjs/core/http'
import { isModuleEnabled } from '#config/modules'
import capabilityService from '#core/auth/services/capability_service'
import { assertOwnedOrAdmin } from '#core/shared/services/visibility'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import { glossaryTermCreateValidator } from '#modules/corpus/validators/corpus'
import { promoteCardToGlossaryTerm } from './glossary_index.js'

export default class PromotionController {
  async store({ auth, params, request, response }: HttpContext) {
    if (!isModuleEnabled('leitner') || !isModuleEnabled('corpus')) return response.notFound()
    if (!(await capabilityService.allows(auth.user!, 'corpus.write'))) return response.forbidden()
    const card = await LeitnerCard.findOrFail(params.id)
    assertOwnedOrAdmin(card, auth.user!.id, auth.user!.isAdmin)
    const payload = await glossaryTermCreateValidator.validate({
      term: request.input('term', card.front),
      definition: request.input('definition', card.back),
    })
    const term = await promoteCardToGlossaryTerm(
      { front: payload.term, back: payload.definition },
      auth.user!.id
    )
    return response.json({ term: { id: term.id } })
  }
}
