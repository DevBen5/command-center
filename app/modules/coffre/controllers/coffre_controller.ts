import type { HttpContext } from '@adonisjs/core/http'
import type { Session } from '@adonisjs/session'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'
import type User from '#core/auth/models/user'
import vault from '#modules/coffre/services/vault_service'
import { entryValidator } from '#modules/coffre/validators/coffre'

/**
 * Le contenu du coffre (CC-178) — **toutes ces routes sont derrière l'élévation**
 * (`vault_unlocked_middleware`), en plus de leur capacité.
 *
 * ⚠️ **La clé est relue à chaque action, jamais gardée entre deux requêtes.** Le middleware vient
 * de vérifier qu'elle existe ; la relire ici n'est pas une redondance gratuite mais la seule façon
 * de l'obtenir — elle vit en mémoire du process, indexée par le pointeur du cookie. Le `throw`
 * ci-dessous ne devrait donc jamais partir : il couvre l'expiration survenue entre le middleware
 * et le contrôleur, et surtout la route qu'on écrirait un jour en oubliant le middleware.
 */
export default class CoffreController {
  async index({ inertia, auth, session }: HttpContext) {
    const user = auth.user!
    const key = this.#key(user, session)

    return inertia.render('modules/coffre/index', {
      entries: await vault.entriesFor(user, key),
    })
  }

  /**
   * Le mot de passe d'UN identifiant, à la demande — **du JSON nu, jamais une réponse Inertia**
   * (CC-179).
   *
   * ⚠️ **Inertia est exclu, et ce n'est pas un choix de style.** Le client Inertia range les props
   * de page dans `history.state` : un secret passé par une prop, fût-elle rechargée partiellement,
   * serait **écrit sur le disque du navigateur** par l'historique de navigation, et y resterait
   * après la fermeture du coffre. Un `fetch` n'y touche pas.
   *
   * ⚠️ **`no-store`, pas `no-cache`.** `no-cache` autorise le stockage et impose seulement une
   * revalidation ; c'est bien l'écriture qu'on interdit ici.
   *
   * ⚠️ **En GET, donc sans corps — délibérément.** Un POST devrait porter un jeton CSRF, dont
   * l'unique copie côté client vit dans le module Leitner (un module n'importe pas chez un
   * voisin), et son corps repartirait dans la session à la moindre erreur de validation. Il n'y a
   * rien à protéger d'une écriture ici : la route ne modifie rien, et une lecture inter-origine
   * de sa réponse est impossible faute de CORS.
   *
   * ⚠️ **Rien n'est journalisé, et il ne faut rien journaliser** — ni le clair, ni un extrait, ni
   * une longueur. Un refus ne dit pas non plus *laquelle* des trois causes s'applique côté
   * `illisible` : c'est déjà un état anormal, l'écran doit le dire à son porteur, pas le détailler
   * dans une réponse.
   */
  async secret({ auth, params, response, session }: HttpContext) {
    const user = auth.user!
    const key = this.#key(user, session)

    response.header('cache-control', 'no-store')

    const verdict = await vault.secretFor(user, key, Number(params.id))

    if (verdict.status === 'introuvable') {
      return response.notFound({ error: 'Entrée introuvable.' })
    }

    if (verdict.status === 'illisible') {
      // Le même refus que la liste rend sur une entrée illisible : on signale, on ne fabrique pas
      // un contenu vide qui se lirait comme « ce compte n'a pas de mot de passe ».
      return response.unprocessableEntity({ error: 'Cette entrée ne se déchiffre pas.' })
    }

    return response.ok({ secret: verdict.secret })
  }

  async store({ auth, request, response, session }: HttpContext) {
    const user = auth.user!
    const key = this.#key(user, session)
    const entry = await request.validateUsing(entryValidator)

    await vault.addEntry(user, key, entry)

    return response.redirect('/coffre')
  }

  /**
   * ⚠️ **La suppression est définitive et sans corbeille**, contrairement à la veille (CC-63). Rien
   * ne peut ressusciter une entrée : il n'y a ni collecte qui la réinsérerait — donc aucune raison
   * de poser une pierre tombale — ni copie ailleurs. Le dialogue de confirmation vit dans la page.
   */
  async destroy({ auth, params, response, session }: HttpContext) {
    const user = auth.user!

    // La clé n'est pas nécessaire pour supprimer — mais l'exiger garde l'invariant simple :
    // aucune écriture du coffre ne se fait sans coffre ouvert, y compris celle qui n'a rien à
    // déchiffrer. Sans ça, la seule route destructive du module serait aussi la seule à ne pas
    // dépendre de la passphrase.
    this.#key(user, session)

    await vault.deleteEntry(user, Number(params.id))

    return response.redirect('/coffre')
  }

  #key(user: User, session: Session): Buffer {
    const key = vault.keyFor(user, session)
    if (key === null) {
      throw new ForbiddenException('Le coffre est verrouillé.')
    }

    return key
  }
}
