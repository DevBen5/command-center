import app from '@adonisjs/core/services/app'
import { HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import type { StatusPageRange, StatusPageRenderer } from '@adonisjs/core/types/http'

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * ⚠️ **Actif partout, et plus seulement en production** — sinon la page 403 serait invisible
   * en développement, c'est-à-dire précisément là où on vérifie le parcours d'un collègue.
   * La contrepartie est traitée juste en dessous : les pages 404 et 5xx, elles, restent
   * réservées à la production.
   */
  protected renderStatusPages = true

  /**
   * ⚠️ **403 s'ajoute aux trois statuts qu'AdonisJS ignore déjà** (400, 422, 401), et c'est une
   * restauration, pas un choix nouveau : avant CC-81 les refus étaient des réponses écrites à
   * la main, donc jamais rapportées. Devenus des exceptions, ils journaliseraient un `warn` à
   * **chaque** clic sur un lien interdit — un refus est un cas normal du produit, pas un
   * incident, et ce bruit-là finit par masquer les vrais.
   *
   * Le seul refus qui mérite une trace en garde une, écrite explicitement : le garde-barrière
   * journalise en `error` la route qui n'a déclaré aucune condition d'accès, et la nomme.
   */
  protected ignoreStatuses = [400, 422, 401, 403]

  /**
   * Les pages d'erreur rendues.
   *
   * ⚠️ **Elles ne sont consultées que sur une exception.** Un `response.forbidden({ … })` écrit
   * sa réponse et ne passe jamais ici : c'est pourquoi les middlewares d'accès lèvent
   * `ForbiddenException` (voir ce fichier). Le jour où un refus redevient un `return`, cette
   * table cesse de le voir — sans que rien ne rougisse.
   *
   * ⚠️ **404 et 5xx restent conditionnées à la production**, parce qu'une page « une erreur est
   * survenue » masquerait en développement la trace verbeuse d'AdonisJS, qui est l'outil de
   * diagnostic. Le 403 est dans l'autre catégorie : ce n'est pas une anomalie à déboguer, c'est
   * un cas **normal** du produit, et il doit se présenter proprement dans les deux mondes.
   */
  protected statusPages: Record<StatusPageRange, StatusPageRenderer> = {
    '403': (_error, ctx) => this.renderForbidden(ctx),
    '404': (error, ctx) =>
      app.inProduction
        ? ctx.inertia.render('core/shared/errors/not_found', { error })
        : this.renderError(error, ctx),
    '500..599': (error, ctx) =>
      app.inProduction
        ? ctx.inertia.render('core/shared/errors/server_error', { error })
        : this.renderError(error, ctx),
  }

  /**
   * Un refus : une page lisible pour un navigateur, un corps JSON pour tout le reste.
   *
   * ⚠️ **L'ordre `['json', 'html']` est l'invariant, pas un détail de style.** `accepts` rend le
   * premier type de la liste quand rien ne départage — donc un client qui accepte tout sans
   * préférence (le cas d'un `fetch` nu) reçoit du JSON. Écrit `['html', 'json']`, les routes
   * JSON du module Leitner (judge, extraction, diagnostic LLM) recevraient une page HTML au
   * lieu d'un refus exploitable, et casseraient la page appelante au lieu de dire non —
   * exactement le contrat que `leitner_readonly.spec.ts` verrouille.
   *
   * ⚠️ **`x-inertia` compte comme une demande de page, en plus de la négociation.** Une visite
   * Inertia — un clic interne, par opposition à un signet — est une requête XHR : le client
   * y joint bien `Accept: text/html`, donc la négociation seule suffirait *aujourd'hui*. Mais
   * cette garantie est un détail d'implémentation du client, hors de notre contrôle : le jour
   * où il n'enverrait plus cet en-tête, tout refus sur un lien interne redeviendrait du JSON
   * brut dans une modale d'erreur, sans que rien ne le signale. L'en-tête `x-inertia`, lui, est
   * une déclaration explicite — et c'est ce qui rend le cas testable.
   *
   * Le message ne nomme jamais la capacité manquante : il dit qu'on n'a pas accès, pas comment
   * l'application est découpée.
   */
  protected renderForbidden(ctx: HttpContext) {
    const veutUnePage =
      ctx.request.header('x-inertia') !== undefined ||
      ctx.request.accepts(['json', 'html']) === 'html'

    if (!veutUnePage) {
      return ctx.response.forbidden({ error: 'Accès refusé.' })
    }

    return ctx.inertia.render('core/shared/errors/forbidden')
  }

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    return super.handle(error, ctx)
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
