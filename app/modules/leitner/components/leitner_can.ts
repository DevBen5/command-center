import { computed } from 'vue'
import { usePage } from '@inertiajs/vue3'

/**
 * Lecture des capacités de l'utilisateur courant, côté page du module Leitner.
 *
 * ⚠️ **Masquer n'est pas fermer.** Ce composable ne sert qu'à ne pas *proposer* une action
 * qui répondrait 403 : la vraie garde est le middleware de capacité sur la route (voir
 * `start/routes.ts`), et un `curl` muni d'un cookie valide n'a que faire du rendu Vue. Les
 * deux, jamais l'un sans l'autre.
 *
 * C'est le pendant, pour les pages du module, du `can()` local de `inertia/layouts/
 * AppLayout.vue` : même logique (`isAdmin` OU la capacité est listée), même source
 * (`config/inertia.ts` partage `user.capabilities` et `user.isAdmin` à toutes les pages).
 * On ne le mutualise pas avec celui du layout : ils vivent dans deux couches différentes
 * (noyau vs module), et `isAdmin` n'a jamais « toutes » les capacités — il passe outre.
 */
interface CurrentUser {
  isAdmin: boolean
  capabilities: string[]
}

export function useCan() {
  const page = usePage()

  const user = computed(() => (page.props.user as CurrentUser | null) ?? null)

  function can(capability: string): boolean {
    const current = user.value
    if (!current) return false
    return current.isAdmin || current.capabilities.includes(capability)
  }

  return { can }
}
