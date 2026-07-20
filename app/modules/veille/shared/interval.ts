/**
 * Cadence de collecte — conversion entre l'unité de l'utilisateur et celle du planificateur.
 *
 * ⚠️ **Le stockage ne change pas** : `veille_sources.fetch_interval_minutes` reste une colonne
 * en minutes, et `VeilleSource.isDue()` continue de faire `plus({ minutes })`. La minute est
 * l'unité canonique parce que c'est celle que la boucle utilise. Seules la **saisie** et
 * l'**affichage** connaissent les heures et les jours.
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
