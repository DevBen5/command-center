import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { deduceTitle } from '#modules/leitner/services/leitner_ingestion_service'
import { TITLE_MAX_CHARS } from '#modules/leitner/validators/leitner'

/**
 * La déduction du titre est **du code pur** : ni base, ni réseau, ni LLM. C'est donc
 * ici, et nulle part ailleurs, qu'elle se prouve.
 *
 * Ce qu'elle enterre : l'historique où les dix travaux s'appelaient « Texte collé ».
 * L'origine (collé / fichier) reste une donnée utile — mais c'est une pastille à côté
 * du titre, pas un titre.
 */
const JULY_14 = DateTime.fromISO('2026-07-14T09:00:00')

test.group('Ingestion / déduction du titre', () => {
  test('un titre fourni n’est jamais écrasé', ({ assert }) => {
    const title = deduceTitle({
      title: '  Réseau — TLS  ',
      text: '# Un tout autre titre\n\nDu contenu.',
      fileName: 'cours.md',
    })

    assert.equal(title, 'Réseau — TLS')
  })

  test('le premier titre Markdown gagne', ({ assert }) => {
    const title = deduceTitle({
      text: 'Une intro sans titre.\n\n## Le handshake TLS\n\nDu contenu.\n\n## Un autre',
    })

    // Le premier trouvé, à n'importe quel niveau (`#` … `######`).
    assert.equal(title, 'Le handshake TLS')
  })

  test('le # de fermeture est décoratif, pas une partie du titre', ({ assert }) => {
    assert.equal(deduceTitle({ text: '## Le handshake TLS ##\n\nDu contenu.' }), 'Le handshake TLS')
  })

  test('sans titre Markdown, la première ligne non vide', ({ assert }) => {
    const title = deduceTitle({ text: '\n\n   \nLe cours du jour : les réseaux.\nLa suite.' })

    assert.equal(title, 'Le cours du jour : les réseaux.')
  })

  test('la première ligne est tronquée sans couper un mot', ({ assert }) => {
    const line =
      'Le handshake TLS négocie les clés et les algorithmes de chiffrement entre le client et le serveur, en plusieurs étapes.'
    const title = deduceTitle({ text: line })

    assert.isBelow(title.length, line.length)
    assert.isTrue(title.endsWith('…'))
    // Aucun mot coupé : tout ce qui reste est un mot entier de la ligne d'origine.
    const kept = title.slice(0, -1).trim()
    assert.isTrue(line.startsWith(kept))
    assert.isTrue(line[kept.length] === ' ')
  })

  test('un titre Markdown démesuré tient dans la colonne', ({ assert }) => {
    const title = deduceTitle({ text: `# ${'principe '.repeat(40)}` })

    assert.isAtMost(title.length, TITLE_MAX_CHARS)
  })

  test('sans texte, le nom du fichier — sans son extension', ({ assert }) => {
    const title = deduceTitle({ text: '', fileName: 'reseaux-avances.v2.md' })

    assert.equal(title, 'reseaux-avances.v2')
  })

  test('sans rien du tout, la date du jour', ({ assert }) => {
    const title = deduceTitle({ text: '   \n\n  ', now: JULY_14 })

    assert.equal(title, 'Cours du 14 juillet')
  })

  test('« Texte collé » n’est jamais un titre', ({ assert }) => {
    const titles = [
      deduceTitle({ text: '# TLS\n\nDu contenu.' }),
      deduceTitle({ text: 'Une ligne de cours.' }),
      deduceTitle({ text: '', fileName: 'cours.txt' }),
      deduceTitle({ text: '', now: JULY_14 }),
    ]

    for (const title of titles) assert.notInclude(title.toLowerCase(), 'collé')
  })
})
