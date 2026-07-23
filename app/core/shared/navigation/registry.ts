/**
 * Le registre des destinations de l'application — les écrans qu'on peut *ouvrir*.
 *
 * ⚠️ **Le noyau ne connaît le nom d'aucune destination**, exactement comme il ne connaît le
 * nom d'aucune capacité (`#core/auth/capabilities/registry`). Chaque module déclare les
 * siennes dans son `destinations.ts` ; `start/navigation.ts` se contente de les enregistrer
 * au démarrage. Une liste centrale énumérant `/revision` et `leitner.view` ferait de `core/`
 * un endroit qu'on modifie à chaque évolution d'un module.
 *
 * À quoi il sert, concrètement — deux usages, une seule source :
 *
 * 1. **l'atterrissage** : après connexion, après acceptation d'invitation, et quand un compte
 *    déjà connecté rouvre `/login`, on redirige vers la première destination que le compte
 *    peut réellement ouvrir. Rediriger vers `/` en dur envoyait un non-admin sur un refus,
 *    donc sur un JSON d'erreur, comme tout premier écran (CC-81) ;
 * 2. **la barre latérale** : elle affiche ces mêmes destinations, filtrées de la même façon.
 *    Avant CC-81, `AppLayout.vue` tenait sa propre liste — deux endroits à mettre d'accord,
 *    et rien pour signaler qu'ils avaient divergé.
 *
 * ⚠️ **L'ordre d'enregistrement est l'ordre de la barre ET l'ordre de l'atterrissage.**
 * Réordonner `start/navigation.ts` change la page d'accueil des comptes non-admins. C'est le
 * même contrat que `config/database.ts` avec ses `migrations.paths` : l'ordre du tableau est
 * l'ordre d'exécution, et il se lit là où il est écrit.
 *
 * ⚠️ **La condition d'accès déclarée ici doit être celle de la route.** Une destination qui
 * citerait une capacité que sa route n'exige pas enverrait l'utilisateur droit sur le refus
 * qu'on cherche à lui épargner. `tests/functional/core/navigation_registry.spec.ts` croise
 * les deux : chaque destination contre le registre de capacités **et** contre la déclaration
 * d'accès réelle de sa route.
 */

/** Ce qui ouvre une destination : une capacité, ou le seul drapeau `is_admin`. */
export type DestinationAccess = { capability: string } | { admin: true }

export interface Destination {
  /**
   * La clé de l'entrée : `nav.<key>` côté i18n, et la clé d'icône côté `AppLayout`.
   * Une icône se déclare avec un composant Vue, qui n'a rien à faire dans un payload —
   * le serveur envoie la clé, le layout tient la table.
   */
  key: string
  /** Le chemin exact de la route qui ouvre cette destination. */
  href: string
  access: DestinationAccess
}

/** Ce qu'on sait de celui qui regarde, sans avoir à charger le modèle User ici. */
export interface NavigationViewer {
  isAdmin: boolean
  capabilities: Set<string>
}

class NavigationRegistry {
  readonly #destinations: Destination[] = []

  /**
   * Enregistre les destinations d'un module, **à la suite** de celles déjà enregistrées.
   *
   * Comme pour les capacités, le préfixe de la capacité citée doit être le nom du module :
   * c'est ce qui empêche `leitner/destinations.ts` de s'ouvrir au passage un écran de
   * `veille`. Les destinations réservées à `is_admin` (Services, Agents) ne citent aucune
   * capacité — c'est justement ce qui les rend inaccessibles à tout rôle.
   */
  register(module: string, destinations: readonly Destination[]): void {
    for (const destination of destinations) {
      if (!destination.href.startsWith('/')) {
        throw new Error(
          `Destination « ${destination.key} » invalide : « ${destination.href} » n'est pas un ` +
            `chemin absolu. Une destination désigne une route de cette application, pas une URL.`
        )
      }

      if (this.#destinations.some((known) => known.key === destination.key)) {
        throw new Error(
          `Destination « ${destination.key} » déjà enregistrée : deux entrées de même clé ` +
            `partageraient leur libellé et leur icône, et l'une masquerait l'autre.`
        )
      }

      if ('capability' in destination.access) {
        const { capability } = destination.access
        if (!capability.startsWith(`${module}.`)) {
          throw new Error(
            `Le module « ${module} » ne peut pas ouvrir « ${destination.href} » avec ` +
              `« ${capability} » : une destination cite une capacité de son propre module.`
          )
        }
      }

      this.#destinations.push(destination)
    }
  }

  /** Toutes les destinations déclarées, dans l'ordre d'enregistrement. */
  all(): Destination[] {
    return [...this.#destinations]
  }

  /**
   * Les destinations que ce compte peut réellement ouvrir, dans l'ordre.
   *
   * ⚠️ `isAdmin` **passe outre** la vérification, il ne porte pas la liste de tout : il
   * n'existe pas de capacité « tout », et en matérialiser une obligerait à la tenir à jour
   * à chaque ajout. C'est la même règle que `CapabilityService.allows`.
   */
  visibleFor(viewer: NavigationViewer): Destination[] {
    return this.#destinations.filter((destination) => {
      if (viewer.isAdmin) return true
      if ('admin' in destination.access) return false
      return viewer.capabilities.has(destination.access.capability)
    })
  }

  /**
   * Où envoyer ce compte quand aucune page n'a été demandée — `null` s'il ne peut rien ouvrir.
   *
   * Le `null` n'est pas un cas de bord : un compte fraîchement invité existe, il est actif, et
   * il n'a encore reçu aucun droit. Il mérite un écran qui le dit (`/aucun-acces`), pas un
   * refus qui laisserait croire à une panne.
   */
  landingFor(viewer: NavigationViewer): Destination | null {
    return this.visibleFor(viewer)[0] ?? null
  }

  /** Remet le registre à zéro. Réservé aux tests. */
  reset(): void {
    this.#destinations.length = 0
  }
}

export default new NavigationRegistry()
