import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type { Session } from '@adonisjs/session'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'
import type User from '#core/auth/models/user'
import coffreImmichConfig from '#config/coffre_immich'
import vault from '#modules/coffre/services/vault_service'
import CatalogLinkService, {
  type CatalogPresence,
} from '#modules/coffre/services/catalog_link_service'
import { entryValidator, entryUpdateValidator } from '#modules/coffre/validators/coffre'
import { groupEntriesByNature, sectionKeyFromSlug } from '#modules/coffre/shared/entry_sections'
import type { CoffreEntryView } from '#modules/coffre/services/vault_service'

const ABSENT_PRESENCE: CatalogPresence = { inCatalog: false, missingSince: null }

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
@inject()
export default class CoffreController {
  constructor(private links: CatalogLinkService) {}

  async index({ inertia, auth, session }: HttpContext) {
    const user = auth.user!
    const key = this.#key(user, session)

    const entries = await vault.entriesFor(user, key)
    const presence = await this.links.catalogPresenceFor(user, key)

    return inertia.render('modules/coffre/index', {
      entries: this.#withCatalogPresence(entries, presence),
      // ⚠️ Un booléen, jamais un secret : dit si le bouton « parcourir le dossier verrouillé »
      // (CC-205) a une chance de fonctionner, sans jamais dire pourquoi ni exposer un identifiant.
      immichFolderAvailable: coffreImmichConfig.enabled,
    })
  }

  /**
   * Une section de l'écran, en entier — `GET /coffre/:section` (CC-208). `:section` est un mot
   * français (`notes`, `liens`, `identifiants`, `photos`) ; la route ne laisse passer que ces
   * quatre valeurs (`.where()`, `start/routes.ts`), donc le `throw` ci-dessous ne devrait jamais
   * partir — il couvre une désynchronisation future entre ce regex et `SECTION_SLUGS`.
   *
   * ⚠️ **Le filtre passe par `groupEntriesByNature`, jamais par une requête SQL sur `type`** : la
   * section d'une entrée dépend de la présence de médias, pas seulement de sa colonne `type` (voir
   * le ticket). Réutiliser la même fonction pure que l'accueil est ce qui empêche les deux vues de
   * diverger sur ce qu'elles considèrent comme « une photo ».
   */
  async section({ inertia, auth, session, params }: HttpContext) {
    const user = auth.user!
    const key = this.#key(user, session)

    const sectionKey = sectionKeyFromSlug(params.section)
    if (sectionKey === null) {
      throw new Error(`Segment de section inconnu : ${params.section}`)
    }

    const sections = groupEntriesByNature(await vault.entriesFor(user, key))
    const entries = sections.find((section) => section.key === sectionKey)?.entries ?? []
    const presence = await this.links.catalogPresenceFor(user, key)

    return inertia.render('modules/coffre/section', {
      section: sectionKey,
      entries: this.#withCatalogPresence(entries, presence),
      immichFolderAvailable: coffreImmichConfig.enabled,
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

  /**
   * ⚠️ **`redirect().back()`, pas `/coffre` en dur** (CC-208) : ajouter depuis une page de
   * section (`/coffre/notes`) doit y ramener, pas renvoyer systématiquement à l'accueil. Reprend
   * l'accueil lui-même quand l'ajout part de là (referer = `/coffre`) — comportement inchangé
   * pour ce cas, qui était le seul avant ce lot.
   */
  async store({ auth, request, response, session }: HttpContext) {
    const user = auth.user!
    const key = this.#key(user, session)
    const entry = await request.validateUsing(entryValidator)

    await vault.addEntry(user, key, entry)

    return response.redirect().back()
  }

  /**
   * Remplace le titre, le contenu et — sur un identifiant, si fourni — le mot de passe (CC-186).
   * Une édition rechiffre : elle est donc derrière le même mur que `store`/`destroy`, pas une
   * exception.
   *
   * ⚠️ **`redirect().back()`, même raison que `store`** (CC-208) : éditer depuis une page de
   * section y reste.
   */
  async update({ auth, params, request, response, session }: HttpContext) {
    const user = auth.user!
    const key = this.#key(user, session)
    const patch = await request.validateUsing(entryUpdateValidator)

    await vault.updateEntry(user, key, Number(params.id), patch)

    return response.redirect().back()
  }

  /**
   * ⚠️ **La suppression est définitive et sans corbeille**, contrairement à la veille (CC-63). Rien
   * ne peut ressusciter une entrée : il n'y a ni collecte qui la réinsérerait — donc aucune raison
   * de poser une pierre tombale — ni copie ailleurs. Le dialogue de confirmation vit dans la page.
   *
   * ⚠️ **`redirect().back()`, même raison que `store`/`update`** (CC-208).
   */
  async destroy({ auth, params, response, session }: HttpContext) {
    const user = auth.user!

    // La clé n'est pas nécessaire pour supprimer — mais l'exiger garde l'invariant simple :
    // aucune écriture du coffre ne se fait sans coffre ouvert, y compris celle qui n'a rien à
    // déchiffrer. Sans ça, la seule route destructive du module serait aussi la seule à ne pas
    // dépendre de la passphrase.
    this.#key(user, session)

    await vault.deleteEntry(user, Number(params.id))

    return response.redirect().back()
  }

  /**
   * Entrée → catalogue (CC-227) : annote chaque chip média/fichier NAS déjà rendue par
   * `pages/section.vue` avec sa présence dans le catalogue — calculée à la volée par
   * `CatalogLinkService`, jamais écrite. Une pièce jointe absente de la map (catalogue jamais
   * synchronisé pour cet élément) retombe sur « absent », pas sur une valeur manquante.
   */
  #withCatalogPresence(
    entries: CoffreEntryView[],
    presence: { nasFiles: Map<number, CatalogPresence>; media: Map<number, CatalogPresence> }
  ) {
    return entries.map((entry) => ({
      ...entry,
      media: entry.media.map((item) => ({
        ...item,
        ...(presence.media.get(item.id) ?? ABSENT_PRESENCE),
      })),
      nasFiles: entry.nasFiles.map((file) => ({
        ...file,
        ...(presence.nasFiles.get(file.id) ?? ABSENT_PRESENCE),
      })),
    }))
  }

  #key(user: User, session: Session): Buffer {
    const key = vault.keyFor(user, session)
    if (key === null) {
      throw new ForbiddenException('Le coffre est verrouillé.')
    }

    return key
  }
}
