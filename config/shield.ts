import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/shield'

const shieldConfig = defineConfig({
  /**
   * CSP active (CC-78) — la couche qui borne ce qu'une XSS pourrait charger ou
   * exfiltrer si elle passait l'échappement de Vue.
   *
   * Ce que les directives disent, et pourquoi :
   *
   * - `script-src 'self'` est LA directive qui compte, et elle est stricte :
   *   aucun script inline, aucun domaine tiers. Le layout Edge n'émet que des
   *   `<script src>` (`@vite` en prod pointe sur `/assets`, en dev le serveur
   *   Vite est monté en middleware sur la même origine — pas de port séparé).
   * - `style-src 'unsafe-inline'` est le compromis assumé : les liaisons
   *   `:style` de Vue et la barre de progression d'Inertia écrivent des styles
   *   inline qu'aucun nonce ne peut couvrir. Une injection de CSS n'exécute
   *   rien ; le vecteur réel — les scripts — reste fermé.
   * - Google Fonts est le seul tiers du dépôt (`inertia_layout.edge`) : la
   *   feuille chez `fonts.googleapis.com`, les fichiers chez `fonts.gstatic.com`.
   * - `img-src data:` couvre le favicon inline du layout ; les vignettes de la
   *   veille passent par notre proxy (`/veille/items/:id/thumbnail`), donc `'self'`.
   * - `connect-src 'ws:'` n'existe qu'en dev : le HMR de Vite ouvre un
   *   websocket sur son propre port (24678), que `'self'` ne couvre pas.
   * - `frame-ancestors 'none'` double `X-Frame DENY` dans le vocabulaire CSP ;
   *   `object-src 'none'` et `base-uri 'self'` ferment les vecteurs archaïques
   *   (plugins, détournement d'URL relatives) ; `form-action 'self'` empêche un
   *   formulaire injecté de poster ailleurs.
   */
  csp: {
    enabled: true,
    directives: {
      defaultSrc: [`'self'`],
      scriptSrc: [`'self'`],
      styleSrc: [`'self'`, `'unsafe-inline'`, 'https://fonts.googleapis.com'],
      fontSrc: [`'self'`, 'https://fonts.gstatic.com'],
      imgSrc: [`'self'`, 'data:'],
      connectSrc: app.inProduction ? [`'self'`] : [`'self'`, 'ws:'],
      frameAncestors: [`'none'`],
      baseUri: [`'self'`],
      formAction: [`'self'`],
      objectSrc: [`'none'`],
    },
    reportOnly: false,
  },

  /**
   * Configure CSRF protection options. Refer documentation
   * to learn more
   */
  csrf: {
    enabled: true,
    exceptRoutes: [],
    enableXsrfCookie: true,
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  },

  /**
   * Control how your website should be embedded inside
   * iFrames
   */
  xFrame: {
    enabled: true,
    action: 'DENY',
  },

  /**
   * Force browser to always use HTTPS
   */
  hsts: {
    enabled: true,
    maxAge: '180 days',
  },

  /**
   * Disable browsers from sniffing the content type of a
   * response and always rely on the "content-type" header.
   */
  contentTypeSniffing: {
    enabled: true,
  },
})

export default shieldConfig
