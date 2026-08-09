import { test } from '@japa/runner'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as age from 'age-encryption'
import testUtils from '@adonisjs/core/services/test_utils'
import { BackupService } from '#core/backup/services/backup_service'
import backupSettings from '#core/backup/services/backup_settings_service'

/**
 * CC-140 — l'ordre des étapes de `BackupService.runBackup()` et l'invariant qui protège le
 * contenu : dump → écriture close → vérification → miroir → purge, et « le miroir échoue ⇒
 * RIEN n'est purgé ». Prouvé par injection de panne sur un runner factice, sans Postgres réel
 * — la vérification/purge elle-même reste couverte par `db_dumps.spec.ts`, inchangé.
 */

const ENTETE = ['--', '-- PostgreSQL database dump', '--', '', '\\restrict aBcDeF', ''].join('\n')
const QUEUE = [
  '--',
  '-- PostgreSQL database dump complete',
  '--',
  '',
  '\\unrestrict aBcDeF',
  '',
].join('\n')
const CORPS = 'CREATE TABLE public.leitner_cards (\n    id integer NOT NULL\n);\n'
const DUMP_VALIDE = `${ENTETE}\n${CORPS}\n${QUEUE}`

/** Un runner qui écrit un dump valide et rend le succès — le cas nominal. */
function runnerValide(): (destination: string) => Promise<number> {
  return async (destination) => {
    writeFileSync(destination, DUMP_VALIDE)
    return 0
  }
}

/** Un runner qui échoue avant d'écrire quoi que ce soit — `pg_dump` mort, par exemple. */
function runnerEnEchec(): (destination: string) => Promise<number> {
  return async () => 1
}

/** Un runner qui « réussit » mais produit un fichier illisible — panne au milieu du dump. */
function runnerCorrompu(): (destination: string) => Promise<number> {
  return async (destination) => {
    writeFileSync(destination, 'ceci ne ressemble à rien')
    return 0
  }
}

/** Trois vieux dumps déjà présents, datés pour trier avant tout dump produit aujourd'hui. */
function seedAncienDumps(dossier: string): void {
  for (const nom of [
    'command-center-2020-01-01_00h00.sql',
    'command-center-2020-01-02_00h00.sql',
    'command-center-2020-01-03_00h00.sql',
  ]) {
    writeFileSync(join(dossier, nom), DUMP_VALIDE)
  }
}

