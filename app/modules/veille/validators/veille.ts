import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import {
  INTERVAL_UNITS,
  SCHEDULE_MODES,
  formatQuantity,
  isIntervalUnit,
  parseTimeOfDay,
  toMinutes,
  unitBounds,
  type IntervalUnit,
} from '#modules/veille/shared/interval'
import { isValidTag, TAG_MAX_LENGTH, TAGS_MAX } from '#modules/veille/shared/tags'
import { BULK_ACTIONS } from '#modules/veille/shared/bulk_actions'

/**
 * La forme d'un tag — **une seule définition, celle de `shared/tags.ts`** (CC-21).
 *
 * ⚠️ **Cette règle sera réutilisée par le validateur de CC-109**, qui pose des tags sur une
 * sélection. Ce sont deux gestes avec deux charges utiles, donc deux validateurs — mais *qu'est-ce
 * qu'un tag valide* est une seule question, et deux réponses divergeraient sans que rien ne le
 * signale : la capture accepterait ce que l'action groupée refuse.
 *
 * ⚠️ **Le message nomme ce qui est autorisé, pas ce qui est refusé.** « Format invalide » sur un
 * champ dont personne ne connaît les règles envoie chercher au hasard.
 */
export const tagRule = vine.createRule(
  (value: unknown, _options: undefined, field: FieldContext) => {
    if (typeof value !== 'string') return
    if (!isValidTag(value)) {
      field.report(
        `Un tag s'écrit en minuscules, sans espace, avec des lettres, des chiffres, ` +
          `« - » ou « _ », et ${TAG_MAX_LENGTH} caractères au maximum.`,
        'tag',
        field
      )
    }
  }
)

/**
 * ⚠️ Cette liste est dupliquée dans `VeilleItemType` (modèle) et dans la contrainte
 * `veille_items_type_check` (migration). Les trois bougent ensemble.
 *
 * ⚠️ **`tags` y figure depuis CC-21**, et c'était le seul champ affiché et filtrable de la page
 * que rien ne permettait de saisir : la colonne se remplissait par les collecteurs et se figeait.
 * Le validateur **ne normalise pas** — la page l'a déjà fait à la frappe, précisément pour que ce
 * qui s'affiche soit ce qui est stocké ; ici on refuse ce qui n'a pas la bonne forme.
 */
export const captureValidator = vine.compile(
  vine.object({
    type: vine.enum(['article', 'bookmark', 'note'] as const),
    title: vine.string().trim().minLength(1).maxLength(500),
    url: vine.string().trim().url().maxLength(2048).optional(),
    content: vine.string().trim().maxLength(50_000).optional(),
    tags: vine.array(vine.string().use(tagRule())).maxLength(TAGS_MAX).optional(),
  })
)

/**
 * La suppression, simple ou en lot (CC-63) — rien que des identifiants.
 *
 * ⚠️ **Le plafond n'est pas décoratif.** Les identifiants deviennent une liste d'assets dans un
 * seul `DELETE /api/assets` : c'est ce qui borne le geste le plus destructeur du module, et ce
 * qu'un client forgé ne peut pas contourner. 200 laisse toute la marge à une page de 50 items,
 * et refuse une requête qui voudrait vider la table d'un coup.
 */
export const itemIdsValidator = vine.compile(
  vine.object({
    ids: vine.array(vine.number().positive().withoutDecimals()).minLength(1).maxLength(200),
  })
)

/**
 * Le filtre qui voyage (CC-108) — **exactement les six champs du flux, rien de plus**.
 *
 * Ce validateur remplace le plafond de 200 identifiants pour un geste qui n'en envoie plus aucun :
 * la page poste un critère, le serveur rejoue la même requête que `index` et agit sur son
 * résultat. Ce n'est plus la page qui décide de ce qui part.
 *
 * ⚠️ **Ce que ce validateur ne fait PAS, et ne doit pas faire** : refuser un filtre vide. Cette
 * décision vit dans `shared/filter_selection.ts`, parce que la page en a besoin aussi — elle
 * n'offre pas le bouton, le serveur refuse quand même. Un refus câblé ici ne serait connu que du
 * serveur, et la page proposerait un geste qui échoue.
 *
 * ⚠️ **`sourceId` reste une chaîne ici, et c'est délibéré.** Il a trois états (`number | 'none' |
 * null`, CC-105) qu'un schéma Vine n'exprime pas sans se dédoubler ; `parseSourceFilter` les
 * tranche déjà et il est testé. Redéfinir la sentinelle dans ce fichier la ferait diverger de
 * celle que la page pose — deux définitions d'un même `'none'`, c'est-à-dire la panne muette que
 * CC-105 vient de corriger.
 *
 * Les bornes de longueur sont là pour ce qu'un client forgé pourrait envoyer, pas pour l'écran :
 * un `search` de 10 Mo partirait dans un `plainto_tsquery`.
 */
