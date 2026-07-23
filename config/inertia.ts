import { defineConfig } from '@adonisjs/inertia'
import type { InferSharedProps } from '@adonisjs/inertia/types'
import i18nManager from '@adonisjs/i18n/services/main'
import NavStatsService from '#core/shared/services/nav_stats_service'
import navigation from '#core/shared/navigation/registry'
import { capabilitiesFor } from '#core/auth/services/capability_service'

const inertiaConfig = defineConfig({
  /**
   * Path to the Edge view that will be used as the root view for Inertia responses
   */
  rootView: 'inertia_layout',

  /**
   * Data that should be shared with all rendered pages
   */
  sharedData: {
    // Utilisateur connecté (ou null sur les pages publiques comme /login).
    //
    // ⚠️ `capabilities` ne contient **pas** « tout » pour un administrateur : `isAdmin`
    // est envoyé à côté, et l'UI compose les deux. Matérialiser la liste de tout, même
    // dans un payload, obligerait à la tenir à jour à chaque ajout de capacité — c'est
    // exactement ce que le modèle cherche à rendre impossible.
    user: async (ctx) => {
      const user = ctx.auth?.user
      if (!user) return null

      return {
        fullName: user.fullName,
        email: user.email,
        isAdmin: user.isAdmin,
        capabilities: [...(await capabilitiesFor(ctx))],
      }
    },
    // Compteurs de la barre latérale, uniquement quand on est authentifié — et réduits à
    // ce que le lecteur a le droit de voir.
    nav: async (ctx) => {
      const user = ctx.auth?.user
      if (!user) return null

      return new NavStatsService().collect({
        isAdmin: user.isAdmin,
        capabilities: await capabilitiesFor(ctx),
      })
    },
    // Les entrées de la barre latérale, filtrées côté serveur.
    //
    // ⚠️ **Elles sortent du registre de destinations, qui sert aussi à l'atterrissage** — c'est
    // tout l'intérêt : avant CC-81, `AppLayout.vue` tenait sa propre liste d'entrées et de
    // capacités, donc deux endroits à mettre d'accord et rien pour signaler qu'ils avaient
    // divergé. Le layout ne connaît plus que la clé (son libellé i18n et son icône).
    //
    // Seuls `key` et `href` descendent : la condition d'accès a déjà été appliquée ici, et le
    // client n'a rien à en refaire.
    destinations: async (ctx) => {
      const user = ctx.auth?.user
      if (!user) return null

      return navigation
        .visibleFor({ isAdmin: user.isAdmin, capabilities: await capabilitiesFor(ctx) })
        .map(({ key, href }) => ({ key, href }))
    },
    // Langue courante + langues disponibles, pour le sélecteur côté Vue.
    locale: (ctx) => ctx.i18n?.locale ?? 'fr',
    supportedLocales: () => i18nManager.supportedLocales(),
  },

  /**
   * Options for the server-side rendering
   */
  ssr: {
    enabled: false,
    entrypoint: 'inertia/app/ssr.ts',
  },
})

export default inertiaConfig

declare module '@adonisjs/inertia/types' {
  export interface SharedProps extends InferSharedProps<typeof inertiaConfig> {}
}
