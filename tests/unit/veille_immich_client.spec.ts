import { test } from '@japa/runner'
import type { ImmichConfig } from '#config/immich'
import ImmichClient, { ImmichUnavailableError } from '#modules/veille/services/immich_client'

/**
 * Ce que le client fait **réellement** d'une réponse d'Immich.
 *
 * Le faux client (`FakeImmichClient`) remplace la couche API : il prouve ce que le collecteur
 * fait des résultats, jamais comment ces résultats sont obtenus. La pagination, l'assertion de
 * `content-type` et le refus des redirections ne se vérifient qu'ici.
 *
 * `fetch` est remplacé le temps du test : aucun réseau, aucune instance — comme partout dans ce
 * dépôt.
 */

const ID = '219187d7-5320-498f-9c59-47a03bbdb491'
const OTHER_ID = 'c1d2e3f4-5a6b-4c8d-9e0f-1a2b3c4d5e6f'

const CONFIG: ImmichConfig = {
  baseUrl: 'https://immich.test',
  apiKey: 'clé-de-test',
  albumId: 'album-de-test',
  timeoutMs: 5_000,
  enabled: true,
}

type Route = (url: string, init: RequestInit) => Response

/** Remplace `fetch` par une table de routes, et rend les URL demandées. */
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

function asset(id: string, type = 'IMAGE') {
  return { id, type, originalFileName: `${id}.jpg`, duration: '0:00:00.00000' }
}

