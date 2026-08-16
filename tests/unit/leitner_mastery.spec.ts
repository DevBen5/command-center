import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  MASTERY_MIN_DAYS,
  masteryDelayDays,
  nextMasteryState,
  type MasteryState,
} from '#modules/leitner/services/leitner_mastery'
import type { Grade } from '#modules/leitner/services/leitner_service'

/**
 * Le **critère de maîtrise**, en code pur : ni base, ni horloge. C'est ce qui permet
 * d'éprouver « trente jours se sont écoulés » sans attendre trente jours — et sans
 * conteneur Postgres.
 *
 * ⚠️ **Le défaut de `box5Days` est 30**, donc le plancher `MASTERY_MIN_DAYS` y est
 * **inerte**. Les deux cas qui font la valeur de ce fichier sont donc les extrêmes du
 * réglage : à 1 jour le plancher mord (c'est lui qui protège la définition de
 * « maîtrisée » d'un réglage d'installation qu'on aurait raccourci), à 365 c'est le
 * réglage qui domine.
 */

const NOW = DateTime.fromISO('2026-08-13T10:00:00.000Z')
const NONE: MasteryState = { box5EnteredAt: null, masteredAt: null }

/** Une carte déjà en boîte 5 depuis `days` jours, jamais maîtrisée. */
function inBox5Since(days: number): MasteryState {
  return { box5EnteredAt: NOW.minus({ days }), masteredAt: null }
}

/**
 * Le mouvement de boîte tel que `LeitnerService.nextBox` le produit. Recopié ici à
 * dessein : ce fichier éprouve le **critère**, pas la règle des boîtes (qui a son propre
 * test) — et les deux doivent pouvoir diverger sans qu'un test mente sur l'autre.
 */
function state(
  options: {
    boxBefore?: number
    boxAfter?: number
    grade?: Grade
    current?: MasteryState
    box5Days?: number
    now?: DateTime
  } = {}
) {
  return nextMasteryState({
    boxBefore: options.boxBefore ?? 5,
    boxAfter: options.boxAfter ?? 5,
    grade: options.grade ?? 'good',
    current: options.current ?? NONE,
    box5Days: options.box5Days ?? 30,
    now: options.now ?? NOW,
  })
}

