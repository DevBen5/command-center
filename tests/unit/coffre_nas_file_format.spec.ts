import { test } from '@japa/runner'
import { nasContentTypeFor, nasFileKindFor } from '#modules/coffre/services/nas_file_format'

/**
 * L'allow-list de formats du coffre (CC-181), **pure**. Ce qui compte : une extension hors liste
 * ne rend jamais un type deviné (`content-type` = `null`), et `kind` distingue photo/vidéo sans
 * jamais lire le contenu du fichier — seulement l'extension du chemin.
 */
test.group('Coffre / les formats de médias NAS', () => {
  test('une extension vidéo connue rend le bon content-type et kind=video', ({ assert }) => {
    assert.equal(nasContentTypeFor('films/exemple.mp4'), 'video/mp4')
    assert.equal(nasFileKindFor('films/exemple.mp4'), 'video')
  })

  test('une extension photo connue rend le bon content-type et kind=photo', ({ assert }) => {
    assert.equal(nasContentTypeFor('photos/exemple.jpg'), 'image/jpeg')
    assert.equal(nasFileKindFor('photos/exemple.jpg'), 'photo')
  })

  test('la casse de l’extension n’a pas d’effet', ({ assert }) => {
    assert.equal(nasContentTypeFor('photos/EXEMPLE.JPG'), 'image/jpeg')
    assert.equal(nasFileKindFor('photos/EXEMPLE.MP4'), 'video')
  })

  test('⚠️ une extension hors allow-list ne rend jamais un type deviné', ({ assert }) => {
    assert.isNull(nasContentTypeFor('fichier.exe'))
    assert.isNull(nasFileKindFor('fichier.exe'))
  })

  test('un chemin sans extension est refusé', ({ assert }) => {
    assert.isNull(nasContentTypeFor('fichier-sans-extension'))
    assert.isNull(nasFileKindFor('fichier-sans-extension'))
  })

  test('⚠️ une extension qui nomme une propriété héritée de `Object.prototype` est refusée, pas confondue avec une valeur héritée', ({
    assert,
  }) => {
    // `'constructor' in {}` vaut `true` et `{}['constructor']` rend la fonction `Object` — un
    // accès par `in`/crochets classerait ce chemin comme vidéo et renverrait cette fonction comme
    // content-type. `Object.hasOwn` doit fermer ça.
    assert.isNull(nasContentTypeFor('fichier.constructor'))
    assert.isNull(nasFileKindFor('fichier.constructor'))
    assert.isNull(nasContentTypeFor('fichier.toString'))
    assert.isNull(nasFileKindFor('fichier.toString'))
  })
})
