import { createServer, type Server } from 'node:http'
import { test } from '@japa/runner'
import LlmClient, { LlmUnavailableError } from '#modules/leitner/services/llm_client'

/**
 * Les redirections ne sont **jamais suivies** — le complément de la liste blanche SSRF.
 *
 * `isLocalLlmUrl` (validateurs du module) ne valide que l'**URL saisie**. Elle ne dit
 * rien de la cible d'un `Location` : un hôte loopback ou privé, accepté par la liste,
 * qui répond `302 Location: http://169.254.169.254/…` sortirait du périmètre sans que
 * rien ne l'arrête — et `listModels` / `test` rendraient le contenu récupéré au client.
 * Le défaut d'undici est `redirect: 'follow'`, jusqu'à 20 sauts : c'est un choix qui
 * doit être écrit, pas hérité.
 *
 * ⚠️ **C'est le seul test du dépôt qui fasse émettre au vrai `LlmClient` une requête**,
 * et c'est inévitable : tous les autres passent par le faux client, qui ne fait pas de
 * réseau et ne peut donc pas voir ce défaut. (La suite fonctionnelle ouvre bien une
 * socket, elle aussi — `testUtils.httpServer().start()` dans `tests/bootstrap.ts` —
 * mais elle *reçoit*, elle n'émet jamais.) Deux serveurs jetables sur `127.0.0.1:0`
 * (port éphémère), fermés en teardown — **jamais** le réseau, et jamais un port fixe
 * qui entrerait en conflit.
 *
 * ⚠️ **La cible rend une réponse VALIDE, et c'est ce qui fait le test.** Un test qui
 * n'asserterait que « ça lève » passerait à tort : une redirection suivie vers un hôte
 * qui répond du charabia lève aussi. Ici, si la redirection était suivie, `listModels`
 * **réussirait** en rendant `['modele-de-la-cible']`. C'est l'**absence de requête**
 * (`hits === 0`) qui est l'objet, pas l'erreur.
 */
function servers() {
  let hits = 0

  const target = createServer((_request, response) => {
    hits += 1
    response.writeHead(200, { 'content-type': 'application/json' })
    // Une réponse que le client sait lire : suivre la redirection serait un SUCCÈS.
    response.end(
      JSON.stringify({
        data: [{ id: 'modele-de-la-cible' }],
        choices: [{ message: { content: 'contenu de la cible' } }],
      })
    )
  })

  const redirector = createServer((_request, response) => {
    response.writeHead(302, { location: `http://127.0.0.1:${port(target)}/models` })
    response.end()
  })

  return {
    async listen() {
      await Promise.all([bind(target), bind(redirector)])
      return `http://127.0.0.1:${port(redirector)}/v1`
    },
    hits: () => hits,
    async close() {
      await Promise.all([shut(target), shut(redirector)])
    },
  }
}

function bind(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
}

function shut(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

function port(server: Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('serveur non démarré')
  return address.port
}

test.group('Leitner / le client LLM ne suit pas les redirections', (group) => {
  let local: ReturnType<typeof servers>
  let baseUrl: string

  group.each.setup(async () => {
    local = servers()
    baseUrl = await local.listen()
    // ⚠️ Fermer même si une assertion échoue : la suite unit tourne avec
    // `forceExit: false` (adonisrc.ts), un serveur laissé ouvert fige `npm test`.
    return () => local.close()
  })

  test('un 302 sur /models n’est pas suivi', async ({ assert }) => {
    await assert.rejects(() => new LlmClient().listModels(baseUrl), LlmUnavailableError)

    // La seule assertion qui prouve quelque chose : la cible n'a rien reçu.
    assert.equal(local.hits(), 0, 'la cible de la redirection a été appelée')
  })

  test('un 302 sur /chat/completions n’est pas suivi', async ({ assert }) => {
    // ⚠️ `target` n'est pas décoratif : sans lui, `complete()` appelle l'URL de
    // l'environnement (`LLM_BASE_URL`, éteinte en test) et le test passerait au vert
    // sans jamais avoir parlé au redirecteur — vert pour la mauvaise raison.
    await assert.rejects(
      () =>
        new LlmClient().complete([{ role: 'user', content: 'Bonjour' }], {
          target: { baseUrl },
          timeoutMs: 1_000,
        }),
      LlmUnavailableError
    )

    assert.equal(local.hits(), 0, 'la cible de la redirection a été appelée')
  })

  test('le message nomme la redirection, pas un serveur injoignable', async ({ assert }) => {
    // ⚠️ Le serveur a répondu, tout de suite. Le `catch` des deux méthodes traduit
    // n'importe quel échec en « injoignable ou n'a pas répondu en moins de N s » :
    // laisser le refus passer par là dirait le contraire de ce qui s'est produit, et
    // enverrait chercher une panne réseau qui n'existe pas.
    const error = await new LlmClient().listModels(baseUrl).catch((raised: unknown) => raised)

    assert.instanceOf(error, LlmUnavailableError)
    assert.include((error as Error).message, 'redirection')
    assert.notInclude((error as Error).message, 'injoignable')
  })

  test('une sonde vers un serveur qui redirige est un échec, pas un succès', async ({ assert }) => {
    // `ping` avale l'erreur et rend `false` — un serveur qui redirige est inutilisable,
    // il se lit « éteint » à la détection. Ce qui compte ici : il ne rend pas `true`.
    assert.isFalse(await new LlmClient().ping(baseUrl))
    assert.equal(local.hits(), 0, 'la cible de la redirection a été appelée')
  })
})