test.group('BackupService / runBackup — ordre et invariants', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  let dossier: string
  let miroir: string

  group.each.setup(() => {
    dossier = mkdtempSync(join(tmpdir(), 'cc-backup-dir-'))
    miroir = mkdtempSync(join(tmpdir(), 'cc-backup-mirror-'))
    return () => {
      rmSync(dossier, { recursive: true, force: true })
      rmSync(miroir, { recursive: true, force: true })
    }
  })

  test('dossier de sauvegarde absent : refus immédiat, le runner n’est jamais appelé', async ({
    assert,
  }) => {
    let appele = false
    const service = new BackupService({
      directory: join(dossier, 'jamais-monte'),
      mirrorDirectory: miroir,
      runner: async () => {
        appele = true
        return 0
      },
    })

    const resultat = await service.runBackup()

    assert.isFalse(resultat.ok)
    assert.isFalse(appele)
    assert.include(resultat.error ?? '', 'introuvable')
  })

  test('pg_dump échoue (code non nul) : aucun fichier laissé derrière', async ({ assert }) => {
    await backupSettings.update({ keep: 10, dailyEnabled: false })
    const service = new BackupService({
      directory: dossier,
      mirrorDirectory: miroir,
      runner: runnerEnEchec(),
    })

    const resultat = await service.runBackup()

    assert.isFalse(resultat.ok)
    assert.deepEqual(readdirSync(dossier), [])
  })

  test('dump produit mais illisible : supprimé, refus explicite', async ({ assert }) => {
    await backupSettings.update({ keep: 10, dailyEnabled: false })
    const service = new BackupService({
      directory: dossier,
      mirrorDirectory: miroir,
      runner: runnerCorrompu(),
    })

    const resultat = await service.runBackup()

    assert.isFalse(resultat.ok)
    assert.include(resultat.error ?? '', 'en-tête')
    assert.deepEqual(readdirSync(dossier), [])
  })

  test('succès sans miroir configuré : vérifié, purge appliquée', async ({ assert }) => {
    seedAncienDumps(dossier)
    await backupSettings.update({ keep: 1, dailyEnabled: false })

    const service = new BackupService({
      directory: dossier,
      mirrorDirectory: join(dossier, 'miroir-jamais-monte'),
      runner: runnerValide(),
    })

    const resultat = await service.runBackup()

    assert.isTrue(resultat.ok)
    assert.isFalse(resultat.mirrored)
    assert.equal(resultat.purged, 3)
    // Ne reste que le dump qui vient d'être produit.
    assert.equal(readdirSync(dossier).length, 1)
  })

  test('succès avec miroir valide : copié, vérifié depuis le miroir, purge appliquée', async ({
    assert,
  }) => {
    seedAncienDumps(dossier)
    await backupSettings.update({ keep: 1, dailyEnabled: false })

    const service = new BackupService({
      directory: dossier,
      mirrorDirectory: miroir,
      runner: runnerValide(),
    })
    const resultat = await service.runBackup()

    assert.isTrue(resultat.ok)
    assert.isTrue(resultat.mirrored)
    assert.equal(resultat.purged, 3)
    assert.equal(readdirSync(miroir).length, 1)
    assert.equal(readdirSync(dossier).length, 1)
  })

  /**
   * ⚠️ **L'invariant du lot.** Le miroir configuré pointe volontairement sur le même dossier
   * que la source (le garde-fou `cible === dossier`) — un échec déterministe, portable, sans
   * dépendre de permissions filesystem qui se comportent différemment selon l'OS. Ce qui compte
   * n'est pas LA RAISON de l'échec, c'est que la purge ne doit JAMAIS avoir lieu quand le miroir
   * échoue : un NAS débranché ne doit jamais faire disparaître des dumps que l'archive n'a
   * jamais reçus.
   */
  test('miroir en échec : AUCUNE purge, dump local conservé', async ({ assert }) => {
    seedAncienDumps(dossier)
    await backupSettings.update({ keep: 1, dailyEnabled: false })

    const service = new BackupService({
      directory: dossier,
      mirrorDirectory: dossier, // le garde-fou anti-auto-miroir doit refuser ceci
      runner: runnerValide(),
    })

    const resultat = await service.runBackup()

    assert.isTrue(resultat.ok, 'le dump local reste bon même si le miroir échoue')
    assert.isFalse(resultat.mirrored)
    assert.equal(resultat.purged, 0)
    assert.isNotNull(resultat.error)
    // Les 3 vieux dumps ET le nouveau sont TOUS encore là : rien n'a été supprimé.
    assert.equal(readdirSync(dossier).length, 4)
  })

  /**
   * ⚠️ **Le mode d'échec que la garde attrape.** Sans elle, un déclenchement admin et le tick
   * automatique tombant dans la même minute (résolution de `horodatage()`) écriraient TOUS DEUX
   * dans le MÊME chemin via deux `createWriteStream` indépendants — pas deux dumps distincts,
   * une écriture concurrente sur un seul fichier. Trouvé en relecture, pas à l'écriture initiale.
   */
  test('deux sauvegardes concurrentes : la seconde est refusée, une seule s’exécute', async ({
    assert,
  }) => {
    await backupSettings.update({ keep: 10, dailyEnabled: false })

    let enCoursSimultanement = 0
    let picSimultane = 0
    const runnerLent: (destination: string) => Promise<number> = async (destination) => {
      enCoursSimultanement += 1
      picSimultane = Math.max(picSimultane, enCoursSimultanement)
      await new Promise((r) => setTimeout(r, 50))
      writeFileSync(destination, DUMP_VALIDE)
      enCoursSimultanement -= 1
      return 0
    }

    const service = new BackupService({
      directory: dossier,
      mirrorDirectory: miroir,
      runner: runnerLent,
    })

    const [premier, second] = await Promise.all([service.runBackup(), service.runBackup()])

    // Un seul appel a réellement atteint le runner : jamais deux écritures concurrentes.
    assert.equal(picSimultane, 1)
    const resultats = [premier, second]
    assert.equal(resultats.filter((r) => r.ok).length, 1)
    assert.equal(resultats.filter((r) => !r.ok).length, 1)
    assert.include(resultats.find((r) => !r.ok)?.error ?? '', 'déjà en cours')
  })
})