test.group('Leitner / critère de maîtrise', () => {
  test('le délai est le réglage, mais jamais sous le plancher de 30 jours', ({ assert }) => {
    // Réglage raccourci : c'est le plancher qui tient. Sans lui, « maîtrisée » voudrait
    // dire deux choses différentes avant et après qu'on ait touché un réglage
    // d'installation — sur des cartes déjà marquées.
    assert.equal(masteryDelayDays(1), MASTERY_MIN_DAYS)
    // Réglage plus long : c'est lui qui domine, le plancher ne plafonne rien.
    assert.equal(masteryDelayDays(365), 365)
    // Le défaut du module : le plancher est exactement atteint, donc inerte.
    assert.equal(masteryDelayDays(30), 30)
  })

  test('la carte qui vient d’arriver en boîte 5 n’est pas maîtrisée', ({ assert }) => {
    // Condition 1 du critère : elle devait y être **déjà**. C'est ce qui empêche un `easy`
    // depuis la boîte 3 de décréter un acquis sur une carte qu'on n'a jamais tenue.
    const result = state({ boxBefore: 3, boxAfter: 5, grade: 'easy' })

    assert.isNull(result.masteredAt)
    // L'horloge, elle, démarre : c'est l'entrée en boîte 5.
    assert.equal(result.box5EnteredAt?.toISO(), NOW.toISO())
  })

  test('une carte en boîte 5 depuis exactement 30 jours est maîtrisée', ({ assert }) => {
    // La borne est **incluse** : à la seconde près, le délai est écoulé.
    const result = state({ current: inBox5Since(30), grade: 'good' })

    assert.equal(result.masteredAt?.toISO(), NOW.toISO())
  })

  test('un jour de moins ne suffit pas', ({ assert }) => {
    // Le pendant du cas précédent : sans lui, une comparaison trop laxiste passerait au
    // vert sur les deux et la borne ne serait éprouvée nulle part.
    assert.isNull(state({ current: inBox5Since(29), grade: 'good' }).masteredAt)
  })

  test('`box5Days = 1` : le plancher de 30 jours mord', ({ assert }) => {
    // Le cas qui porte le lot. Sans plancher, 2 jours suffiraient ici.
    assert.isNull(state({ current: inBox5Since(2), grade: 'good', box5Days: 1 }).masteredAt)
    assert.isNotNull(state({ current: inBox5Since(30), grade: 'good', box5Days: 1 }).masteredAt)
  })

  test('`box5Days = 365` : c’est le réglage qui commande, pas le plancher', ({ assert }) => {
    assert.isNull(state({ current: inBox5Since(200), grade: 'good', box5Days: 365 }).masteredAt)
    assert.isNotNull(state({ current: inBox5Since(365), grade: 'good', box5Days: 365 }).masteredAt)
  })

  test('`hard` ne valide pas, même après le délai', ({ assert }) => {
    // ⚠️ L'écart assumé avec `retentionRate`, qui compte `hard` comme une réussite : la
    // rétention mesure « l'ai-je retrouvé », la maîtrise « le sais-je solidement ».
    assert.isNull(state({ current: inBox5Since(90), grade: 'hard' }).masteredAt)
  })

  test('`hard` ne réarme PAS l’horloge', ({ assert }) => {
    // Décision explicite : `hard` est une réussite, réarmer serait une punition. C'est la
    // ligne à changer si l'arbitrage bascule — et ce test est celui qui rougirait.
    const entered = NOW.minus({ days: 20 })
    const result = state({ current: { box5EnteredAt: entered, masteredAt: null }, grade: 'hard' })

    assert.equal(result.box5EnteredAt?.toISO(), entered.toISO())
  })

  test('`again` réarme l’horloge et démaîtrise la carte', ({ assert }) => {
    // Le seul chemin qui défait un acquis sans quitter la boîte 5.
    const result = state({
      current: { box5EnteredAt: NOW.minus({ days: 90 }), masteredAt: NOW.minus({ days: 60 }) },
      grade: 'again',
    })

    assert.equal(result.box5EnteredAt?.toISO(), NOW.toISO())
    assert.isNull(result.masteredAt)
  })

  test('le 2ᵉ `hard` d’affilée sort la carte de la boîte 5 : plus d’horloge, plus d’acquis', ({
    assert,
  }) => {
    // Le seul chemin de rétrogradation du module. ⚠️ Sans ce nettoyage, la colonne
    // affirmerait « en boîte 5 depuis X » d'une carte en boîte 1, et tout consommateur qui
    // lirait `box5_entered_at IS NOT NULL` comme « est en boîte 5 » serait faux.
    const result = state({
      boxBefore: 5,
      boxAfter: 1,
      grade: 'hard',
      current: { box5EnteredAt: NOW.minus({ days: 90 }), masteredAt: NOW.minus({ days: 60 }) },
    })

    assert.isNull(result.box5EnteredAt)
    assert.isNull(result.masteredAt)
  })

  test('une carte importée en boîte 5 sans horloge la reçoit, sans être maîtrisée pour autant', ({
    assert,
  }) => {
    // L'import écrit `box` directement depuis le JSON : la carte arrive en boîte 5 sans
    // qu'aucune note ne l'y ait amenée, donc sans horloge. La laisser `null` la rendrait
    // **définitivement** non maîtrisable, en silence.
    const result = state({ current: NONE, grade: 'good' })

    assert.equal(result.box5EnteredAt?.toISO(), NOW.toISO())
    // On ne sait pas quand elle est entrée : on compte à partir de maintenant, donc cette
    // note-ci ne peut pas la valider.
    assert.isNull(result.masteredAt)
  })

  test('la date d’acquisition ne dérive pas sur une réussite suivante', ({ assert }) => {
    // Une date qui avancerait à chaque `good` ne daterait plus rien.
    const acquiseLe = NOW.minus({ days: 45 })
    const result = state({
      current: { box5EnteredAt: NOW.minus({ days: 120 }), masteredAt: acquiseLe },
      grade: 'easy',
    })

    assert.equal(result.masteredAt?.toISO(), acquiseLe.toISO())
  })

  test('`easy` valide comme `good`', ({ assert }) => {
    assert.isNotNull(state({ current: inBox5Since(31), grade: 'easy' }).masteredAt)
  })
})
