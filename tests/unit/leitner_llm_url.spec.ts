import { test } from '@japa/runner'
import { errors as vineErrors } from '@vinejs/vine'
import {
  llmDetectValidator,
  llmModelsValidator,
  llmTestValidator,
} from '#modules/leitner/validators/leitner'

/**
 * La liste blanche des URL de diagnostic — **le rempart SSRF du module**.
 *
 * L'écran de configuration fait émettre au serveur des requêtes vers une URL saisie
 * par l'utilisateur : il faut bien tester la valeur avant de la coller dans `.env`.
 * Ce validateur est ce qui empêche cette nécessité de devenir une SSRF. S'il tombe,
 * `/revision/llm/models` sonde `169.254.169.254` (métadonnées cloud) ou n'importe quel
 * hôte interne, et le module devient un proxy.
 */
async function accepts(url: string): Promise<boolean> {
  try {
    await llmModelsValidator.validate({ baseUrl: url })
    return true
  } catch (error) {
    if (error instanceof vineErrors.E_VALIDATION_ERROR) return false
    throw error
  }
}

test.group('Leitner / liste blanche des URL du serveur LLM', () => {
  test('accepte le loopback et les plages privées', async ({ assert }) => {
    for (const url of [
      'http://127.0.0.1:1234/v1',
      'http://127.5.4.3:8080/v1',
      'http://localhost:8080/v1',
      'http://[::1]:1234/v1',
      'https://192.168.1.20:11434/v1',
      'http://10.0.0.7:1234/v1',
      'http://172.16.0.1:1234/v1',
      'http://172.31.255.254:1234/v1',
    ]) {
      assert.isTrue(await accepts(url), `${url} aurait dû être accepté`)
    }
  })

  test('refuse tout le reste', async ({ assert }) => {
    for (const url of [
      // Internet.
      'http://8.8.8.8',
      'https://example.com',
      'https://example.com:1234/v1',
      // Métadonnées cloud : la cible classique d'une SSRF.
      'http://169.254.169.254',
      'http://169.254.169.254/latest/meta-data/',
      // Un schéma qui n'est pas HTTP.
      'ftp://127.0.0.1',
      'file:///etc/passwd',
      // Un nom de domaine, même s'il ressemble à du local : seule une IP littérale
      // (ou `localhost`) est acceptée — un nom peut résoudre où il veut.
      'http://localhost.evil.example/v1',
      'http://127.0.0.1.evil.example/v1',
      // L'hôte n'est pas celui qu'on croit lire.
      'http://127.0.0.1@evil.example/v1',
      // Juste hors des plages privées.
      'http://172.15.0.1:1234/v1',
      'http://172.32.0.1:1234/v1',
      'http://192.169.1.1:1234/v1',
      'http://11.0.0.1:1234/v1',
      // Pas une URL du tout.
      'pas une url',
      '',
    ]) {
      assert.isFalse(await accepts(url), `${url} aurait dû être refusé`)
    }
  })

  test('la forme canonique de l’hôte fait foi, pas ce qui est tapé', async ({ assert }) => {
    // Le parseur d'URL normalise l'IPv4 : `0x7f000001` et `2130706433` sont 127.0.0.1.
    // La comparaison porte donc sur l'hôte normalisé — un décimal ou un hexadécimal ne
    // contourne rien, ni dans un sens, ni dans l'autre.
    assert.isTrue(await accepts('http://2130706433:1234/v1'))
    assert.isFalse(await accepts('http://134744072:1234/v1')) // 8.8.8.8
  })

  test('les trois routes de diagnostic partagent la même liste blanche', async ({ assert }) => {
    for (const validator of [llmDetectValidator, llmTestValidator]) {
      await assert.rejects(() => validator.validate({ baseUrl: 'http://169.254.169.254' }))
    }

    // `detect` et `test` acceptent l'absence d'URL : c'est la configuration chargée
    // (celle de l'environnement) qui est alors sondée — elle ne vient d'aucune requête.
    assert.deepEqual(await llmDetectValidator.validate({}), {})
    assert.deepEqual(await llmTestValidator.validate({}), {})
  })
})
