import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'

test.group('Leitner / séparation de l’organisation', () => {
  test('retire la gestion taxonomique de settings', async ({ assert }) => {
    const source = await readFile(
      new URL('../../app/modules/leitner/pages/settings.vue', import.meta.url),
      'utf8'
    )

    assert.notInclude(source, 'taxonomyTitle')
    assert.notInclude(source, 'newCategoryPlaceholder')
    assert.notInclude(source, 'taxonomyMergeTitle')
    assert.notInclude(source, 'findTaxonomyDuplicates')
  })

  test('porte le libellé de la nouvelle page', async ({ assert }) => {
    const source = await readFile(
      new URL('../../app/modules/leitner/pages/organisation.vue', import.meta.url),
      'utf8'
    )
    const translations = await readFile(
      new URL('../../app/modules/leitner/i18n/fr.json', import.meta.url),
      'utf8'
    )

    assert.include(source, "t('leitner.organisation.title')")
    assert.include(translations, 'Organisation des cartes')
  })
})
