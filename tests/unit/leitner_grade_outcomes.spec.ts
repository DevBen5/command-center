import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import { gradeOutcomes, nextBox } from '#modules/leitner/services/leitner_grade_outcomes'
import type { GradeOutcome } from '#modules/leitner/services/leitner_grade_outcomes'

/**
 * **Ce que chaque note va faire** (CC-262) — la sortie que l'écran de révision annonce
 * sous ses quatre boutons, code pur sans base ni horloge.
 *
 * ⚠️ **Ce que ce fichier garde, et que rien d'autre ne peut garder** : l'écran promettait
 * une échéance qu'il calculait lui-même, dans un `<script setup>` hors de portée de tout
 * exécuteur. Depuis CC-261 cette promesse était **fausse** sur la note la plus importante
 * du module — celle qui acquiert une carte, annoncée « boîte 5 · dans 30 j » alors qu'elle
 * repart pour 90. Aucun test d'apparence n'aurait pu le voir : jsdom ne lit pas les
 * libellés, et le chiffre restait parfaitement plausible.
 */
test.group('Leitner / effets d’une note', () => {
  const INTERVALS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 }
  const NOW = DateTime.fromISO('2026-08-16T12:00:00')

  function outcomes(
    input: Partial<Parameters<typeof gradeOutcomes>[0]> = {}
  ): Record<string, GradeOutcome> {
    const list = gradeOutcomes({
      box: 1,
      lastGrade: null,
      mastery: { box5EnteredAt: null, masteredAt: null },
      maintenanceRank: 0,
      boxIntervals: INTERVALS,
      now: NOW,
      ...input,
    })
    return Object.fromEntries(list.map((outcome) => [outcome.grade, outcome]))
  }

  test('le cas nominal : la boîte monte, l’échéance suit l’intervalle réglé', async ({
    assert,
  }) => {
    const effects = outcomes({ box: 2 })

    // `again` ne rétrograde pas et laisse la carte due le jour même — le seul cas à 0 j.
    assert.deepEqual(effects.again, { grade: 'again', box: 2, mastered: false, days: 0 })
    // `hard` isolé ne bouge pas la boîte.
    assert.deepEqual(effects.hard, { grade: 'hard', box: 2, mastered: false, days: 2 })
    assert.deepEqual(effects.good, { grade: 'good', box: 3, mastered: false, days: 4 })
    // `easy` saute deux boîtes.
    assert.deepEqual(effects.easy, { grade: 'easy', box: 4, mastered: false, days: 7 })
  })

  test('le 2ᵉ `hard` d’affilée ramène en boîte 1', async ({ assert }) => {
    const effects = outcomes({ box: 4, lastGrade: 'hard' })

    assert.equal(effects.hard.box, 1)
    assert.equal(effects.hard.days, INTERVALS[1])
    // Et lui seul : les trois autres notes ignorent la note précédente.
    assert.equal(effects.good.box, 5)
  })

  test('la boîte est plafonnée à 5, jamais 6', async ({ assert }) => {
    const effects = outcomes({ box: 5 })

    assert.equal(effects.good.box, 5)
    assert.equal(effects.easy.box, 5)
  })

  /**
   * ⚠️ **Le cœur du fichier.** Sans la règle partagée, ces deux notes annonçaient l'un des
   * intervalles de boîte (30 j) au lieu du premier palier d'entretien (90 j).
   */
  test('la note qui ACQUIERT annonce l’entretien, pas la boîte 5', async ({ assert }) => {
    const effects = outcomes({
      box: 5,
      // En boîte 5 depuis 40 jours : le délai de maîtrise (max(30, 30)) est écoulé.
      mastery: { box5EnteredAt: NOW.minus({ days: 40 }), masteredAt: null },
    })

    assert.isTrue(effects.good.mastered)
    assert.equal(effects.good.days, 90, 'premier palier d’entretien, pas les 30 j de la boîte 5')
    assert.isTrue(effects.easy.mastered)
    assert.equal(effects.easy.days, 90)

    // ⚠️ `hard` est une réussite mais **ne valide pas** — écart voulu avec la rétention
    // (CC-260). La carte reste en cours, au rythme de la boîte 5.
    assert.isFalse(effects.hard.mastered)
    assert.equal(effects.hard.days, 30)
    // Et `again` réarme l'horloge : la carte reste en boîte 5, non acquise, due ce jour.
    assert.isFalse(effects.again.mastered)
    assert.equal(effects.again.days, 0)
  })

  test('le délai non écoulé ne donne aucun acquis', async ({ assert }) => {
    const effects = outcomes({
      box: 5,
      // 29 jours : un de moins que le plancher.
      mastery: { box5EnteredAt: NOW.minus({ days: 29 }), masteredAt: null },
    })

    assert.isFalse(effects.good.mastered)
    assert.equal(effects.good.days, 30)
  })

  test('en entretien, l’échéance gravit l’échelle selon le rang', async ({ assert }) => {
    const mastered = {
      box5EnteredAt: NOW.minus({ days: 200 }),
      masteredAt: NOW.minus({ days: 90 }),
    }

    for (const [rank, expected] of [
      [0, 90],
      [1, 180],
      [2, 365],
      // Le dernier palier se répète : au moins une vérification par an, pour toujours.
      [7, 365],
    ] as const) {
      const effects = outcomes({ box: 5, mastery: mastered, maintenanceRank: rank })
      assert.equal(effects.good.days, expected, `rang ${rank}`)
      assert.isTrue(effects.good.mastered)
    }
  })

  /**
   * ⚠️ **Le cœur de CC-265.** Sur une carte acquise, `hard`, `good` et `easy` rendaient un
   * `GradeOutcome` **identique** — le plafond de boîte écrase `+1` et `+2`, et l'échéance
   * vient de l'échelle d'entretien, qui ne lit pas la note. L'écran proposait donc trois
   * boutons pour un seul effet.
   */
  test('en entretien, DEUX réponses seulement — et elles ne font pas la même chose', async ({
    assert,
  }) => {
    const list = gradeOutcomes({
      box: 5,
      lastGrade: null,
      mastery: { box5EnteredAt: NOW.minus({ days: 200 }), masteredAt: NOW.minus({ days: 90 }) },
      maintenanceRank: 1,
      boxIntervals: INTERVALS,
      now: NOW,
    })

    assert.deepEqual(
      list.map((outcome) => outcome.grade),
      ['again', 'good'],
      'du plus sévère au plus généreux, comme les quatre autres'
    )

    // ⚠️ **La mutation que ce bloc existe pour attraper** : rendre les deux sorties
    // identiques (ou rétablir les quatre notes) doit faire rougir ce test nommé. Deux
    // boutons qui produisent le même effet sont exactement le défaut qu'on corrige.
    assert.deepEqual(list[0], { grade: 'again', box: 5, mastered: false, days: 0 })
    assert.deepEqual(list[1], { grade: 'good', box: 5, mastered: true, days: 180 })
    assert.notDeepEqual(list[0], list[1])
  })

  /**
   * ⚠️ **Le motif réel du lot, et il ne se voit que là.** `nextBox` rend
   * `lastGrade === 'hard' ? 1 : box` : un « Difficile » qui suit un « Difficile » renvoyait
   * en boîte 1 **et** faisait perdre l'acquis. Un bouton dont l'effet dépend d'un état que
   * l'écran ne montre pas, sur une file dont les visites sont espacées de 90 à 365 jours.
   */
  test('l’exception cachée du 2ᵉ `hard` n’est plus PROPOSABLE en entretien', async ({ assert }) => {
    const effects = outcomes({
      box: 5,
      lastGrade: 'hard',
      mastery: { box5EnteredAt: NOW.minus({ days: 200 }), masteredAt: NOW.minus({ days: 90 }) },
      maintenanceRank: 2,
    })

    assert.isUndefined(effects.hard, 'aucun bouton ne peut plus déclencher la rétrogradation')
    // Et la note précédente ne contamine pas les deux qui restent : « je le sais encore »
    // conserve l'acquis quoi qu'ait dit la visite d'avant.
    assert.deepEqual(effects.good, { grade: 'good', box: 5, mastered: true, days: 365 })
    assert.isFalse(effects.again.mastered)

    // ⚠️ **La RÈGLE, elle, n'a pas bougé** — ce lot ferme un piège d'écran, pas un
    // comportement de `review()`. `POST /review` accepte toujours `hard` sur une carte
    // acquise, et `nextBox` le traite exactement comme avant. Confondre les deux ferait
    // « réparer » un jour une régression qui n'existe pas.
    assert.equal(nextBox(5, 'hard', 'hard'), 1)
  })

  test('`again` en entretien fait SORTIR des acquis, aujourd’hui', async ({ assert }) => {
    const effects = outcomes({
      box: 5,
      mastery: { box5EnteredAt: NOW.minus({ days: 200 }), masteredAt: NOW.minus({ days: 90 }) },
      maintenanceRank: 1,
    })

    assert.isFalse(effects.again.mastered, 'la dé-maîtrise est le seul effet d’un `again` ici')
    // ⚠️ La boîte ne bouge pas : « `again` ne rétrograde jamais » porte sur `box`, et ce
    // lot ne rouvre pas cette décision.
    assert.equal(effects.again.box, 5)
    assert.equal(effects.again.days, 0)
  })

  test('un réglage extrême de la boîte 5 écrase l’échelle, dans les deux sens', async ({
    assert,
  }) => {
    const mastered = {
      box5EnteredAt: NOW.minus({ days: 400 }),
      masteredAt: NOW.minus({ days: 90 }),
    }

    // Borne haute : une carte acquise ne doit jamais revenir plus souvent qu'une carte en
    // cours d'apprentissage.
    const long = gradeOutcomes({
      box: 5,
      lastGrade: null,
      mastery: mastered,
      maintenanceRank: 0,
      boxIntervals: { ...INTERVALS, 5: 365 },
      now: NOW,
    })
    assert.equal(long.find((o) => o.grade === 'good')!.days, 365)

    // Borne basse : l'échelle domine, une carte acquise ne revient pas demain.
    const short = gradeOutcomes({
      box: 5,
      lastGrade: null,
      mastery: mastered,
      maintenanceRank: 0,
      boxIntervals: { ...INTERVALS, 5: 1 },
      now: NOW,
    })
    assert.equal(short.find((o) => o.grade === 'good')!.days, 90)
  })

  test('le rang ne s’applique QU’À une carte déjà acquise', async ({ assert }) => {
    // Une carte que la note acquiert repart au palier 0, quel que soit le rang passé : son
    // `mastered_at` est posé à l'instant, donc aucune révision ne lui est postérieure.
    // Sans cette borne, une carte ré-acquise après un oubli repartirait à un an.
    const effects = outcomes({
      box: 5,
      mastery: { box5EnteredAt: NOW.minus({ days: 40 }), masteredAt: null },
      maintenanceRank: 5,
    })

    assert.equal(effects.good.days, 90)
  })

  /**
   * ⚠️ **Le pendant obligatoire du test d'entretien** : la file normale garde ses quatre
   * notes, où `again`/`hard`/`good`/`easy` produisent bien quatre effets distincts. Sans
   * les deux mondes dans le même fichier, réduire la file normale à deux boutons passerait
   * au vert.
   */
  test('en file normale, les QUATRE notes sortent, dans l’ordre des boutons', async ({
    assert,
  }) => {
    const list = gradeOutcomes({
      box: 3,
      lastGrade: null,
      mastery: { box5EnteredAt: null, masteredAt: null },
      maintenanceRank: 0,
      boxIntervals: INTERVALS,
      now: NOW,
    })

    assert.deepEqual(
      list.map((outcome) => outcome.grade),
      ['again', 'hard', 'good', 'easy']
    )
    // Quatre effets réellement distincts : c'est ce qui justifie qu'on n'y touche pas.
    assert.equal(new Set(list.map((outcome) => `${outcome.box}/${outcome.days}`)).size, 4)
  })

  /**
   * ⚠️ **La file se DÉDUIT de `mastered_at`, elle ne se passe pas en paramètre.** Les deux
   * files sont disjointes par construction (CC-261) : une carte acquise n'est servie que
   * par l'entretien, une carte non acquise que par la file normale. Un second témoin
   * pourrait contredire celui-là.
   */
  test('c’est l’ACQUIS qui décide du nombre de réponses, pas un drapeau de file', async ({
    assert,
  }) => {
    const enCours = outcomes({ box: 5, mastery: { box5EnteredAt: NOW, masteredAt: null } })
    const acquise = outcomes({ box: 5, mastery: { box5EnteredAt: NOW, masteredAt: NOW } })

    assert.lengthOf(Object.keys(enCours), 4)
    assert.lengthOf(Object.keys(acquise), 2)
  })

  test('`nextBox` reste la règle déplacée, à l’identique', async ({ assert }) => {
    // Le déplacement depuis `LeitnerService` (CC-262) ne devait rien changer : ce test
    // rougirait si la règle de boîte avait bougé au passage.
    assert.equal(nextBox(3, 'again', null), 3)
    assert.equal(nextBox(3, 'hard', null), 3)
    assert.equal(nextBox(3, 'hard', 'hard'), 1)
    assert.equal(nextBox(3, 'good', null), 4)
    assert.equal(nextBox(4, 'easy', null), 5)
    assert.equal(nextBox(5, 'easy', null), 5)
  })
})
