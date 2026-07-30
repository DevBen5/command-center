import { test } from '@japa/runner'
import { dockerDisponible } from '#config/docker'

/**
 * Le défaut de `config/docker.ts` (CC-116) — la seule logique qui décide qu'un écran dit la
 * vérité ou invente des conteneurs.
 *
 * ⚠️ **Le cas qui compte est `('production', undefined)`.** C'est l'oubli de la variable sur le
 * NAS — le mode d'échec principal du ticket : il doit aller vers la bannière « hors service »,
 * jamais vers des statuts imaginaires. Les autres cas gardent le comportement de dev (le mensonge
 * assumé du `catch {}`) et le droit de contredire le défaut dans les deux sens.
 */
test.group('Services / disponibilité Docker (CC-116)', () => {
  test('en development, Docker est réputé disponible — rien ne change en dev', ({ assert }) => {
    assert.isTrue(dockerDisponible('development', undefined))
  })

  test('en test, Docker est réputé disponible — les suites gardent le comportement simulé', ({
    assert,
  }) => {
    assert.isTrue(dockerDisponible('test', undefined))
  })

  test("en production, l'absence de variable va vers la vérité : indisponible", ({ assert }) => {
    assert.isFalse(dockerDisponible('production', undefined))
  })

  test('posée, la variable gagne dans les deux sens', ({ assert }) => {
    // Un déploiement qui monterait le socket…
    assert.isTrue(dockerDisponible('production', true))
    // …et un poste de dev qui veut prévisualiser la bannière.
    assert.isFalse(dockerDisponible('development', false))
  })

  test('un NODE_ENV absent retombe côté disponible', ({ assert }) => {
    // Inatteignable par l'environnement (NODE_ENV est un enum requis au boot) : la signature
    // accepte `undefined` par symétrie avec `immichConfigFrom`, et ce test fige le choix.
    assert.isTrue(dockerDisponible(undefined, undefined))
  })
})
