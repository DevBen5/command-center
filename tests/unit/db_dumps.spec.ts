import { test } from '@japa/runner'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  GARDER_PAR_DEFAUT,
  dumpsAPurger,
  listerDumps,
  lireGarder,
  verifierDump,
} from '../../scripts/lib/dumps.js'

/**
 * CC-69 — ce que `db:backup` et `db:restore` décident d'un dump, sans Docker.
 *
 * Ces deux scripts ne sont pas testables : ils parlent à un conteneur Postgres. Mais les
 * deux décisions qui peuvent **détruire des données** en sont extraites, et le sont ici :
 *
 * - la **vérification** dit si un fichier mérite le nom de sauvegarde. Un faux positif
 *   laisse croire qu'on est protégé ; un faux négatif SUPPRIME un dump valide, puisque
 *   `db-backup.js` efface ce qu'il vient d'écrire quand la vérification échoue.
 * - la **purge** choisit quels fichiers disparaissent.
 *
 * Ce sont les seuls endroits du dépôt où une erreur de logique se paie en contenu perdu
 * — et ce contenu est saisi à la main, sans seeder, donc irreproductible.
 */

/** Le bloc de lecture de `contient()`. Dupliqué à dessein : le test doit viser la frontière. */
const BLOC = 64 * 1024

const ENTETE = ['--', '-- PostgreSQL database dump', '--', '', '\\restrict aBcDeF', ''].join('\n')
// ⚠️ Le `\unrestrict` APRÈS le marqueur de fin n'est pas décoratif : c'est ce que `pg_dump`
// écrit réellement (vérifié sur les dumps du dossier `backups/`). Un test qui l'omettrait
// laisserait passer une vérification qui cherche le marqueur « en dernière ligne » — donc
// une vérification qui rejetterait tous les vrais dumps.
const QUEUE = [
  '--',
  '-- PostgreSQL database dump complete',
  '--',
  '',
  '\\unrestrict aBcDeF',
  '',
].join('\n')
const CORPS = 'CREATE TABLE public.leitner_cards (\n    id integer NOT NULL\n);\n'

function dumpComplet() {
  return `${ENTETE}\n${CORPS}\n${QUEUE}`
}

test.group('CC-69 / vérification — un dump complet', (group) => {
  let dossier: string

  group.each.setup(() => {
    dossier = mkdtempSync(join(tmpdir(), 'cc-dumps-'))
    return () => rmSync(dossier, { recursive: true, force: true })
  })

  const ecrire = (nom: string, contenu: string) => {
    const chemin = join(dossier, nom)
    writeFileSync(chemin, contenu)
    return chemin
  }

  test('un dump entier passe, marqueur de fin suivi du \\unrestrict de pg_dump', ({ assert }) => {
    assert.deepEqual(verifierDump(ecrire('plein.sql', dumpComplet())), { ok: true })
  })

  /**
   * **Le faux négatif coûteux.** `contient()` balaye par blocs de 64 Ko ; sans le report de
   * la fin du bloc précédent, un `CREATE TABLE` posé pile sur la frontière serait invisible.
   * `db-backup.js` conclurait « base vide » et supprimerait un dump parfaitement bon — le
   * seul, s'il vient d'être fait.
   */
  test('un CREATE TABLE à cheval sur deux blocs de lecture est trouvé', ({ assert }) => {
    // Le `\n` qui précède `CREATE TABLE ` est placé 3 octets avant la fin du premier bloc :
    // l'aiguille est donc coupée en deux, et aucun bloc lu seul ne la contient.
    const avant = `${ENTETE}\n`
    const rembourrage = '-'.repeat(BLOC - 3 - avant.length)
    const dump = `${avant}${rembourrage}\n${CORPS}\n${QUEUE}`

    assert.isAbove(dump.length, BLOC, 'le dump doit dépasser un bloc pour que le test ait un sens')
    assert.deepEqual(verifierDump(ecrire('gros.sql', dump)), { ok: true })
  })

  test('un dump plus grand que deux blocs passe aussi', ({ assert }) => {
    const dump = `${ENTETE}\n${CORPS}${'-- remplissage\n'.repeat(20_000)}\n${QUEUE}`

    assert.isAbove(dump.length, 2 * BLOC)
    assert.deepEqual(verifierDump(ecrire('tres-gros.sql', dump)), { ok: true })
  })
})

