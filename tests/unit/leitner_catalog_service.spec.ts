import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerCardProgress from '#modules/leitner/models/leitner_card_progress'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import LeitnerCatalogService from '#modules/leitner/services/leitner_catalog_service'
import { progressBox } from '#modules/leitner/services/leitner_progress'
import { setProgress } from '#tests/helpers/leitner'
import { createAdmin } from '#tests/helpers/users'

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

  test('une carte créée ne sème AUCUNE progression', async ({ assert }) => {
    // Elle vaut « boîte 1, due aujourd'hui » pour tout le monde par la seule absence de
    // ligne (CC-119) — y compris pour les comptes créés avant elle. Semer ici obligerait
    // à un re-semis à chaque nouveau compte, et une carte créée entre les deux resterait
    // invisible sans erreur.
    const { kubernetes } = await makeTaxonomy()

    const card = await new LeitnerCatalogService().createCard({
      front: 'Pod ?',
      back: 'Plus petite unité déployable.',
      leitnerThemeId: kubernetes.id,
    })

    assert.equal(card.leitnerThemeId, kubernetes.id)
    assert.lengthOf(await LeitnerCardProgress.query().where('leitner_card_id', card.id), 0)
  })

  test('le catalogue montre la boîte de celui qui regarde', async ({ assert }) => {
    // Le contenu est communal, la colonne « boîte » ne l'est pas : deux personnes voient
    // les mêmes cartes avec des boîtes différentes, et l'absence de ligne vaut 1.
    const mine = await createAdmin()
    const theirs = await createAdmin()
    const service = new LeitnerCatalogService()
    const card = await service.createCard({ front: 'Partagée', back: '…' })
    await setProgress(mine.id, card.id, { box: 4 })

    const forMe = await service.cards(mine.id)
    const forThem = await service.cards(theirs.id)
    assert.equal(progressBox(forMe[0]), 4)
    assert.equal(progressBox(forThem[0]), 1)
  })

  test('le filtre « boîte N » suit la progression de la personne', async ({ assert }) => {
    const mine = await createAdmin()
    const theirs = await createAdmin()
    const service = new LeitnerCatalogService()
    const card = await service.createCard({ front: 'Partagée', back: '…' })
    await setProgress(mine.id, card.id, { box: 3 })

    assert.lengthOf(await service.cards(mine.id, { box: 3 }), 1)
    assert.lengthOf(await service.cards(theirs.id, { box: 3 }), 0)
    // ⚠️ Le filtre « boîte 1 » doit trouver les cartes SANS ligne, sinon il ne remonterait
    // jamais une carte neuve — le cas le plus fréquent de l'écran.
    assert.lengthOf(await service.cards(theirs.id, { box: 1 }), 1)
  })

  test('le filtre par catégorie remonte les cartes de tous ses thèmes', async ({ assert }) => {
    const user = await createAdmin()
    const service = new LeitnerCatalogService()
    const { devops, kubernetes, docker } = await makeTaxonomy()
    const autre = await LeitnerCategory.create({ name: 'Réseau' })
    const dns = await LeitnerTheme.create({ leitnerCategoryId: autre.id, name: 'DNS' })

    await service.createCard({ front: 'Pod ?', back: '…', leitnerThemeId: kubernetes.id })
    await service.createCard({ front: 'Image ?', back: '…', leitnerThemeId: docker.id })
    await service.createCard({ front: 'Enregistrement A ?', back: '…', leitnerThemeId: dns.id })

    const cards = await service.cards(user.id, { categoryId: devops.id })

    assert.lengthOf(cards, 2)
    assert.sameMembers(
      cards.map((card) => card.front),
      ['Pod ?', 'Image ?']
    )
  })

  test('le filtre « non classées » ne remonte que les cartes sans thème', async ({ assert }) => {
    const user = await createAdmin()
    const service = new LeitnerCatalogService()
    const { kubernetes } = await makeTaxonomy()

    await service.createCard({ front: 'Classée', back: '…', leitnerThemeId: kubernetes.id })
    await service.createCard({ front: 'Orpheline', back: '…' })

    const cards = await service.cards(user.id, { unclassified: true })

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
