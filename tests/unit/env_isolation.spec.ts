import { test } from '@japa/runner'
import { externalServicesIsolated } from '#config/env_isolation'
import immichConfig, { immichConfigFrom } from '#config/immich'
import youtubeConfig, { youtubeConfigFrom } from '#config/youtube'
import llmConfig, { llmConfigFrom, LLM_DEFAULT_BASE_URL, LLM_DEFAULT_MODEL } from '#config/llm'
import coffreImmichConfig, { coffreImmichConfigFrom } from '#config/coffre_immich'
import backupEncryptionConfig, { backupEncryptionConfigFrom } from '#config/backup'
import coffreNasConfig, { coffreNasConfigFrom } from '#config/coffre_nas'

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
 *
 * ⚠️ **`config/backup.ts` (CC-231) et `config/coffre_nas.ts` (CC-232) sont entrés ici sans être
 * des clients externes** — aucun appel réseau, aucune instance à joindre : l'un est une clé
 * publique age, l'autre des chemins de disque. Ce que la fusion par truthiness menace, c'est
 * n'importe quelle variable lue hors d'un `config/*.ts` : `BackupService` lisait
 * `BACKUP_ENCRYPTION_RECIPIENT` en `env.get(...)` direct, et la suite chiffrait ses dumps avec la
 * clé publique réelle du propriétaire dès que le poste activait la fonctionnalité — et sans la
 * garde de `coffre_nas.ts`, un `.env` de poste de dev ferait lire aux tests un vrai dossier, à
 * parcourir puis (CC-226) indexer. Le titre du groupe dit « clients externes » pour des raisons
 * historiques (CC-101) ; la propriété réellement tenue est « aucune valeur du `.env` de la
 * machine n'entre dans la suite ».
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

    /**
     * ⚠️ **CC-231 — le seul cas du lot qui ne parle à personne sur le réseau.** Sans cette garde,
     * la suite chiffre ses dumps de test avec la clé publique RÉELLE du propriétaire, et surtout
     * le test « pas de clé configurée ⇒ dump en clair » — le comportement que reçoit toute
     * installation tierce — rougit en permanence sur le poste qui a activé la fonctionnalité,
     * en exerçant l'autre branche. Un gate rouge en permanence cesse d'être un gate.
     */
    const backup = backupEncryptionConfigFrom('test', {
      recipient: 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3wzz0m',
    })
    assert.isUndefined(backup.recipient, 'les dumps de test seraient chiffrés avec la clé du poste')

    /**
     * ⚠️ **CC-232 — le second cas qui ne parle à personne sur le réseau.** Sans cette garde, la
     * suite lirait un vrai dossier du poste : parcouru par `NasRootsService`, et depuis CC-226
     * indexé dans le catalogue.
     */
    const coffreNas = coffreNasConfigFrom('test', {
      roots: 'photos=D:\\Medias\\command-center,videos=D:\\Medias\\command-center-videos',
    })
    assert.deepEqual(
      coffreNas.roots,
      [],
      'un vrai dossier du poste serait parcouru pendant npm test'
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

    // ⚠️ Sans ce contre-test, une garde qui neutraliserait TOUJOURS passerait au vert tout en
    // envoyant en clair, sur un NAS, les sauvegardes d'une installation qui croit les chiffrer.
    const backup = backupEncryptionConfigFrom('production', {
      recipient: 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3wzz0m',
    })
    assert.equal(backup.recipient, 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3wzz0m')

    // ⚠️ Même contre-test côté coffre_nas : une garde toujours coupée viderait aussi cette liste
    // en production, et le module coffre perdrait ses racines sans qu'aucun test ne rougisse.
    const coffreNas = coffreNasConfigFrom('production', {
      roots: 'photos=D:\\Medias\\command-center,videos=D:\\Medias\\command-center-videos',
    })
    assert.deepEqual(coffreNas.roots, [
      { name: 'photos', path: 'D:\\Medias\\command-center' },
      { name: 'videos', path: 'D:\\Medias\\command-center-videos' },
    ])
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
    assert.isUndefined(backupEncryptionConfig.recipient)
    assert.deepEqual(coffreNasConfig.roots, [])
  })
})
