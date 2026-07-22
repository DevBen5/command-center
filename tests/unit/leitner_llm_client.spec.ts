import { test } from '@japa/runner'
import LlmClient, { DEFAULT_TEMPERATURE } from '#modules/leitner/services/llm_client'

/**
 * Ce que le client **envoie réellement** sur le fil. Le faux client (`FakeLlmClient`)
 * enregistre les options reçues, mais il ne prouve pas ce que le vrai en fait : c'est
 * ici, et nulle part ailleurs, que le corps de la requête se vérifie.
 *
 * Ce que ce fichier enterre : **abaisser le défaut de température « puisque le juge veut
 * 0 »**. Le juge et l'ingestion partagent ce client ; leurs besoins sont opposés (noter
 * vs synthétiser), et la seule chose qui les tienne séparés est que la surcharge se
 * demande appel par appel. Un défaut qui glisserait changerait le comportement de
 * l'ingestion sans qu'aucun test d'ingestion ne bronche.
 *
 * `fetch` est remplacé le temps du test : aucun réseau, aucun serveur — comme partout
 * dans ce dépôt.
 */
function captureRequest(): { body: () => any; restore: () => void } {
  const original = globalThis.fetch
  let captured: any = null

  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    captured = JSON.parse(init.body as string)
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
    })
  }) as typeof globalThis.fetch

  return {
    body: () => captured,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

test.group('Leitner / client LLM — ce qui part sur le fil', () => {
  test("sans surcharge, la température est celle de l'ingestion", async ({ assert }) => {
    const request = captureRequest()

    try {
      await new LlmClient().complete([{ role: 'user', content: 'Bonjour' }])
    } finally {
      request.restore()
    }

    // ⚠️ 0.2 : une synthèse doit rendre la même sortie sur le même cours. C'est le
    // défaut historique du module, et le juge ne l'a pas déplacé.
    assert.equal(request.body().temperature, DEFAULT_TEMPERATURE)
    assert.equal(DEFAULT_TEMPERATURE, 0.2)
  })

  test('une surcharge à 0 est transmise telle quelle', async ({ assert }) => {
    const request = captureRequest()

    try {
      await new LlmClient().complete([{ role: 'user', content: 'Bonjour' }], { temperature: 0 })
    } finally {
      request.restore()
    }

    // `?? DEFAULT_TEMPERATURE` et non `|| DEFAULT_TEMPERATURE` : 0 est falsy, et un
    // `||` renverrait donc 0.2 — le juge improviserait, en silence.
    assert.equal(request.body().temperature, 0)
  })
})
