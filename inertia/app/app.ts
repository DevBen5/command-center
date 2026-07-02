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
    return resolvePageComponent(
      `../pages/${name}.vue`,
      import.meta.glob<DefineComponent>('../pages/**/*.vue')
    )
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
