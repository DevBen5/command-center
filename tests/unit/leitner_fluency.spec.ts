import { test } from '@japa/runner'
import {
  FAST_RATIO,
  type FluencyMeasure,
  isUsableMeasure,
  MAX_THINKING_MS,
  MIN_BOX_SAMPLES,
  MIN_CARD_SAMPLES,
  MIN_REFERENCE_MS,
  pickReference,
  refineGrade,
  SLOW_RATIO,
} from '#modules/leitner/services/leitner_fluency'

/**
 * La fluence est **le cœur du lot**, et elle se prouve ici : du code pur, sans base,
 * sans horloge, sans DOM — donc le seul endroit où les trois conditions du ticket
 * s'asserttent vraiment. Le chronométrage lui-même vit dans `pages/index.vue`, que ce
 * dépôt ne sait pas tester (aucun test de composant Vue) : c'est précisément pour ça
 * que la page ne décide de rien et que tout est ici.
 *
 * Ce que ces tests enterrent, dans l'ordre d'importance :
 *
 * 1. **Une carte re-présentée promue sur sa vitesse.** `again` la redonne quelques
 *    minutes plus tard : la seconde réponse est rapide par mémoire de travail, pas par
 *    apprentissage. Proposer `easy` reviendrait à promouvoir ce qu'on vient de rater.
 * 2. **Une interruption prise pour de la lenteur.** Le téléphone sonne, huit secondes
 *    deviennent quatre cents — et on proposerait `hard` sur une carte parfaitement sue.
 * 3. **Une proposition affinée sans référence.** Sans historique, il n'y a rien à
 *    comparer : le lot doit être indiscernable de son absence.
 */

/** 10 s de médiane : les seuils tombent à 6 s (rapide) et 16 s (lent). */
const REFERENCE = 10_000

function measure(overrides: Partial<FluencyMeasure> = {}): FluencyMeasure {
  return { thinkingMs: 10_000, interrupted: false, represented: false, ...overrides }
}

test.group('Leitner / fluence — la proposition affinée', () => {
  test('juste + très rapide propose `easy`, juste + lent propose `hard`', ({ assert }) => {
    const fast = refineGrade('juste', 'good', measure({ thinkingMs: 3_000 }), REFERENCE)
    const slow = refineGrade('juste', 'good', measure({ thinkingMs: 30_000 }), REFERENCE)
    const normal = refineGrade('juste', 'good', measure({ thinkingMs: 10_000 }), REFERENCE)

    // Les trois nuances que le juge ne distingue pas : pour lui, les trois sont « juste ».
    assert.equal(fast, 'easy')
    assert.equal(slow, 'hard')
    assert.equal(normal, 'good')
  })

  test('les deux bornes tombent du bon côté', ({ assert }) => {
    const atFast = REFERENCE * FAST_RATIO
    const atSlow = REFERENCE * SLOW_RATIO

    // Les comparaisons sont larges : la borne elle-même bascule.
    assert.equal(refineGrade('juste', 'good', measure({ thinkingMs: atFast }), REFERENCE), 'easy')
    assert.equal(refineGrade('juste', 'good', measure({ thinkingMs: atSlow }), REFERENCE), 'hard')
    assert.equal(
      refineGrade('juste', 'good', measure({ thinkingMs: atFast + 1 }), REFERENCE),
      'good'
    )
    assert.equal(
      refineGrade('juste', 'good', measure({ thinkingMs: atSlow - 1 }), REFERENCE),
      'good'
    )
  })

  test('la fluence ne remonte JAMAIS un verdict qui n’est pas « juste »', ({ assert }) => {
    // ⚠️ Le test qui borne le lot. Une réponse fausse ou incomplète rendue en une
    // seconde reste fausse ou incomplète : la vitesse ne dit rien de la justesse, et
    // laisser le chrono remonter un `partiel` ferait promouvoir une carte mal sue.
    const instant = measure({ thinkingMs: 200 })

    assert.equal(refineGrade('partiel', 'hard', instant, REFERENCE), 'hard')
    assert.equal(refineGrade('faux', 'again', instant, REFERENCE), 'again')
    // `again` reste hors d'atteinte du timer, dans les deux sens.
    assert.equal(refineGrade('faux', 'again', measure({ thinkingMs: 90_000 }), REFERENCE), 'again')
  })

  test('sans référence, la proposition est exactement celle du juge', ({ assert }) => {
    // Le comportement des premières semaines : aucune donnée, donc rien à comparer. Ça
    // doit être **indiscernable** de l'absence de ce lot — pas un badge, pas un message.
    assert.equal(refineGrade('juste', 'good', measure({ thinkingMs: 200 }), null), 'good')
    assert.isNull(refineGrade(null, null, measure({ thinkingMs: 200 }), null))
  })

  test('une carte re-présentée dans la journée n’est jamais proposée `easy`', ({ assert }) => {
    // ⚠️ Le premier critère de succès du ticket. Depuis CC-41, `again` redonne la carte
    // quelques minutes plus tard : la seconde réponse est rapide par mémoire de travail,
    // pas par apprentissage. On retombe sur la présélection de CC-43.
    const grade = refineGrade(
      'juste',
      'good',
      measure({ thinkingMs: 300, represented: true }),
      REFERENCE
    )

    assert.equal(grade, 'good')
  })

  test('une perte de focus écarte la mesure au lieu de proposer `hard`', ({ assert }) => {
    // ⚠️ Le troisième critère du ticket. Le téléphone sonne pendant la réflexion : sans
    // ce garde-fou, une carte parfaitement sue se verrait proposer « Difficile ».
    //
    // ⚠️ **40 s, et surtout PAS 400 s** : au-delà de `MAX_THINKING_MS` le plafond
    // écarterait déjà la mesure tout seul, et ce test passerait même en supprimant
    // `interrupted` de `isUsableMeasure` — il ne prouverait rien. Ici la mesure est
    // parfaitement plausible (40 s ≥ 1,6 × 10 s), donc c'est bien l'interruption, et
    // elle seule, qui empêche le `hard`.
    const grade = refineGrade(
      'juste',
      'good',
      measure({ thinkingMs: 40_000, interrupted: true }),
      REFERENCE
    )

    assert.equal(grade, 'good')
    // La preuve que le scénario est réel : sans le drapeau, la même mesure dit `hard`.
    assert.equal(refineGrade('juste', 'good', measure({ thinkingMs: 40_000 }), REFERENCE), 'hard')
  })

  test('une interruption écarte aussi une mesure qui aurait valu `easy`', ({ assert }) => {
    // Le garde-fou ne joue pas que contre les faux `hard` : une carte présentée dans un
    // onglet masqué puis retrouvée n'a pas non plus mérité une promotion de deux boîtes.
    assert.equal(
      refineGrade('juste', 'good', measure({ thinkingMs: 1_000, interrupted: true }), REFERENCE),
      'good'
    )
  })

  test('au-delà du plafond, la mesure est écartée — jamais lue comme de la lenteur', ({
    assert,
  }) => {
    // Le filet qui attrape ce qu'aucun événement de navigateur ne dit : l'utilisateur
    // qui se détourne simplement de son écran. `visibilitychange` ne se déclenche pas,
    // `blur` non plus — seul ce plafond reste.
    const grade = refineGrade(
      'juste',
      'good',
      measure({ thinkingMs: MAX_THINKING_MS + 1 }),
      REFERENCE
    )

    assert.equal(grade, 'good')
    // Juste sous le plafond, en revanche, la mesure compte toujours.
    assert.equal(
      refineGrade('juste', 'good', measure({ thinkingMs: MAX_THINKING_MS }), 200_000),
      'easy'
    )
  })

  test('une réponse non chronométrée ne propose rien d’affiné', ({ assert }) => {
    assert.equal(refineGrade('juste', 'good', measure({ thinkingMs: null }), REFERENCE), 'good')
  })

  test('une horloge reculée ne passe pas pour un rappel instantané', ({ assert }) => {
    // La page écrête déjà à 0, mais le service est public : une durée négative arrivant
    // par un autre chemin doit être écartée, pas lue comme « répondu en un éclair ».
    assert.isFalse(isUsableMeasure(measure({ thinkingMs: -5_000 })))
    assert.equal(refineGrade('juste', 'good', measure({ thinkingMs: -5_000 }), REFERENCE), 'good')
  })
})

