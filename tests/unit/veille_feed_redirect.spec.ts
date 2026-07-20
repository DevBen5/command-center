import { createServer, type Server } from 'node:http'
import { test } from '@japa/runner'
import FeedFetcher, { FeedUnavailableError } from '#modules/veille/services/feed_fetcher'

/**
 * Les redirections d'un flux : **suivies, mais jamais aveuglément**.
 *
 * C'est le complément de la garde SSRF (`veille_feed_url.spec.ts`), et il est indispensable :
 * la garde ne juge que l'URL **saisie**. La cible d'un `Location` est choisie par le serveur
 * distant, pas par l'utilisateur — un flux public parfaitement légitime peut répondre
 * `302 Location: http://169.254.169.254/…`. C'est le vecteur réel, davantage que la saisie.
 *
 * Contrairement au client LLM (qui refuse tout 3xx : un serveur compatible OpenAI n'a aucune
 * redirection légitime), un flux RSS en a constamment — http→https, domaine changé, FeedBurner.
 * On suit donc jusqu'à 3 sauts, **en repassant la garde en entier à chaque `Location`**.
 *
 * ⚠️ **C'est le seul test du module qui fasse émettre une vraie requête**, et c'est inévitable :
 * le faux fetcher ne fait pas de réseau, il ne peut donc pas voir ce défaut. Serveurs jetables
 * sur `127.0.0.1:0` (port éphémère), fermés en teardown — jamais un port fixe.
 *
 * ⚠️ **La cible rend un flux VALIDE, et c'est ce qui fait le test.** Si `redirect: 'manual'`
 * disparaissait, undici suivrait tout seul (20 sauts par défaut), notre boucle ne verrait jamais
 * le 3xx, et `fetch()` **réussirait** en rendant le contenu de la cible. C'est donc l'absence de
 * requête (`hits === 0`) qui est l'objet du test, pas l'exception.
 */

const FLUX_VALIDE = `<?xml version="1.0"?><rss version="2.0"><channel>
  <title>Cible</title>
  <item><title>Contenu de la cible</title><link>https://exemple.dev/cible</link></item>
</channel></rss>`

/**
 * La garde réelle refuse `127.0.0.1` : sans cet assouplissement, aucun serveur de test ne serait
 * joignable et la mécanique des redirections resterait sans preuve.
 *
 * ⚠️ Il ne porte que sur les origines **explicitement** listées — la cible du `Location`, elle,
 * passe par `super`, donc par la garde de production. C'est exactement ce qu'on veut prouver.
 */
class FetcherAvecOriginesDeTest extends FeedFetcher {
  constructor(private autorisees: string[]) {
    super()
  }

  protected async assertReachableTarget(rawUrl: string): Promise<void> {
    if (this.autorisees.some((origine) => rawUrl.startsWith(origine))) return
    return super.assertReachableTarget(rawUrl)
  }
}

function bind(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
}

