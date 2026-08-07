import { test } from '@japa/runner'
import { externalServicesIsolated } from '#config/env_isolation'
import immichConfig, { immichConfigFrom } from '#config/immich'
import youtubeConfig, { youtubeConfigFrom } from '#config/youtube'
import llmConfig, { llmConfigFrom, LLM_DEFAULT_BASE_URL, LLM_DEFAULT_MODEL } from '#config/llm'
import coffreImmichConfig, { coffreImmichConfigFrom } from '#config/coffre_immich'

/**
 * CC-101 — « aucun test ne touche une vraie instance » devient une propriété du code.
 *
 * ⚠️ **Ces tests passent un environnement FACTICE, jamais le `.env` de la machine.** C'est tout
 * l'enjeu : une spec qui se contenterait de lire les singletons serait verte sur un poste au `.env`
 * vide **même si la garde était retirée** — elle prouverait l'absence de configuration, pas
 * l'isolation. Le test doit mordre partout, donc il fournit lui-même une configuration complète.
 *
 * ⚠️ Ce sont les fonctions `*ConfigFrom` des `config/*.ts` qui sont appelées, pas une recomposition
 * locale de `externalServicesIsolated` et `normalize*`. Recomposer ici prouverait l'expression de ce
 * fichier ; retirer la garde d'un `config/*.ts` laisserait la spec verte.
 */
test.group('Isolation des clients externes pendant les tests', () => {
  /**
   * ⚠️ La garde reconnaît `'test'` et rien d'autre. `start/env.ts` restreint `NODE_ENV` à
   * `development | production | test` : c'est cet enum qui garantit qu'aucune autre valeur ne
   * désigne un environnement de test. En ajouter une (le chargeur d'AdonisJS connaît aussi
   * `'testing'`) sans l'ajouter ici désarmerait l'isolation en silence.
   */
  test('la garde ne reconnaît que NODE_ENV=test', ({ assert }) => {
    assert.isTrue(externalServicesIsolated('test'))

    assert.isFalse(externalServicesIsolated('development'))
    assert.isFalse(externalServicesIsolated('production'))
    assert.isFalse(externalServicesIsolated(undefined))
    assert.isFalse(externalServicesIsolated(''))
  })

  /**
   * Le cœur du ticket : un environnement **pleinement configuré** n'active aucun client externe
   * quand `NODE_ENV` vaut `test`. C'est la situation réelle de tout poste de développement — le
   * `.env` porte une vraie instance Immich et une vraie clé YouTube, et `.env.test` ne les masque
   * pas, quoi qu'on y écrive.
   */
  test('un environnement plein n’active aucun client sous NODE_ENV=test', ({ assert }) => {
    const immich = immichConfigFrom('test', {
      baseUrl: 'https://immich.exemple.dev',
      apiKey: 'clef-immich-reelle',
      albumId: 'fb5eb1db-0000-0000-0000-000000000000',
    })
    assert.isFalse(immich.enabled, 'Immich resterait joignable pendant npm test')

    const youtube = youtubeConfigFrom('test', {
      apiKey: 'AIza-clef-reelle',
      playlistId: 'PLfQaAPvny1wA',
    })
    assert.isFalse(youtube.enabled, 'le quota YouTube du jour serait en jeu pendant npm test')

    /**
     * Le LLM n'a pas d'`enabled` — il a une URL par défaut. Ce que l'isolation garantit ici, c'est
     * qu'aucune valeur du `.env` personnel n'entre dans la suite : ni la clé, ni le modèle, ni un
     * hôte particulier.
     */
    const llm = llmConfigFrom('test', {
      baseUrl: 'http://127.0.0.1:9999/v1',
      model: 'un-gros-modele-du-poste',
      apiKey: 'clef-llm-du-poste',
      timeoutMs: 5_000,
    })
    assert.isUndefined(llm.apiKey, 'la clé du .env entrerait dans les tests')
    assert.equal(llm.baseUrl, LLM_DEFAULT_BASE_URL)
    assert.equal(llm.model, LLM_DEFAULT_MODEL)

    /**
     * ⚠️ **Le cas le plus sensible du lot (CC-205)** : ces trois valeurs sont les identifiants
     * COMPLETS d'un compte Immich, pas une clé à portée réduite. Sans cette garde, un poste de dev
     * dont le `.env` réel les configure enverrait de vrais identifiants vers une vraie instance
     * pendant `npm test`.
     */
    const coffreImmich = coffreImmichConfigFrom('test', {
      baseUrl: 'https://immich.exemple.dev',
      email: 'proprietaire@exemple.dev',
      password: 'mot-de-passe-reel',
      pinCode: '123456',
    })
    assert.isFalse(
      coffreImmich.enabled,
      'le dossier verrouillé resterait joignable pendant npm test'
    )
  })

  /**
   * ⚠️ **Le contre-test, sans lequel le précédent ne prouve rien.** Une garde qui désactiverait
   * *toujours* — `return normalize({})` sans condition — passerait le test ci-dessus sans broncher,
   * et casserait la collecte en production sans qu'une seule spec ne rougisse. Le même
   * environnement, hors test, doit configurer les trois clients.
   */
  test('hors test, le même environnement configure bien les trois clients', ({ assert }) => {
    const immich = immichConfigFrom('development', {
      baseUrl: 'https://immich.exemple.dev',
      apiKey: 'clef-immich-reelle',
      albumId: 'fb5eb1db-0000-0000-0000-000000000000',
    })
    assert.isTrue(immich.enabled)
    assert.equal(immich.baseUrl, 'https://immich.exemple.dev')

    const youtube = youtubeConfigFrom('production', {
      apiKey: 'AIza-clef-reelle',
      playlistId: 'PLfQaAPvny1wA',
    })
    assert.isTrue(youtube.enabled)
    assert.equal(youtube.playlistId, 'PLfQaAPvny1wA')

    const llm = llmConfigFrom('development', { apiKey: 'clef-llm-du-poste', model: 'mistral' })
    assert.equal(llm.apiKey, 'clef-llm-du-poste')
    assert.equal(llm.model, 'mistral')

    const coffreImmich = coffreImmichConfigFrom('development', {
      baseUrl: 'https://immich.exemple.dev',
      email: 'proprietaire@exemple.dev',
      password: 'mot-de-passe-reel',
      pinCode: '123456',
    })
    assert.isTrue(coffreImmich.enabled)
    assert.equal(coffreImmich.baseUrl, 'https://immich.exemple.dev')
  })

  /**
   * La couture restante : que les singletons soient bien construits **à travers** ces fonctions.
   *
   * ⚠️ **Ce test-ci est le seul du fichier dont la morsure dépend de la machine** — sur un poste
   * dont le `.env` ne configure rien, il passerait même sans garde. Il ne remplace pas les
   * précédents, il vérifie le câblage : `env.get('NODE_ENV')` réellement passé à `*ConfigFrom`.
   */
  test('les configurations chargées par la suite sont inertes', ({ assert }) => {
    assert.isFalse(immichConfig.enabled)
    assert.isFalse(youtubeConfig.enabled)
    assert.isUndefined(llmConfig.apiKey)
    assert.isFalse(coffreImmichConfig.enabled)
  })
})
