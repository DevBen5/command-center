import { test } from '@japa/runner'
import { normalizeYoutubeConfig, YOUTUBE_DEFAULT_TIMEOUT_MS } from '#config/youtube'

/**
 * `enabled` décide seul qu'une source YouTube collecte ou se tait. C'est la raison d'être de
 * ce fichier : `config/immich.ts` calcule le sien à l'import, donc aucun test ne le tient, et
 * une régression sur ce booléen ne se manifesterait que par l'absence de collecte — la panne
 * la plus silencieuse qui soit, puisqu'il n'y a ni erreur ni ligne à lire.
 */
test.group('Veille / configuration YouTube', () => {
  test('active la source quand la clé et la playlist sont là', ({ assert }) => {
    const config = normalizeYoutubeConfig({ apiKey: 'AIza-clef', playlistId: 'PLveille' })

    assert.isTrue(config.enabled)
    assert.equal(config.apiKey, 'AIza-clef')
    assert.equal(config.playlistId, 'PLveille')
  })

  test('laisse la source inactive dès qu’une des deux manque', ({ assert }) => {
    for (const raw of [
      {},
      { apiKey: 'AIza-clef' },
      { playlistId: 'PLveille' },
      // La chaîne vide est le cas réel : une ligne `YOUTUBE_API_KEY=` laissée dans `.env`
      // n'est pas « absente » pour autant, et sans le test sur `!== ''` elle passerait.
      { apiKey: '', playlistId: 'PLveille' },
      { apiKey: 'AIza-clef', playlistId: '' },
      // Une valeur qui n'est que du blanc doit compter pour absente, pas pour présente.
      { apiKey: '   ', playlistId: 'PLveille' },
      { apiKey: 'AIza-clef', playlistId: '  ' },
    ]) {
      assert.isFalse(
        normalizeYoutubeConfig(raw).enabled,
        `${JSON.stringify(raw)} ne devrait pas activer la collecte`
      )
    }
  })

  test('retire les blancs et le slash parasite', ({ assert }) => {
    const config = normalizeYoutubeConfig({
      apiKey: '  AIza-clef  ',
      playlistId: '  PLveille//  ',
    })

    assert.equal(config.apiKey, 'AIza-clef')
    assert.equal(config.playlistId, 'PLveille')
  })

  test('applique le délai par défaut, et respecte celui qu’on lui donne', ({ assert }) => {
    assert.equal(normalizeYoutubeConfig({}).timeoutMs, YOUTUBE_DEFAULT_TIMEOUT_MS)
    assert.equal(normalizeYoutubeConfig({ timeoutMs: 3_000 }).timeoutMs, 3_000)
  })

  /**
   * Ce que la normalisation ne rattrape PAS, et c'est délibéré (CC-85). Une URL complète
   * collée à la place de l'identifiant reste « configurée » : la collecte répondra 404 et
   * l'erreur ira dans le `last_error` de la source, visible sur `/veille/sources`. Extraire le
   * `list=` masquerait l'erreur de configuration et obligerait à trancher `watch?v=…&list=…`.
   *
   * Le test fige la décision : s'il tombe, c'est qu'on a ajouté cette magie — pas qu'un bug
   * est apparu.
   */
  test('ne tente pas d’extraire l’identifiant d’une URL collée', ({ assert }) => {
    const config = normalizeYoutubeConfig({
      apiKey: 'AIza-clef',
      playlistId: 'https://www.youtube.com/playlist?list=PLveille',
    })

    assert.equal(config.playlistId, 'https://www.youtube.com/playlist?list=PLveille')
    assert.isTrue(config.enabled)
  })
})
