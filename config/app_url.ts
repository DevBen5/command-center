import env from '#start/env'

/**
 * L'URL publique de l'application (CC-136) — la question qui compte pour un cookie n'est
 * pas « suis-je en production ? » mais « suis-je servi en TLS ? ». `APP_URL` est ce que
 * l'utilisateur tape dans son navigateur ; `secure` s'en déduit, plutôt que de `NODE_ENV`
 * (qui vaut toujours `production` sur l'image Docker, TLS ou pas — le proxy DSM le termine
 * en amont, l'application ne voit jamais de HTTP nu sur le NAS, mais le voit en local).
 */
export interface AppUrlInfo {
  /** L'URL telle que parsée — protocole, hôte, port. */
  url: URL
  /** `true` seulement si le schéma est `https:`. Pose le `secure` des cookies de session et CSRF. */
  secureCookies: boolean
  /**
   * HTTP sur un hôte qui n'est ni `localhost` ni une boucle locale : mots de passe et cookies
   * circuleraient en clair sur le réseau. Signalé au boot (`providers/app_url_provider.ts`),
   * jamais bloqué — ça peut être un réseau de confiance.
   */
  isInsecureNonLoopback: boolean
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Fonction pure, séparée de la lecture d'`env` — même raison que `normalizeLlmConfig`
 * (`config/llm.ts`) : rendre la dérivation testable sans dépendre du `.env` de la machine
 * qui lance les tests.
 */
export function inspectAppUrl(rawAppUrl: string): AppUrlInfo {
  const url = new URL(rawAppUrl)
  const secureCookies = url.protocol === 'https:'

  return {
    url,
    secureCookies,
    isInsecureNonLoopback: !secureCookies && !LOOPBACK_HOSTNAMES.has(url.hostname),
  }
}

const appUrl = inspectAppUrl(env.get('APP_URL'))

export default appUrl
