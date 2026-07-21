import { test } from '@japa/runner'
import {
  boundsHint,
  isDraftValid,
  isScheduleDirty,
  schedulePayload,
  switchUnit,
  type ScheduleDraft,
  type StoredSchedule,
} from '#modules/veille/shared/schedule_draft'

/*
|--------------------------------------------------------------------------
| CC-60 — le brouillon de cadence de `pages/sources.vue`
|--------------------------------------------------------------------------
| Ces fonctions vivaient dans le `<script setup>`, donc hors de portée de Japa —
| qui importe des `.ts` et n'a aucun compilateur Vue. Elles décident si un
| enregistrement part, sous quelle forme, et si le bouton *Enregistrer* existe :
| leurs régressions sont muettes. Aucune n'a changé de comportement en déménageant.
|
| ⚠️ Ce que ces tests ne voient PAS : le template. Un `v-model` mal branché, un
| `@change` sur le mauvais élément, et l'enveloppe `isScheduleDirty` de la page —
| la couture que l'extraction crée. Ça se vérifie au navigateur.
*/

function draft(over: Partial<ScheduleDraft> = {}): ScheduleDraft {
  return { scheduleMode: 'interval', interval: 1, intervalUnit: 'hours', dailyAt: '07:00', ...over }
}

function stored(over: Partial<StoredSchedule> = {}): StoredSchedule {
  return { scheduleMode: 'interval', dailyAt: null, fetchIntervalMinutes: 60, ...over }
}

test.group('Veille — brouillon de cadence : validité', () => {
  test('en mode intervalle, les bornes de l’unité s’appliquent', ({ assert }) => {
    assert.isTrue(isDraftValid(draft({ interval: 1, intervalUnit: 'days' })))
    assert.isTrue(isDraftValid(draft({ interval: 7, intervalUnit: 'days' })))
    // 8 jours = 11 520 minutes, au-dessus du plafond de 7 jours.
    assert.isFalse(isDraftValid(draft({ interval: 8, intervalUnit: 'days' })))
    // 5 minutes est le plancher : en dessous, on martèle un serveur tiers pour rien.
    assert.isFalse(isDraftValid(draft({ interval: 4, intervalUnit: 'minutes' })))
    assert.isTrue(isDraftValid(draft({ interval: 5, intervalUnit: 'minutes' })))
  })

  test('une durée non entière est refusée — pas d’arrondi silencieux sur une cadence', ({
    assert,
  }) => {
    assert.isFalse(isDraftValid(draft({ interval: 1.5, intervalUnit: 'hours' })))
  })

  test('en mode horaire, seule l’heure compte — un intervalle hors bornes ne bloque pas', ({
    assert,
  }) => {
    // Les deux modes coexistent dans le brouillon : basculer ne doit pas effacer l'autre.
    const daily = draft({ scheduleMode: 'daily', interval: 9999, dailyAt: '07:00' })
    assert.isTrue(isDraftValid(daily))

    assert.isFalse(isDraftValid(draft({ scheduleMode: 'daily', dailyAt: '' })))
    assert.isFalse(isDraftValid(draft({ scheduleMode: 'daily', dailyAt: '25:00' })))
  })
})

test.group('Veille — brouillon de cadence : payload', () => {
  test('le mode horaire ne poste QUE son heure', ({ assert }) => {
    const payload = schedulePayload(draft({ scheduleMode: 'daily', dailyAt: '07:30' }))

    assert.deepEqual(payload, { scheduleMode: 'daily', dailyAt: '07:30' })
    // Poster un intervalle avec un mode horaire enregistrerait un réglage inerte —
    // affiché comme saisi, jamais appliqué. Le validateur le refuse d'ailleurs.
    assert.notProperty(payload, 'interval')
    assert.notProperty(payload, 'intervalUnit')
  })

  test('le mode intervalle ne poste QUE sa durée, et ne convertit jamais', ({ assert }) => {
    const payload = schedulePayload(draft({ interval: 2, intervalUnit: 'days' }))

    // ⚠️ L'unité voyage telle quelle : c'est `resolveIntervalMinutes` qui fait les minutes.
    // Convertir ici ne laisserait au serveur qu'un nombre, sans moyen de re-valider le sens.
    assert.deepEqual(payload, { scheduleMode: 'interval', interval: 2, intervalUnit: 'days' })
    assert.notProperty(payload, 'dailyAt')
  })
})

