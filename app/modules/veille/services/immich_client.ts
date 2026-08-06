import CoreImmichClient, { ImmichUnavailableError } from '#core/shared/services/immich_client'
import { parseAsset, type ImmichAsset } from '#modules/veille/services/immich_asset'

export { ImmichUnavailableError, type ImmichThumbnail } from '#core/shared/services/immich_client'

/**
 * Assets par page. Immich pagine `search/metadata` et rend `nextPage` : 250 tient dans une
 * réponse raisonnable tout en évitant une dizaine d'aller-retours sur un album fourni.
 */
const PAGE_SIZE = 250

/**
 * ⚠️ **Le plafond de pages est un garde-fou de boucle, pas une limite de volumétrie.** Si une
 * version d'Immich rendait un `nextPage` qui n'avance pas, la collecte tournerait indéfiniment
 * en tenant la boucle du planificateur. 40 pages = 10 000 assets, très au-delà d'un album de
 * veille — l'atteindre est un défaut, et c'est signalé comme tel.
 */
const MAX_PAGES = 40

/**
 * Le client Immich de la veille (CC-55) — étend le transport commun du core (CC-180) avec ce qui
 * n'a de sens que pour la collecte d'un **album** : pagination, marquage des disparus, corbeille.
 *
 * ⚠️ **`thumbnail()`, `serverVersion()` et le transport bas niveau vivent dans
 * `#core/shared/services/immich_client` — partagés avec le coffre**, qui n'a besoin que de la
 * vignette. Cette classe n'ajoute que ce qui a une opinion sur le domaine veille : le type
 * `ImmichAsset`, `parseAsset`, la corbeille (CC-63).
 */
export default class ImmichClient extends CoreImmichClient {
  /**
   * Tous les assets de l'album de veille.
   *
   * ⚠️ **Tout ou rien.** La moindre page en échec fait lever : l'appelant ne reçoit **jamais**
   * une liste partielle. C'est ce qui rend sûr le marquage des assets disparus, qui se calcule
   * par différence — une liste tronquée ferait marquer « plus dans l'album » des dizaines
   * d'assets parfaitement présents, sans qu'aucune erreur ne s'affiche.
   */
  async albumAssets(): Promise<ImmichAsset[]> {
    const assets: ImmichAsset[] = []
    let page: number | null = 1

    for (let visited = 0; page !== null; visited++) {
      if (visited >= MAX_PAGES) {
        throw new ImmichUnavailableError(
          `L'album Immich dépasse ${MAX_PAGES} pages de ${PAGE_SIZE} assets : la collecte ` +
            's’arrête là plutôt que de boucler.'
        )
      }

      const body = await this.postJson('/api/search/metadata', {
        albumIds: [this.config.albumId],
        page,
        size: PAGE_SIZE,
      })

      const payload = body.assets
      if (typeof payload !== 'object' || payload === null) {
        throw new ImmichUnavailableError(
          "La réponse d'Immich ne porte pas de bloc « assets » : l'API a probablement changé."
        )
      }

      const { items, nextPage } = payload as { items?: unknown; nextPage?: unknown }
      if (!Array.isArray(items)) {
        throw new ImmichUnavailableError(
          "La réponse d'Immich ne porte pas de liste « assets.items » : l'API a probablement changé."
        )
      }

      for (const raw of items) {
        // Un asset illisible (type audio, identifiant malformé) est sauté, jamais deviné.
        const asset = parseAsset(raw)
        if (asset) assets.push(asset)
      }

      // ⚠️ Immich rend `nextPage` en **chaîne** (`"2"`), pas en nombre. Un `typeof === 'number'`
      // arrêterait la pagination à la première page, en silence, et l'album paraîtrait tronqué.
      page = nextPage === null || nextPage === undefined ? null : Number(nextPage)
      if (page !== null && !Number.isInteger(page)) {
        throw new ImmichUnavailableError(
          `Immich annonce une page suivante illisible (« ${String(nextPage)} »).`
        )
      }
    }

    return assets
  }