function shut(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

function origin(server: Server): string {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('serveur non démarré')
  return `http://127.0.0.1:${address.port}`
}

test.group('Veille / les redirections d’un flux', (group) => {
  let cible: Server
  let cibleHits = 0
  const ouverts: Server[] = []

  group.each.setup(async () => {
    cibleHits = 0
    cible = createServer((_request, response) => {
      cibleHits += 1
      response.writeHead(200, { 'content-type': 'application/rss+xml' })
      // Une réponse que le parseur sait lire : suivre la redirection serait un SUCCÈS.
      response.end(FLUX_VALIDE)
    })
    await bind(cible)
    ouverts.push(cible)

    // ⚠️ Fermer même si une assertion échoue : la suite unit tourne avec `forceExit: false`
    // (adonisrc.ts), un serveur laissé ouvert fige `npm test`.
    return async () => {
      await Promise.all(ouverts.splice(0).map(shut))
    }
  })

  async function redirecteur(vers: () => string, status = 302): Promise<Server> {
    const server = createServer((_request, response) => {
      response.writeHead(status, { location: vers() })
      response.end()
    })
    await bind(server)
    ouverts.push(server)
    return server
  }

  test('une redirection vers une cible interne n’est pas suivie', async ({ assert }) => {
    // Le redirecteur est joignable (origine de test) ; sa cible est du loopback, donc jugée
    // par la garde réelle.
    const relais = await redirecteur(() => `${origin(cible)}/feed.xml`)
    const fetcher = new FetcherAvecOriginesDeTest([origin(relais)])

    await assert.rejects(() => fetcher.fetch(`${origin(relais)}/feed.xml`), FeedUnavailableError)

    // La seule assertion qui prouve quelque chose : la cible n'a rien reçu.
    assert.equal(cibleHits, 0, 'la cible de la redirection a été appelée')
  })

  test('le message nomme la cible refusée, pas un flux injoignable', async ({ assert }) => {
    const relais = await redirecteur(() => `${origin(cible)}/feed.xml`)
    const fetcher = new FetcherAvecOriginesDeTest([origin(relais)])

    const error = await fetcher.fetch(`${origin(relais)}/feed.xml`).catch((e: unknown) => e)

    assert.instanceOf(error, FeedUnavailableError)
    // ⚠️ Le serveur a répondu, tout de suite. Si le refus passait par le `catch` de `request()`,
    // il serait ré-écrit en « injoignable ou n'a pas répondu en moins de 10 s » — le contraire
    // de ce qui s'est produit, et on chercherait une panne réseau qui n'existe pas.
    assert.notInclude((error as Error).message, 'injoignable')
    assert.include((error as Error).message.toLowerCase(), 'publique')
  })

  test('une redirection légitime EST suivie', async ({ assert }) => {
    // Le pendant du test précédent : refuser tout 3xx casserait les flux qui migrent en https
    // ou changent de domaine. Ici les deux sauts sont autorisés — la chaîne aboutit.
    const relais = await redirecteur(() => `${origin(cible)}/feed.xml`)
    const fetcher = new FetcherAvecOriginesDeTest([origin(relais), origin(cible)])

    const response = await fetcher.fetch(`${origin(relais)}/feed.xml`)

    assert.equal(response.status, 'ok')
    assert.include(response.status === 'ok' ? response.body : '', 'Contenu de la cible')
    assert.equal(cibleHits, 1)
  })

  test('une chaîne de plus de 3 redirections est coupée', async ({ assert }) => {
    // Une boucle de redirections ne doit pas tourner indéfiniment.
    const boucle = createServer((_request, response) => {
      response.writeHead(302, { location: `${origin(boucle)}/encore` })
      response.end()
    })
    await bind(boucle)
    ouverts.push(boucle)

    const fetcher = new FetcherAvecOriginesDeTest([origin(boucle)])

    const error = await fetcher.fetch(`${origin(boucle)}/feed.xml`).catch((e: unknown) => e)

    assert.instanceOf(error, FeedUnavailableError)
    assert.include((error as Error).message, 'redirection')
  })

  test('la garde s’applique AVANT la requête, pas après', async ({ assert }) => {
    // Le fetcher de production, sans assouplissement : l'adresse est du loopback, donc rien
    // ne part sur le fil. `hits === 0` le prouve — un refus tardif aurait déjà tapé le serveur.
    await assert.rejects(
      () => new FeedFetcher().fetch(`${origin(cible)}/feed.xml`),
      FeedUnavailableError
    )

    assert.equal(cibleHits, 0, 'une requête est partie vers une adresse interdite')
  })

  test('une redirection sans en-tête Location est une erreur, pas un succès muet', async ({
    assert,
  }) => {
    const muet = createServer((_request, response) => {
      response.writeHead(302)
      response.end()
    })
    await bind(muet)
    ouverts.push(muet)

    const fetcher = new FetcherAvecOriginesDeTest([origin(muet)])
    const error = await fetcher.fetch(`${origin(muet)}/feed.xml`).catch((e: unknown) => e)

    assert.instanceOf(error, FeedUnavailableError)
    assert.include((error as Error).message, 'Location')
  })
})
