/// <reference path="../../adonisrc.ts" />
/// <reference path="../../config/inertia.ts" />

import '../css/app.css'
import { createApp, h } from 'vue'
import type { DefineComponent } from 'vue'
import { createInertiaApp, router } from '@inertiajs/vue3'
import { resolvePageComponent } from '@adonisjs/inertia/helpers'
import { i18n, setLocale } from '../i18n'

// À chaque navigation réussie, on aligne vue-i18n sur la langue renvoyée par
// le backend (utile après un changement de langue).
router.on('success', (event) => {
  const locale = event.detail.page.props.locale as string | undefined
  if (locale) setLocale(locale)
})

const appName = import.meta.env.VITE_APP_NAME || 'AdonisJS'

createInertiaApp({
  progress: { color: '#ff1493' },

  title: (title) => `${title} - ${appName}`,

  resolve: (name) => {
    // Les pages Vue sont co-localisées dans chaque feature, sous app/**/pages/.
    // Le nom de composant Inertia est dérivé du chemin du fichier : on retire le
    // préfixe « /app/ » et le segment « /pages/ »
    // (ex. /app/modules/services/pages/index.vue → modules/services/index).
    // On retrouve donc le bon fichier par correspondance sur ce nom normalisé.
    const pages = import.meta.glob<DefineComponent>('/app/**/pages/**/*.vue')
    const path = Object.keys(pages).find(
      (file) =>
        file
          .replace('/app/', '')
          .replace('/pages/', '/')
          .replace(/\.vue$/, '') === name
    )
    if (!path) {
      throw new Error(`Page Inertia introuvable : "${name}"`)
    }
    return resolvePageComponent(path, pages)
  },

  setup({ el, App, props, plugin }) {
    // Langue initiale fournie par le backend via les shared data Inertia.
    const locale = (props.initialPage.props.locale as string | undefined) ?? 'fr'
    setLocale(locale)

    createApp({ render: () => h(App, props) })
      .use(plugin)
      .use(i18n)
      .mount(el)
  },
})