test.group('Leitner / fluence — le choix de la référence', () => {
  const enough = (count: number, value: number) => Array.from({ length: count }, () => value)

  test('la carte est sa propre référence dès qu’elle se connaît assez', ({ assert }) => {
    // ⚠️ C'est tout l'intérêt du seuil relatif : 10 s sont rapides pour « explique le
    // théorème CAP » et très lentes pour « quel port pour Postgres ». La carte d'abord.
    const reference = pickReference(
      enough(MIN_CARD_SAMPLES, 8_000),
      enough(MIN_BOX_SAMPLES, 30_000)
    )

    assert.equal(reference, 8_000)
  })

  test('sa boîte prend le relais tant qu’elle ne se connaît pas', ({ assert }) => {
    const reference = pickReference(
      enough(MIN_CARD_SAMPLES - 1, 8_000),
      enough(MIN_BOX_SAMPLES, 30_000)
    )

    assert.equal(reference, 30_000)
  })

  test('trop peu de mesures partout : aucune référence, donc aucun raffinement', ({ assert }) => {
    assert.isNull(
      pickReference(enough(MIN_CARD_SAMPLES - 1, 8_000), enough(MIN_BOX_SAMPLES - 1, 30_000))
    )
    assert.isNull(pickReference([], []))
  })

  test('une référence trop courte est refusée, quelle qu’en soit la quantité', ({ assert }) => {
    // ⚠️ Le garde-fou qui ne vient pas du ticket mais de l'arithmétique des ratios : sur
    // une carte répondue en 1,5 s, les seuils tomberaient à 0,9 s et 2,4 s — on
    // classerait `easy` ou `hard` sur du bruit de frappe. Il n'y a pas de nuance à
    // récupérer là.
    assert.isNull(pickReference(enough(50, MIN_REFERENCE_MS - 1), []))
    assert.equal(pickReference(enough(50, MIN_REFERENCE_MS), []), MIN_REFERENCE_MS)
  })

  test('la référence est une médiane, pas une moyenne', ({ assert }) => {
    // Une seule mesure aberrante (un aller-retour à la machine à café) écraserait une
    // moyenne. Elle laisse la médiane où elle est — c'est déjà le raisonnement des
    // stats d'effort, et `median` porte aussi le tri numérique qui évite `[10, 100, 9]`.
    assert.equal(pickReference([9_000, 10_000, 100_000, 9_500, 10_500], []), 10_000)
  })
})