test.group('CC-69 / vérification — ce qui est refusé', (group) => {
  let dossier: string

  group.each.setup(() => {
    dossier = mkdtempSync(join(tmpdir(), 'cc-dumps-'))
    return () => rmSync(dossier, { recursive: true, force: true })
  })

  const ecrire = (nom: string, contenu: string) => {
    const chemin = join(dossier, nom)
    writeFileSync(chemin, contenu)
    return chemin
  }

  /**
   * Le mode d'échec que cette vérification existe pour attraper : disque plein, conteneur
   * tué en plein dump, copie coupée vers le NAS. Le fichier a l'en-tête, il a des tables,
   * il pèse son poids — et il ne peut pas reconstruire la base.
   */
  test('un dump tronqué est refusé, et la raison le nomme', ({ assert }) => {
    const entier = dumpComplet()
    const coupe = entier.slice(0, Math.floor(entier.length * 0.8))

    const { ok, raison } = verifierDump(ecrire('coupe.sql', coupe))
    assert.isFalse(ok)
    assert.include(raison ?? '', 'tronqué')
  })

  /**
   * ⚠️ Le cas le plus sournois : `DB_DATABASE` désigne une base vide (une coquille, ou
   * `app_test` que `npm test` déroule à chaque exécution). `pg_dump` réussit, sort 0, et
   * produit un fichier bien formé de quelques Ko qui ne contient rien.
   */
  test('un dump sans une seule table est refusé, et la raison désigne DB_DATABASE', ({
    assert,
  }) => {
    const { ok, raison } = verifierDump(ecrire('vide-de-tables.sql', `${ENTETE}\n${QUEUE}`))
    assert.isFalse(ok)
    assert.include(raison ?? '', 'DB_DATABASE')
  })

  test('un fichier vide est refusé', ({ assert }) => {
    const { ok, raison } = verifierDump(ecrire('rien.sql', ''))
    assert.isFalse(ok)
    assert.include(raison ?? '', 'vide')
  })

  test("un fichier qui n'est pas un dump pg_dump est refusé", ({ assert }) => {
    const { ok, raison } = verifierDump(ecrire('notes.sql', 'SELECT 1;\n'))
    assert.isFalse(ok)
    assert.include(raison ?? '', 'en-tête')
  })

  test('un chemin inexistant est refusé sans lever', ({ assert }) => {
    const { ok, raison } = verifierDump(join(dossier, 'jamais-ecrit.sql'))
    assert.isFalse(ok)
    assert.include(raison ?? '', 'introuvable')
  })

  /** L'en-tête seul ne suffit pas : c'est le début d'un dump interrompu au premier octet. */
  test("un dump réduit à son en-tête est refusé, pas accepté 'presque bon'", ({ assert }) => {
    assert.isFalse(verifierDump(ecrire('entete-seule.sql', ENTETE)).ok)
  })
})

test.group('CC-69 / listage — ce que la purge accepte de voir', (group) => {
  let dossier: string

  group.each.setup(() => {
    dossier = mkdtempSync(join(tmpdir(), 'cc-dumps-'))
    return () => rmSync(dossier, { recursive: true, force: true })
  })

  /**
   * Le garde-fou de la purge : elle ne supprime que ce que `listerDumps` rend. Un `.sql`
   * déposé là à la main — un export de travail, un dump venu d'ailleurs — doit être
   * invisible pour elle.
   */
  test('seuls les noms produits par db:backup sont listés', ({ assert }) => {
    for (const nom of [
      'command-center-2026-07-20_16h33.sql',
      'command-center-2026-07-21_12h16.sql',
      'notes.sql',
      'command-center.sql',
      'command-center-2026-07-21.sql',
      'command-center-2026-07-21_12h16.sql.part',
      'command-center-2026-07-21_12h16.txt',
      'README.md',
    ]) {
      writeFileSync(join(dossier, nom), 'peu importe')
    }

    assert.deepEqual(listerDumps(dossier), [
      'command-center-2026-07-20_16h33.sql',
      'command-center-2026-07-21_12h16.sql',
    ])
  })

  /** L'horodatage est en tête et de largeur fixe : le tri des noms EST le tri du temps. */
  test('la liste va du plus ancien au plus récent', ({ assert }) => {
    for (const nom of [
      'command-center-2026-07-21_16h23.sql',
      'command-center-2026-07-13_14h20.sql',
      'command-center-2026-07-20_16h07.sql',
      'command-center-2026-07-20_16h33.sql',
    ]) {
      writeFileSync(join(dossier, nom), 'peu importe')
    }

    assert.deepEqual(listerDumps(dossier), [
      'command-center-2026-07-13_14h20.sql',
      'command-center-2026-07-20_16h07.sql',
      'command-center-2026-07-20_16h33.sql',
      'command-center-2026-07-21_16h23.sql',
    ])
  })

  test('un dossier absent rend une liste vide, pas une erreur', ({ assert }) => {
    assert.deepEqual(listerDumps(join(dossier, 'pas-la')), [])
  })
})

