import { test } from '@japa/runner'
import {
  DEFAULT_DAILY_AT,
  INTERVAL_UNITS,
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  formatInterval,
  formatQuantity,
  formatSchedule,
  formatTimeOfDay,
  fromMinutes,
  normalizeTimeOfDay,
  parseTimeOfDay,
  toMinutes,
  unitBounds,
  type IntervalUnit,
} from '#modules/veille/shared/interval'

/**
 * La cadence saisie en minutes, heures ou jours — pendant unitaire de CC-57.
 *
 * Le stockage reste en minutes ; ces fonctions sont la seule traduction entre l'unité de
 * l'utilisateur et celle du planificateur. Elles n'ont ni base ni horloge, donc tout se teste
 * ici — et c'est le seul filet, la page Vue n'ayant aucun test de composant dans ce dépôt.
 */
test.group('Veille / cadence — conversion valeur ⇄ unité', () => {
  test('la table de lecture du ticket : la plus grande unité qui divise exactement', ({
    assert,
  }) => {
    const cases: [number, number, IntervalUnit][] = [
      [30, 30, 'minutes'],
      [60, 1, 'hours'],
      // 90 minutes ne devient PAS « 1,5 heure » : pas de décimale, donc pas d'arrondi.
      [90, 90, 'minutes'],
      [1440, 1, 'days'],
      [2880, 2, 'days'],
      [10_080, 7, 'days'],
      [120, 2, 'hours'],
      [5, 5, 'minutes'],
    ]

    for (const [minutes, value, unit] of cases) {
      assert.deepEqual(fromMinutes(minutes), { value, unit }, `${minutes} min`)
    }
  })

  /**
   * **La propriété universelle.** C'est elle qui interdit toute dérive entre ce qui est stocké
   * et ce qui est affiché : quelle que soit la valeur en base, la relire puis la reconvertir
   * doit rendre exactement la même minute.
   */
  test('ALLER-RETOUR — toMinutes(fromMinutes(m)) === m pour toute minute du domaine', ({
    assert,
  }) => {
    for (let minutes = MIN_INTERVAL_MINUTES; minutes <= MAX_INTERVAL_MINUTES; minutes++) {
      const { value, unit } = fromMinutes(minutes)
      assert.equal(toMinutes(value, unit), minutes, `${minutes} min ne revient pas sur ses pieds`)
    }
  })

  /**
   * Le sens inverse, **et sa limite** : il n'est vrai que pour les couples *canoniques*, ceux que
   * `fromMinutes` sait produire. Le ticket l'énonce « pour tout couple représentable », ce qui
   * est faux tel quel — `fromMinutes(toMinutes(60, 'minutes'))` rend `(1, 'hours')`.
   */
  test('ALLER-RETOUR — fromMinutes(toMinutes(v, u)) === (v, u) pour tout couple canonique', ({
    assert,
  }) => {
    for (let minutes = MIN_INTERVAL_MINUTES; minutes <= MAX_INTERVAL_MINUTES; minutes++) {
      const canonical = fromMinutes(minutes)
      assert.deepEqual(
        fromMinutes(toMinutes(canonical.value, canonical.unit)),
        canonical,
        `${canonical.value} ${canonical.unit}`
      )
    }
  })

  test('un couple NON canonique se normalise, il ne se conserve pas', ({ assert }) => {
    // 60 minutes et 1 heure sont la même durée : la forme canonique est l'heure.
    assert.deepEqual(fromMinutes(toMinutes(60, 'minutes')), { value: 1, unit: 'hours' })
    assert.deepEqual(fromMinutes(toMinutes(24, 'hours')), { value: 1, unit: 'days' })
  })

  test('une valeur héritée hors domaine retombe en minutes, jamais en « 0 jour »', ({ assert }) => {
    // `0 % 1440 === 0` : sans garde, zéro s'afficherait « tous les 0 jours ».
    assert.deepEqual(fromMinutes(0), { value: 0, unit: 'minutes' })
    assert.deepEqual(fromMinutes(-1440), { value: -1440, unit: 'minutes' })
    assert.deepEqual(fromMinutes(7.5), { value: 7.5, unit: 'minutes' })
  })

  test('toMinutes applique le bon facteur', ({ assert }) => {
    assert.equal(toMinutes(30, 'minutes'), 30)
    assert.equal(toMinutes(2, 'hours'), 120)
    // Le cas exact du piège n° 1 : 2 jours valent 2880 minutes, pas 2.
    assert.equal(toMinutes(2, 'days'), 2880)
    assert.equal(toMinutes(7, 'days'), MAX_INTERVAL_MINUTES)
  })
})

test.group('Veille / cadence — bornes par unité', () => {
  test('le sélecteur borne ce qu’il propose, dans chaque unité', ({ assert }) => {
    assert.deepEqual(unitBounds('minutes'), { min: 5, max: 10_080 })
    assert.deepEqual(unitBounds('hours'), { min: 1, max: 168 })
    assert.deepEqual(unitBounds('days'), { min: 1, max: 7 })
  })

  /**
   * Les bornes exprimées par unité doivent dire **la même chose** que les bornes en minutes :
   * si elles divergeaient, le champ laisserait saisir une valeur que le serveur refuserait —
   * exactement l'invitation à l'erreur que le ticket cherche à supprimer.
   */
  test('les bornes par unité restent dans le domaine en minutes', ({ assert }) => {
    for (const unit of INTERVAL_UNITS) {
      const { min, max } = unitBounds(unit)
      assert.isAtLeast(toMinutes(min, unit), MIN_INTERVAL_MINUTES, `min ${unit}`)
      assert.isAtMost(toMinutes(max, unit), MAX_INTERVAL_MINUTES, `max ${unit}`)
      // Et le plancher est bien le PLUS PETIT entier acceptable : un cran en dessous sort.
      assert.isBelow(toMinutes(min - 1, unit), MIN_INTERVAL_MINUTES, `min-1 ${unit}`)
      assert.isAbove(toMinutes(max + 1, unit), MAX_INTERVAL_MINUTES, `max+1 ${unit}`)
    }
  })
})

