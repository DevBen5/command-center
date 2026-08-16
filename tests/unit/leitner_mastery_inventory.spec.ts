import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import {
  groupMasteredByMonth,
  maintenanceDueCount,
  masteredShare,
  masteredThisMonth,
  nextMaintenanceAt,
  type MasteredCard,
} from '#modules/leitner/shared/mastery_inventory'
import {
  dueInLabel,
  gradeHint,
  gradeLabelKey,
  highlightedGrade,
  type GradeOutcome,
} from '#modules/leitner/shared/review_page'
import { splitByMastery } from '#modules/leitner/shared/settings_page'

/**
 * L'**inventaire d'acquis** vu de la page (CC-262) : ce qui se compte, ce qui se regroupe,
 * et la phrase que chaque bouton de note annonce. Code pur — le jour courant est un
 * paramètre, comme partout dans ce module.
 *
 * ⚠️ **Pourquoi ces fonctions sont sorties du `<script setup>` :** un mois décalé d'un
 * jour, un tri inversé, un « dont N ce mois-ci » qui glisse — tout ça reste parfaitement
 * plausible à l'écran, et jsdom ne rend aucune date. Ce qui vit dans `setup` n'est
 * atteignable par aucun exécuteur.
 */
test.group('Leitner / inventaire d’acquis', () => {
  function card(id: number, masteredAt: string, nextReview = '2027-01-01T00:00:00+02:00') {
    return { id, front: `Carte ${id}`, path: 'Cat · Thème', masteredAt, nextReview } as MasteredCard
  }

  test('les acquis se groupent par mois, du plus récent au plus ancien', async ({ assert }) => {
    const months = groupMasteredByMonth([
      card(1, '2026-06-04T10:00:00+02:00'),
      card(2, '2026-08-12T10:00:00+02:00'),
      card(3, '2025-11-30T10:00:00+01:00'),
      card(4, '2026-08-02T10:00:00+02:00'),
    ])

    assert.deepEqual(
      months.map((month) => month.key),
      ['2026-08', '2026-06', '2025-11']
    )
    // ⚠️ **Aucun mois vide** : la liste n'est pas un calendrier. Juillet 2026 n'existe pas
    // ici, et une suite de mois à zéro ferait de l'inventaire un reproche.
    assert.lengthOf(months, 3)
    // Le 1ᵉʳ du mois part avec, c'est lui que la page donne à `Intl`.
    assert.equal(months[0].monthStart, '2026-08-01')
  })

  test('dans un mois, la plus récemment acquise vient en tête', async ({ assert }) => {
    const [august] = groupMasteredByMonth([
      card(1, '2026-08-02T10:00:00+02:00'),
      card(2, '2026-08-28T10:00:00+02:00'),
      card(3, '2026-08-15T10:00:00+02:00'),
    ])

    assert.deepEqual(
      august.cards.map((c) => c.id),
      [2, 3, 1]
    )
  })

  test('« ce mois-ci » est le mois CIVIL, pas les trente derniers jours', async ({ assert }) => {
    const cards = [
      card(1, '2026-08-01T09:00:00+02:00'),
      card(2, '2026-08-16T09:00:00+02:00'),
      // Le 31 juillet est à seize jours, donc « dans les trente derniers » — et pourtant
      // hors du mois courant. C'est exactement la ligne que les deux définitions séparent :
      // un compteur glissant reculerait tout seul demain matin.
      card(3, '2026-07-31T23:00:00+02:00'),
      card(4, '2025-08-16T09:00:00+02:00'),
    ]

    assert.equal(masteredThisMonth(cards, '2026-08-16'), 2)
    // Le 1ᵉʳ du mois suivant, le compteur repart de zéro — sans qu'aucune carte n'ait bougé.
    assert.equal(masteredThisMonth(cards, '2026-09-01'), 0)
  })

  test('l’entretien dû se compte sur l’échéance, bornes incluses', async ({ assert }) => {
    const cards = [
      card(1, '2026-01-01T09:00:00+01:00', '2026-08-10T00:00:00+02:00'),
      // Due aujourd'hui même : elle compte. Le contraire laisserait une carte due
      // aujourd'hui hors du chiffre pendant que la file la présente.
      card(2, '2026-02-01T09:00:00+01:00', '2026-08-16T00:00:00+02:00'),
      card(3, '2026-03-01T09:00:00+01:00', '2026-11-12T00:00:00+01:00'),
    ]

    assert.equal(maintenanceDueCount(cards, '2026-08-16'), 2)
    assert.equal(maintenanceDueCount([], '2026-08-16'), 0)
  })

  test('la prochaine vérification est la plus proche, `null` sans acquis', async ({ assert }) => {
    const cards = [
      card(1, '2026-01-01T09:00:00+01:00', '2026-11-12T00:00:00+01:00'),
      card(2, '2026-02-01T09:00:00+01:00', '2026-09-30T00:00:00+02:00'),
    ]

    assert.equal(nextMaintenanceAt(cards), '2026-09-30T00:00:00+02:00')
    // Sans acquis il n'y a rien à annoncer — et surtout pas une date inventée.
    assert.isNull(nextMaintenanceAt([]))
  })

  test('la part du catalogue rend `null` sur une base vide, jamais 0 %', async ({ assert }) => {
    assert.equal(masteredShare(12, 48), 25)
    assert.equal(masteredShare(0, 48), 0)
    // ⚠️ « 0 % » se lirait comme une mesure (« tu n'as rien appris ») là où il n'y a rien à
    // mesurer. Même règle que la rétention et que les durées de session.
    assert.isNull(masteredShare(0, 0))
  })

  test('le catalogue se partage en deux sections sans rien perdre', async ({ assert }) => {
    const cards = [
      { id: 1, masteredAt: null },
      { id: 2, masteredAt: '2026-08-01T09:00:00+02:00' },
      { id: 3, masteredAt: null },
    ]

    const { inProgress, mastered } = splitByMastery(cards)

    assert.deepEqual(
      inProgress.map((c) => c.id),
      [1, 3]
    )
    assert.deepEqual(
      mastered.map((c) => c.id),
      [2]
    )
    // ⚠️ C'est un partage, jamais un filtre : la somme des deux sections est le tout, sans
    // quoi une carte acquise deviendrait inéditable sur le seul écran qui sert à corriger.
    assert.equal(inProgress.length + mastered.length, cards.length)
    // ⚠️ Et l'ordre reçu du serveur (`id desc`) est conservé dans chaque section : c'est
    // lui que suppose le recalage de défilement après un import (CC-67).
    assert.deepEqual(
      splitByMastery([...cards].reverse()).inProgress.map((c) => c.id),
      [3, 1]
    )
  })
})

