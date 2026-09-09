import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import enabledModules from '#config/modules'
import { createUserWith } from '#tests/helpers/users'
import GlossaryTerm from '#modules/corpus/models/glossary_term'
import BackupService, { BACKUP_VERSION } from '#modules/leitner/services/leitner_backup_service'
import { backupValidator } from '#modules/leitner/validators/leitner'

test.group('Leitner — sauvegarde du glossaire v6', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  test('export filtré, import du contenu sans cours et réimport sans doublon', async ({
    assert,
  }) => {
    const owner = await createUserWith([])
    const other = await createUserWith([])
    await GlossaryTerm.createMany([
      {
        term: 'TLS',
        aliases: ['Transport'],
        definition: '**Texte**',
        ownerId: owner.id,
        isShared: false,
      },
      { term: 'Secret', aliases: [], definition: 'Caché', ownerId: other.id, isShared: false },
      { term: 'Partagé', aliases: [], definition: 'Lisible', ownerId: other.id, isShared: true },
    ])
    const service = new BackupService()
    const backup = await service.export(owner.id)
    assert.equal(BACKUP_VERSION, 6)
    assert.deepEqual(
      backup.glossaryTerms.map((term) => term.term),
      ['TLS', 'Partagé']
    )
    const target = await createUserWith([])
    const validated = await backupValidator.validate(backup)
    const report = await service.import(target.id, validated)
    assert.equal(report.termsCreated, 2)
    const reimported = await service.import(target.id, validated)
    assert.equal(reimported.termsSkipped, 2)
    const restored = await GlossaryTerm.query()
      .where('owner_id', target.id)
      .where('term', 'TLS')
      .firstOrFail()
    assert.deepEqual(restored.aliases, ['Transport'])
    assert.equal(restored.definition, '**Texte**')
    assert.equal(restored.createdAt.toISO(), backup.glossaryTerms[0].createdAt)
    assert.isFalse(restored.isShared)
  })
  test('garde un terme dont la section manque et compte le lien perdu', async ({ assert }) => {
    const user = await createUserWith([])
    const report = await new BackupService().import(user.id, {
      version: 6,
      cards: [],
      glossaryTerms: [
        { term: 'TLS', definition: 'Texte', section: { courseTitle: 'Absent', slug: 'tls' } },
      ],
    })
    assert.equal(report.termsCreated, 1)
    assert.equal(report.termLinksLost, 1)
    const term = await GlossaryTerm.query().where('owner_id', user.id).firstOrFail()
    assert.isNull(term.leitnerCourseSectionId)
  })
  test('Corpus éteint signale les termes non pris en charge', async ({ assert }) => {
    const user = await createUserWith([])
    enabledModules.delete('corpus')
    try {
      const service = new BackupService()
      const backup = await service.export(user.id)
      assert.isFalse(backup.glossarySupported)
      assert.deepEqual(backup.glossaryTerms, [])
      const report = await service.import(user.id, {
        version: 6,
        cards: [],
        glossaryTerms: [{ term: 'TLS', definition: 'Texte' }],
      })
      assert.isFalse(report.glossarySupported)
      assert.equal(report.termsSkipped, 1)
      assert.equal(report.termsCreated, 0)
    } finally {
      enabledModules.add('corpus')
    }
  })
})
