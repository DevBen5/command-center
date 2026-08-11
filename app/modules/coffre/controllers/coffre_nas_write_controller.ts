import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'
import vault from '#modules/coffre/services/vault_service'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import {
  deleteNasFile,
  moveNasFile,
  renameNasFile,
  uploadNasFile,
  type NasWriteResult,
} from '#modules/coffre/services/nas_write_service'
import nasWriteThrottle from '#modules/coffre/services/nas_write_throttle_service'
import {
  nasDeleteValidator,
  nasMoveValidator,
  nasRenameValidator,
  nasUploadValidator,
} from '#modules/coffre/validators/coffre'

/**
 * L'écriture sur le NAS depuis le coffre (CC-240) — envoyer, renommer, déplacer, supprimer.
 *
 * ⚠️ **Hérite du mur du coffre** (`middleware.coffreOuvert()`, groupe de routes) **et** de
 * `vault.keyFor()` en contrôleur, second mécanisme indépendant — même patron que
 * `CoffreNasBrowseController`. Capacité `coffre.write`, jamais `coffre.view` : consulter n'est
 * pas écrire.
 *
 * ⚠️ **La traduction `NasWriteResult` → HTTP suit la doctrine du module : uniforme sur tout ce qui
 * touche à la résolution de chemin (`not-found`), explicite sur ce que le client peut corriger
 * lui-même** (`bad-name`, `name-taken`, `cross-root` — son propre nom, sa propre décision de
 * déplacer entre deux racines, rien qui renseigne un attaquant sur l'arborescence du disque).
 */
@inject()
export default class CoffreNasWriteController {
  constructor(private roots: NasRootsService) {}

  #key(context: HttpContext) {
    const key = vault.keyFor(context.auth.user!, context.session)
    if (key === null) {
      throw new ForbiddenException('Le coffre est verrouillé.')
    }
    return key
  }

  async #throttled(context: HttpContext): Promise<boolean> {
    const wait = await nasWriteThrottle.secondsBeforeRetry(context.auth.user!.id)
    if (wait > 0) {
      context.response.header('cache-control', 'no-store')
      context.response.tooManyRequests({ error: 'Trop de requêtes. Réessayez dans un instant.' })
      return true
    }
    await nasWriteThrottle.recordRequest(context.auth.user!.id)
    return false
  }

  #respond(response: HttpContext['response'], result: NasWriteResult) {
    response.header('cache-control', 'no-store')

    switch (result.status) {
      case 'ok':
        return response.ok({ ok: true })
      case 'bad-name':
        return response.unprocessableEntity({ error: 'invalid-name' })
      case 'name-taken':
        return response.conflict({ error: 'name-taken' })
      case 'cross-root':
        return response.unprocessableEntity({ error: 'cross-root' })
      case 'not-found':
        return response.notFound({ error: 'not-found' })
    }
  }

  async upload(context: HttpContext) {
    this.#key(context)
    if (await this.#throttled(context)) return

    const payload = await context.request.validateUsing(nasUploadValidator)
    const tmpPath = payload.file.tmpPath
    if (tmpPath === undefined) {
      return this.#respond(context.response, { status: 'not-found' })
    }

    const result = await uploadNasFile(
      this.roots,
      payload.root,
      payload.path ?? '',
      payload.file.clientName,
      tmpPath
    )

    if (result.status !== 'ok') {
      logger.warn(
        { root: payload.root, status: result.status },
        "L'envoi d'un fichier NAS a échoué."
      )
    }

    return this.#respond(context.response, result)
  }

  async rename(context: HttpContext) {
    this.#key(context)
    if (await this.#throttled(context)) return

    const payload = await context.request.validateUsing(nasRenameValidator)
    const result = await renameNasFile(this.roots, payload.root, payload.path, payload.newName)

    return this.#respond(context.response, result)
  }

  async move(context: HttpContext) {
    this.#key(context)
    if (await this.#throttled(context)) return

    const payload = await context.request.validateUsing(nasMoveValidator)
    const result = await moveNasFile(
      this.roots,
      payload.root,
      payload.path,
      payload.targetRoot,
      payload.targetPath ?? ''
    )

    return this.#respond(context.response, result)
  }

  async destroy(context: HttpContext) {
    this.#key(context)
    if (await this.#throttled(context)) return

    const payload = await context.request.validateUsing(nasDeleteValidator)
    const result = await deleteNasFile(this.roots, payload.root, payload.path)

    return this.#respond(context.response, result)
  }
}