/**
 * Les phrases annoncées sous les quatre boutons. Elles rendent une **clé i18n**, jamais un
 * texte : c'est ce qui les garde traduisibles et visibles du test qui exige qu'une clé
 * écrite dans un template existe.
 */
test.group('Leitner / phrase d’un bouton de note', () => {
  const normal = { mastered: false, lastGrade: null }

  test('l’échéance se dit en jours, et zéro se dit « aujourd’hui »', async ({ assert }) => {
    // ⚠️ Zéro est une valeur, pas une absence : c'est le privilège d'`again`, et le bouton
    // doit le promettre. Une chaîne vide ferait disparaître la moitié de la phrase.
    assert.equal(dueInLabel(0), "aujourd'hui")
    assert.equal(dueInLabel(1), 'demain')
    assert.equal(dueInLabel(90), 'dans 90 j')
  })

  test('le cas nominal reste exactement ce qui s’affichait avant CC-262', async ({ assert }) => {
    assert.deepEqual(gradeHint({ grade: 'again', box: 2, mastered: false, days: 0 }, normal), {
      key: 'leitner.index.grade.againHint',
      params: { box: 2 },
    })
    assert.deepEqual(gradeHint({ grade: 'good', box: 3, mastered: false, days: 4 }, normal), {
      key: 'leitner.index.grade.boxDue',
      params: { box: 3, due: 'dans 4 j' },
    })
  })

  test('« 2ᵉ d’affilée » se décide sur la note PRÉCÉDENTE, jamais sur la boîte atteinte', async ({
    assert,
  }) => {
    // ⚠️ Le piège : une carte **déjà** en boîte 1 y reste sur un `hard` isolé. Déduire la
    // rétrogradation d'une boîte 1 en sortie annoncerait « 2ᵉ d'affilée » sur la première.
    assert.equal(
      gradeHint({ grade: 'hard', box: 1, mastered: false, days: 1 }, normal).key,
      'leitner.index.grade.hardHint'
    )
    assert.equal(
      gradeHint(
        { grade: 'hard', box: 1, mastered: false, days: 1 },
        { mastered: false, lastGrade: 'hard' }
      ).key,
      'leitner.index.grade.hardHintDemote'
    )
  })

  test('la note qui acquiert annonce l’entretien', async ({ assert }) => {
    assert.deepEqual(gradeHint({ grade: 'good', box: 5, mastered: true, days: 90 }, normal), {
      key: 'leitner.index.grade.masteredHint',
      params: { due: 'dans 90 j' },
    })
  })

  test('toutes les clés rendues existent dans fr.json', async ({ assert }) => {
    // ⚠️ **La garde qui compense ce que `keys.spec.ts` ne peut pas voir.** Ces clés ne sont
    // écrites dans aucun template — elles sortent d'une fonction —, donc l'extraction
    // statique du châssis ne les atteint pas. Une clé absente s'afficherait **en texte
    // brut** sous un bouton de note, et rien d'autre ne le dirait.
    const fr = JSON.parse(
      await readFile(new URL('../../app/modules/leitner/i18n/fr.json', import.meta.url), 'utf8')
    )

    const cas: Array<
      [GradeOutcome, { mastered: boolean; lastGrade: GradeOutcome['grade'] | null }]
    > = [
      [
        { grade: 'again', box: 2, mastered: false, days: 0 },
        { mastered: false, lastGrade: null },
      ],
      [
        { grade: 'again', box: 5, mastered: false, days: 0 },
        { mastered: true, lastGrade: null },
      ],
      [
        { grade: 'hard', box: 3, mastered: false, days: 4 },
        { mastered: false, lastGrade: null },
      ],
      [
        { grade: 'hard', box: 1, mastered: false, days: 1 },
        { mastered: false, lastGrade: 'hard' },
      ],
      [
        { grade: 'hard', box: 1, mastered: false, days: 1 },
        { mastered: true, lastGrade: 'hard' },
      ],
      [
        { grade: 'good', box: 4, mastered: false, days: 7 },
        { mastered: false, lastGrade: null },
      ],
      [
        { grade: 'good', box: 5, mastered: true, days: 90 },
        { mastered: false, lastGrade: null },
      ],
    ]

    // `leitner.index.grade.xxx` → `index.grade.xxx` : le namespace du module vient du nom
    // de son dossier, il n'est pas dans le fichier.
    const traduction = (key: string) =>
      key
        .replace(/^leitner\./, '')
        .split('.')
        .reduce<any>((noeud, morceau) => noeud?.[morceau], fr)

    for (const [outcome, card] of cas) {
      const { key, params } = gradeHint(outcome, card)
      const valeur = traduction(key)

      assert.isString(valeur, `clé absente de fr.json : ${key}`)
      // ⚠️ Et chaque variable passée doit être **utilisée** par la phrase : un paramètre
      // orphelin est le signe d'une phrase qui a perdu une information en route.
      for (const nom of Object.keys(params)) {
        assert.include(valeur, `{${nom}}`, `${key} ignore le paramètre ${nom}`)
      }
    }

    // ⚠️ **Les LIBELLÉS passent par la même garde** (CC-265) : ils sont calculés eux aussi,
    // donc invisibles de `keys.spec.ts`. Une clé manquante afficherait
    // `leitner.index.grade.stillKnowIt` en toutes lettres **sur le bouton**.
    for (const [outcome, card] of cas) {
      const key = gradeLabelKey(outcome, card)
      assert.isString(traduction(key), `libellé absent de fr.json : ${key}`)
    }
  })

  /**
   * Le libellé d'un bouton (CC-265) — l'entretien **vérifie**, il n'apprend pas : « À
   * revoir / Correct » y seraient les mots de la mauvaise question.
   */
  test('en entretien, les deux boutons disent la vérification, pas l’effort', async ({
    assert,
  }) => {
    const acquise = { mastered: true, lastGrade: null }

    assert.equal(
      gradeLabelKey({ grade: 'again', box: 5, mastered: false, days: 0 }, acquise),
      'leitner.index.grade.lostIt'
    )
    assert.equal(
      gradeLabelKey({ grade: 'good', box: 5, mastered: true, days: 180 }, acquise),
      'leitner.index.grade.stillKnowIt'
    )

    // ⚠️ La file normale garde ses quatre libellés d'origine, au mot près.
    for (const grade of ['again', 'hard', 'good', 'easy'] as const) {
      assert.equal(
        gradeLabelKey({ grade, box: 3, mastered: false, days: 4 }, normal),
        `leitner.index.grade.${grade}`
      )
    }
  })

  test('le libellé se décide sur l’état AVANT la note, jamais sur celui d’après', async ({
    assert,
  }) => {
    // ⚠️ Le piège : `outcome.mastered` d'un `again` d'entretien vaut `false` (la carte sort
    // des acquis). Lu là, le bouton « Je l'ai perdu » se rebaptiserait « À revoir »
    // exactement sur la carte où la distinction compte.
    assert.equal(
      gradeLabelKey({ grade: 'again', box: 5, mastered: false, days: 0 }, { mastered: true }),
      'leitner.index.grade.lostIt'
    )
  })

  /**
   * ⚠️ **Le mode d'échec silencieux ouvert par les deux réponses** (CC-265) : le juge
   * propose `hard` sur un verdict `partiel`, la fluence propose `hard` sur une réponse
   * lente — deux notes sans bouton en entretien. Le surlignage tombait dans le vide.
   */
  test('le surlignage tombe toujours sur un bouton réellement offert', async ({ assert }) => {
    const quatre: GradeOutcome[] = [
      { grade: 'again', box: 2, mastered: false, days: 0 },
      { grade: 'hard', box: 2, mastered: false, days: 2 },
      { grade: 'good', box: 3, mastered: false, days: 4 },
      { grade: 'easy', box: 4, mastered: false, days: 7 },
    ]
    const deux: GradeOutcome[] = [
      { grade: 'again', box: 5, mastered: false, days: 0 },
      { grade: 'good', box: 5, mastered: true, days: 90 },
    ]

    // File normale : comportement **strictement** inchangé — la suggestion gagne toujours,
    // et l'absence de suggestion retombe sur `easy`, comme avant l'arrivée du juge.
    assert.equal(highlightedGrade(quatre, 'hard'), 'hard')
    assert.equal(highlightedGrade(quatre, null), 'easy')

    // Entretien : une suggestion sans bouton désigne « je le sais encore » — les trois
    // notes que le juge pouvait proposer hors `again` disaient toutes « rappelé ».
    assert.equal(highlightedGrade(deux, 'hard'), 'good')
    assert.equal(highlightedGrade(deux, 'easy'), 'good')
    assert.equal(highlightedGrade(deux, null), 'good')
    // Un échec, lui, reste un échec : `again` est offert, il gagne.
    assert.equal(highlightedGrade(deux, 'again'), 'again')

    // Aucune carte : rien à surligner, et surtout pas une note inventée.
    assert.isNull(highlightedGrade([], 'good'))
  })

  test('sur un acquis, `again` dit la SORTIE des acquis, pas « reste boîte 5 »', async ({
    assert,
  }) => {
    // C'est la phrase la plus importante de l'écran d'entretien : sans elle, l'utilisateur
    // croit remettre la carte dans la session alors qu'il perd un acquis.
    assert.equal(
      gradeHint(
        { grade: 'again', box: 5, mastered: false, days: 0 },
        { mastered: true, lastGrade: null }
      ).key,
      'leitner.index.grade.lostMasteryAgain'
    )
    // Et le 2ᵉ `hard` sur un acquis dit les deux effets d'un coup : boîte 1 **et** sortie.
    assert.deepEqual(
      gradeHint(
        { grade: 'hard', box: 1, mastered: false, days: 1 },
        { mastered: true, lastGrade: 'hard' }
      ),
      { key: 'leitner.index.grade.lostMasteryHint', params: { box: 1, due: 'demain' } }
    )
  })
})
