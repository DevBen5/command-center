import { test } from '@japa/runner'
import type { YoutubeConfig } from '#config/youtube'
import YoutubeClient, { YoutubeUnavailableError } from '#modules/veille/services/youtube_client'

/**
 * Ce que le client fait **réellement** d'une réponse de l'API Data v3.
 *
 * La pagination, l'appariement des durées, le refus des redirections et — surtout — la non-fuite
 * de la clé ne se vérifient qu'ici. `fetch` est remplacé le temps du test : aucun réseau, aucune
 * requête vers Google, comme partout dans ce dépôt.
 */

const API_KEY = 'AIzaSyD-CLEF-QUI-NE-DOIT-JAMAIS-FUIR'

const CONFIG: YoutubeConfig = {
  apiKey: API_KEY,
  playlistId: 'PLveille',
  timeoutMs: 5_000,
  enabled: true,
}

type Route = (url: string) => Response

function stubFetch(route: Route): { urls: string[]; restore: () => void } {
  const original = globalThis.fetch
  const urls: string[] = []

  globalThis.fetch = (async (url: string) => {
    urls.push(String(url))
    return route(String(url))
  }) as typeof globalThis.fetch

  return {
    urls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function item(videoId: string) {
  return {
    snippet: {
      publishedAt: '2026-07-20T10:00:00Z',
      title: `Vidéo ${videoId}`,
      description: '',
      videoOwnerChannelTitle: 'Une chaîne',
      thumbnails: { high: { url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` } },
      resourceId: { videoId },
    },
    contentDetails: { videoId, videoPublishedAt: '2020-01-15T08:30:00Z' },
    status: { privacyStatus: 'public' },
  }
}

const A = 'aaaaaaaaaaa'
const B = 'bbbbbbbbbbb'
const C = 'ccccccccccc'

test.group('Veille / client YouTube — la clé ne fuit jamais', () => {
  /**
   * ⚠️ **Le test qui porte le lot.** L'API Data v3 n'accepte sa clé qu'en **paramètre de
   * requête**, là où Immich la met dans un en-tête. Or `ImmichClient` compose ses messages
   * d'erreur avec le chemin appelé : recopier ce patron ferait atterrir la clé dans
   * `veille_sources.last_error` — écrite en base, et affichée telle quelle sur `/veille/sources`.
   *
   * Ce test couvre **tous** les chemins d'échec, pas un seul : c'est la seule façon d'attraper
   * celui qu'on ajouterait plus tard sans y penser.
   */
  test('aucun message d’erreur ne porte la clé, sur aucun chemin d’échec', async ({ assert }) => {
    const chemins: Array<{ nom: string; route: Route }> = [
      { nom: 'redirection', route: () => new Response(null, { status: 302 }) },
      {
        nom: 'clé refusée',
        route: () => json({ error: { errors: [{ reason: 'keyInvalid' }] } }, 403),
      },
      {
        nom: 'quota épuisé',
        route: () => json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403),
      },
      { nom: 'playlist inconnue', route: () => json({ error: {} }, 404) },
      {
        nom: 'HTML au lieu de JSON',
        route: () =>
          new Response('<!doctype html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      },
      {
        nom: 'JSON illisible',
        route: () =>
          new Response('{ pas du json', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      },
      {
        nom: 'réponse sans items',
        route: () => json({ pageInfo: { totalResults: 0 } }),
      },
      {
        nom: 'réseau injoignable',
        route: () => {
          throw new Error(`connect ECONNREFUSED https://www.googleapis.com/?key=${API_KEY}`)
        },
      },
    ]

    for (const { nom, route } of chemins) {
      const fetchStub = stubFetch(route)
      try {
        await new YoutubeClient(CONFIG).playlistVideos()
        assert.fail(`${nom} aurait dû lever`)
      } catch (error) {
        assert.instanceOf(error, YoutubeUnavailableError, `${nom} : mauvais type d'erreur`)
        assert.notInclude(
          (error as Error).message,
          API_KEY,
          `${nom} : le message d'erreur porte la clé d'API`
        )
      } finally {
        fetchStub.restore()
      }
    }
  })

  /**
   * Le pendant du précédent : la clé DOIT partir vers Google, sinon rien ne fonctionne. Sans ce
   * test, un « on retire la clé de l'URL » qui casserait tout passerait le test ci-dessus.
   */
  test('la clé part bien dans la requête', async ({ assert }) => {
    const fetchStub = stubFetch(() => json({ items: [] }))

    try {
      await new YoutubeClient(CONFIG).playlistVideos()
      assert.include(fetchStub.urls[0], `key=${API_KEY}`)
      assert.include(fetchStub.urls[0], 'playlistId=PLveille')
    } finally {
      fetchStub.restore()
    }
  })
})

