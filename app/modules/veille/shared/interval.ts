/**
 * Cadence de collecte — conversion entre l'unité de l'utilisateur et celle du planificateur,
 * et lecture de l'heure du jour pour le mode horaire.
 *
 * ⚠️ **En mode intervalle, le stockage n'a pas changé** : `veille_sources.fetch_interval_minutes`
 * reste une colonne en minutes, et `VeilleSource.isDue()` continue de faire `plus({ minutes })`.
 * La minute est l'unité canonique parce que c'est celle que la boucle utilise. Seules la
 * **saisie** et l'**affichage** connaissent les heures et les jours.
 *
 * ⚠️ **Le mode horaire (CC-59), lui, a bien une colonne à part** (`daily_at`) — et il le fallait :
 * « à 7h » n'est pas une durée, donc rien dans `fetch_interval_minutes` ne pouvait la porter.
 * C'est la raison pour laquelle CC-59 a une migration là où CC-57 n'en avait pas.
 *
 * Stocker un couple (valeur, unité) ferait coexister deux représentations de la même durée —
 * elles finiraient par diverger, et le planificateur convertirait à chaque tick pour rien.
 *
 * Ce fichier est **pur** : ni base, ni horloge, ni framework. C'est ce qui permet au serveur
 * (validateur, contrôleur) et à la page Vue d'en partager exactement la même copie — une
 * seconde implémentation côté navigateur serait précisément le moyen de faire diverger
 * l'affichage de ce qui est réellement enregistré.
 */

export const INTERVAL_UNITS = ['minutes', 'hours', 'days'] as const

export type IntervalUnit = (typeof INTERVAL_UNITS)[number]

const MINUTES_PER_UNIT: Record<IntervalUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
}

/**
 * Plancher à 5 minutes : en dessous, on martèle un serveur tiers pour rien — un flux qui publie
 * plus souvent que ça n'existe pas. Plafond à 7 jours.
 */
export const MIN_INTERVAL_MINUTES = 5
export const MAX_INTERVAL_MINUTES = 10_080

export function isIntervalUnit(value: unknown): value is IntervalUnit {
  return typeof value === 'string' && (INTERVAL_UNITS as readonly string[]).includes(value)
}

/** La durée saisie, en minutes. */
export function toMinutes(value: number, unit: IntervalUnit): number {
  return value * MINUTES_PER_UNIT[unit]
}

/**
 * L'inverse : la **plus grande unité qui divise exactement**.
 *
 * `90` reste « 90 minutes » et ne devient jamais « 1,5 heure » — autoriser les décimales
 * obligerait à arrondir quelque part, et un arrondi silencieux sur une cadence est exactement
 * ce qu'on cherche à éviter.
 *
 * ⚠️ La propriété universelle est `toMinutes(fromMinutes(m)) === m`, **pas** l'aller-retour dans
 * l'autre sens : `fromMinutes(toMinutes(60, 'minutes'))` rend `(1, 'hours')`, pas
 * `(60, 'minutes')`. Ce second sens n'est vrai que pour les couples déjà canoniques — ceux que
 * cette fonction produit.
 */
export function fromMinutes(minutes: number): { value: number; unit: IntervalUnit } {
  // Une valeur héritée hors domaine (0, négative, non entière) n'a pas de forme canonique :
  // `0 % 1440 === 0` la ferait afficher « 0 jour ». On la rend telle quelle, en minutes.
  if (!Number.isInteger(minutes) || minutes <= 0) {
    return { value: minutes, unit: 'minutes' }
  }

  if (minutes % MINUTES_PER_UNIT.days === 0) {
    return { value: minutes / MINUTES_PER_UNIT.days, unit: 'days' }
  }
  if (minutes % MINUTES_PER_UNIT.hours === 0) {
    return { value: minutes / MINUTES_PER_UNIT.hours, unit: 'hours' }
  }
  return { value: minutes, unit: 'minutes' }
}

/**
 * Ce que le sélecteur doit laisser saisir dans une unité donnée. En jours le maximum est 7, en
 * heures 168 : un champ qui laisse saisir « 30 jours » pour le refuser ensuite est une
 * invitation à l'erreur.
 *
 * Le plancher suit la même logique : 5 minutes ne se disent pas en heures, donc le minimum y
 * est 1 heure.
 */
export function unitBounds(unit: IntervalUnit): { min: number; max: number } {
  const factor = MINUTES_PER_UNIT[unit]
  return {
    min: Math.ceil(MIN_INTERVAL_MINUTES / factor),
    max: Math.floor(MAX_INTERVAL_MINUTES / factor),
  }
}

const UNIT_LABELS: Record<IntervalUnit, { one: string; many: string }> = {
  minutes: { one: 'minute', many: 'minutes' },
  hours: { one: 'heure', many: 'heures' },
  days: { one: 'jour', many: 'jours' },
}