const filterFields = {
  type: vine.enum(['article', 'bookmark', 'note', 'image', 'video'] as const).optional(),
  tag: vine.string().trim().maxLength(100).optional(),
  search: vine.string().trim().maxLength(200).optional(),
  sourceId: vine.string().trim().maxLength(20).optional(),
  readingQueue: vine.boolean().optional(),
  unread: vine.boolean().optional(),
}

export const itemFilterValidator = vine.compile(vine.object({ ...filterFields }))

/**
 * Les actions groupées (CC-109) — **un validateur neuf, pas une extension de `captureValidator`**.
 *
 * Le ticket l'exigeait, et il avait raison : poser un tag sur une capture et sur trente items sont
 * deux gestes, avec deux charges utiles et deux routes. Ce qui est partagé, c'est `tagRule` — la
 * *forme* d'un tag est une seule question, et deux réponses laisseraient la capture accepter ce que
 * l'action groupée refuse.
 *
 * ⚠️ **`requiredWhen` dans un seul sens, et c'est suffisant ici** : un `tag` sans action de tag est
 * simplement ignoré par le service (le `switch` ne le lit pas), là où une action de tag **sans**
 * tag écrirait `array_append(tags, NULL)` — Postgres ajoute alors un `NULL` au tableau, que la
 * barre de tags afficherait comme une pastille vide et que le filtre ne retrouverait jamais.
 *
 * ⚠️ **Aucun plafond de 200 identifiants ici**, contrairement à `itemIdsValidator` : ce plafond
 * bornait ce qui part vers Immich dans un seul `DELETE`, et **aucune de ces actions ne sort de
 * Command Center**. La borne à 1000 ne protège qu'une charge utile, pas un système tiers.
 */