test.group('Veille / client YouTube — ce qu’il fait de la réponse', () => {
  test('suit la pagination jusqu’au bout', async ({ assert }) => {
    const fetchStub = stubFetch((url) => {
      if (url.includes('/videos?')) return json({ items: [] })
      if (url.includes('pageToken=page2')) return json({ items: [item(C)] })
      return json({ items: [item(A), item(B)], nextPageToken: 'page2' })
    })

    try {
      const videos = await new YoutubeClient(CONFIG).playlistVideos()

      assert.deepEqual(
        videos.map((v) => v.videoId),
        [A, B, C]
      )
    } finally {
      fetchStub.restore()
    }
  })

  /**
   * ⚠️ Un jeton qui se répète ne fait pas avancer. Le plafond de pages finirait par arrêter la
   * boucle, mais après 40 requêtes inutiles et en accusant la taille de la playlist — le message
   * doit dire la vraie cause.
   */
  test('refuse un jeton de page qui ne progresse pas', async ({ assert }) => {
    const fetchStub = stubFetch(() => json({ items: [item(A)], nextPageToken: 'toujours-le-meme' }))

    try {
      await assert.rejects(() => new YoutubeClient(CONFIG).playlistVideos(), /ne progresse pas/)
    } finally {
      fetchStub.restore()
    }
  })

  /**
   * ⚠️ **Le test le plus important après la clé.** `videos.list` rend **moins** d'éléments qu'on
   * en demande dès qu'un identifiant est indisponible, sans trou ni marqueur. Apparier par index
   * attribuerait la durée d'une vidéo à une autre et décalerait toutes les suivantes — une
   * corruption parfaitement silencieuse.
   *
   * Ici la deuxième vidéo manque à l'appel : si l'appariement se faisait par position, B
   * hériterait de la durée de C.
   */
  test('apparie les durées par identifiant, jamais par position', async ({ assert }) => {
    const fetchStub = stubFetch((url) => {
      if (url.includes('/videos?')) {
        return json({
          items: [
            { id: A, contentDetails: { duration: 'PT1M' } },
            { id: C, contentDetails: { duration: 'PT3M' } },
          ],
        })
      }
      return json({ items: [item(A), item(B), item(C)] })
    })

    try {
      const videos = await new YoutubeClient(CONFIG).playlistVideos()
      const durations = Object.fromEntries(videos.map((v) => [v.videoId, v.durationSeconds]))

      assert.deepEqual(durations, { [A]: 60, [B]: null, [C]: 180 })
    } finally {
      fetchStub.restore()
    }
  })

  /**
   * ⚠️ Une page en échec fait lever : l'appelant ne reçoit **jamais** une liste partielle. C'est
   * ce qui rendra sûr le marquage des vidéos disparues (CC-87), calculé par différence — une
   * liste tronquée marquerait disparues des vidéos parfaitement présentes.
   */
  test('ne rend jamais une liste partielle quand une page échoue', async ({ assert }) => {
    const fetchStub = stubFetch((url) =>
      url.includes('pageToken=page2')
        ? json({ error: {} }, 500)
        : json({ items: [item(A)], nextPageToken: 'page2' })
    )

    try {
      await assert.rejects(() => new YoutubeClient(CONFIG).playlistVideos())
    } finally {
      fetchStub.restore()
    }
  })

  test('nomme la cause quand Google la donne', async ({ assert }) => {
    const fetchStub = stubFetch(() =>
      json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403)
    )

    try {
      await assert.rejects(() => new YoutubeClient(CONFIG).playlistVideos(), /quotaExceeded/)
    } finally {
      fetchStub.restore()
    }
  })

  test('ne part pas sur le réseau quand la configuration est absente', async ({ assert }) => {
    const fetchStub = stubFetch(() => json({ items: [] }))

    try {
      await assert.rejects(
        () => new YoutubeClient({ ...CONFIG, apiKey: '', enabled: false }).playlistVideos(),
        /n'est pas configuré/
      )
      assert.lengthOf(fetchStub.urls, 0)
    } finally {
      fetchStub.restore()
    }
  })

  test('demande la partie « status » — sans elle, on ne peut pas écarter les vidéos supprimées', async ({
    assert,
  }) => {
    const fetchStub = stubFetch(() => json({ items: [] }))

    try {
      await new YoutubeClient(CONFIG).playlistVideos()
      assert.include(decodeURIComponent(fetchStub.urls[0]), 'part=snippet,contentDetails,status')
    } finally {
      fetchStub.restore()
    }
  })
})