/**
 * CC-223 — le chiffrement s'insère dans l'ordre déjà prouvé ci-dessus (dump → vérification →
 * miroir → purge), sans le perturber : opt-in via `recipient` (l'override de test de
 * `BACKUP_ENCRYPTION_RECIPIENT`), et jamais de suppression du clair avant qu'un résultat en
 * aval soit vérifié bon — même doctrine que le miroir.
 */
test.group('BackupService / runBackup — chiffrement (CC-223)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  let dossier: string
  let miroir: string

  group.each.setup(() => {
    dossier = mkdtempSync(join(tmpdir(), 'cc-backup-dir-'))
    miroir = mkdtempSync(join(tmpdir(), 'cc-backup-mirror-'))
    return () => {
      rmSync(dossier, { recursive: true, force: true })
      rmSync(miroir, { recursive: true, force: true })
    }
  })

  test('sans recipient configuré : comportement inchangé, dump en clair', async ({ assert }) => {
    await backupSettings.update({ keep: 10, dailyEnabled: false })

    const service = new BackupService({
      directory: dossier,
      mirrorDirectory: miroir,
      runner: runnerValide(),
    })

    const resultat = await service.runBackup()

    assert.isTrue(resultat.ok)
    assert.isTrue(resultat.file?.endsWith('.sql'))
    const noms = readdirSync(dossier)
    assert.equal(noms.length, 1)
    assert.isTrue(noms[0].endsWith('.sql'))
  })

  test('recipient valide : le clair est chiffré, vérifié, puis supprimé — le miroir reçoit le chiffré', async ({
    assert,
  }) => {
    await backupSettings.update({ keep: 10, dailyEnabled: false })
    const identity = await age.generateIdentity()
    const recipient = await age.identityToRecipient(identity)

    const service = new BackupService({
      directory: dossier,
      mirrorDirectory: miroir,
      runner: runnerValide(),
      recipient,
    })

    const resultat = await service.runBackup()

    assert.isTrue(resultat.ok)
    assert.isTrue(resultat.file?.endsWith('.sql.age'), `file inattendu : ${resultat.file}`)
    assert.isTrue(resultat.mirrored)

    // Le clair a bien disparu du dossier local — seul le chiffré y reste.
    const noms = readdirSync(dossier)
    assert.equal(noms.length, 1)
    assert.isTrue(noms[0].endsWith('.sql.age'))

    // Ce que le miroir reçoit ne ressemble à rien en clair.
    const chiffre = readFileSync(join(miroir, noms[0]))
    assert.notInclude(chiffre.toString('latin1'), 'CREATE TABLE')
  })

  test('recipient invalide : le clair est CONSERVÉ, rien n’est mirroré ni purgé', async ({
    assert,
  }) => {
    seedAncienDumps(dossier)
    await backupSettings.update({ keep: 1, dailyEnabled: false })

    const service = new BackupService({
      directory: dossier,
      mirrorDirectory: miroir,
      runner: runnerValide(),
      recipient: 'pas-une-clé-age',
    })

    const resultat = await service.runBackup()

    assert.isFalse(resultat.ok)
    assert.include(resultat.error ?? '', 'BACKUP_ENCRYPTION_RECIPIENT')
    assert.include(resultat.error ?? '', 'reste en clair')
    // Les 3 vieux dumps ET le nouveau clair sont TOUS encore là : rien n'a été purgé.
    assert.equal(readdirSync(dossier).length, 4)
    assert.equal(readdirSync(miroir).length, 0)
  })
})
