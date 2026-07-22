import { test } from '@japa/runner'
import {
  assetIdFromDedupKey,
  immichDedupKey,
  isImmichAssetId,
  networkTagFor,
  parseAsset,
  parseDurationSeconds,
} from '#modules/veille/services/immich_asset'

const ID = '219187d7-5320-498f-9c59-47a03bbdb491'

/**
 * La lecture d'un asset Immich — du code pur, donc le test qui compte de ce lot.
 *
 * Les formes réelles viennent d'un relevé sur une instance **v2.6.1** : c'est la seule chose qui
 * empêche ces tests de ne prouver que ma propre lecture de la documentation.
 */
test.group('Veille / lecture d’un asset Immich', () => {
  test('lit les deux formes de durée que rend Immich', ({ assert }) => {
    // ⚠️ Les deux existent sur la même instance : heures sur deux chiffres pour une vidéo,
    // sur un seul pour une image. Une regex trop stricte lirait `null` sur la moitié des
    // assets, et la durée disparaîtrait sans qu'aucune erreur ne le signale.
    assert.equal(parseDurationSeconds('00:01:04.362'), 64)
    assert.equal(parseDurationSeconds('01:02:03.000'), 3723)
    assert.equal(parseDurationSeconds('0:00:12.5'), 12)

    // Immich écrit `0:00:00.00000` sur **toutes** les images : « 0 s » affiché sous une photo
    // serait une mesure là où il n'y a rien à mesurer.
    assert.isNull(parseDurationSeconds('0:00:00.00000'))
    assert.isNull(parseDurationSeconds('bavardage'))
    assert.isNull(parseDurationSeconds(undefined))
    assert.isNull(parseDurationSeconds(64))
  })

  test('déduit le réseau du nom de fichier, et seulement quand il y est', ({ assert }) => {
    // Le cas réel, relevé dans l'album : une capture d'écran Android nomme l'application.
    assert.equal(networkTagFor('Screenshot_20260721_105950_TikTok.jpg'), 'tiktok')
    assert.equal(networkTagFor('reddit-2026-07-21.mp4'), 'reddit')
    assert.equal(networkTagFor('insta_story.mp4'), 'instagram')

    // ⚠️ Le cœur de la règle : sans réseau lisible, **on ne devine pas**. Un tag faux se
    // retrouverait dans la barre de tags et dans les filtres, où il ment durablement.
    assert.isNull(networkTagFor('IMG_2043.jpg'))
    assert.isNull(networkTagFor('VID_20260721_105950.mp4'))
    assert.isNull(networkTagFor(''))
  })

  test('ne reconnaît un réseau que sur un jeton entier', ({ assert }) => {
    // Un `includes()` étiquetterait ces trois-là. Le découpage sur les non-alphanumériques est
    // ce qui l'empêche — et c'est la seule raison pour laquelle `x` (Twitter) n'est pas listé :
    // un jeton d'une lettre apparaît partout.
    assert.isNull(networkTagFor('retikTokage.mp4'))
    assert.isNull(networkTagFor('IMG_x2.jpg'))
    assert.isNull(networkTagFor('video-x.mp4'))
  })

  test('n’accepte comme identifiant qu’un UUID', ({ assert }) => {
    // ⚠️ L'identifiant finit dans un chemin d'URL : un `..%2f..` y ferait de la traversée. Ce
    // contrôle est une défense en profondeur — la garantie réelle est que le proxy relit l'UUID
    // depuis notre base — mais il garantit qu'un identifiant malformé n'y entre jamais.
    assert.isTrue(isImmichAssetId(ID))
    assert.isFalse(isImmichAssetId('../../../api/users'))
    assert.isFalse(isImmichAssetId('219187d7532049 8f9c5947a03bbdb491'))
    assert.isFalse(isImmichAssetId(''))
    assert.isFalse(isImmichAssetId(42))
  })

  test('fait un aller-retour entre la clé de dédup et l’identifiant', ({ assert }) => {
    assert.equal(immichDedupKey(ID), `immich:${ID}`)
    assert.equal(assetIdFromDedupKey(immichDedupKey(ID)), ID)
  })

  test('ne rend un identifiant que pour une vraie clé Immich', ({ assert }) => {
    // C'est ce qui fait l'autorisation du proxy de vignette : un article, une capture manuelle
    // (clé nulle) ou une clé bricolée ne rendent **rien**, donc ne servent aucune vignette.
    assert.isNull(assetIdFromDedupKey('url:https://exemple.dev/article'))
    assert.isNull(assetIdFromDedupKey(null))
    assert.isNull(assetIdFromDedupKey('immich:../../secret'))
    assert.isNull(assetIdFromDedupKey('immich:'))
  })

  test('lit un asset image tel que l’instance le rend', ({ assert }) => {
    const asset = parseAsset({
      id: ID,
      type: 'IMAGE',
      originalFileName: 'Screenshot_20260721_105950_TikTok.jpg',
      fileCreatedAt: '2026-07-21T08:59:50.413Z',
      duration: '0:00:00.00000',
    })

    assert.isNotNull(asset)
    assert.equal(asset!.type, 'image')
    assert.equal(asset!.fileName, 'Screenshot_20260721_105950_TikTok.jpg')
    assert.equal(asset!.network, 'tiktok')
    assert.isNull(asset!.durationSeconds)
    assert.equal(asset!.takenAt?.toUTC().toISO(), '2026-07-21T08:59:50.413Z')
  })

  test('ne porte une durée que sur une vidéo', ({ assert }) => {
    const video = parseAsset({ id: ID, type: 'VIDEO', duration: '00:01:04.362' })
    assert.equal(video!.durationSeconds, 64)

    // Une image qui porterait une durée non nulle ne doit pas en gagner une pour autant : c'est
    // le type qui décide, pas la valeur.
    const image = parseAsset({ id: ID, type: 'IMAGE', duration: '00:01:04.362' })
    assert.isNull(image!.durationSeconds)
  })

  test('saute ce qu’il ne sait pas lire, plutôt que de le deviner', ({ assert }) => {
    // ⚠️ Immich connaît aussi AUDIO et OTHER. Les convertir en `image` remplirait la liste
    // d'items dont la vignette n'existerait pas.
    assert.isNull(parseAsset({ id: ID, type: 'AUDIO' }))
    assert.isNull(parseAsset({ id: ID, type: 'OTHER' }))
    assert.isNull(parseAsset({ id: 'pas-un-uuid', type: 'IMAGE' }))
    assert.isNull(parseAsset({ type: 'IMAGE' }))
    assert.isNull(parseAsset(null))
    assert.isNull(parseAsset('IMAGE'))
  })

  test('donne un titre neutre à un asset sans nom, sans inventer de tag', ({ assert }) => {
    const asset = parseAsset({ id: ID, type: 'IMAGE' })

    assert.equal(asset!.fileName, 'Asset 219187d7')
    assert.isNull(asset!.network)
  })

  test('rend une date nulle plutôt qu’une date invalide', ({ assert }) => {
    // Une date invalide de Luxon contamine toute comparaison : `published_at` prime sur
    // `created_at` dans le tri, et une valeur illisible y ferait remonter n'importe quoi.
    assert.isNull(parseAsset({ id: ID, type: 'IMAGE', fileCreatedAt: 'hier' })!.takenAt)
    assert.isNull(parseAsset({ id: ID, type: 'IMAGE' })!.takenAt)
  })
})