  /**
   * Le nombre de jours pendant lesquels Immich conserve un asset mis à la corbeille.
   *
   * ⚠️ **C'est ce qui autorise la suppression, et rien d'autre** (CC-63). `DELETE /api/assets`
   * en `force: false` envoie à la corbeille — mais *seulement si la corbeille est activée*. Sur
   * une instance qui la désactive (`trashDays: 0`), le même appel **détruit immédiatement**, et
   * Command Center n'a aucune copie des octets à opposer : « Immich possède les octets » veut
   * aussi dire qu'on ne peut rien réparer.
   *
   * ⚠️ **Lu avant chaque suppression, jamais mis en cache au démarrage.** Une valeur relevée au
   * boot devient fausse si la corbeille est désactivée pendant que le serveur tourne — et cette
   * fausseté-là est irréversible.
   *
   * ⚠️ **`GET /api/server/config` est une route publique** (aucun `@Authenticated` côté Immich) :
   * elle ne demande aucune permission, et fonctionne donc même avec une clé réduite au strict
   * nécessaire. La clé part quand même dans l'en-tête — même hôte, aucune raison de faire une
   * exception au transport.
   */
  async trashDays(): Promise<number> {
    const config = await this.getJson('/api/server/config')
    const raw = config.trashDays

    /**
     * ⚠️ **Échec fermé.** Un champ absent, renommé par une version future, ou rendu en chaîne ne
     * doit **jamais** se lire « corbeille active » : ce serait la seule erreur du lot qui détruit
     * pour de bon. Refuser ne coûte qu'un message ; laisser passer est irréversible. La valeur
     * `-1` sort du domaine d'un compte de jours et fait donc refuser comme un `0`.
     */
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
  }

  /**
   * Met des assets à la corbeille d'Immich.
   *
   * ⚠️ **`force: false`, toujours, et il n'y a aucun chemin vers `true`** — pas de paramètre, pas
   * de réglage, pas de surcharge. `force: true` détruirait définitivement, sans que Command Center
   * ait de quoi réparer. Le seul filet est la corbeille d'Immich, et `trashDays()` vérifie qu'elle
   * existe avant qu'on arrive ici.
   *
   * ⚠️ **Immich rend 204 sans corps**, et c'est pour ça que cet appel ne passe pas par `readJson`.
   * Y passer ferait échouer l'assertion de `content-type` sur un appel **réussi** : les assets
   * partiraient à la corbeille, notre code lèverait, rien ne serait marqué en base — la
   * suppression paraîtrait échouer à chaque clic tout en ayant lieu à chaque fois.
   */
  async trashAssets(assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) return

    const response = await this.request('/api/assets', 'DELETE', {
      ids: assetIds,
      force: false,
    })

    // Rien à lire : on draine pour rendre la connexion au pool, quel que soit le statut.
    await this.drain(response)

    if (response.status === 401 || response.status === 403) {
      throw new ImmichUnavailableError(
        `Immich a refusé la clé d'API (${response.status}) pour la mise à la corbeille : ` +
          'vérifie que la clé porte la permission « asset.delete ».'
      )
    }

    if (!response.ok) {
      /**
       * ⚠️ **Le 400 sur un lot est ambigu, et le message doit dire quoi faire.** Immich rend 400
       * aussi bien pour un asset inconnu que pour une requête qu'il refuse — et on ne sait pas
       * s'il plafonne la taille d'un lot (non vérifiable sans l'instance). Sur un lot de
       * plusieurs assets, la seule action utile côté utilisateur est de réessayer plus petit :
       * si ça passe, c'était la taille ; si un asset précis échoue seul, c'est lui.
       *
       * Sans cette phrase, le message dit ce qui s'est passé mais pas quoi en faire — et un
       * message qu'on ne peut pas suivre revient à ne rien dire.
       */
      const piste =
        response.status === 400 && assetIds.length > 1
          ? ' Réessaie par plus petits lots : si ça passe, la taille du lot était en cause ; ' +
            'si un asset échoue seul, le problème vient de lui.'
          : ''

      throw new ImmichUnavailableError(
        `Immich a répondu ${response.status} à la mise à la corbeille de ${assetIds.length} ` +
          'asset(s). ⚠️ Un asset inconnu rend 400, pas 404. Rien n’a été marqué comme ' +
          `supprimé.${piste}`
      )
    }
  }
}
