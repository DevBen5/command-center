import { defineConfig } from '@adonisjs/inertia'
import type { InferSharedProps } from '@adonisjs/inertia/types'
import i18nManager from '@adonisjs/i18n/services/main'
import NavStatsService from '#services/nav_stats_service'

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
    user: (ctx) => {
      const user = ctx.auth?.user
      return user ? { fullName: user.fullName, email: user.email } : null
    },
    // Compteurs de la barre latérale, uniquement quand on est authentifié.
    nav: (ctx) => (ctx.auth?.user ? new NavStatsService().collect() : null),
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
