import { test } from '@japa/runner'
import {
  bestThumbnailUrl,
  isYoutubeVideoId,
  parseDurationSeconds,
  parseVideo,
  videoIdFromDedupKey,
  youtubeDedupKey,
} from '#modules/veille/services/youtube_asset'

/**
 * Le parsing d'une entrée de playlist — la partie du lot où l'on peut réellement se tromper,
 * comme `veille_immich_asset.spec.ts` l'est pour Immich. Aucune I/O, aucun réseau.
 */

const VIDEO_ID = 'dQw4w9WgXcQ'

/** Une entrée de `playlistItems.list` telle que l'API la documente. */
function playlistItem(overrides: Record<string, unknown> = {}) {
  return {
    snippet: {
      // ⚠️ Sur un playlistItem, `publishedAt` est la date d'AJOUT à la playlist.
      publishedAt: '2026-07-20T10:00:00Z',
      title: 'Une vidéo de veille',
      description: 'Sa description.',
      // ⚠️ La chaîne du PROPRIÉTAIRE DE LA PLAYLIST, donc la nôtre — pas celle de la vidéo.
      channelTitle: 'Ma playlist',
      videoOwnerChannelTitle: 'La chaîne de la vidéo',
      thumbnails: {
        default: { url: 'https://i.ytimg.com/vi/x/default.jpg' },
        medium: { url: 'https://i.ytimg.com/vi/x/mqdefault.jpg' },
        high: { url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' },
      },
      resourceId: { kind: 'youtube#video', videoId: VIDEO_ID },
      ...(overrides.snippet as object),
    },
    contentDetails: {
      videoId: VIDEO_ID,
      // ⚠️ LA date de publication de la vidéo.
      videoPublishedAt: '2020-01-15T08:30:00Z',
      ...(overrides.contentDetails as object),
    },
    status: { privacyStatus: 'public', ...(overrides.status as object) },
  }
}

test.group('Veille / parsing d’une vidéo YouTube', () => {
  /**
   * ⚠️ **Le test qui porte le fichier.** `snippet.publishedAt` est la date d'ajout à la playlist,
   * `contentDetails.videoPublishedAt` celle de la vidéo. Les confondre est silencieux : la liste
   * de veille trie sur `coalesce(published_at, created_at) DESC`, l'ordre serait faux sans
   * qu'aucune erreur ne le dise. Les deux sont exposées, sous des noms qui ne se confondent pas.
   */
  test('distingue la date de la vidéo de la date d’ajout à la playlist', ({ assert }) => {
    const video = parseVideo(playlistItem())

    assert.equal(video?.publishedAt?.toISODate(), '2020-01-15')
    assert.equal(video?.addedToPlaylistAt?.toISODate(), '2026-07-20')
  })

  /**
   * ⚠️ Même piège, autre champ : `snippet.channelTitle` est la chaîne propriétaire de la
   * playlist. Le lire ferait afficher notre propre nom de chaîne sous chaque vidéo.
   */
  test('retient la chaîne de la vidéo, pas celle du propriétaire de la playlist', ({ assert }) => {
    const video = parseVideo(playlistItem())

    assert.equal(video?.channelTitle, 'La chaîne de la vidéo')
  })

  /**
   * ⚠️ Une playlist conserve ses vidéos supprimées et privées, titrées « Deleted video » /
   * « Private video ». Sans ce filtre, la veille se remplirait d'items sans miniature et sans
   * rien à ouvrir, et rien à l'écran ne dirait pourquoi.
   */
  test('saute une vidéo supprimée ou passée en privé', ({ assert }) => {
    for (const privacyStatus of ['private', 'privacyStatusUnspecified']) {
      assert.isNull(
        parseVideo(playlistItem({ status: { privacyStatus } })),
        `${privacyStatus} ne devrait pas produire d'item`
      )
    }

    assert.isNotNull(parseVideo(playlistItem({ status: { privacyStatus: 'unlisted' } })))
  })

  test('refuse une entrée sans identifiant de vidéo exploitable', ({ assert }) => {
    assert.isNull(parseVideo(null))
    assert.isNull(parseVideo('une chaîne'))
    assert.isNull(parseVideo({}))
    assert.isNull(
      parseVideo(
        playlistItem({
          contentDetails: { videoId: 'trop-court' },
          snippet: { resourceId: { videoId: 'trop-court' } },
        })
      )
    )
  })

  test('retombe sur snippet.resourceId quand contentDetails ne porte pas l’identifiant', ({
    assert,
  }) => {
    const video = parseVideo(playlistItem({ contentDetails: { videoId: undefined } }))

    assert.equal(video?.videoId, VIDEO_ID)
  })

  test('donne un titre neutre plutôt que rien', ({ assert }) => {
    const video = parseVideo(playlistItem({ snippet: { title: '   ' } }))

    assert.equal(video?.title, `Vidéo ${VIDEO_ID}`)
  })

  test('ne renseigne pas la durée : playlistItems ne la rend pas', ({ assert }) => {
    assert.isNull(parseVideo(playlistItem())?.durationSeconds)
  })
})

test.group('Veille / durée ISO 8601 d’une vidéo', () => {
  test('lit les formes que rend l’API', ({ assert }) => {
    assert.equal(parseDurationSeconds('PT30S'), 30)
    assert.equal(parseDurationSeconds('PT4M13S'), 253)
    assert.equal(parseDurationSeconds('PT1H2M3S'), 3_723)
    assert.equal(parseDurationSeconds('PT2H'), 7_200)
    assert.equal(parseDurationSeconds('PT15M'), 900)
  })

  /**
   * ⚠️ **Les jours existent** (`P1DT2H`) : une regex qui ne lirait que `PT#H#M#S` rendrait `null`
   * dessus, et la durée disparaîtrait sans qu'aucune erreur ne le signale.
   */
  test('lit les durées qui dépassent la journée', ({ assert }) => {
    assert.equal(parseDurationSeconds('P1D'), 86_400)
    assert.equal(parseDurationSeconds('P1DT2H30M'), 95_400)
  })

  /**
   * ⚠️ Un direct et une vidéo à venir rendent `P0D`. On rend `null` plutôt que `0` : « 0 s »
   * affiché sous une vidéo serait une mesure là où il n'y a rien à mesurer — même règle que la
   * durée nulle des images chez Immich.
   */
  test('rend null sur une durée nulle ou illisible', ({ assert }) => {
    for (const raw of ['P0D', 'PT0S', '', 'quatre minutes', 'P1M', null, undefined, 253]) {
      assert.isNull(parseDurationSeconds(raw), `${String(raw)} devrait rendre null`)
    }
  })
})

test.group('Veille / miniature d’une vidéo', () => {
  /**
   * ⚠️ L'ordre n'est pas décoratif : `maxres` n'existe que sur les vidéos téléversées en HD.
   * Prendre `maxres` sans repli laisserait sans vignette une part des vidéos.
   */
  test('prend la plus large disponible, et retombe sur ce qui existe', ({ assert }) => {
    assert.equal(
      bestThumbnailUrl({
        default: { url: 'https://i.ytimg.com/a.jpg' },
        maxres: { url: 'https://i.ytimg.com/max.jpg' },
        high: { url: 'https://i.ytimg.com/high.jpg' },
      }),
      'https://i.ytimg.com/max.jpg'
    )

    assert.equal(
      bestThumbnailUrl({ default: { url: 'https://i.ytimg.com/a.jpg' } }),
      'https://i.ytimg.com/a.jpg'
    )
  })

  test('refuse ce qui n’est pas une URL https', ({ assert }) => {
    assert.isNull(bestThumbnailUrl(null))
    assert.isNull(bestThumbnailUrl({}))
    assert.isNull(bestThumbnailUrl({ high: { url: 'http://i.ytimg.com/a.jpg' } }))
    assert.isNull(bestThumbnailUrl({ high: { url: 42 } }))
  })
})

test.group('Veille / clé de dédup YouTube', () => {
  test('fait l’aller-retour', ({ assert }) => {
    const key = youtubeDedupKey(VIDEO_ID)

    assert.equal(key, `youtube:${VIDEO_ID}`)
    assert.equal(videoIdFromDedupKey(key), VIDEO_ID)
  })

  /**
   * ⚠️ Ce préfixe est aussi ce qui aiguillera le proxy de vignette (CC-88) : une clé d'un autre
   * préfixe ne doit jamais en sortir un identifiant, sinon le proxy irait chercher chez YouTube
   * ce qui appartient à Immich.
   */
  test('ne rend rien d’une clé qui n’est pas une clé YouTube', ({ assert }) => {
    assert.isNull(videoIdFromDedupKey(null))
    assert.isNull(videoIdFromDedupKey('immich:219187d7-5320-498f-9c59-47a03bbdb491'))
    assert.isNull(videoIdFromDedupKey('url:https://exemple.dev/a'))
    assert.isNull(videoIdFromDedupKey('youtube:pas-un-identifiant'))
  })

  test('vérifie la forme d’un identifiant de vidéo', ({ assert }) => {
    assert.isTrue(isYoutubeVideoId(VIDEO_ID))
    assert.isTrue(isYoutubeVideoId('_-aBcDeFgH1'))
    assert.isFalse(isYoutubeVideoId('trop-court'))
    assert.isFalse(isYoutubeVideoId('beaucoup-trop-long'))
    // ⚠️ L'identifiant finit dans un paramètre de requête et dans une URL de miniature.
    assert.isFalse(isYoutubeVideoId('../../etc/pw'))
    assert.isFalse(isYoutubeVideoId(42))
  })
})
