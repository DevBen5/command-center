import { test } from '@japa/runner'
import { ImmichUnavailableError } from '#core/shared/services/immich_client'
import type { CoffreImmichConfig } from '#config/coffre_immich'
import ImmichSessionClient from '#modules/coffre/services/immich_session_client'
import { ImmichSessionState } from '#modules/coffre/services/immich_session_state'

/**
 * Le client de session Immich du coffre (CC-205) — login, élévation par PIN, listing du dossier
 * verrouillé, vignette. `fetch` est remplacé le temps du test, comme partout dans ce dépôt : aucun
 * test ne touche le réseau ni une vraie instance.
 *
 * ⚠️ **Une `ImmichSessionState` neuve à chaque test**, jamais le singleton par défaut — même
 * doctrine que `VaultKeyring` : le singleton est un état partagé entre tous les tests du process,
 * et l'ordre d'exécution déciderait du résultat.
 */

const ASSET_ID = '11111111-2222-4333-8444-555555555555'
const OTHER_ASSET_ID = 'c1d2e3f4-5a6b-4c8d-9e0f-1a2b3c4d5e6f'

const CONFIG: CoffreImmichConfig = {
  baseUrl: 'https://immich.test',
  email: 'proprietaire@exemple.fr',
  password: 'mot-de-passe-de-test',
  pinCode: '123456',
  timeoutMs: 5_000,
  enabled: true,
}

type Route = (url: string, init: RequestInit) => Response | Promise<Response>

