/**
 * Le registre des capacités connues de l'application.
 *
 * ⚠️ **Le noyau ne connaît le nom d'aucune capacité.** Chaque module déclare les siennes
 * dans son propre `capabilities.ts` ; `start/capabilities.ts` se contente de les enregistrer
 * au démarrage. Une liste centrale énumérant les actions de Leitner ferait de `core/` un
 * endroit qu'on modifie à chaque évolution d'un module — exactement ce que la règle des
 * tranches verticales interdit.
 *
 * À quoi sert ce registre, concrètement :
 *
 * 1. l'écran d'administration coche des capacités existantes, plutôt que d'accepter une
 *    chaîne libre — un rôle ne peut pas accorder une capacité qui n'existe pas ;
 * 2. le test d'énumération des routes vérifie que chaque capacité citée par une route est
 *    bien déclarée par un module. Sans lui, une faute de frappe dans `can('leitner.reviw')`
 *    fermerait la route pour toujours **sans rien signaler** : la capacité n'existant nulle
 *    part, personne ne pourrait l'accorder, et `is_admin` continuerait de passer — donc
 *    invisible pour celui qui teste.
 */

/** `module.action`, en minuscules. Deux segments au moins. */
const CAPABILITY_FORMAT = /^[a-z0-9]+(\.[a-z0-9]+)+$/

class CapabilityRegistry {
  readonly #byModule = new Map<string, Set<string>>()

  /**
   * Enregistre les capacités d'un module. Le préfixe de chaque capacité doit être le nom
   * du module : c'est ce qui empêche `leitner/capabilities.ts` de s'accorder au passage
   * une capacité de `services`.
   */
  register(module: string, capabilities: readonly string[]): void {
    const known = this.#byModule.get(module) ?? new Set<string>()

    for (const capability of capabilities) {
      // ⚠️ **Il n'existe pas de capacité `*`.** L'admin est un drapeau booléen sur
      // l'utilisateur, jamais une liste qui contiendrait tout — sinon cette liste devrait
      // être tenue à jour à chaque ajout, et c'est précisément l'oubli qu'on rend impossible.
      if (!CAPABILITY_FORMAT.test(capability)) {
        throw new Error(
          `Capacité « ${capability} » invalide : le format attendu est « module.action » en minuscules. ` +
            `Les jokers n'existent pas — l'accès total passe par is_admin, pas par une capacité.`
        )
      }

      if (!capability.startsWith(`${module}.`)) {
        throw new Error(
          `Le module « ${module} » ne peut pas déclarer « ${capability} » : ` +
            `une capacité appartient au module dont elle porte le préfixe.`
        )
      }

      known.add(capability)
    }

    this.#byModule.set(module, known)
  }

  /** Cette capacité a-t-elle été déclarée par un module ? */
  has(capability: string): boolean {
    for (const capabilities of this.#byModule.values()) {
      if (capabilities.has(capability)) return true
    }
    return false
  }

  /** Toutes les capacités déclarées, tous modules confondus. */
  all(): string[] {
    return [...this.#byModule.values()].flatMap((capabilities) => [...capabilities])
  }

  /** Les capacités groupées par module — l'écran d'administration s'en sert pour l'affichage. */
  byModule(): Array<{ module: string; capabilities: string[] }> {
    return [...this.#byModule.entries()].map(([module, capabilities]) => ({
      module,
      capabilities: [...capabilities],
    }))
  }

  /** Remet le registre à zéro. Réservé aux tests. */
  reset(): void {
    this.#byModule.clear()
  }
}

export default new CapabilityRegistry()