test.group('CC-69 / rétention — lire BACKUP_KEEP', () => {
  test('absente ou vide, la valeur par défaut s’applique', ({ assert }) => {
    assert.equal(lireGarder(undefined), GARDER_PAR_DEFAUT)
    assert.equal(lireGarder(''), GARDER_PAR_DEFAUT)
    assert.equal(lireGarder('   '), GARDER_PAR_DEFAUT)
    assert.equal(GARDER_PAR_DEFAUT, 10)
  })

  test('un entier positif est lu tel quel, et 0 est une valeur légitime', ({ assert }) => {
    assert.equal(lireGarder('3'), 3)
    assert.equal(lireGarder('1'), 1)
    assert.equal(lireGarder(' 25 '), 25)
    assert.equal(lireGarder('0'), 0)
  })

  /**
   * ⚠️ **Pourquoi ça LÈVE au lieu de retomber sur un défaut.** `Number('abc')` vaut `NaN`,
   * et une comparaison avec `NaN` est toujours fausse : une lecture laxiste finirait par
   * traiter la valeur comme 0 — c'est-à-dire « ne garder aucun dump ». Une coquille dans
   * `.env` effacerait la totalité des sauvegardes, sans un mot.
   */
  test('une valeur illisible lève — elle ne vaut jamais 0 par accident', ({ assert }) => {
    for (const invalide of ['abc', '-1', '3.5', '1e3', 'dix', '10 dumps']) {
      assert.throws(() => lireGarder(invalide), /BACKUP_KEEP/, `« ${invalide} » a été accepté`)
    }
  })
})

test.group('CC-69 / rétention — choisir ce qui disparaît', () => {
  const dumps = [
    'command-center-2026-07-13_14h20.sql',
    'command-center-2026-07-19_20h02.sql',
    'command-center-2026-07-20_16h33.sql',
    'command-center-2026-07-21_16h23.sql',
  ]

  test('les plus anciens partent, les N derniers restent', ({ assert }) => {
    assert.deepEqual(dumpsAPurger(dumps, 2), [
      'command-center-2026-07-13_14h20.sql',
      'command-center-2026-07-19_20h02.sql',
    ])
    assert.deepEqual(dumpsAPurger(dumps, 1), dumps.slice(0, 3))
  })

  test('garder 0 DÉSACTIVE la purge — ce n’est pas « tout supprimer »', ({ assert }) => {
    assert.deepEqual(dumpsAPurger(dumps, 0), [])
  })

  test('garder autant ou plus que ce qui existe ne supprime rien', ({ assert }) => {
    assert.deepEqual(dumpsAPurger(dumps, 4), [])
    assert.deepEqual(dumpsAPurger(dumps, 10), [])
    assert.deepEqual(dumpsAPurger([], 10), [])
  })

  test('un nombre invalide lève plutôt que de supprimer au hasard', ({ assert }) => {
    for (const invalide of [-1, 1.5, Number.NaN]) {
      assert.throws(() => dumpsAPurger(dumps, invalide), /garder/, `${invalide} a été accepté`)
    }
  })
})
