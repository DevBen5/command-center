import { computed } from 'vue'
import { usePage } from '@inertiajs/vue3'

/**
 * Lecture des capacités de l'utilisateur courant, côté page du module corpus (CC-275,
 * extrait de Leitner — `components/leitner_can.ts`, dont c'est une copie locale). « Un
 * module n'importe pas chez un voisin » (CLAUDE.md racine) : même patron que
 * `shared/csrf.ts` juste à côté.
 *
 * ⚠️ **Masquer n'est pas fermer.** Ce composable ne sert qu'à ne pas *proposer* une action
 * qui répondrait 403 : la vraie garde est le middleware de capacité sur la route (voir
 * `start/routes.ts`), et un `curl` muni d'un cookie valide n'a que faire du rendu Vue.
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

  const isAdmin = computed(() => user.value?.isAdmin ?? false)

  return { can, isAdmin }
}
