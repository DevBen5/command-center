import { test } from '@japa/runner'
import { tokenizeFront, type GlossaryTerm } from '#modules/leitner/shared/glossary_highlight'

/**
 * Les mots-clés du recto (CC-254) : le tokeniseur est CODE PUR — accents, casse, plus
 * long d'abord, refus à l'intérieur d'un mot, chevauchement. Le rendu (les `<span>`, la
 * modale) reste hors de portée de ce fichier : `pages/__tests__/index.spec.ts` le prouve.
 */

const GLOSSARY: GlossaryTerm[] = [{ term: 'TLS', sectionId: 1 }]

test.group('Leitner / tokeniseur du glossaire (CC-254)', () => {
  test('un recto sans aucun terme rend un seul jeton plein', ({ assert }) => {
    const tokens = tokenizeFront('Que négocie le handshake ?', GLOSSARY)
    assert.deepEqual(tokens, [{ texte: 'Que négocie le handshake ?', sectionId: null }])
  })

  test('un glossaire vide ne souligne jamais rien', ({ assert }) => {
    const tokens = tokenizeFront('Que négocie le handshake TLS ?', [])
    assert.deepEqual(tokens, [{ texte: 'Que négocie le handshake TLS ?', sectionId: null }])
  })

  test('reconnaît un terme malgré les accents et la casse', ({ assert }) => {
    const tokens = tokenizeFront('La sécurité du protocole', [{ term: 'securite', sectionId: 5 }])
    assert.deepEqual(tokens, [
      { texte: 'La ', sectionId: null },
      { texte: 'sécurité', sectionId: 5 },
      { texte: ' du protocole', sectionId: null },
    ])
  })

  test('plus long d’abord : le terme composé prime sur son sous-terme', ({ assert }) => {
    const glossary: GlossaryTerm[] = [
      { term: 'Transport', sectionId: 1 },
      { term: 'Transport Layer Security', sectionId: 2 },
    ]
    const tokens = tokenizeFront('Le protocole Transport Layer Security négocie.', glossary)
    assert.deepEqual(tokens, [
      { texte: 'Le protocole ', sectionId: null },
      { texte: 'Transport Layer Security', sectionId: 2 },
      { texte: ' négocie.', sectionId: null },
    ])
  })

  test('jamais à l’intérieur d’un mot : « TLSv1.3 » ne souligne pas « TLS »', ({ assert }) => {
    const tokens = tokenizeFront('La version TLSv1.3 est récente.', GLOSSARY)
    assert.deepEqual(tokens, [{ texte: 'La version TLSv1.3 est récente.', sectionId: null }])
  })

  test('deux termes qui se chevauchent : le premier trouvé consomme sa portée', ({ assert }) => {
    const glossary: GlossaryTerm[] = [
      { term: 'Transport Layer', sectionId: 1 },
      { term: 'Layer Security', sectionId: 2 },
    ]
    const tokens = tokenizeFront('Transport Layer Security', glossary)
    assert.deepEqual(tokens, [
      { texte: 'Transport Layer', sectionId: 1 },
      { texte: ' Security', sectionId: null },
    ])
  })

  test('deux termes distincts, non chevauchants, sont tous deux reconnus', ({ assert }) => {
    const glossary: GlossaryTerm[] = [
      { term: 'TLS', sectionId: 1 },
      { term: 'handshake', sectionId: 2 },
    ]
    const tokens = tokenizeFront('Le handshake TLS négocie.', glossary)
    assert.deepEqual(tokens, [
      { texte: 'Le ', sectionId: null },
      { texte: 'handshake', sectionId: 2 },
      { texte: ' ', sectionId: null },
      { texte: 'TLS', sectionId: 1 },
      { texte: ' négocie.', sectionId: null },
    ])
  })
})