export const bulkActionValidator = vine.compile(
  vine.object({
    action: vine.enum(BULK_ACTIONS),
    tag: vine
      .string()
      .use(tagRule())
      .optional()
      .requiredWhen('action', 'in', ['tag.add', 'tag.remove']),
    ids: vine.array(vine.number().positive().withoutDecimals()).minLength(1).maxLength(1000),
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

// ---------------------------------------------------------------------------------------------
// La cadence — l'unité voyage avec la valeur, et c'est le serveur qui convertit
// ---------------------------------------------------------------------------------------------

/**
 * Le mode d'échec que cette règle existe pour rendre bruyant est **asymétrique**.
 *
 * Si l'unité se perd en route et qu'un `12` voulant dire 12 **heures** arrive comme 12 minutes,
 * rien ne le signale : 12 passe le plancher de 5. La source serait interrogée 5 fois par heure
 * au lieu de 2 fois par jour — un serveur tiers martelé, sans une ligne de log. Le sens inverse
 * est inoffensif : un `2` voulant dire 2 minutes tombe sous le plancher et se fait refuser.
 *
 * D'où le contrat : la page envoie `{ interval, intervalUnit }` et **ne convertit jamais**. Si
 * elle convertissait avant d'envoyer, le serveur ne verrait qu'un nombre de minutes sans moyen
 * de re-valider ce que l'utilisateur voulait dire — la garde reposerait entièrement sur le
 * JavaScript de la page.
 *
 * ⚠️ **Cette règle est la SEULE borne** : les `.min(5).max(10_080)` du schéma ont disparu, parce
 * qu'ils ne savaient pas dans quelle unité le nombre était écrit. Elle **échoue donc fermée** —
 * une unité illisible reporte une erreur au lieu de sortir en silence. Sortir en silence
 * laisserait passer « 8 jours » (11520 min) sans aucune borne, ce qui serait pire que le bug
 * qu'on corrige. Le test `veille_sources.spec.ts` qui poste 8 jours et attend un refus est ce
 * qui garde ce garde.
 */
const intervalWithinBounds = vine.createRule(
  (value: unknown, _options: undefined, field: FieldContext) => {
    if (typeof value !== 'number') return

    const unit = field.parent?.intervalUnit
    if (!isIntervalUnit(unit)) {
      field.report(
        'Le champ {{ field }} exige une unité valide (minutes, heures ou jours).',
        'intervalWithinBounds',
        field
      )
      return
    }

    const { min, max } = unitBounds(unit)
    if (value < min) {
      field.report(
        `La cadence doit être d'au moins ${formatQuantity(min, unit)}.`,
        'intervalWithinBounds',
        field
      )
    } else if (value > max) {
      field.report(
        `La cadence ne peut pas dépasser ${formatQuantity(max, unit)}.`,
        'intervalWithinBounds',
        field
      )
    }
  }
)

/**
 * Les deux champs vont ensemble ou aucun : `requiredIfExists` dans les **deux sens** transforme
 * une unité droppée en refus bruyant, au lieu d'un nombre lu dans la mauvaise unité.
 *
 * Pas de décimale (`withoutDecimals`) : « 1,5 heure » se saisit en 90 minutes. Autoriser les
 * décimales obligerait à arrondir quelque part.
 */
const intervalFields = {
  interval: vine
    .number()
    .withoutDecimals()
    .use(intervalWithinBounds())
    .optional()
    .requiredIfExists('intervalUnit'),
  intervalUnit: vine.enum(INTERVAL_UNITS).optional().requiredIfExists('interval'),
}

/**
 * La conversion, en **un seul endroit nommé** — appelée par le contrôleur après validation.
 *
 * Rend `undefined` quand la cadence n'a pas été soumise du tout : l'appelant décide alors du
 * défaut (1 heure à la création) ou ne touche à rien (mise à jour).
 */
export function resolveIntervalMinutes(payload: {
  interval?: number
  intervalUnit?: IntervalUnit
}): number | undefined {
  if (payload.interval === undefined || payload.intervalUnit === undefined) return undefined
  return toMinutes(payload.interval, payload.intervalUnit)
}

// ---------------------------------------------------------------------------------------------
// CC-59 — l'horaire mural, et l'exclusivité des deux modes
// ---------------------------------------------------------------------------------------------

/**
 * L'heure du jour, au format `HH:MM` — celui que produit un `<input type="time">`.
 *
 * Une regex plutôt qu'un `vine.date()` : on ne veut pas d'une date, seulement de deux nombres
 * bornés. Et le refus doit parler de l'heure, pas d'un format ISO que l'utilisateur n'a jamais vu.
 */
const timeOfDay = vine.createRule((value: unknown, _options: undefined, field: FieldContext) => {
  if (typeof value !== 'string') return
  if (parseTimeOfDay(value) === null) {
    field.report(
      'L’heure de collecte doit s’écrire HH:MM, entre 00:00 et 23:59.',
      'timeOfDay',
      field
    )
  }
})

/**
 * Les deux champs de l'horaire, avec la même doctrine que la cadence de CC-57 : **l'exclusivité
 * se valide dans les deux sens**, faute de quoi le mode d'échec est silencieux.
 *
 * - `dailyAt` sans `scheduleMode` : l'heure serait enregistrée sur une source restée en mode
 *   intervalle — un réglage inerte, que l'écran afficherait pourtant comme saisi.
 * - `scheduleMode: 'daily'` sans `dailyAt` : la contrainte `veille_sources_schedule_check`
 *   refuserait l'écriture, mais en 500 — une page d'erreur au lieu d'un message.
 *
 * `requiredWhen` couvre le second, `requiredIfExists` le premier. Un champ manquant devient un
 * refus lisible, jamais un réglage qui ne s'applique pas.
 */
const scheduleFields = {
  scheduleMode: vine.enum(SCHEDULE_MODES).optional().requiredIfExists('dailyAt'),
  dailyAt: vine
    .string()
    .trim()
    .use(timeOfDay())
    .optional()
    .requiredWhen('scheduleMode', '=', 'daily'),
}

export const sourceValidator = vine.compile(
  vine.object({
    url: vine.string().trim().maxLength(2048).use(publicFeedUrl()),
    title: vine.string().trim().minLength(1).maxLength(200),
    ...intervalFields,
    ...scheduleFields,
  })
)

export const sourceUpdateValidator = vine.compile(
  vine.object({
    title: vine.string().trim().minLength(1).maxLength(200).optional(),
    active: vine.boolean().optional(),
    ...intervalFields,
    ...scheduleFields,
  })
)
