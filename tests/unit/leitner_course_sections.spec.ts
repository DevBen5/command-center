import { test } from '@japa/runner'
import {
  hashCourseMarkdown,
  splitCourseIntoSections,
} from '#modules/leitner/services/leitner_course_sections'

/**
 * Le découpage d'un cours en sections est **du code pur**, comme la déduction du titre
 * (`leitner_ingestion_title.spec.ts`) : c'est ici, et nulle part ailleurs, qu'il se
 * prouve.
 *
 * ⚠️ Ce n'est PAS `chunkCourse` (`leitner_ingestion_service.spec.ts`) — pas de
 * recouvrement à vérifier ici, mais l'inverse : que deux sections ne se répètent jamais.
 */
test.group('Leitner / découpage d’un cours en sections', () => {
  test('sans recouvrement : chaque section porte SON corps, pas celui du voisin', ({ assert }) => {
    const sections = splitCourseIntoSections('# TLS\n\nLe handshake.\n\n# HTTP\n\nLes verbes.')

    assert.lengthOf(sections, 2)
    assert.equal(sections[0].body, 'Le handshake.')
    assert.equal(sections[1].body, 'Les verbes.')
    // Le corps de la première section ne doit RIEN porter de la seconde.
    assert.notInclude(sections[0].body, 'verbes')
  })

  test('le chemin de titres accumule les ancêtres', ({ assert }) => {
    const sections = splitCourseIntoSections('# Réseaux\n\n## TLS\n\n### Handshake\n\nLe détail.')

    assert.deepEqual(
      sections.map((s) => s.headingPath),
      [['Réseaux'], ['Réseaux', 'TLS'], ['Réseaux', 'TLS', 'Handshake']]
    )
  })

  test('un titre de même niveau ferme le précédent, pas ses ancêtres', ({ assert }) => {
    const sections = splitCourseIntoSections('# Réseaux\n\n## TLS\n\n## HTTP\n\nLes verbes.')

    const paths = sections.map((s) => s.headingPath)
    assert.deepEqual(paths[paths.length - 1], ['Réseaux', 'HTTP'])
  })

  test('un passage avant tout titre devient une section « introduction »', ({ assert }) => {
    const sections = splitCourseIntoSections('Un avant-propos.\n\n# TLS\n\nLe détail.')

    assert.equal(sections[0].slug, 'introduction')
    assert.equal(sections[0].body, 'Un avant-propos.')
  })

  test('un avant-propos vide ne produit AUCUNE section fantôme', ({ assert }) => {
    const sections = splitCourseIntoSections('   \n\n# TLS\n\nLe détail.')

    assert.lengthOf(sections, 1)
    assert.equal(sections[0].slug, 'tls')
  })

  test('le slug est stable si le corps change mais pas le titre', ({ assert }) => {
    const before = splitCourseIntoSections('# TLS\n\nAncien texte.')
    const after = splitCourseIntoSections('# TLS\n\nNouveau texte, plus long.')

    assert.equal(before[0].slug, after[0].slug)
  })

  test('deux chemins de titres réellement identiques se désambiguïsent', ({ assert }) => {
    const sections = splitCourseIntoSections('# Résumé\n\nUn.\n\n# Résumé\n\nDeux.')

    assert.equal(sections[0].slug, 'resume')
    assert.equal(sections[1].slug, 'resume-2')
    assert.notEqual(sections[0].slug, sections[1].slug)
  })

  test('deux titres homonymes sous des parents différents ne collisionnent PAS', ({ assert }) => {
    const sections = splitCourseIntoSections(
      '# Réseaux\n\n## Résumé\n\nUn.\n\n# Sécurité\n\n## Résumé\n\nDeux.'
    )

    const résumés = sections.filter((s) => s.headingPath.at(-1) === 'Résumé')
    assert.lengthOf(résumés, 2)
    assert.notEqual(résumés[0].slug, résumés[1].slug)
  })

  test('les accents et la ponctuation sont neutralisés dans le slug', ({ assert }) => {
    const sections = splitCourseIntoSections('# Sécurité : les bases !\n\nDu contenu.')

    assert.equal(sections[0].slug, 'securite-les-bases')
  })

  test('la ligne `> notion:` range la section au glossaire, avec ses alias', ({ assert }) => {
    const sections = splitCourseIntoSections(
      '# TLS\n\n> notion: TLS, Transport Layer Security\n\nLe détail.'
    )

    assert.deepEqual(sections[0].aliases, ['TLS', 'Transport Layer Security'])
  })

  test('sans la ligne `> notion:`, une section reste hors glossaire', ({ assert }) => {
    const sections = splitCourseIntoSections('# TLS\n\nLe détail, sans glossaire.')

    assert.isNull(sections[0].aliases)
  })

  test('un cours sans aucun titre reste une seule section', ({ assert }) => {
    const sections = splitCourseIntoSections('Juste du texte, aucun titre.')

    assert.lengthOf(sections, 1)
    assert.deepEqual(sections[0].headingPath, [])
  })
})

test.group('Leitner / empreinte de dédup d’un cours', () => {
  test('deux textes identiques donnent la même empreinte', ({ assert }) => {
    assert.equal(
      hashCourseMarkdown('# TLS\n\nLe détail.'),
      hashCourseMarkdown('# TLS\n\nLe détail.')
    )
  })

  test('les fins de ligne et les bords sont normalisés avant le calcul', ({ assert }) => {
    const unix = hashCourseMarkdown('# TLS\n\nLe détail.')
    const windows = '  \r\n# TLS\r\n\r\nLe détail.\r\n  '

    assert.equal(hashCourseMarkdown(windows), unix)
  })

  test('un texte différent rend une empreinte différente', ({ assert }) => {
    assert.notEqual(hashCourseMarkdown('# TLS\n\nUn.'), hashCourseMarkdown('# TLS\n\nDeux.'))
  })
})
