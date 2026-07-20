import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'

/**
 * ⚠️ Cette liste est dupliquée dans `VeilleItemType` (modèle) et dans la contrainte
 * `veille_items_type_check` (migration). Les trois bougent ensemble.
 */
export const captureValidator = vine.compile(
  vine.object({
    type: vine.enum(['article', 'bookmark', 'note'] as const),
    title: vine.string().trim().minLength(1).maxLength(500),
    url: vine.string().trim().url().maxLength(2048).optional(),
    content: vine.string().trim().maxLength(50_000).optional(),
  })
)

// ---------------------------------------------------------------------------------------------
// Garde SSRF — le miroir inverse de celle du client LLM
// ---------------------------------------------------------------------------------------------

/**
 * `isLocalLlmUrl` (module Leitner) n'accepte **que** les hôtes locaux : le serveur LLM tourne sur
 * la machine. Ici c'est l'inverse — un flux RSS est public — mais le raisonnement de fond est le
 * même : le serveur va chercher une URL saisie par l'utilisateur, il faut donc lui interdire les
 * cibles internes.
 *
 * Une différence de taille : Leitner peut refuser **tout nom de domaine** (le serveur LLM est
 * toujours une IP littérale), ce qui l'immunise contre le DNS rebinding. Impossible ici — un flux
 * RSS *est* un nom de domaine. D'où la vérification en deux temps : les littéraux sont filtrés à
 * la saisie, les noms sont résolus et leurs IP vérifiées au moment du fetch
 * (`feed_fetcher.ts`). Le TOCTOU qui subsiste est documenté dans le `CLAUDE.md` du module.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function isBlockedIpv4(host: string): boolean {
  const octets = host.match(IPV4)
  if (!octets) return false

  const [a, b] = octets.slice(1, 5).map(Number)

  if (a === 0) return true //   0.0.0.0/8      — « ce réseau »
  if (a === 10) return true //  10.0.0.0/8     — privé
  if (a === 127) return true // 127.0.0.0/8    — loopback
  if (a === 169 && b === 254) return true //    169.254.0.0/16 — lien-local, dont 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 — privé
  if (a === 192 && b === 168) return true //     192.168.0.0/16 — privé
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 — CGNAT
  if (a === 192 && b === 0) return true //       192.0.0.0/24   — IETF
  if (a === 198 && b >= 18 && b <= 19) return true // 198.18.0.0/15 — bancs d'essai
  if (a >= 224) return true //  224.0.0.0/4 multicast et 240.0.0.0/4 réservé (dont 255.255.255.255)

  return false
}

function isBlockedIpv6(host: string): boolean {
  const ip = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()

  if (ip === '::1' || ip === '::') return true

  // `::ffff:127.0.0.1` — une IPv4 déguisée en IPv6 vise exactement les mêmes cibles.
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped) return isBlockedIpv4(mapped[1])

  if (/^f[cd]/.test(ip)) return true //          fc00::/7  — unique local
  if (/^fe[89ab]/.test(ip)) return true //       fe80::/10 — lien-local

  return false
}

/**
 * L'adresse est-elle interdite comme cible ? Appelée sur les littéraux à la saisie, **et** sur
 * chaque IP résolue avant le fetch.
 */
export function isBlockedAddress(host: string): boolean {
  return isBlockedIpv4(host) || isBlockedIpv6(host)
}

/**
 * Noms qui ne désignent jamais un service public.
 * Le cas du nom sans point (`intranet`, `routeur`) compte : c'est la forme habituelle d'un hôte
 * de réseau local, et un flux public a toujours un domaine.
 */
function isInternalHostname(host: string): boolean {
  const name = host.toLowerCase()
  if (name === 'localhost' || name.endsWith('.localhost')) return true
  if (name.endsWith('.local') || name.endsWith('.internal') || name.endsWith('.home.arpa')) {
    return true
  }
  return !name.includes('.')
}

export function isPublicFeedUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return false
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

  // `http://flux.example@169.254.169.254/` : l'hôte n'est pas celui qu'on croit lire.
  if (url.username !== '' || url.password !== '') return false

  // `url.hostname` est déjà normalisé par le parseur : `0x7f000001`, `2130706433` et `127.1`
  // arrivent tous ici sous la forme `127.0.0.1`.
  if (isBlockedAddress(url.hostname)) return false
  if (isInternalHostname(url.hostname)) return false

  return true
}

const publicFeedUrl = vine.createRule(
  (value: unknown, _options: undefined, field: FieldContext) => {
    if (typeof value !== 'string') return
    if (!isPublicFeedUrl(value)) {
      field.report(
        'Le champ {{ field }} doit être une URL http(s) publique. Les adresses locales, ' +
          'privées et de lien-local (127.0.0.1, localhost, 10/8, 172.16/12, 192.168/16, ' +
          '169.254/16) sont refusées : le serveur irait les chercher pour toi.',
        'publicFeedUrl',
        field
      )
    }
  }
)

export const sourceValidator = vine.compile(
  vine.object({
    url: vine.string().trim().maxLength(2048).use(publicFeedUrl()),
    title: vine.string().trim().minLength(1).maxLength(200),
    // Plancher à 5 minutes : en dessous, on martèle un serveur tiers pour rien — un flux qui
    // publie plus souvent que ça n'existe pas.
    fetchIntervalMinutes: vine.number().min(5).max(10_080).optional(),
  })
)

export const sourceUpdateValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(200).optional(),
    fetchIntervalMinutes: vine.number().min(5).max(10_080).optional(),
    active: vine.boolean().optional(),
  })
)
