import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { errors as vineErrors } from '@vinejs/vine'
import VeilleSource from '#modules/veille/models/veille_source'
import VeilleCollectorService from '#modules/veille/services/veille_collector_service'
import {
  resolveIntervalMinutes,
  sourceUpdateValidator,
  sourceValidator,
} from '#modules/veille/validators/veille'

@inject()
export default class VeilleSourcesController {
  constructor(private collector: VeilleCollectorService) {}

  async index({ inertia, session }: HttpContext) {
    const sources = await VeilleSource.query().orderBy('title', 'asc')

    return inertia.render('modules/veille/sources', {
      sources,
      // Retours de la dernière action, flashés avant la redirection : Inertia ne partage
      // automatiquement ni les erreurs de validateur ni les flashs, il faut les relire ici
      // et les renvoyer en props (même mécanique que `ingestErrors` côté Leitner).
      notification: session.flashMessages.get('notification') ?? null,
      sourceErrors: session.flashMessages.get('sourceErrors') ?? null,
    })
  }

  async store({ request, response, session }: HttpContext) {
    const fail = (errors: Record<string, string>) => {
      session.flash('sourceErrors', errors)
      return response.redirect().back()
    }

    let payload: Awaited<ReturnType<typeof sourceValidator.validate>>
    try {
      payload = await request.validateUsing(sourceValidator)
    } catch (error) {
      // Le refus de la garde SSRF est *le* message que l'utilisateur doit lire : laisser filer
      // l'exception le renverrait sur le formulaire sans un mot, et le refus passerait pour
      // un bug. On le relaie mot pour mot.
      if (error instanceof vineErrors.E_VALIDATION_ERROR) {
        const messages = error.messages as { field: string; message: string }[]
        return fail(Object.fromEntries(messages.map((item) => [item.field, item.message])))
      }
      throw error
    }

    // L'URL est unique en base. Le dire ici évite une 500 sur violation de contrainte, et rend
    // un message utile plutôt qu'une page d'erreur.
    const existing = await VeilleSource.findBy('url', payload.url)
    if (existing) {
      return fail({ url: 'Cette source est déjà suivie.' })
    }

    await VeilleSource.create({
      kind: 'rss',
      url: payload.url,
      title: payload.title,
      // Le défaut reste 1 heure, en dur. `resolveIntervalMinutes` rend `undefined` quand la
      // cadence n'a pas été soumise du tout.
      fetchIntervalMinutes: resolveIntervalMinutes(payload) ?? 60,
      active: true,
    })

    return response.redirect().back()
  }

  async update({ params, request, response, session }: HttpContext) {
    const source = await VeilleSource.findOrFail(params.id)

    let payload: Awaited<ReturnType<typeof sourceUpdateValidator.validate>>
    try {
      payload = await request.validateUsing(sourceUpdateValidator)
    } catch (error) {
      // Sans ce bloc, une cadence refusée sur ce chemin serait **invisible** : la page ne lit que
      // `sourceErrors`, et l'utilisateur verrait un rechargement sans changement ni message.
      // Le `sourceId` sert à afficher l'erreur sur la bonne ligne — plusieurs sources se
      // modifient depuis le même écran.
      if (error instanceof vineErrors.E_VALIDATION_ERROR) {
        const messages = error.messages as { field: string; message: string }[]
        session.flash('sourceErrors', {
          sourceId: source.id,
          ...Object.fromEntries(messages.map((item) => [item.field, item.message])),
        })
        return response.redirect().back()
      }
      throw error
    }

    // ⚠️ Merge explicite, et pas `source.merge(payload)` : le payload porte désormais
    // `interval`/`intervalUnit`, qui ne sont **pas** des colonnes. `merge` les poserait en
    // propriétés parasites, non persistées — la cadence ne changerait jamais, sans erreur.
    // Les clés absentes ne sont pas touchées : on ne remet pas à `null` ce qui n'a pas été soumis.
    const minutes = resolveIntervalMinutes(payload)
    if (payload.title !== undefined) source.title = payload.title
    if (payload.active !== undefined) source.active = payload.active
    if (minutes !== undefined) source.fetchIntervalMinutes = minutes

    await source.save()

    return response.redirect().back()
  }

  /**
   * Rafraîchissement d'**une** source, **synchrone**.
   *
   * C'est le seul moyen de vérifier qu'une source qu'on vient d'ajouter fonctionne, sans
   * attendre la prochaine passe. On attend donc le résultat pour l'afficher tout de suite —
   * `collectSource` est borné par le timeout du fetcher (10 s), la requête ne peut pas traîner.
   */
  async refresh({ params, response, session }: HttpContext) {
    const source = await VeilleSource.findOrFail(params.id)
    const outcome = await this.collector.collectSource(source)

    if (!outcome.ok) {
      // Le message est déjà écrit dans `last_error` et affiché sur la source ; le flash évite
      // d'avoir à le chercher des yeux dans la liste juste après avoir cliqué.
      session.flash('notification', { type: 'error', message: outcome.error })
    } else if (outcome.found === 0) {
      // 200 + XML valide + zéro entrée n'est pas une erreur, et c'est précisément le piège :
      // sans ce message, la source paraît saine et on croit le sujet calme.
      session.flash('notification', {
        type: 'warning',
        message: 'Le flux a répondu, mais aucune entrée n’a été reconnue.',
      })
    } else {
      session.flash('notification', {
        type: 'success',
        message: `${outcome.found} entrée(s) lue(s), ${outcome.inserted} nouvelle(s).`,
      })
    }

    return response.redirect().back()
  }

  /**
   * Rafraîchissement de **toutes** les sources, **asynchrone**.
   *
   * Vingt sources à 10 s de timeout tiendraient la requête HTTP bien au-delà de ce qu'un
   * navigateur accepte d'attendre. La passe part donc en tâche de fond et les résultats
   * apparaissent au rechargement — `last_fetched_at` et `last_error` disent où on en est.
   */
  async refreshAll({ response, session }: HttpContext) {
    void this.collector.collectAll().catch((error) => {
      // Chaque échec de flux est déjà écrit en base par `collectSource`. Ici, c'est la passe
      // elle-même qui a lâché : personne n'attend cette promesse, donc sans ce log l'échec
      // n'existerait nulle part.
      logger.error({ err: error }, 'Veille : le rafraîchissement manuel global a échoué.')
    })

    session.flash('notification', {
      type: 'info',
      message: 'Rafraîchissement lancé. Recharge la page dans quelques instants.',
    })

    return response.redirect().back()
  }
}
