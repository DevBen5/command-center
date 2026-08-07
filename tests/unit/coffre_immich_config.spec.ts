import { test } from '@japa/runner'
import { normalizeCoffreImmichConfig } from '#config/coffre_immich'
import { IMMICH_DEFAULT_TIMEOUT_MS } from '#config/immich'

/**
 * `enabled` décide seul si le bouton « Parcourir le dossier verrouillé » a une chance de
 * fonctionner (CC-205) — sur le patron de `veille_youtube_config.spec.ts`, qui teste la même
 * classe de garde côté YouTube. L'isolation en test (aucune vraie instance jointe pendant
 * `npm test`) est prouvée à part, dans `tests/unit/env_isolation.spec.ts`.
 */
test.group('Coffre / configuration de session Immich', () => {
  test('active le dossier verrouillé quand les quatre valeurs sont là', ({ assert }) => {
    const config = normalizeCoffreImmichConfig({
      baseUrl: 'https://immich.exemple.dev',
      email: 'proprietaire@exemple.dev',
      password: 'un-mot-de-passe',
      pinCode: '123456',
    })

    assert.isTrue(config.enabled)
    assert.equal(config.baseUrl, 'https://immich.exemple.dev')
    assert.equal(config.email, 'proprietaire@exemple.dev')
    assert.equal(config.password, 'un-mot-de-passe')
    assert.equal(config.pinCode, '123456')
  })

  test('laisse le dossier inactif dès qu’une des quatre valeurs manque', ({ assert }) => {
    const complet = {
      baseUrl: 'https://immich.exemple.dev',
      email: 'proprietaire@exemple.dev',
      password: 'un-mot-de-passe',
      pinCode: '123456',
    }

    for (const champ of ['baseUrl', 'email', 'password', 'pinCode'] as const) {
      const raw = { ...complet, [champ]: '' }
      assert.isFalse(
        normalizeCoffreImmichConfig(raw).enabled,
        `sans ${champ}, le dossier verrouillé ne devrait pas s'activer`
      )
    }

    assert.isFalse(normalizeCoffreImmichConfig({}).enabled)
  })

  test('retire les blancs et le slash parasite de l’hôte, jamais du mot de passe ni du PIN', ({
    assert,
  }) => {
    // ⚠️ Même raison que la passphrase du coffre (`validators/coffre.ts`) : un espace de tête ou
    // de fin fait partie du mot de passe et du PIN — le retirer changerait la valeur envoyée à
    // Immich sans que rien ne le signale.
    const config = normalizeCoffreImmichConfig({
      baseUrl: '  https://immich.exemple.dev//  ',
      email: '  proprietaire@exemple.dev  ',
      password: '  un-mot-de-passe  ',
      pinCode: '  123456  ',
    })

    assert.equal(config.baseUrl, 'https://immich.exemple.dev')
    assert.equal(config.email, 'proprietaire@exemple.dev')
    assert.equal(config.password, '  un-mot-de-passe  ')
    assert.equal(config.pinCode, '  123456  ')
  })

  test('applique le délai par défaut d’Immich, et respecte celui qu’on lui donne', ({ assert }) => {
    assert.equal(normalizeCoffreImmichConfig({}).timeoutMs, IMMICH_DEFAULT_TIMEOUT_MS)
    assert.equal(normalizeCoffreImmichConfig({ timeoutMs: 3_000 }).timeoutMs, 3_000)
  })
})