test.group('Veille / client Immich — ce qu’il fait de la réponse', () => {
  test('un 200 en text/html est une erreur explicite, pas un album vide', async ({ assert }) => {
    /**
     * ⚠️ **Le test qui porte le lot.** Immich sert son interface en repli sur tout chemin
     * inconnu : une route d'API disparue rend **200 avec du HTML**, pas une 404. Constaté sur
     * l'instance réelle — un slash final de trop dans `IMMICH_BASE_URL` suffit à le produire.
     *
     * Sans l'assertion de `content-type`, `assets` serait `undefined`, l'album paraîtrait vide,
     * et la réconciliation marquerait **tout l'album** « plus dans l'album ». Le pire mode
     * d'échec de ce lot, et il ressemble trait pour trait à un fonctionnement normal.
     */
    const fetchStub = stubFetch(
      () =>
        new Response('<!doctype html><html><head></head></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
    )

    try {
      await assert.rejects(
        () => new ImmichClient(CONFIG).albumAssets(),
        ImmichUnavailableError,
        /au lieu de JSON/
      )
    } finally {
      fetchStub.restore()
    }
  })

  test('suit la pagination jusqu’au bout', async ({ assert }) => {
    // ⚠️ Immich rend `nextPage` en **chaîne** (`"2"`), pas en nombre — relevé sur l'instance.
    // Un `typeof === 'number'` arrêterait la collecte à la première page, en silence, et
    // l'album paraîtrait tronqué : les assets des pages suivantes seraient marqués disparus.
    const pages: Record<number, unknown> = {
      1: { assets: { items: [asset(ID)], nextPage: '2' } },
      2: { assets: { items: [asset(OTHER_ID, 'VIDEO')], nextPage: null } },
    }

    const fetchStub = stubFetch((_url, init) => {
      const body = JSON.parse(init.body as string)
      return json(pages[body.page])
    })

    try {
      const assets = await new ImmichClient(CONFIG).albumAssets()

      assert.lengthOf(assets, 2)
      assert.deepEqual(
        assets.map((entry) => entry.id),
        [ID, OTHER_ID]
      )
      assert.equal(fetchStub.urls.length, 2)
      assert.equal(fetchStub.urls[0], 'https://immich.test/api/search/metadata')
    } finally {
      fetchStub.restore()
    }
  })

  test('n’interroge que l’album configuré', async ({ assert }) => {
    // La bibliothèque entière contient des photos personnelles : une requête sans `albumIds`
    // les ferait toutes entrer dans la veille — et, au lot 3, partir vers un LLM.
    const fetchStub = stubFetch(() => json({ assets: { items: [], nextPage: null } }))

    try {
      await new ImmichClient(CONFIG).albumAssets()

      const body = JSON.parse(fetchStub.inits[0].body as string)
      assert.deepEqual(body.albumIds, ['album-de-test'])
    } finally {
      fetchStub.restore()
    }
  })

  test('envoie la clé d’API en en-tête, et rien d’autre', async ({ assert }) => {
    const fetchStub = stubFetch(() => json({ assets: { items: [], nextPage: null } }))

    try {
      await new ImmichClient(CONFIG).albumAssets()

      const headers = fetchStub.inits[0].headers as Record<string, string>
      assert.equal(headers['x-api-key'], 'clé-de-test')
      // La clé ne doit jamais fuir dans l'URL : elle finirait dans les journaux du serveur
      // distant et dans tout mandataire de la chaîne.
      assert.notInclude(fetchStub.urls[0], 'clé-de-test')
    } finally {
      fetchStub.restore()
    }
  })

  test('ne suit jamais une redirection', async ({ assert }) => {
    // Comme le client LLM, et contrairement au collecteur RSS : une API n'a aucune redirection
    // légitime, et suivre un `Location` ferait sortir de l'hôte configuré — **avec la clé
    // d'API dans les en-têtes**.
    const fetchStub = stubFetch(
      () => new Response(null, { status: 302, headers: { location: 'https://ailleurs.test/' } })
    )

    try {
      await assert.rejects(
        () => new ImmichClient(CONFIG).albumAssets(),
        ImmichUnavailableError,
        /redirige/
      )
      assert.equal(fetchStub.inits[0].redirect, 'manual')
      // Un seul appel : la chaîne s'arrête, elle n'est pas suivie d'un saut.
      assert.lengthOf(fetchStub.urls, 1)
    } finally {
      fetchStub.restore()
    }
  })

  test('distingue une clé refusée d’un album introuvable', async ({ assert }) => {
    // Les deux sont des pannes de configuration, mais elles ne se réparent pas au même endroit
    // — et le message part dans `last_error`, affiché tel quel sur la source.
    const unauthorized = stubFetch(() => json({ message: 'Unauthorized' }, 401))
    try {
      await assert.rejects(
        () => new ImmichClient(CONFIG).albumAssets(),
        ImmichUnavailableError,
        /IMMICH_API_KEY/
      )
    } finally {
      unauthorized.restore()
    }

    // ⚠️ Immich rend **400**, pas 404, sur un album inconnu : le message doit le dire, sinon on
    // cherche une faute de frappe là où il n'y en a pas.
    const missing = stubFetch(() => json({ message: 'Not found or no album.read access' }, 400))
    try {
      await assert.rejects(
        () => new ImmichClient(CONFIG).albumAssets(),
        ImmichUnavailableError,
        /IMMICH_ALBUM_ID/
      )
    } finally {
      missing.restore()
    }
  })

  test('refuse une réponse sans bloc « assets »', async ({ assert }) => {
    // Du JSON valide qui n'est pas ce qu'on attend : une API qui a changé de forme. La lire
    // « au mieux » rendrait un album vide — encore le marquage de masse.
    const fetchStub = stubFetch(() => json({ resultat: [] }))

    try {
      await assert.rejects(
        () => new ImmichClient(CONFIG).albumAssets(),
        ImmichUnavailableError,
        /API a probablement changé/
      )
    } finally {
      fetchStub.restore()
    }
  })

  test('saute les assets illisibles sans faire échouer la page', async ({ assert }) => {
    // Un fichier audio dans l'album ne casse pas la collecte : il n'est simplement pas retenu.
    const fetchStub = stubFetch(() =>
      json({
        assets: {
          items: [asset(ID), asset(OTHER_ID, 'AUDIO'), { id: 'bricolé', type: 'IMAGE' }],
          nextPage: null,
        },
      })
    )

    try {
      const assets = await new ImmichClient(CONFIG).albumAssets()

      assert.lengthOf(assets, 1)
      assert.equal(assets[0].id, ID)
    } finally {
      fetchStub.restore()
    }
  })

  test('refuse une vignette qui n’est pas une image', async ({ assert }) => {
    // Même repli SPA que pour l'API : une route de vignette disparue rend du HTML en 200. Sans
    // ce contrôle, le proxy servirait la page d'accueil d'Immich sous un `content-type` d'image.
    const fetchStub = stubFetch(
      () =>
        new Response('<!doctype html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
    )

    try {
      await assert.rejects(
        () => new ImmichClient(CONFIG).thumbnail(ID),
        ImmichUnavailableError,
        /au lieu d'une image/
      )
    } finally {
      fetchStub.restore()
    }
  })

  test('restitue la vignette avec le type réel d’Immich', async ({ assert }) => {
    const fetchStub = stubFetch(
      () =>
        new Response(Buffer.from('webp'), {
          status: 200,
          headers: { 'content-type': 'image/webp' },
        })
    )

    try {
      const thumbnail = await new ImmichClient(CONFIG).thumbnail(ID)

      // Le type vient d'Immich, jamais d'une valeur devinée : c'est lui qu'on rendra au
      // navigateur, et `image/jpeg` sur du webp casserait l'affichage.
      assert.equal(thumbnail.contentType, 'image/webp')
      assert.equal(thumbnail.bytes.toString(), 'webp')
      assert.include(fetchStub.urls[0], `/api/assets/${ID}/thumbnail`)
    } finally {
      fetchStub.restore()
    }
  })

  // -------------------------------------------------------------------------------------------
  // CC-63 — la corbeille : ce qui est réellement envoyé, et ce qui ne l'est jamais
  // -------------------------------------------------------------------------------------------

  test('LE test de CC-63 : la suppression envoie force: false, et rien d’autre', async ({
    assert,
  }) => {
    /**
     * ⚠️ **`force: true` détruirait définitivement**, sans que Command Center ait de quoi
     * réparer — il ne garde aucune copie des octets. Ce test lit le corps réellement émis :
     * c'est le seul endroit du dépôt où cette valeur se prouve, et il rougit si quelqu'un
     * ajoute un paramètre pour « forcer quand c'est vraiment voulu ».
     */
    const fetchStub = stubFetch(() => new Response(null, { status: 204 }))

    try {
      await new ImmichClient(CONFIG).trashAssets([ID, OTHER_ID])

      assert.equal(fetchStub.inits[0].method, 'DELETE')
      assert.include(fetchStub.urls[0], '/api/assets')

      const body = JSON.parse(String(fetchStub.inits[0].body))
      assert.deepEqual(body.ids, [ID, OTHER_ID])
      assert.isFalse(body.force)
    } finally {
      fetchStub.restore()
    }
  })

  test('un 204 sans corps est un succès, pas une réponse illisible', async ({ assert }) => {
    /**
     * ⚠️ `DELETE /api/assets` rend **204 sans corps**. Passer par le lecteur JSON ferait échouer
     * l'assertion de `content-type` sur un appel **réussi** : les assets partiraient à la
     * corbeille, le code lèverait, rien ne serait marqué en base — la suppression paraîtrait
     * échouer à chaque clic tout en ayant lieu à chaque fois.
     */
    const fetchStub = stubFetch(() => new Response(null, { status: 204 }))

    try {
      // Ne lève pas — et la requête est bien partie : un succès silencieux qui n'appellerait
      // rien passerait ce test sans cette seconde assertion.
      await new ImmichClient(CONFIG).trashAssets([ID])
      assert.lengthOf(fetchStub.urls, 1)
    } finally {
      fetchStub.restore()
    }
  })

  test('une liste vide n’émet aucune requête', async ({ assert }) => {
    const fetchStub = stubFetch(() => new Response(null, { status: 204 }))

    try {
      await new ImmichClient(CONFIG).trashAssets([])
      assert.lengthOf(fetchStub.urls, 0)
    } finally {
      fetchStub.restore()
    }
  })

  test('un refus de la clé nomme la permission qui manque', async ({ assert }) => {
    // Une clé réduite mais mal réduite est le cas le plus probable après ce lot : le message
    // doit nommer `asset.delete`, pas parler d'une instance injoignable.
    const fetchStub = stubFetch(() => new Response(null, { status: 403 }))

    try {
      await assert.rejects(
        () => new ImmichClient(CONFIG).trashAssets([ID]),
        ImmichUnavailableError,
        /asset\.delete/
      )
    } finally {
      fetchStub.restore()
    }
  })

  test('trashDays se lit, et tout ce qui n’est pas un nombre vaut 0', async ({ assert }) => {
    /**
     * ⚠️ **Échec fermé.** Un champ absent, renommé par une version future ou rendu en chaîne ne
     * doit jamais se lire « corbeille active » : ce serait la seule erreur du lot qui détruit
     * pour de bon. Refuser ne coûte qu'un message.
     */
    for (const [payload, attendu] of [
      [{ trashDays: 30 }, 30],
      [{ trashDays: 0 }, 0],
      [{ trashDays: '30' }, 0],
      [{}, 0],
    ] as const) {
      const fetchStub = stubFetch(() => json(payload))

      try {
        assert.equal(await new ImmichClient(CONFIG).trashDays(), attendu)
        assert.include(fetchStub.urls[0], '/api/server/config')
      } finally {
        fetchStub.restore()
      }
    }
  })

  test('ne tente rien quand Immich n’est pas configuré', async ({ assert }) => {
    // Sans les trois variables, la collecte doit dire pourquoi — pas partir chercher
    // `undefined/api/...` et rapporter une erreur réseau qui n'explique rien.
    const fetchStub = stubFetch(() => json({}))

    try {
      await assert.rejects(
        () => new ImmichClient({ ...CONFIG, enabled: false }).albumAssets(),
        ImmichUnavailableError,
        /IMMICH_BASE_URL/
      )
      assert.lengthOf(fetchStub.urls, 0)
    } finally {
      fetchStub.restore()
    }
  })
})
