import proxyAddr from 'proxy-addr'
import env from '#start/env'
import appUrl from '#config/app_url'
import { Secret } from '@adonisjs/core/helpers'
import { defineConfig } from '@adonisjs/core/http'

/**
 * The app key is used for encrypting cookies, generating signed URLs,
 * and by the "encryption" module.
 *
 * The encryption module will fail to decrypt data if the key is lost or
 * changed. Therefore it is recommended to keep the app key secure.
 */
export const appKey = new Secret(env.get('APP_KEY'))

/**
 * The configuration settings used by the HTTP server
 */
export const http = defineConfig({
  generateRequestId: true,
  allowMethodSpoofing: false,

  /**
   * Qui a le droit de parler au nom du client via `X-Forwarded-For` (CC-78).
   * `request.ip()` — dont dépend le throttle de connexion par IP — remonte la
   * chaîne des proxys tant qu'ils sont de confiance. Défaut `loopback` : le
   * défaut d'AdonisJS, explicité pour que la valeur à changer au déploiement
   * derrière le proxy DSM ait un nom (`TRUST_PROXY`, voir `.env.example`).
   */
  trustProxy: proxyAddr.compile(
    (env.get('TRUST_PROXY') ?? 'loopback').split(',').map((entry) => entry.trim())
  ),

  /**
   * Enabling async local storage will let you access HTTP context
   * from anywhere inside your application.
   */
  useAsyncLocalStorage: false,

  /**
   * Manage cookies configuration. The settings for the session id cookie are
   * defined inside the "config/session.ts" file.
   */
  cookie: {
    domain: '',
    path: '/',
    maxAge: '2h',
    httpOnly: true,
    // Dérivé d'APP_URL, pas de NODE_ENV (CC-136) — hérité par le cookie XSRF-TOKEN de Shield,
    // qui ne définit pas ses propres `cookieOptions`. Même raison que config/session.ts.
    secure: appUrl.secureCookies,
    sameSite: 'lax',
  },
})
