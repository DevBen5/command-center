import { test } from '@japa/runner'
import { courseSearchQuery } from '#modules/leitner/shared/course_search'

/**
 * `courseSearchQuery` — pur, sans base ni horloge. Il ne fait que retirer la décoration
 * Markdown du recto ; accents et mots vides restent l'affaire de Postgres
 * (`plainto_tsquery('french', …)`), pas de ce fichier.
 */
test.group('Leitner / recherche du corpus — construction de la requête (CC-252)', () => {
  test('retire la décoration Markdown, garde les mots', ({ assert }) => {
    assert.equal(
      courseSearchQuery("**Qu'est-ce que le handshake TLS ?**"),
      "Qu'est-ce que le handshake TLS ?"
    )
  })

  test('retire un marqueur de liste en tête de ligne', ({ assert }) => {
    assert.equal(courseSearchQuery('- Un point important'), 'Un point important')
  })

  test('retire les apostrophes de code inline, garde le tiret interne au mot', ({ assert }) => {
    assert.equal(courseSearchQuery('Le mot-clé `SELECT` en SQL'), 'Le mot-clé SELECT en SQL')
  })

  test('retire un séparateur --- sans toucher un tiret interne à un mot', ({ assert }) => {
    assert.equal(courseSearchQuery('Avant --- après-coup'), 'Avant après-coup')
  })

  test('collapse plusieurs espaces en un seul, et retire les bords', ({ assert }) => {
    assert.equal(courseSearchQuery('  Trop   d’espaces  '), 'Trop d’espaces')
  })

  test('un recto réduit à de la seule décoration rend une chaîne vide', ({ assert }) => {
    assert.equal(courseSearchQuery('*** --- ###'), '')
  })

  test('les accents ne sont PAS touchés — Postgres s’en charge', ({ assert }) => {
    assert.equal(courseSearchQuery('Sécurité et régularité'), 'Sécurité et régularité')
  })
})