function stubFetch(route: Route): { urls: string[]; inits: RequestInit[]; restore: () => void } {
  const original = globalThis.fetch
  const urls: string[] = []
  const inits: RequestInit[] = []

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    urls.push(String(url))
    inits.push(init)
    return route(String(url), init)
  }) as typeof globalThis.fetch

  return {
    urls,
    inits,
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

function image(bytes = 'faux-webp', status = 200): Response {
  return new Response(Buffer.from(bytes), { status, headers: { 'content-type': 'image/webp' } })
}

/** Une paire login+unlock qui réussit toujours — le cas nominal pour router les autres tests. */
function routeSuccessfulAuth(url: string, _init: RequestInit): Response | null {
  if (url.endsWith('/api/auth/login')) {
    return json({ accessToken: 'jeton-1', userId: 'u1' })
  }
  if (url.endsWith('/api/auth/session/unlock')) {
    return json({ successful: true })
  }
  if (url.endsWith('/api/auth/logout')) {
    return json({ successful: true })
  }
  return null
}

function client(state = new ImmichSessionState()): ImmichSessionClient {
  return new ImmichSessionClient(CONFIG, state)
}

test.group('Coffre / le client de session Immich', () => {
  test('ne tente rien quand le module n’est pas configuré', async ({ assert }) => {
    const fetchStub = stubFetch(() => json({}))
    const nonConfigure = new ImmichSessionClient({ ...CONFIG, enabled: false })

    try {
      await assert.rejects(
        () => nonConfigure.lockedPhotos(),
        ImmichUnavailableError,
        /pas configuré/
      )
      assert.lengthOf(fetchStub.urls, 0)
    } finally {
      fetchStub.restore()
    }
  })

  test('login puis unlock, avec le jeton en Bearer sur l’appel de données', async ({ assert }) => {
    const fetchStub = stubFetch((url, init) => {
      const auth = routeSuccessfulAuth(url, init)
      if (auth) return auth

      return json({ assets: { items: [], nextPage: null } })
    })

    try {
      const result = await client().lockedPhotos()

      assert.deepEqual(result, { photos: [], truncated: false })
      assert.deepEqual(
        fetchStub.urls.map((u) => new URL(u).pathname),
        ['/api/auth/login', '/api/auth/session/unlock', '/api/search/metadata']
      )

      const loginBody = JSON.parse(fetchStub.inits[0].body as string)
      assert.deepEqual(loginBody, { email: CONFIG.email, password: CONFIG.password })

      const unlockHeaders = fetchStub.inits[1].headers as Record<string, string>
      assert.equal(unlockHeaders.authorization, 'Bearer jeton-1')
      const unlockBody = JSON.parse(fetchStub.inits[1].body as string)
      assert.deepEqual(unlockBody, { pinCode: CONFIG.pinCode })

      const dataHeaders = fetchStub.inits[2].headers as Record<string, string>
      assert.equal(dataHeaders.authorization, 'Bearer jeton-1')
    } finally {
      fetchStub.restore()
    }
  })

  test('réutilise la session : un second appel ne relogue pas', async ({ assert }) => {
    const fetchStub = stubFetch((url, init) => {
      const auth = routeSuccessfulAuth(url, init)
      if (auth) return auth

      return json({ assets: { items: [], nextPage: null } })
    })

    try {
      const c = client()
      await c.lockedPhotos()
      await c.lockedPhotos()

      // Une seule paire login+unlock pour DEUX appels de données.
      const logins = fetchStub.urls.filter((u) => u.endsWith('/api/auth/login'))
      assert.lengthOf(logins, 1)
    } finally {
      fetchStub.restore()
    }
  })

  test('des appels concurrents ne déclenchent qu’un seul login', async ({ assert }) => {
    // ⚠️ Le cas réel : la grille de vignettes du dossier rend plusieurs <img> à la fois. Sans
    // coordination, chacune verrait « pas de session » et logurait séparément.
    let loginCalls = 0
    const fetchStub = stubFetch(async (url) => {
      if (url.endsWith('/api/auth/login')) {
        loginCalls++
        // Un délai simule un aller-retour réseau, pour laisser les appels concurrents se chevaucher.
        await new Promise((resolve) => setTimeout(resolve, 5))
        return json({ accessToken: 'jeton-1' })
      }
      if (url.endsWith('/api/auth/session/unlock')) return json({ successful: true })
      return image()
    })

    try {
      const c = client()
      await Promise.all([c.thumbnail(ASSET_ID), c.thumbnail(OTHER_ASSET_ID), c.thumbnail(ASSET_ID)])

      assert.equal(loginCalls, 1)
    } finally {
      fetchStub.restore()
    }
  })

  test('un 401 sur un appel de données déclenche UNE reprise, jamais une boucle', async ({
    assert,
  }) => {
    let call = 0
    const fetchStub = stubFetch((url) => {
      if (url.endsWith('/api/auth/login')) return json({ accessToken: `jeton-${++call}` })
      if (url.endsWith('/api/auth/session/unlock')) return json({ successful: true })
      if (url.endsWith('/api/auth/logout')) return json({ successful: true })

      // La vignette échoue en 401 la première fois (session périmée entre-temps), réussit ensuite.
      return call === 1 ? new Response(null, { status: 401 }) : image()
    })

    try {
      const thumbnail = await client().thumbnail(ASSET_ID)
      assert.equal(thumbnail.contentType, 'image/webp')

      const logins = fetchStub.urls.filter((u) => u.endsWith('/api/auth/login'))
      assert.lengthOf(logins, 2, 'un login initial, puis un second après la reprise')
    } finally {
      fetchStub.restore()
    }
  })

  test('un 401 persistant après la reprise remonte, sans boucler indéfiniment', async ({
    assert,
  }) => {
    const fetchStub = stubFetch((url) => {
      if (url.endsWith('/api/auth/login')) return json({ accessToken: 'jeton-x' })
      if (url.endsWith('/api/auth/session/unlock')) return json({ successful: true })
      if (url.endsWith('/api/auth/logout')) return json({ successful: true })

      return new Response(null, { status: 401 })
    })

    try {
      await assert.rejects(() => client().thumbnail(ASSET_ID))

      // Un login initial + un après la reprise = 2, jamais plus : la reprise est bornée à une fois.
      const logins = fetchStub.urls.filter((u) => u.endsWith('/api/auth/login'))
      assert.lengthOf(logins, 2)
    } finally {
      fetchStub.restore()
    }
  })

  test('ferme la session précédente avant d’en ouvrir une autre', async ({ assert }) => {
    let call = 0
    const fetchStub = stubFetch((url) => {
      if (url.endsWith('/api/auth/login')) return json({ accessToken: `jeton-${++call}` })
      if (url.endsWith('/api/auth/session/unlock')) return json({ successful: true })
      if (url.endsWith('/api/auth/logout')) return json({ successful: true })

      return call === 1 ? new Response(null, { status: 401 }) : image()
    })

    try {
      await client().thumbnail(ASSET_ID)

      const logout = fetchStub.inits.find((_, i) => fetchStub.urls[i].endsWith('/api/auth/logout'))
      assert.isDefined(
        logout,
        'le jeton périmé doit être fermé côté Immich avant le renouvellement'
      )
      const logoutHeaders = logout!.headers as Record<string, string>
      assert.equal(logoutHeaders.authorization, 'Bearer jeton-1')
    } finally {
      fetchStub.restore()
    }
  })

  test('des identifiants refusés ne sont jamais retentés', async ({ assert }) => {
    const fetchStub = stubFetch((url) => {
      if (url.endsWith('/api/auth/login')) return new Response(null, { status: 401 })
      return json({})
    })

    try {
      await assert.rejects(
        () => client().lockedPhotos(),
        ImmichUnavailableError,
        /COFFRE_IMMICH_EMAIL/
      )
      assert.lengthOf(fetchStub.urls, 1, 'un login refusé ne doit pas être rejoué')
    } finally {
      fetchStub.restore()
    }
  })

  test('un PIN refusé nomme la variable à corriger', async ({ assert }) => {
    const fetchStub = stubFetch((url) => {
      if (url.endsWith('/api/auth/login')) return json({ accessToken: 'jeton-1' })
      if (url.endsWith('/api/auth/session/unlock')) return new Response(null, { status: 403 })
      return json({})
    })

    try {
      await assert.rejects(
        () => client().lockedPhotos(),
        ImmichUnavailableError,
        /COFFRE_IMMICH_PIN/
      )
    } finally {
      fetchStub.restore()
    }
  })

  test('un 200 en HTML sur le login est une erreur explicite, pas un jeton absent', async ({
    assert,
  }) => {
    const fetchStub = stubFetch(
      () =>
        new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })
    )

    try {
      await assert.rejects(() => client().lockedPhotos(), ImmichUnavailableError, /au lieu de JSON/)
    } finally {
      fetchStub.restore()
    }
  })

  test('ne suit jamais une redirection', async ({ assert }) => {
    const fetchStub = stubFetch(
      () => new Response(null, { status: 302, headers: { location: 'https://ailleurs.test/' } })
    )

    try {
      await assert.rejects(() => client().lockedPhotos(), ImmichUnavailableError, /redirige/)
      assert.equal(fetchStub.inits[0].redirect, 'manual')
    } finally {
      fetchStub.restore()
    }
  })

  test('suit la pagination en chaîne, et plafonne avec `truncated`', async ({ assert }) => {
    const pages: Record<number, unknown> = {
      1: { assets: { items: [{ id: ASSET_ID }], nextPage: '2' } },
      2: { assets: { items: [{ id: OTHER_ASSET_ID }], nextPage: '2' } },
    }

    const fetchStub = stubFetch((url, init) => {
      const auth = routeSuccessfulAuth(url, init)
      if (auth) return auth

      const body = JSON.parse(init.body as string)
      return json(pages[body.page] ?? pages[2])
    })

    try {
      const result = await client().lockedPhotos()

      assert.isTrue(result.truncated)
      assert.isAbove(result.photos.length, 0)
      // Le premier appel de données porte bien le filtre attendu.
      const firstDataCall = fetchStub.inits.find(
        (_, i) => new URL(fetchStub.urls[i]).pathname === '/api/search/metadata'
      )
      const firstBody = JSON.parse(firstDataCall!.body as string)
      assert.equal(firstBody.visibility, 'locked')
    } finally {
      fetchStub.restore()
    }
  })

  test('saute un asset dont l’identifiant est malformé', async ({ assert }) => {
    const fetchStub = stubFetch((url, init) => {
      const auth = routeSuccessfulAuth(url, init)
      if (auth) return auth

      return json({
        assets: { items: [{ id: ASSET_ID }, { id: 'pas-un-uuid' }], nextPage: null },
      })
    })

    try {
      const result = await client().lockedPhotos()

      assert.lengthOf(result.photos, 1)
      assert.equal(result.photos[0].assetId, ASSET_ID)
    } finally {
      fetchStub.restore()
    }
  })

  test('restitue la vignette avec le type réel d’Immich', async ({ assert }) => {
    const fetchStub = stubFetch((url, init) => {
      const auth = routeSuccessfulAuth(url, init)
      if (auth) return auth

      return image('octets-webp')
    })

    try {
      const thumbnail = await client().thumbnail(ASSET_ID)

      assert.equal(thumbnail.contentType, 'image/webp')
      assert.equal(thumbnail.bytes.toString(), 'octets-webp')
      const lastUrl = fetchStub.urls.at(-1)!
      assert.include(lastUrl, `/api/assets/${ASSET_ID}/thumbnail`)
    } finally {
      fetchStub.restore()
    }
  })

  test('refuse une vignette qui n’est pas une image (repli HTML)', async ({ assert }) => {
    const fetchStub = stubFetch((url, init) => {
      const auth = routeSuccessfulAuth(url, init)
      if (auth) return auth

      return new Response('<!doctype html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    })

    try {
      await assert.rejects(
        () => client().thumbnail(ASSET_ID),
        ImmichUnavailableError,
        /au lieu d'une image/
      )
    } finally {
      fetchStub.restore()
    }
  })

  test('closeSession ferme une session ouverte, et ne fait rien sans session', async ({
    assert,
  }) => {
    const fetchStub = stubFetch((url, init) => {
      const auth = routeSuccessfulAuth(url, init)
      if (auth) return auth
      return json({ assets: { items: [], nextPage: null } })
    })

    try {
      const c = client()

      // Sans session ouverte : aucun appel.
      await c.closeSession()
      assert.lengthOf(fetchStub.urls, 0)

      await c.lockedPhotos()
      await c.closeSession()

      const logouts = fetchStub.urls.filter((u) => u.endsWith('/api/auth/logout'))
      assert.lengthOf(logouts, 1)
    } finally {
      fetchStub.restore()
    }
  })
})
