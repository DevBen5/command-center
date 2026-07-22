import { test } from '@japa/runner'
import { readFile } from 'node:fs/promises'
import {
  MEASURE_MAX_MS,
  boxIntervalLabel,
  dueLabel,
  duration,
  fluencyMeasure,
  type FluencyState,
} from '#modules/leitner/shared/review_page'

/*
|--------------------------------------------------------------------------
| CC-60 — l'écran de révision : écrêtage, mesure, libellés
|--------------------------------------------------------------------------
| `MEASURE_MAX_MS` était déclaré DEUX fois : dans `services/leitner_fluency.ts`
| (importé par le validateur) et dans `pages/index.vue`, hors de portée de Japa.
| Baisser le plafond serveur sans toucher la copie faisait poster une mesure hors
| borne — `POST /review` en 422, et l'utilisateur cliquait une note sans que rien
| ne se passe. Aucune erreur visible, aucun test rouge.
|
| ⚠️ Ce que ces tests ne voient PAS : le chronométrage lui-même (`visibilitychange`,
| `blur`, la remise à zéro entre deux cartes) et l'enveloppe de la page. Ça reste au
| navigateur — noter « À revoir » sur la dernière carte due, et voir l'écran repartir vierge.
*/

function state(over: Partial<FluencyState> = {}): FluencyState {
  return { presentedAt: 1_000, firstInputAt: null, revealedAt: null, interrupted: false, ...over }
}

test.group('Leitner — écrêtage d’une durée', () => {
  test('une durée normale passe telle quelle', ({ assert }) => {
    assert.equal(duration(1_000, 9_000), 8_000)
    assert.equal(duration(1_000, 1_000), 0)
  })

  test('une durée négative se rend null, JAMAIS 0', ({ assert }) => {
    /*
     * Une correction NTP ou une reprise de machine virtuelle recule l'horloge entre
     * l'affichage et la frappe. Ramener ça à zéro donnerait la MEILLEURE valeur possible :
     * `easy` proposé, et un `0` écrit en base qui tirerait la médiane de la carte vers le bas
     * durablement. Une mesure qu'on n'a pas ne vaut pas zéro.
     */
    assert.isNull(duration(9_000, 1_000))
    assert.notStrictEqual(duration(9_000, 1_000), 0)
  })

  test('une durée absurde est écrêtée au plafond de transport', ({ assert }) => {
    // Un onglet laissé ouvert trois heures : envoyé tel quel, le validateur refuse → 422.
    assert.equal(duration(0, 11_000_000), MEASURE_MAX_MS)
  })
})

test.group('Leitner — la mesure transmise', () => {
  test('rien de tapé → aucun temps de réflexion, mais un temps total', ({ assert }) => {
    // ⚠️ C'est cette ABSENCE qui vaut « non mesurable » — la règle serveur la lit ainsi.
    const measure = fluencyMeasure(state({ firstInputAt: null }), 5_000)

    assert.isNull(measure.thinkingMs)
    assert.equal(measure.totalMs, 4_000)
  })

  test('le dévoilement fige le temps total — `now` ne sert plus', ({ assert }) => {
    const measure = fluencyMeasure(state({ firstInputAt: 3_000, revealedAt: 9_000 }), 99_999_999)

    assert.equal(measure.thinkingMs, 2_000)
    // Sans ce figeage, le total inclurait la lecture du verso : deux choses dans une colonne.
    assert.equal(measure.totalMs, 8_000)
  })

  test('l’interruption est transmise telle quelle — la page ne conclut rien', ({ assert }) => {
    assert.isTrue(fluencyMeasure(state({ interrupted: true }), 5_000).interrupted)
    assert.isFalse(fluencyMeasure(state({ interrupted: false }), 5_000).interrupted)
  })

  test('une horloge qui recule ne fabrique pas une mesure parfaite', ({ assert }) => {
    const measure = fluencyMeasure(state({ presentedAt: 9_000, firstInputAt: 1_000 }), 9_500)

    assert.isNull(measure.thinkingMs)
  })
})

test.group('Leitner — libellés d’échéance', () => {
  test('le singulier se dit sans le nombre', ({ assert }) => {
    // Du wording, mais il régresse en silence — d'où son test.
    assert.equal(boxIntervalLabel({ 1: 1 }, 1), 'tous les jours')
    assert.equal(dueLabel({ 1: 1 }, 1), 'demain')
  })

  test('au-delà d’un jour, le nombre s’affiche', ({ assert }) => {
    const intervals = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 }

    assert.equal(boxIntervalLabel(intervals, 3), 'tous les 4 j')
    assert.equal(dueLabel(intervals, 5), 'dans 30 j')
  })

  test('une boîte sans intervalle réglé retombe sur 0, sans lever', ({ assert }) => {
    // Le cas d'une carte importée en boîte 12 : la grille affiche, elle ne casse pas.
    assert.equal(boxIntervalLabel({ 1: 1 }, 12), 'tous les 0 j')
    assert.equal(dueLabel({ 1: 1 }, 12), 'dans 0 j')
  })
})

/*
|--------------------------------------------------------------------------
| Le garde-fou anti-copie
|--------------------------------------------------------------------------
| Une fois la constante importée, il n'y a plus de copie PAR CONSTRUCTION — mais
| rien n'empêche quelqu'un d'en réécrire une, exactement comme la première fois.
|
| ⚠️ Ce test attrape la RECOPIE LITTÉRALE, pas toute réintroduction : un
| `60 * 60 * 1000` passerait au travers. Ce n'est pas prétendu couvert. Il vise le
| geste réel, qui est le copier-coller.
|
| Effet de bord voulu : si la page est renommée ou déplacée, `readFile` lève et ce
| test rougit bruyamment — ce que `pages.spec.ts` ne sait pas faire.
*/
test.group('Leitner — MEASURE_MAX_MS n’est déclaré qu’une fois', () => {
  test('la page de révision ne redéclare pas le plafond de transport', async ({ assert }) => {
    const page = new URL('../../app/modules/leitner/pages/index.vue', import.meta.url)
    const source = await readFile(page, 'utf-8')

    assert.notInclude(source, '3_600_000')
    assert.notInclude(source, '3600000')
  })
})
