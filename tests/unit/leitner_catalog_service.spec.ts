import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import LeitnerCatalogService from '#modules/leitner/services/leitner_catalog_service'

async function makeTaxonomy() {
  const devops = await LeitnerCategory.create({ name: 'DevOps' })
  const kubernetes = await LeitnerTheme.create({
    leitnerCategoryId: devops.id,
    name: 'Kubernetes',
  })
  const docker = await LeitnerTheme.create({ leitnerCategoryId: devops.id, name: 'Docker' })
  return { devops, kubernetes, docker }
}

test.group('LeitnerCatalogService / catalogue', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('une carte créée avec un thème part en boîte 1', async ({ assert }) => {
    const { kubernetes } = await makeTaxonomy()

    const card = await new LeitnerCatalogService().createCard({
      front: 'Pod ?',
      back: 'Plus petite unité déployable.',
      leitnerThemeId: kubernetes.id,
    })

    assert.equal(card.box, 1)
    assert.equal(card.leitnerThemeId, kubernetes.id)
  })

  test('le filtre par catégorie remonte les cartes de tous ses thèmes', async ({ assert }) => {
    const service = new LeitnerCatalogService()
    const { devops, kubernetes, docker } = await makeTaxonomy()
    const autre = await LeitnerCategory.create({ name: 'Réseau' })
    const dns = await LeitnerTheme.create({ leitnerCategoryId: autre.id, name: 'DNS' })

    await service.createCard({ front: 'Pod ?', back: '…', leitnerThemeId: kubernetes.id })
    await service.createCard({ front: 'Image ?', back: '…', leitnerThemeId: docker.id })
    await service.createCard({ front: 'Enregistrement A ?', back: '…', leitnerThemeId: dns.id })

    const cards = await service.cards({ categoryId: devops.id })

    assert.lengthOf(cards, 2)
    assert.sameMembers(
      cards.map((card) => card.front),
      ['Pod ?', 'Image ?']
    )
  })

  test('le filtre « non classées » ne remonte que les cartes sans thème', async ({ assert }) => {
    const service = new LeitnerCatalogService()
    const { kubernetes } = await makeTaxonomy()

    await service.createCard({ front: 'Classée', back: '…', leitnerThemeId: kubernetes.id })
    await service.createCard({ front: 'Orpheline', back: '…' })

    const cards = await service.cards({ unclassified: true })

    assert.lengthOf(cards, 1)
    assert.equal(cards[0].front, 'Orpheline')
  })

  test('plusieurs cartes se suppriment en une fois', async ({ assert }) => {
    const service = new LeitnerCatalogService()
    const a = await service.createCard({ front: 'A', back: '…' })
    const b = await service.createCard({ front: 'B', back: '…' })
    await service.createCard({ front: 'C', back: '…' })

    const deleted = await service.deleteCards([a.id, b.id])

    assert.equal(deleted, 2)
    const remaining = await LeitnerCard.all()
    assert.lengthOf(remaining, 1)
    assert.equal(remaining[0].front, 'C')
  })

  test('le reclassement multiple accepte le retour en « non classé »', async ({ assert }) => {
    const service = new LeitnerCatalogService()
    const { docker } = await makeTaxonomy()
    const a = await service.createCard({ front: 'A', back: '…' })
    const b = await service.createCard({ front: 'B', back: '…' })

    await service.assignTheme([a.id, b.id], docker.id)
    const classee = await LeitnerCard.findOrFail(a.id)
    assert.equal(classee.leitnerThemeId, docker.id)

    await service.assignTheme([a.id], null)
    const declassee = await LeitnerCard.findOrFail(a.id)
    const intacte = await LeitnerCard.findOrFail(b.id)
    assert.isNull(declassee.leitnerThemeId)
    assert.equal(intacte.leitnerThemeId, docker.id)
  })

  test('supprimer un thème rend ses cartes non classées sans les détruire', async ({ assert }) => {
    const service = new LeitnerCatalogService()
    const { kubernetes } = await makeTaxonomy()
    const card = await service.createCard({
      front: 'Pod ?',
      back: '…',
      leitnerThemeId: kubernetes.id,
    })

    await service.deleteTheme(kubernetes)

    const reloaded = await LeitnerCard.findOrFail(card.id)
    assert.isNull(reloaded.leitnerThemeId)
  })

  test('supprimer une catégorie emporte ses thèmes, pas ses cartes', async ({ assert }) => {
    const service = new LeitnerCatalogService()
    const { devops, docker } = await makeTaxonomy()
    const card = await service.createCard({
      front: 'Image ?',
      back: '…',
      leitnerThemeId: docker.id,
    })

    await service.deleteCategory(devops)

    assert.lengthOf(await LeitnerTheme.all(), 0)
    const reloaded = await LeitnerCard.findOrFail(card.id)
    assert.isNull(reloaded.leitnerThemeId)
  })

  test('un nom de catégorie déjà pris est refusé', async ({ assert }) => {
    const service = new LeitnerCatalogService()
    await service.createCategory('DevOps')

    assert.isNull(await service.createCategory('DevOps'))
  })

  test('un thème est unique dans sa catégorie, mais réutilisable ailleurs', async ({ assert }) => {
    const service = new LeitnerCatalogService()
    const devops = await LeitnerCategory.create({ name: 'DevOps' })
    const cloud = await LeitnerCategory.create({ name: 'Cloud' })

    assert.isNotNull(await service.createTheme(devops.id, 'Docker'))
    assert.isNull(await service.createTheme(devops.id, 'Docker'))
    assert.isNotNull(await service.createTheme(cloud.id, 'Docker'))
  })

  test("l'arbre compte les cartes de chaque nœud", async ({ assert }) => {
    const service = new LeitnerCatalogService()
    const { kubernetes, docker } = await makeTaxonomy()

    await service.createCard({ front: 'Pod ?', back: '…', leitnerThemeId: kubernetes.id })
    await service.createCard({ front: 'Image ?', back: '…', leitnerThemeId: docker.id })
    await service.createCard({ front: 'Volume ?', back: '…', leitnerThemeId: docker.id })
    await service.createCard({ front: 'Orpheline', back: '…' })

    const { categories, unclassifiedCount } = await service.categoryTree()

    assert.lengthOf(categories, 1)
    assert.equal(categories[0].cardCount, 3)
    assert.equal(categories[0].themes.find((theme) => theme.name === 'Docker')?.cardCount, 2)
    assert.equal(unclassifiedCount, 1)
  })
})