test.group('Veille / cadence — ce qui se lit à l’écran', () => {
  test('le genre suit l’unité et le cas 1 se dit sans le nombre', ({ assert }) => {
    assert.equal(formatInterval(30), 'toutes les 30 minutes')
    assert.equal(formatInterval(60), 'toutes les heures')
    assert.equal(formatInterval(90), 'toutes les 90 minutes')
    assert.equal(formatInterval(120), 'toutes les 2 heures')
    assert.equal(formatInterval(1440), 'tous les jours')
    assert.equal(formatInterval(2880), 'tous les 2 jours')
    assert.equal(formatInterval(10_080), 'tous les 7 jours')
  })

  test('formatQuantity accorde le singulier — pour les messages d’erreur', ({ assert }) => {
    assert.equal(formatQuantity(5, 'minutes'), '5 minutes')
    assert.equal(formatQuantity(1, 'hours'), '1 heure')
    assert.equal(formatQuantity(168, 'hours'), '168 heures')
    assert.equal(formatQuantity(1, 'days'), '1 jour')
    assert.equal(formatQuantity(7, 'days'), '7 jours')
  })

  test('aucune cadence du domaine ne se lit en minutes à quatre chiffres', ({ assert }) => {
    // La plainte d'origine : « toutes les 1440 min » ne se lit pas.
    assert.notInclude(formatInterval(1440), '1440')
    assert.notInclude(formatInterval(10_080), '10080')
  })
})

/**
 * CC-59 — l'heure du jour. Le comportement d'ordonnancement se teste dans
 * `veille_schedule.spec.ts` ; ici, seulement la traduction entre ce que Postgres stocke, ce que
 * le champ accepte et ce qui s'affiche.
 */
test.group('Veille / horaire — lire et écrire une heure du jour', () => {
  test('parseTimeOfDay accepte HH:MM et la forme rendue par Postgres', ({ assert }) => {
    assert.deepEqual(parseTimeOfDay('07:00'), { hour: 7, minute: 0 })
    // ⚠️ Le driver `pg` rend un `time` sous la forme `'07:00:00'` : la refuser viderait le champ.
    assert.deepEqual(parseTimeOfDay('07:00:00'), { hour: 7, minute: 0 })
    assert.deepEqual(parseTimeOfDay('23:59'), { hour: 23, minute: 59 })
    assert.deepEqual(parseTimeOfDay('00:00'), { hour: 0, minute: 0 })
    assert.deepEqual(parseTimeOfDay(' 07:30 '), { hour: 7, minute: 30 })
  })

  test('parseTimeOfDay rend null plutôt que de lever — la boucle n’a pas de lecteur', ({
    assert,
  }) => {
    for (const invalid of [null, undefined, '', '7:00', '24:00', '07:60', '-1:00', 'sept heures']) {
      assert.isNull(parseTimeOfDay(invalid), `« ${invalid} » a été accepté`)
    }
  })

  test('normalizeTimeOfDay ramène à la forme que le champ accepte', ({ assert }) => {
    assert.equal(normalizeTimeOfDay('07:00:00'), '07:00')
    assert.equal(normalizeTimeOfDay('7:00'), DEFAULT_DAILY_AT, 'une heure illisible vide le champ')
    assert.equal(normalizeTimeOfDay(null), DEFAULT_DAILY_AT)
    assert.equal(normalizeTimeOfDay('23:05'), '23:05')
  })

  test('l’heure se lit à la française, sans zéro de tête', ({ assert }) => {
    assert.equal(formatTimeOfDay('07:00'), '7h00')
    assert.equal(formatTimeOfDay('07:00:00'), '7h00')
    assert.equal(formatTimeOfDay('00:30'), '0h30')
    assert.equal(formatTimeOfDay('23:59'), '23h59')
  })

  /**
   * Le point d'entrée unique de l'affichage : la page n'a pas à choisir sa fonction selon le
   * mode, donc elle ne peut pas se tromper de branche. C'est du wording, et il régresse en
   * silence — d'où son test, comme pour `formatInterval`.
   */
  test('formatSchedule dit « tous les jours à 7h00 » à côté de « tous les 2 jours »', ({
    assert,
  }) => {
    assert.equal(
      formatSchedule({ scheduleMode: 'daily', dailyAt: '07:00:00', fetchIntervalMinutes: 60 }),
      'tous les jours à 7h00'
    )
    assert.equal(
      formatSchedule({ scheduleMode: 'interval', dailyAt: null, fetchIntervalMinutes: 2880 }),
      'tous les 2 jours'
    )
    // ⚠️ Le mode décide, jamais la présence d'une heure : une source en mode intervalle qui
    // porterait une heure résiduelle doit lire sa cadence en minutes.
    assert.equal(
      formatSchedule({ scheduleMode: 'interval', dailyAt: '07:00', fetchIntervalMinutes: 60 }),
      'toutes les heures'
    )
    // Et une source d'avant CC-59, dont le mode n'a jamais été chargé, reste lisible.
    assert.equal(formatSchedule({ fetchIntervalMinutes: 30 }), 'toutes les 30 minutes')
  })
})
