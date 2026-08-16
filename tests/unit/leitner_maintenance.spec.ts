import { test } from '@japa/runner'
import {
  MAINTENANCE_LADDER_DAYS,
  maintenanceIntervalDays,
} from '#modules/leitner/services/leitner_maintenance'

/**
 * L'**échelle d'entretien** (CC-261), code pur sans base ni horloge — c'est ce qui permet
 * d'éprouver « un an » sans attendre un an.
 *
 * ⚠️ **Les deux cas qui portent le fichier sont les extrêmes du réglage**, pas le défaut :
 * à `box5Days = 365` c'est le réglage qui écrase toute l'échelle, à `1` c'est l'échelle
 * qui domine partout. Le défaut étant 30, un test au seul défaut n'éprouverait ni le
 * `Math.max` ni son absence.
 */
test.group('Leitner / échelle d’entretien', () => {
  test('l’échelle croît puis se répète : 90, 180, 365, 365…', async ({ assert }) => {
    // Le réglage par défaut (30 j) est sous tous les paliers : l'échelle passe telle
    // quelle, et c'est le cas nominal.
    assert.strictEqual(maintenanceIntervalDays(0, 30), 90)
    assert.strictEqual(maintenanceIntervalDays(1, 30), 180)
    assert.strictEqual(maintenanceIntervalDays(2, 30), 365)
    // ⚠️ Le dernier palier se **répète**, il ne s'échappe pas : c'est ce qui garantit au
    // moins une vérification par an, donc que « maîtrisée » reste une affirmation
    // contrôlée.
    assert.strictEqual(maintenanceIntervalDays(3, 30), 365)
    assert.strictEqual(maintenanceIntervalDays(10, 30), 365)
  })

  test('un réglage court ne raccourcit rien : l’échelle domine', async ({ assert }) => {
    // `box5Days = 1` est la borne basse autorisée. Une carte acquise ne doit pas revenir
    // demain sous prétexte que les cartes en cours, elles, reviennent tous les jours.
    assert.strictEqual(maintenanceIntervalDays(0, 1), 90)
    assert.strictEqual(maintenanceIntervalDays(1, 1), 180)
    assert.strictEqual(maintenanceIntervalDays(2, 1), 365)
    assert.strictEqual(maintenanceIntervalDays(10, 1), 365)
  })

  test('un réglage long écrase l’échelle : jamais plus souvent qu’une carte en cours', async ({
    assert,
  }) => {
    // ⚠️ **Le test qui porte le lot.** À la borne haute (365 j), un palier fixe à 90
    // ferait revenir une carte **maîtrisée** quatre fois plus souvent qu'une carte encore
    // en apprentissage — absurde, et invisible tant que personne ne pousse le réglage.
    // Sans le `Math.max`, les deux premières assertions rendraient 90 et 180.
    assert.strictEqual(maintenanceIntervalDays(0, 365), 365)
    assert.strictEqual(maintenanceIntervalDays(1, 365), 365)
    assert.strictEqual(maintenanceIntervalDays(2, 365), 365)
    assert.strictEqual(maintenanceIntervalDays(10, 365), 365)
  })

  test('un rang aberrant retombe sur le premier palier, jamais sur `undefined`', async ({
    assert,
  }) => {
    // Le rang vient d'un `count(*)`, il ne devrait jamais être négatif — mais un
    // `MAINTENANCE_LADDER_DAYS[-1]` rendrait `undefined`, et
    // `plus({ days: undefined })` de Luxon rend une date **valide** à +0 jour : la carte
    // serait due aujourd'hui, indéfiniment, sans exception ni log. Même piège que la
    // boîte 12 de l'import.
    assert.strictEqual(maintenanceIntervalDays(-1, 30), 90)
    assert.strictEqual(maintenanceIntervalDays(-99, 30), 90)
    // Un rang non entier ne doit pas non plus sortir de la table.
    assert.strictEqual(maintenanceIntervalDays(1.7, 30), 180)
  })

  test('l’échelle est plafonnée à un an', async ({ assert }) => {
    // Le plancher du fichier : si quelqu'un ajoute un palier au-delà de 365, cette
    // assertion le lui dit — « au moins une vérification par an » est la promesse, pas un
    // effet de bord de la liste actuelle.
    assert.strictEqual(Math.max(...MAINTENANCE_LADDER_DAYS), 365)
    assert.deepEqual([...MAINTENANCE_LADDER_DAYS], [90, 180, 365])
  })
})
