import env from '#start/env'
import appUrl from '#config/app_url'
import { defineConfig, stores } from '@adonisjs/session'

const sessionConfig = defineConfig({
  enabled: true,
  cookieName: 'adonis-session',

  /**
   * When set to true, the session id cookie will be deleted
   * once the user closes the browser.
   */
  clearWithBrowser: false,

  /**
   * Define how long to keep the session data alive without
   * any activity.
   */
  age: '2h',

  /**
   * Configuration for session cookie and the
   * cookie store
   */
  cookie: {
    path: '/',
    httpOnly: true,
    // Dérivé d'APP_URL, pas de NODE_ENV (CC-136) : sinon un cookie `secure` en HTTP nu
    // empêcherait toute connexion locale (`http://localhost:8080`), en silence.
    secure: appUrl.secureCookies,
    sameSite: 'lax',
  },

  /**
   * The store to use. Make sure to validate the environment
   * variable in order to infer the store name without any
   * errors.
   */
  store: env.get('SESSION_DRIVER'),

  /**
   * List of configured stores. Refer documentation to see
   * list of available stores and their config.
   */
  // Le store « memory » (utilisé par les tests via .env.test) est intégré
  // d'office au package : seul « cookie » doit être déclaré ici.
  stores: {
    cookie: stores.cookie(),
  },
})

export default sessionConfig
