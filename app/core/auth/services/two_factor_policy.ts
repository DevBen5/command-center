import env from '#start/env'

/**
 * La règle « un administrateur doit porter un second facteur » (CC-114).
 *
 * ⚠️ **Opt-in, et défaut à `false`.** Un `git pull` ne doit pas pouvoir enfermer dehors
 * l'unique administrateur d'une installation existante : c'est la panne sans retour de ce
 * lot — plus personne pour atteindre l'écran qui distribue les droits, réparation en SQL. La
 * règle s'allume quand son porteur a vérifié que l'enrôlement fonctionne **sur sa machine,
 * dans son navigateur, avec son téléphone**.
 *
 * ⚠️ Elle ne concerne que `is_admin`. Pour tout le monde, le second facteur reste optionnel,
 * comme le demande le ticket.
 */
let override: boolean | null = null

export function adminTotpRequired(): boolean {
  return override ?? env.get('ADMIN_2FA_REQUIRED', false)
}

/**
 * Force la règle le temps d'un test, `null` pour rendre la main à l'environnement.
 *
 * ⚠️ Cette porte existe pour une raison précise, et c'est la même que les seuils injectables
 * de `LoginThrottleService` : une variable d'environnement est lue au démarrage, donc une
 * suite ne peut pas l'allumer pour trois tests. Sans elle, il faudrait poser la règle dans
 * `.env.test` — et alors **toute** la suite s'exécuterait sous une règle que la production
 * n'a pas encore, ou l'inverse. À n'appeler que depuis les tests.
 */
export function overrideAdminTotpRequired(value: boolean | null): void {
  override = value
}