/** « 5 minutes », « 1 heure », « 7 jours » — pour les messages d'erreur, dans l'unité saisie. */
export function formatQuantity(value: number, unit: IntervalUnit): string {
  const labels = UNIT_LABELS[unit]
  return `${value} ${value === 1 ? labels.one : labels.many}`
}

/**
 * La cadence telle qu'elle se lit dans la liste des sources : « toutes les 30 minutes »,
 * « toutes les heures », « tous les 2 jours ».
 *
 * Le genre suit l'unité (une minute, une heure → « toutes les » ; un jour → « tous les ») et le
 * cas 1 se dit sans le nombre. C'est du wording, mais il régresse en silence — d'où son test.
 */
export function formatInterval(minutes: number): string {
  const { value, unit } = fromMinutes(minutes)
  const article = unit === 'days' ? 'tous les' : 'toutes les'

  if (value === 1) {
    return `${article} ${UNIT_LABELS[unit].many}`
  }
  return `${article} ${formatQuantity(value, unit)}`
}

// ---------------------------------------------------------------------------------------------
// CC-59 — l'horaire mural, le second mode d'ordonnancement
// ---------------------------------------------------------------------------------------------

/**
 * Les deux façons de cadencer une source. `interval` est l'historique (« N minutes après la
 * dernière collecte »), `daily` l'horaire mural (« tous les jours à 7h »).
 *
 * Ce n'est **pas** une unité de plus dans le sélecteur : « à 7h » n'est pas une durée. Le champ
 * passe de « minutes | heures | jours » à « intervalle | horaire », l'unité se repliant sous le
 * premier.
 */
export const SCHEDULE_MODES = ['interval', 'daily'] as const

export type ScheduleMode = (typeof SCHEDULE_MODES)[number]

export function isScheduleMode(value: unknown): value is ScheduleMode {
  return typeof value === 'string' && (SCHEDULE_MODES as readonly string[]).includes(value)
}

/** L'heure par défaut proposée quand on bascule en mode horaire. */
export const DEFAULT_DAILY_AT = '07:00'

/**
 * `HH:MM`, avec ou sans les secondes — Postgres rend un `time` sous la forme `'07:00:00'`, un
 * `<input type="time">` sous la forme `'07:00'`. Les deux doivent se lire.
 */
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/

/**
 * L'heure du jour, décomposée — ou `null` si elle est absente ou illisible.
 *
 * ⚠️ **Rendre `null` plutôt que lever est délibéré** : cette fonction est appelée depuis
 * `isDue()`, dans une boucle de fond où personne ne lit d'exception. L'appelant décide quoi
 * faire d'une heure manquante ; ici on se contente de dire qu'elle l'est.
 */
export function parseTimeOfDay(value: string | null | undefined): {
  hour: number
  minute: number
} | null {
  if (typeof value !== 'string') return null

  const parts = value.trim().match(TIME_OF_DAY)
  if (!parts) return null

  return { hour: Number(parts[1]), minute: Number(parts[2]) }
}

/**
 * La forme `HH:MM` — celle que le `<input type="time">` accepte, et la seule qu'on poste.
 *
 * Postgres rend `'07:00:00'` : le donner tel quel au champ le laisserait **vide**, sans un mot.
 * Une heure invalide retombe sur le défaut plutôt que de vider le champ.
 */
export function normalizeTimeOfDay(value: string | null | undefined): string {
  const at = parseTimeOfDay(value)
  if (at === null) return DEFAULT_DAILY_AT

  return `${String(at.hour).padStart(2, '0')}:${String(at.minute).padStart(2, '0')}`
}

/** « 7h00 », « 0h30 » — la convention française, l'heure sans zéro de tête. */
export function formatTimeOfDay(value: string | null | undefined): string {
  const at = parseTimeOfDay(value)
  if (at === null) return '—'

  return `${at.hour}h${String(at.minute).padStart(2, '0')}`
}

/**
 * La cadence telle qu'elle se lit dans la liste, **quel que soit le mode** : « toutes les 30
 * minutes » à côté de « tous les jours à 7h00 ».
 *
 * Un seul point d'entrée pour l'affichage : la page n'a pas à savoir quelle fonction appeler
 * selon le mode, donc elle ne peut pas se tromper de branche.
 */
export function formatSchedule(source: {
  scheduleMode?: ScheduleMode | string | null
  dailyAt?: string | null
  fetchIntervalMinutes: number
}): string {
  if (source.scheduleMode === 'daily') {
    return `tous les jours à ${formatTimeOfDay(source.dailyAt)}`
  }
  return formatInterval(source.fetchIntervalMinutes)
}