test.group('Veille — brouillon de cadence : changement d’unité', () => {
  test('une durée qui tombe juste est convertie', ({ assert }) => {
    const d = draft({ interval: 60, intervalUnit: 'minutes' })
    switchUnit(d, 'hours')

    assert.deepEqual({ interval: d.interval, unit: d.intervalUnit }, { interval: 1, unit: 'hours' })
  })

  test('une durée qui ne tombe pas juste garde son nombre — jamais d’arrondi', ({ assert }) => {
    // 90 minutes ne font pas un compte rond d'heures : « 1,5 heure » se saisit en 90 minutes.
    const d = draft({ interval: 90, intervalUnit: 'minutes' })
    switchUnit(d, 'hours')

    assert.deepEqual(
      { interval: d.interval, unit: d.intervalUnit },
      { interval: 90, unit: 'hours' }
    )
  })
})

test.group('Veille — brouillon de cadence : bornes affichées', () => {
  test('la règle est dite dans l’unité saisie', ({ assert }) => {
    assert.equal(boundsHint('days'), 'de 1 à 7 jours')
    assert.equal(boundsHint('hours'), 'de 1 à 168 heures')
    assert.equal(boundsHint('minutes'), 'de 5 à 10080 minutes')
  })
})

/*
|--------------------------------------------------------------------------
| `isScheduleDirty` — le mode d'échec silencieux que ce lot existe pour couvrir
|--------------------------------------------------------------------------
| Postgres rend `'07:00:00'`, le champ manipule `'07:00'`. Sans la normalisation
| de la valeur STOCKÉE, la comparaison est TOUJOURS vraie et le bouton
| *Enregistrer* ne disparaît jamais. Normaliser du mauvais côté produit l'inverse :
| le bouton n'apparaît jamais, et la cadence devient non modifiable.
|
| Dans les deux cas : typecheck vert, lint vert, build vert, suite fonctionnelle
| verte. Ça ne se voit qu'en ouvrant la page et en cliquant — d'où ces deux tests.
*/
test.group('Veille — cadence modifiée ?', () => {
  test('l’heure du driver pg et celle du champ sont la MÊME heure', ({ assert }) => {
    const source = stored({ scheduleMode: 'daily', dailyAt: '07:00:00' })

    // Le test qui porte le lot : retire `normalizeTimeOfDay` de `isScheduleDirty` et il rougit.
    assert.isFalse(isScheduleDirty(draft({ scheduleMode: 'daily', dailyAt: '07:00' }), source))
  })

  test('une heure réellement changée est bien vue', ({ assert }) => {
    const source = stored({ scheduleMode: 'daily', dailyAt: '07:00:00' })

    // Le pendant du précédent : normaliser des DEUX côtés le ferait rougir, lui.
    assert.isTrue(isScheduleDirty(draft({ scheduleMode: 'daily', dailyAt: '08:00' }), source))
  })

  test('changer de mode suffit, même à valeurs identiques', ({ assert }) => {
    const source = stored({ scheduleMode: 'interval', fetchIntervalMinutes: 60 })

    assert.isTrue(isScheduleDirty(draft({ scheduleMode: 'daily', interval: 1 }), source))
  })

  test('la durée est comparée en minutes, pas dans l’unité saisie', ({ assert }) => {
    const source = stored({ fetchIntervalMinutes: 60 })

    // 1 heure et 60 minutes sont la même cadence : rien à enregistrer.
    assert.isFalse(isScheduleDirty(draft({ interval: 1, intervalUnit: 'hours' }), source))
    assert.isFalse(isScheduleDirty(draft({ interval: 60, intervalUnit: 'minutes' }), source))
    assert.isTrue(isScheduleDirty(draft({ interval: 2, intervalUnit: 'hours' }), source))
  })
})