function image(bytes = 'faux-jpeg', status = 200, contentType = 'image/jpeg'): Response {
  return new Response(bytes, { status, headers: { 'content-type': contentType } })
}

test.group('Veille / client YouTube — la vignette (CC-88)', () => {
  /**
   * ⚠️ **Le test qui porte CC-88.** L'URL est **dérivée** de l'identifiant : hôte constant du
   * code, identifiant validé sur onze caractères. `metadata.thumbnailUrl` existe en base et il
   * serait tentant de le passer au client — ce serait une valeur relue en base promue en cible
   * réseau, ce que la doctrine du module refuse partout ailleurs.
   */
  test('dérive l’URL de l’identifiant, sur un hôte constant', async ({ assert }) => {
    const fetchStub = stubFetch(() => image())

    try {
      await new YoutubeClient(CONFIG).thumbnail(A)

      assert.lengthOf(fetchStub.urls, 1)
      assert.equal(fetchStub.urls[0], `https://i.ytimg.com/vi/${A}/mqdefault.jpg`)
    } finally {
      fetchStub.restore()
    }
  })

  /**
   * ⚠️ La clé n'a rien à faire chez `i.ytimg.com` : les miniatures sont publiques, le CDN n'en
   * veut pas, et la lui envoyer serait une fuite pure vers un tiers.
   */
  test('n’envoie jamais la clé d’API au CDN des miniatures', async ({ assert }) => {
    const fetchStub = stubFetch(() => image())

    try {
      await new YoutubeClient(CONFIG).thumbnail(A)
      assert.notInclude(fetchStub.urls[0], API_KEY)
      assert.notInclude(fetchStub.urls[0], 'key=')
    } finally {
      fetchStub.restore()
    }
  })

  /**
   * ⚠️ `config.enabled` ne garde **pas** cet appel, contrairement aux appels d'API : une miniature
   * ne consomme ni clé ni quota. Gater dessus ferait disparaître les vignettes de tous les items
   * déjà collectés à la seconde où `.env` est vidé.
   */
  test('sert encore une vignette quand la configuration a disparu', async ({ assert }) => {
    const fetchStub = stubFetch(() => image())

    try {
      const thumbnail = await new YoutubeClient({
        ...CONFIG,
        apiKey: '',
        playlistId: '',
        enabled: false,
      }).thumbnail(A)

      assert.equal(thumbnail.contentType, 'image/jpeg')
    } finally {
      fetchStub.restore()
    }
  })

  test('rend le type réel du CDN, sans les paramètres', async ({ assert }) => {
    const fetchStub = stubFetch(() => image('faux-webp', 200, 'image/webp; charset=binary'))

    try {
      const thumbnail = await new YoutubeClient(CONFIG).thumbnail(A)

      assert.equal(thumbnail.contentType, 'image/webp')
      assert.equal(thumbnail.bytes.toString('utf8'), 'faux-webp')
    } finally {
      fetchStub.restore()
    }
  })

  test('lève sur une vidéo supprimée, sur une redirection et sur ce qui n’est pas une image', async ({
    assert,
  }) => {
    const chemins: Array<{ nom: string; route: Route }> = [
      { nom: 'vidéo supprimée', route: () => image('', 404) },
      { nom: 'redirection', route: () => new Response(null, { status: 302 }) },
      { nom: 'page HTML', route: () => image('<!doctype html>', 200, 'text/html') },
    ]

    for (const { nom, route } of chemins) {
      const fetchStub = stubFetch(route)
      try {
        await new YoutubeClient(CONFIG).thumbnail(A)
        assert.fail(`${nom} aurait dû lever`)
      } catch (error) {
        assert.instanceOf(error, YoutubeUnavailableError, `${nom} : mauvais type d'erreur`)
      } finally {
        fetchStub.restore()
      }
    }
  })

  /**
   * ⚠️ Défense en profondeur : l'identifiant vient de `dedup_key`, donc d'une valeur que nous
   * avons écrite — mais il est interpolé dans un chemin d'URL, et rien ne part avant vérification.
   */
  test('refuse un identifiant malformé avant toute requête', async ({ assert }) => {
    const fetchStub = stubFetch(() => image())

    try {
      await assert.rejects(
        () => new YoutubeClient(CONFIG).thumbnail('../../etc/passwd'),
        /illisible/
      )
      assert.lengthOf(fetchStub.urls, 0, 'une requête est partie sur un identifiant malformé')
    } finally {
      fetchStub.restore()
    }
  })
})
