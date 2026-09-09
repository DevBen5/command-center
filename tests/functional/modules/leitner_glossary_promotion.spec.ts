import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createUserWith } from '#tests/helpers/users'
import { makeCard } from '#tests/helpers/leitner'
import GlossaryTerm from '#modules/corpus/models/glossary_term'
import enabledModules from '#config/modules'

test.group('Leitner / promotion glossaire (CC-277)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  test('refuse aussi si Corpus est désactivé après le démarrage', async ({ client }) => {
    const user = await createUserWith(['leitner.cards.write', 'corpus.write'])
    const card = await makeCard('TLS', { ownerId: user.id })
    enabledModules.delete('corpus')
    try {
      const response = await client
        .post(`/revision/cards/${card.id}/glossaire`)
        .loginAs(user)
        .withCsrfToken()
      response.assertStatus(404)
    } finally {
      enabledModules.add('corpus')
    }
  })
  test('refuse sans corpus.write', async ({ client, assert }) => {
    const user = await createUserWith(['leitner.cards.write', 'corpus.view'])
    const card = await makeCard('TLS', { ownerId: user.id })
    const response = await client
      .post(`/revision/cards/${card.id}/glossaire`)
      .loginAs(user)
      .withCsrfToken()
    response.assertStatus(403)
    assert.lengthOf(await GlossaryTerm.all(), 0)
  })

  test('refuse la carte d’un autre propriétaire', async ({ client, assert }) => {
    const owner = await createUserWith([])
    const user = await createUserWith(['leitner.cards.write', 'corpus.view', 'corpus.write'])
    const card = await makeCard('TLS', { ownerId: owner.id })
    const response = await client
      .post(`/revision/cards/${card.id}/glossaire`)
      .loginAs(user)
      .withCsrfToken()
    response.assertStatus(403)
    assert.lengthOf(await GlossaryTerm.all(), 0)
  })
  test('crée un terme privé depuis une carte', async ({ client, assert }) => {
    const user = await createUserWith(['leitner.cards.write', 'corpus.view', 'corpus.write'])
    const card = await makeCard('TLS', { back: 'Un protocole.', ownerId: user.id })
    const response = await client
      .post(`/revision/cards/${card.id}/glossaire`)
      .loginAs(user)
      .withCsrfToken()
    response.assertStatus(200)
    const term = await GlossaryTerm.findOrFail(response.body().term.id)
    assert.equal(term.term, 'TLS')
    assert.equal(term.definition, 'Un protocole.')
    assert.isFalse(term.isShared)
  })
})
